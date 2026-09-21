package com.dshtavern.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.system.Os
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.atomic.AtomicBoolean
import java.util.zip.ZipInputStream

/**
 * DSH 运行时守护服务：
 * 1. 首启把 assets/dsh-runtime.zip 解压到 filesDir/dsh-runtime（含 node_modules + lib/ 版本号 so）
 * 2. exec nativeLibraryDir/libnode.so 运行 DSH web 服务（127.0.0.1:3080）
 * 3. 进程死亡自动重启（3s 退避）
 *
 * 诊断（M1）：全部状态经 companion 对外暴露——MainActivity / WebView 桥直接读取，
 * 无需 logcat 即可观测（卓易通等兼容层真机排障用）。
 */
class NodeService : Service() {

    companion object {
        private const val TAG = "DSHTavern.Node"
        private const val CHANNEL_ID = "dshtavern_runtime"
        private const val NOTIFICATION_ID = 42000
        private const val RUNTIME_DIR = "dsh-runtime"
        private const val RUNTIME_ZIP = "dsh-runtime.zip"
        /** 解压哨兵：§4.16.2 前端 dsht-rp-ui client 变更随 runtime.zip 重发布 → v97（覆盖安装强制重解压） */
        private const val RUNTIME_SENTINEL = ".installed-v372"
        private const val DSH_PORT = 3080
        /** W-C（2026-09-21）：端口冲突探测区间（3080..3089，逐个 bind 试占用） */
        private const val PORT_PROBE_MAX = 3089
        /** W-A（2026-09-21）：LAN 代理端口 = activePort + 此偏移（避免与 loopback 同号冲突：
         *  0.0.0.0:3080 与 127.0.0.1:3080 不能共存） */
        private const val LAN_PORT_OFFSET = 10
        /** Intent action：主界面请求「按最新设置重启 node」（LAN 开关变更等启动参数面变更） */
        const val ACTION_RESTART_NODE = "com.dshtavern.app.RESTART_NODE"
        private const val OUTPUT_CAP = 200
        private const val PROOT_ROOTFS_DIR = "proot-rootfs"
        /** PRoot 真隔离（targetSdk 36：SELinux 仅允许从 nativeLibraryDir exec，busybox 实体必须是 libbusybox.so）。
         *  rootfs = 纯 symlink 林：全部指向 nativeLibraryDir/libbusybox.so（guest 内经 -b nativeLibDir 可见）。 */
        /** 【P1 2026-09-20】能力补齐包：bash/rg/zstd/git 伪装 lib*.so 在 nativeLibraryDir（SELinux
         *  唯一允许 untrusted_app exec 的位置——app_data_file 的 execve 必拒，模拟器 avc 实证）。
         *  经 symlink 暴露命令名（execve 跟随 symlink 检查最终目标，busybox applets 同款机制）：
         *   ① filesDir/dsh-runtime/bin/（node 直 spawn 用，PATH 含该目录）
         *   ② proot rootfs /bin/（sandbox 包裹的 guest 内用） */
        private val DSHT_TOOL_LINKS = linkedMapOf(
            "bash" to "libdsht-bash.so",
            "rg" to "libdsht-rg.so",
            "zstd" to "libdsht-zstd.so",
            "git" to "libdsht-git.so",
        )
        private val BUSYBOX_APPLETS = listOf(
            "sh", "ls", "cat", "echo", "printf", "pwd", "cd", "mkdir", "rmdir", "rm", "cp", "mv", "ln",
            "touch", "chmod", "chown", "head", "tail", "grep", "egrep", "fgrep", "sed", "awk", "find",
            "xargs", "sort", "uniq", "wc", "tr", "cut", "tee", "date", "uname", "whoami", "id", "env",
            "which", "true", "false", "test", "sleep", "kill", "ps", "tar", "gzip", "gunzip", "zcat",
            "dirname", "basename", "realpath", "readlink", "stat", "du", "df", "diff", "patch", "md5sum",
            "sha256sum", "base64", "od", "hexdump", "strings", "expr", "seq", "yes", "timeout", "nohup",
            "wget", "ping", "ifconfig", "netstat", "free", "top", "uptime", "sync", "mount", "umount",
            "unzip"
        )

        // ---- 诊断状态（WebView/Activity 可读）----
        @Volatile var state: String = "IDLE" // IDLE/EXTRACTING/EXTRACTED/STARTING/RUNNING/EXITED/FAILED
        @Volatile var nodeExitCode: Int? = null
        @Volatile var lastError: String? = null
        @Volatile var portOpen: Boolean = false
        @Volatile var extractedFiles: Int = 0
        @Volatile var restartCount: Int = 0
        /**
         * 【W-C 2026-09-21】实际监听端口（端口冲突自动回退的结果；缺省 3080）。
         * MainActivity 的 loadUrl / 等待屏文案 / 端口探活线程全部以它为准——
         * 不再硬编码 3080。冷启动时由 findFreePort() 确定；连续启动失败 5 次
         * 会触发一次重探测（可能在它挂掉期间端口被别人占了）。
         */
        @Volatile var activePort: Int = DSH_PORT
        /** 【W-A 2026-09-21】局域网访问开关（镜像 SharedPreferences 的 lan_enabled；
         *  服务启动与每次 node 启动时重读——开关变更经 ACTION_RESTART_NODE 生效） */
        @Volatile var lanEnabled: Boolean = false
        /** 【W-A】当前可用的局域网地址（http://<ip>:<port>/，已含端口；空 = LAN 未开或无 IPv4） */
        @Volatile var lanUrls: List<String> = emptyList()
        /**
         * 【W-B 2026-09-21】维护模式（备份/恢复期间）：true 时看门狗不再拉起 node。
         * 进入 = 停 node + 停 LAN 代理 + 失效旧看门狗；退出 = 新代看门狗重新拉起。
         * 备份/恢复必须停 node：会话 jsonl 是热写文件，活备份会带上半行残尾。
         */
        @Volatile var maintenanceMode: Boolean = false
        /** 当前服务实例（companion 维护入口用；onStartCommand 赋值，onDestroy 清空） */
        @Volatile private var instance: NodeService? = null
        /** 连续启动失败计数（端口 0→1 跳变归零；≥5 触发一次端口重探测） */
        @Volatile private var startFailStreak: Int = 0
        /**
         * watchdog 自愈（2026-09-04 手机 agent 自检实证：ANR/内存峰值被杀，重启后
         * checkpoint 续跑——本标记让"上次异常退出"对用户可见）：启动时写 .dsht-alive
         * 标记，onDestroy（正常销毁路径）删除。下次启动若标记仍在 = 上次进程级被杀
         * （LMK/ANR，无 onDestroy 回调）→ lastAbnormalExit=true + 日志留痕。
         * node 层自动重启已由 node-watchdog 线程承担，本标记只做事后归因可见性。
         */
        @Volatile var lastAbnormalExit: Boolean = false
        /**
         * 【L4 2026-09-14】沙箱降级原因（null = 未降级 / 未探测）。
         *
         * 为什么需要它：proot 不可用时 JS 层会降级为「不拒绝、无隔离执行（仅 fs 层做工作区
         * 边界）」。这是**能力降级**，用户有权知道——此前只 `console.warn`（logcat 可见、
         * UI 不可见），属「静默降级」的 UI 面缺口（P-3）。本字段把它带到等待屏。
         *
         * 取值（nil 语义用 null 表示）：
         *   · `"proot-missing"`  —— nativeLibraryDir 里没有 libproot.so / libbusybox.so
         *   · `"rootfs-failed"`  —— rootfs 搭建抛错（失败不致命，回落 fs 边界）
         */
        @Volatile var sandboxFallback: String? = null
        /**
         * web UI 认证令牌（0.1.2 新增 token 鉴权）：node stdout 打印
         * "dsh web: http://127.0.0.1:3080/?token=..."——首次 index 请求必须带
         * token 才能种下 30 天签名 cookie（HttpOnly SameSite=Strict，authority 绑定）；
         * 之后凭 cookie。MainActivity 首次 loadUrl 用带 token 的 URL。旧版 DSH
         * 无此行 → null → MainActivity 降级干净 URL。
         */
        @Volatile var webToken: String? = null
        private var tokenFileMisses = 0
        // 行首 "dsh web:" 锚定 + URL 里任意位置的 token 参数（host/端口/路径形态放宽——
        // 真机 announce URL 形态不保证 127.0.0.1 精确匹配，踩过：正则过严 → token 永不捕获）
        private val TOKEN_LINE_PREFIX = "dsh web:"
        private val TOKEN_REGEX = Regex("""[?&]token=([A-Za-z0-9_\-]+)""")
        private const val ALIVE_MARKER = ".dsht-alive"
        private val outputLines = ArrayDeque<String>()

        /**
         * watchdog 代际计数：每创建一个新 watchdog 自增；旧 watchdog 发现自己不是最新代即自杀。
         * 背景：interrupt 打在 waitFor() 上时标志会被清除并被 catch(Throwable) 吞掉，
         * 旧 watchdog 会复活——两个 watchdog 双 node 抢 3080 端口，输家 exit 1 无限重启（踩过）。
         */
        @Volatile private var watchdogGen = 0

        fun recordLine(line: String) {
            synchronized(outputLines) {
                if (outputLines.size >= OUTPUT_CAP) outputLines.removeFirst()
                outputLines.addLast(line)
            }
            // 诊断面板与 logcat 双通道（2026-09-04：probe/token 状态只在 recordLine 时
            // logcat 不可见，排障盲区——全量落 logcat，[node] 行保留原 Log.i 会有重复可接受）
            Log.d(TAG, line)
        }

        /** 诊断 JSON（JS 桥 / UI 轮询消费） */
        fun diagJson(): String {
            val o = org.json.JSONObject()
            o.put("state", state)
            o.put("portOpen", portOpen)
            o.put("activePort", activePort) // W-C：实际监听端口（冲突回退后可能 ≠3080）
            o.put("lanEnabled", lanEnabled) // W-A：局域网访问开关状态
            val lanArr = org.json.JSONArray()
            lanUrls.forEach { lanArr.put(it) }
            o.put("lanUrls", lanArr) // W-A：可用局域网地址（含端口）
            o.put("maintenanceMode", maintenanceMode) // W-B：备份/恢复进行中
            o.put("exitCode", nodeExitCode ?: org.json.JSONObject.NULL)
            o.put("lastError", lastError ?: org.json.JSONObject.NULL)
            o.put("extractedFiles", extractedFiles)
            o.put("restartCount", restartCount)
            // 【L4 2026-09-14 R8 出声】上次进程级被杀（LMK/ANR）的归因。
            // 此前 `lastAbnormalExit` **只赋值、从不暴露**（`docs/B-DEVICE-VERIFY-CHECKLIST.md`
            // 却声称等待屏已显示它 —— 文档与代码不一致，属 R7 违规）。现补上输出。
            o.put("lastAbnormalExit", lastAbnormalExit)
            // 【L4 2026-09-14 R8 出声】沙箱降级状态：proot/busybox 缺失或 rootfs 搭建失败时
            // 降级为「无进程隔离，仅 fs 层工作区边界」。此前**只在 logcat 出声**，UI 不可见
            // ⇒ 用户在「隔离已失效」的状态下使用而不自知（P-3 静默降级的 UI 面）。
            o.put("sandboxFallback", sandboxFallback ?: org.json.JSONObject.NULL)
            val arr = org.json.JSONArray()
            synchronized(outputLines) {
                outputLines.toList().takeLast(40).forEach { arr.put(it) }
            }
            o.put("output", arr)
            return o.toString()
        }

        // ---- W-B/W-D（2026-09-21）维护与自检的 companion 入口（MainActivity 调用）----

        /** 进入维护模式：停 node + 停 LAN 代理 + 失效旧看门狗（备份/恢复期间不被拉起） */
        fun enterMaintenance() {
            maintenanceMode = true
            instance?.stopForMaintenance()
        }

        /** 退出维护模式：新代看门狗拉起 node（并幂等重同步 profile 插件/symlink 林） */
        fun exitMaintenance() {
            maintenanceMode = false
            instance?.resumeFromMaintenance()
        }

        /** 按最新设置重启 node（LAN 开关等启动参数面变更后调用；看门狗新代接管） */
        fun restartNode() {
            instance?.restartNodeNow()
        }

        /** 自检（W-D）：返回 {checks:[{id,name,ok,detail,repairable}]}；实例缺席时报单条失败 */
        fun selfCheckJson(): String = instance?.runSelfCheck()
            ?: org.json.JSONObject().put("checks", org.json.JSONArray().put(
                org.json.JSONObject().put("id", "service").put("name", "运行时服务")
                    .put("ok", false).put("detail", "服务未运行").put("repairable", false),
            )).toString()

        /** 一键修补（W-D）：执行全部可修复项后重跑自检，返回最新自检 JSON */
        fun repairAndRecheck(): String {
            instance?.runBasicRepairs()
            return selfCheckJson()
        }

        /** 重装运行时（W-D 重度修复，UI 确认后调）：停 node → 删哨兵 → 重解压 → 拉起 */
        fun reinstallRuntime() {
            instance?.reinstallRuntimeNow()
        }
    }

    private val started = AtomicBoolean(false)
    private var nodeProcess: Process? = null
    private var watchdog: Thread? = null
    @Volatile private var portThread: Thread? = null
    @Volatile private var serviceAlive = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startAsForeground()
        serviceAlive = true
        instance = this
        // W-A：镜像主界面的 LAN 开关（每次 node 启动前也会重读，这里先拿初值）
        lanEnabled = getSharedPreferences("dsht", MODE_PRIVATE).getBoolean("lan_enabled", false)
        // W-A/W-B：主界面的「立即重启」请求——按最新设置（LAN 开关/trusted-host/端口）重启 node
        if (intent?.action == ACTION_RESTART_NODE) {
            recordLine("restart requested by UI (apply latest settings)")
            restartNodeNow()
            return START_STICKY
        }
        // ★ T-76（心跳 65）旧 token 必须**同步**清掉，且必须早于 startPortProbe()。
        // 原实现把"清旧"写在下面的后台线程里（要等 Thread.start() 被调度），而探活线程
        // 在此处立即启动并每秒读一次 dsht-token、在 webToken==null 时发布首个非空值
        // ⇒ 存在窗口：探活线程先读到**上一进程遗留**的 token 并发布。
        // 实机实证（两次冷启）：发布值逐字符等于上一进程的 launchToken，随后 MainActivity
        // 立刻用它 loadUrl（日志 `main-frame http 404 @ …?token=<陈旧值>`）。
        // 危害：陈旧 token ⇒ 页面在"静态前端已可服务、RPC 网关（/api 属主、sessionController）
        // 尚未挂载"的窗口内就启动 ⇒ 前端连接 generation 一次性失败且不再重臂
        //（`typert gateway: session/control: active Service "sessionController" is unavailable`）
        // ⇒ workspace.list/session.list 永远停在 phase='pending' ⇒ 工作区选择器永久卡在
        // "Loading workspaces…"，只有手动 reload 能恢复。首装/升级（重解压 ≈4 min）窗口最大
        // ⇒ 首启几乎必现；热启窗口小 ⇒ 不易复现（这正是心跳 64 判定"非缺陷"的原因）。
        // 依据：DSH 自身把 `dsh web:` 那行 stdout 定义为**唯一就绪信号**
        //（deepseek-harness/packages/bundle/web-app/src/index.ts:249-256）。
        // 只在**本次真的要拉起 node 进程**时清旧（重复 onStartCommand 时不清，
        // 免得把当次有效的回退通道删掉）。
        val coldStart = started.compareAndSet(false, true)
        if (coldStart) {
            try { File(File(filesDir, ".dsh"), "dsht-token").delete() } catch (_: Throwable) { }
        }
        startPortProbe()
        if (coldStart) {
            Thread {
                try {
                    // 异常退出检测（详见 ALIVE_MARKER 注释）：标记残留 = 上次进程级被杀
                    val marker = File(filesDir, ALIVE_MARKER)
                    if (marker.exists()) {
                        lastAbnormalExit = true
                        val prev = marker.readText().trim()
                        recordLine("RECOVERED: 上次异常退出（标记 $prev），会话数据完好，checkpoint 续跑")
                        Log.w(TAG, "previous run did not exit cleanly (marker=$prev)")
                    }
                    try { marker.writeText("${System.currentTimeMillis()}") } catch (_: Throwable) { }
                    // token 文件清旧已**上移到 onStartCommand 同步执行**（T-76：必须早于
                    // startPortProbe()，否则探活线程会先发布上一进程的陈旧 token）。此处不再重复。
                    state = "EXTRACTING"
                    ensureRuntime()
                    ensureRpPluginPatch()
                    ensureProotRootfs()
                    ensureToolLinks()
                    state = "EXTRACTED"
                    // W-C：首次启动前确定实际端口（3080 被占则顺延 3081..3089）
                    activePort = findFreePort()
                    if (activePort != DSH_PORT) recordLine("port $DSH_PORT busy → fallback to $activePort")
                    startNodeForever()
                } catch (t: Throwable) {
                    state = "FAILED"
                    lastError = t.message ?: t.javaClass.name
                    recordLine("FATAL: ${lastError}")
                    Log.e(TAG, "runtime failed", t)
                }
            }.start()
        }
        return START_STICKY
    }

    /** 端口探活线程：每秒 TCP 连 127.0.0.1:activePort（比 WebView 报错可靠）+ token 文件轮询 */
    private fun startPortProbe() {
        if (portThread != null) return
        portThread = Thread {
            var lastPort = false
            while (serviceAlive) {
                portOpen = try {
                    Socket().use { s ->
                        s.connect(InetSocketAddress("127.0.0.1", activePort), 400)
                        true
                    }
                } catch (_: Exception) {
                    false
                }
                // 端口 0→1 跳变 = node 真的起来了 ⇒ 连续失败计数归零（W-C 重探测的复位条件）
                if (portOpen && !lastPort) startFailStreak = 0
                lastPort = portOpen
                // token 文件轮询（APK 坑 #12：卓易通/鸿蒙上 node stdout 管道可能整段静默，
                // stdout 捕获链拿不到 token——插件进程内写 $DSH_HOME/dsht-token 作旁路通道；
                // NodeService 启动 node 前删旧文件，此处读到的一定是本次进程的 token）
                if (webToken == null) {
                    try {
                        val tf = File(File(filesDir, ".dsh"), "dsht-token")
                        if (tf.exists()) {
                            val t = tf.readText().trim()
                            if (t.isNotEmpty()) {
                                webToken = t
                                recordLine("web token captured from dsht-token file (${t.length} chars)")
                            } else if (portOpen) {
                                recordLine("token file exists but empty")
                            }
                        } else if (portOpen) {
                            tokenFileMisses += 1
                            if (tokenFileMisses == 15 || tokenFileMisses == 60) {
                                recordLine("token file not found yet (miss #$tokenFileMisses, port open)")
                            }
                        }
                    } catch (e: Throwable) {
                        recordLine("token file read error: ${e.message}")
                    }
                }
                try {
                    Thread.sleep(1000)
                } catch (_: InterruptedException) {
                    break
                }
            }
        }.apply { name = "port-probe"; isDaemon = true; start() }
    }

    private fun startAsForeground() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "DSHTavern 运行时", NotificationManager.IMPORTANCE_LOW)
        )
        val notification: Notification = Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("DSHTavern")
            .setContentText("DSH 运行时运行中")
            .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
            // §4.16.2 B 类：点击通知回主界面（singleTask：运行中走 onNewIntent，
            // 深链在 MainActivity 侧处理——本通知不带 dsht:// 数据，仅回前台）
            .setContentIntent(buildContentIntent())
            .build()
        if (Build.VERSION.SDK_INT >= 34) {
            // API 34+：specialUse —— dataSync 在 Android 15+ 有 6 小时强制超时（超时后
            // 系统停前台服务 → node 失去庇护被 LMK 杀 → 长会话必断，真机鸿蒙 6 实证）；
            // DSH 运行时是常驻本地 web 服务，specialUse 无超时（manifest 已带 subtype 说明）
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        }
    }

    /** 通知点击 → 回主界面（不动既有保活/看门狗逻辑，仅通知补 PendingIntent） */
    private fun buildContentIntent(): PendingIntent = PendingIntent.getActivity(
        this, 0, Intent(this, MainActivity::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    /**
     * RP 插件就位 + profile patch 幂等写入：
     * 1) 把 runtime 里打包的 dsht-rp-plugin 拷进 profile 自己的 node_modules
     *    （loader 的包名解析基准是 profile 目录——dsh plugin add 的同款布局）
     * 2) cordis.patch.yml 写 insert 行（官方叠加层，不动官方包）
     */
    private fun ensureRpPluginPatch() {
        try {
            val webProfile = File(filesDir, ".dsh/profiles/web")
            ensureProfileMetadata(webProfile)
            // 1. 插件拷贝（幂等：目标缺失或内容不同则覆盖）
            //    插件合并（用户定案）：dsht-rp-plugin 单包装双面——lib/index.js（node 宿主）
            //    + lib/client.js（浏览器 wire 契约，dsh.client 声明进 boot graph）
            // 0.1.2 pitfall #15: strict slot declaration checks; external edges force official
            // client modules to apply first (keep in sync with build-dsht.ps1).
            val rpMergedPkgJson = "{\"name\":\"dsht-rp-plugin\",\"version\":\"1.0.0\",\"type\":\"module\",\"main\":\"lib/index.js\",\"exports\":{\".\":\"./lib/index.js\",\"./client\":\"./lib/client.js\",\"./package.json\":\"./package.json\"},\"dsh\":{\"client\":{\"platform\":\"web\",\"external\":[\"@deepseek-ai/dsh-client-ui-sidebar\",\"@deepseek-ai/dsh-client-ui-layout\",\"@deepseek-ai/dsh-client-ui-conversation\",\"@deepseek-ai/dsh-client-ui-settings-plugins\"]}}}"
            copyPackage(webProfile, "dsht-rp-plugin", "lib/index.js", rpMergedPkgJson)
            copyPackage(webProfile, "dsht-rp-plugin", "lib/client.js", rpMergedPkgJson)
            // T2.11：dsht-rp-plugin 的 assets（嵌入导入中心 iframe 页面 + 引擎 bundle）随插件拷贝——
            // 否则 Android 上 readAsset('../assets/…') 404（PC 验证环境由 setup-pc-verify 拷贝，这里补 Android 侧）
            copyPackageDir(webProfile, "dsht-rp-plugin", "assets")
            // 旧布局清理：独立 dsht-rp-ui 包已并入 dsht-rp-plugin（老安装升级时删掉旧包与 patch 行）
            val legacyUi = File(webProfile, "node_modules/dsht-rp-ui")
            if (legacyUi.exists()) legacyUi.deleteRecursively()
            // R10 三大插件（MVU / 酒馆助手 / 提示词模板）+ 剧情记忆（楼层总结）：单产物 lib/index.js，无 assets
            // 【T-88】package.json 字段与构建脚本（rebuild-plugins.ps1 / build-dsht.ps1）同源同值
            // （dsh.bundle.patch 声明在 Android 不被消费——profile patch 由本服务手写；但字段保持
            //   一致防「同名包两侧两个形状」的漂移，T-88 拆包纪律）
            for (pkg in listOf("dsht-plugin-mvu", "dsht-plugin-tavern-helper", "dsht-plugin-prompt-template", "dsht-plugin-memory")) {
                copyPackage(webProfile, pkg, "lib/index.js",
                    "{\"name\":\"$pkg\",\"version\":\"1.0.0\",\"type\":\"module\",\"main\":\"lib/index.js\",\"dsh\":{\"bundle\":{\"patch\":\"./cordis.patch.yml\"}}}")
            }
            // 【T-88 补】prompt-template 的 EJS worker 必须随包拷贝（workerPath = 与 lib/index.js 同目录；
            // 缺失时 Worker 构造失败 ⇒ **静默**退化为同步渲染——此前总包/独立包两种形态下都漏拷）
            copyPackage(webProfile, "dsht-plugin-prompt-template", "lib/ejs-worker.js",
                "{\"name\":\"dsht-plugin-prompt-template\",\"version\":\"1.0.0\",\"type\":\"module\",\"main\":\"lib/index.js\",\"dsh\":{\"bundle\":{\"patch\":\"./cordis.patch.yml\"}}}")
            // dsht-plugin-mobile（Step 4.77 双面形态）：patch 行在 pluginRows 里，缺拷贝会导致
            // loader 启动即崩（Cannot find package 'dsht-plugin-mobile'）
            val mobilePkgJson = "{\"name\":\"dsht-plugin-mobile\",\"version\":\"1.0.0\",\"type\":\"module\",\"main\":\"lib/index.js\",\"exports\":{\".\":\"./lib/index.js\",\"./client\":\"./lib/client.js\",\"./package.json\":\"./package.json\"},\"dsh\":{\"client\":{\"platform\":\"web\",\"external\":[\"@deepseek-ai/dsh-client-ui-layout\"]}}}"
            copyPackage(webProfile, "dsht-plugin-mobile", "lib/index.js", mobilePkgJson)
            copyPackage(webProfile, "dsht-plugin-mobile", "lib/client.js", mobilePkgJson)
            // dsh-preset-enhance（bychv，MIT）：完整 npm 包形态（lib/ web/ agent-mode/ + 原样 package.json），
            // 整包树同步；注入面 = llm/stream 消息编译（与 RP 的 pre-step 快照管线默认不冲突：
            // 它只在会话被显式启用或命中自动启用模式时编译，默认配置下两边各管各的会话）
            copyPackageTree(webProfile, "dsh-preset-enhance")
            // 2. patch 写入（按包名逐个补齐 insert 行——已有安装升级时旧块不动，
            //    缺失的行以新的顶层 - insert 列表追加，cordis patch 允许多个 insert 操作）
            val pluginRows = listOf(
                "dsht-rp" to "dsht-rp-plugin",
                "dsht-mvu" to "dsht-plugin-mvu",
                "dsht-tavern-helper" to "dsht-plugin-tavern-helper",
                "dsht-prompt-template" to "dsht-plugin-prompt-template",
                "dsht-mobile" to "dsht-plugin-mobile",
                "dsht-memory" to "dsht-plugin-memory",
                "preset-enhance" to "dsh-preset-enhance",
            )
            val patch = File(webProfile, "cordis.patch.yml")
            // 旧布局清理：老安装 patch 里的 dsht-rp-ui 行指向已删除的包，必须摘除（loader 会报缺包）
            if (patch.exists()) {
                val t0 = patch.readText()
                if (t0.contains("dsht-rp-ui")) {
                    val cleaned = t0.lines()
                        .filter { !it.contains("dsht-rp-ui") }
                        .joinToString("\n")
                    patch.writeText(if (cleaned.endsWith("\n")) cleaned else cleaned + "\n")
                    recordLine("legacy dsht-rp-ui patch row removed")
                }
            }
            val rowsText = pluginRows.joinToString("\n") { (id, pkg) -> "    - id: $id\n      name: '$pkg'" }
            val insertBlock = "# DSHTavern RP 插件（node 侧 + 浏览器侧 + R10 三大插件，由 NodeService 幂等维护）\n- insert:\n$rowsText"
            if (!patch.exists()) {
                webProfile.mkdirs()
                patch.writeText("$insertBlock\n")
                return
            }
            val text = patch.readText()
            val missing = pluginRows.filter { (_, pkg) -> !text.contains("name: '$pkg'") }
            if (missing.isEmpty()) return // 全部就位
            val newRows = "- insert:\n" + missing.joinToString("\n") { (id, pkg) -> "    - id: $id\n      name: '$pkg'" }
            val updated = if (text.lines().any { it.trim() == "[]" })
                text.lines().joinToString("\n") { line -> if (line.trim() == "[]") newRows else line } + "\n"
            else
                text.trimEnd() + "\n$newRows\n"
            patch.writeText(updated)
            recordLine("rp plugin patch applied to profile (added: ${missing.joinToString(",") { it.first }})")
        } catch (t: Throwable) {
            recordLine("rp plugin patch skipped: ${t.message}")
        }
    }

    /**
     * web profile 元数据修复（2026-09-04 真机"等待令牌"根因）：0.1.2 的 profile 走
     * `dsh.profile.bundles` 机制（dsh-base + dsh-web-app，见 cordis.yml/package.json/
     * pnpm-workspace.yaml 三件套）；旧版本时期创建的 profile 元数据形态不同 → 0.1.2
     * loader 挂起且 **announce 静默**（web-app 的 loader reject 分支为空函数）→
     * token 永不打印 → MainActivity 永等。PC 纯净 home 复刻（0.1.2 自初始化三件套）
     * 装载正常，真机旧 profile 卡死——本函数把三件套对齐 0.1.2 标准形态（内容为
     * 0.1.2 首启实证的固定值；社区插件走 cordis.patch.yml insert，不依赖 bundles）。
     */
    private fun ensureProfileMetadata(webProfile: File) {
        webProfile.mkdirs()
        val cordisYml = File(webProfile, "cordis.yml")
        val cordisCanonical = """
            |# dsh profile root — an empty entry list. The tree is composed as patches:
            |# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any
            |# --patch overlays. Edit cordis.patch.yml, not this file.
            |[]
        """.trimMargin("|") + "\n"
        if (!cordisYml.exists() || !cordisYml.readText().contains("dsh profile root")) {
            cordisYml.writeText(cordisCanonical)
            recordLine("profile cordis.yml aligned to 0.1.2 canonical form")
        }
        val pkgJson = File(webProfile, "package.json")
        val pkgCanonical = """
            |{
            |  "name": "dsh-profile-web",
            |  "private": true,
            |  "dependencies": {},
            |  "dsh": {
            |    "profile": {
            |      "bundles": [
            |        "@deepseek-ai/dsh-base",
            |        "@deepseek-ai/dsh-web-app"
            |      ],
            |      "patchReload": "live"
            |    }
            |  }
            |}
        """.trimMargin("|") + "\n"
        if (!pkgJson.exists() || !pkgJson.readText().contains("dsh-web-app")) {
            pkgJson.writeText(pkgCanonical)
            recordLine("profile package.json aligned to 0.1.2 canonical form")
        }
        val wsYml = File(webProfile, "pnpm-workspace.yaml")
        val wsCanonical = "packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n"
        if (!wsYml.exists() || !wsYml.readText().contains("nodeLinker: hoisted")) {
            wsYml.writeText(wsCanonical)
            recordLine("profile pnpm-workspace.yaml aligned to 0.1.2 canonical form")
        }
    }

    /** 把 runtime node_modules 里的 DSHT 插件包拷进 web profile（幂等：产物文件比对）。 */
    private fun copyPackage(webProfile: File, pkgName: String, artifactRel: String, pkgJson: String) {
        val src = File(filesDir, "dsh-runtime/node_modules/$pkgName")
        val dst = File(webProfile, "node_modules/$pkgName")
        if (!src.isDirectory) return
        // package.json 独立于产物比对（坑 #16：产物 esbuild 确定性输出字节相同时，
        // 声明变更（如 dsh.client.external）永远不会同步进 profile → boot graph 不更新）
        val pkgFile = File(dst, "package.json")
        val pkgChanged = try { !pkgFile.exists() || pkgFile.readText() != pkgJson } catch (_: Throwable) { true }
        if (pkgChanged) {
            dst.mkdirs()
            pkgFile.writeText(pkgJson)
            recordLine("$pkgName package.json updated in profile")
        }
        val srcFile = File(src, artifactRel)
        val dstFile = File(dst, artifactRel)
        var needCopy = !dstFile.exists() || dstFile.length() != srcFile.length()
        if (!needCopy) {
            val a = srcFile.readBytes(); val b = dstFile.readBytes()
            needCopy = !a.contentEquals(b)
        }
        if (needCopy) {
            dstFile.parentFile?.mkdirs()
            srcFile.copyTo(dstFile, overwrite = true)
            recordLine("$pkgName copied to profile node_modules")
        }
    }

    /** 拷贝插件包内整个子目录（幂等：逐个文件比对）。T2.11：dsht-rp-plugin/assets（导入中心页面）。 */
    private fun copyPackageDir(webProfile: File, pkgName: String, dirRel: String) {
        val srcDir = File(filesDir, "dsh-runtime/node_modules/$pkgName/$dirRel")
        if (!srcDir.isDirectory) return
        val dstDir = File(webProfile, "node_modules/$pkgName/$dirRel")
        var copied = 0
        srcDir.walkTopDown().filter { it.isFile }.forEach { srcFile ->
            val rel = srcFile.relativeTo(srcDir).path
            val dstFile = File(dstDir, rel)
            var needCopy = !dstFile.exists() || dstFile.length() != srcFile.length()
            if (!needCopy) {
                needCopy = !srcFile.readBytes().contentEquals(dstFile.readBytes())
            }
            if (needCopy) {
                dstFile.parentFile?.mkdirs()
                srcFile.copyTo(dstFile, overwrite = true)
                copied++
            }
        }
        if (copied > 0) recordLine("$pkgName/$dirRel copied to profile node_modules ($copied files)")
    }

    /**
     * 整包拷贝（幂等：逐个文件字节比对，含 package.json）。
     * 用于「完整 npm 包形态」的第三方插件（首个实例：dsh-preset-enhance，
     * bychv/dsh-preset-enhance，MIT）——它与 copyPackage 的单产物形态不同：
     * 包内有多层目录（lib/ web/ agent-mode/）且 package.json 必须原样保留
     * （含 dsh.bundle.patch / dsh.client / engines 声明，不能由本服务硬编码重写）。
     * 反向清理：源包消失（构建期移除）时清掉 profile 里的整包目录。
     */
    private fun copyPackageTree(webProfile: File, pkgName: String) {
        val srcDir = File(filesDir, "dsh-runtime/node_modules/$pkgName")
        val dstDir = File(webProfile, "node_modules/$pkgName")
        if (!srcDir.isDirectory) {
            if (dstDir.exists()) { dstDir.deleteRecursively(); recordLine("$pkgName removed from profile (source gone)") }
            return
        }
        var copied = 0
        srcDir.walkTopDown().filter { it.isFile }.forEach { srcFile ->
            val rel = srcFile.relativeTo(srcDir).path
            val dstFile = File(dstDir, rel)
            var needCopy = !dstFile.exists() || dstFile.length() != srcFile.length()
            if (!needCopy) {
                needCopy = !srcFile.readBytes().contentEquals(dstFile.readBytes())
            }
            if (needCopy) {
                dstFile.parentFile?.mkdirs()
                srcFile.copyTo(dstFile, overwrite = true)
                copied++
            }
        }
        // 源里已删除的文件在 profile 侧同步清掉（版本升级减文件时不留残）
        if (dstDir.isDirectory) {
            dstDir.walkTopDown().filter { it.isFile }.forEach { dstFile ->
                val rel = dstFile.relativeTo(dstDir).path
                if (!File(srcDir, rel).exists()) { dstFile.delete(); copied++ }
            }
        }
        if (copied > 0) recordLine("$pkgName tree synced to profile node_modules ($copied changes)")
    }

    /** 首启解压运行时；已安装则跳过（sentinel 标记）。 */
    private fun ensureRuntime() {
        val runtimeDir = File(filesDir, RUNTIME_DIR)
        val sentinel = File(runtimeDir, RUNTIME_SENTINEL)
        if (sentinel.exists()) {
            extractedFiles = -1 // 已安装标记（计数不重算）
            recordLine("runtime already installed at ${runtimeDir.path}")
            return
        }
        Log.i(TAG, "extracting runtime to ${runtimeDir.path} …")
        recordLine("extracting runtime → ${runtimeDir.path}")
        runtimeDir.mkdirs()
        assets.open(RUNTIME_ZIP).use { ais ->
            ZipInputStream(ais.buffered()).use { zip ->
                var entry = zip.nextEntry
                val buf = ByteArray(1 shl 16)
                var count = 0
                while (entry != null) {
                    val out = File(runtimeDir, entry.name)
                    if (entry.isDirectory) {
                        out.mkdirs()
                    } else {
                        out.parentFile?.mkdirs()
                        FileOutputStream(out).use { fos ->
                            while (true) {
                                val n = zip.read(buf)
                                if (n < 0) break
                                fos.write(buf, 0, n)
                            }
                        }
                        if (entry.time > 0) out.setLastModified(entry.time)
                    }
                    zip.closeEntry()
                    entry = zip.nextEntry
                    count++
                    extractedFiles = count
                    if (count % 2000 == 0) recordLine("extracted $count files…")
                }
                recordLine("extract done: $count files")
                Log.i(TAG, "extract done: $count files")
            }
        }
        sentinel.writeText("ok")
        // 【2026-09-08 鲁棒性】历史哨兵清理：每次升级只写新文件不删旧（实机 28 个残留
        // .installed-v123..v177），build-info 的目录序 find() 因此恒报最旧版本。解压
        // 成功发布新哨兵后，清掉其余 .installed-v* 旧标记（幂等）。
        runtimeDir.listFiles { f -> f.name.startsWith(".installed-v") && f.name != RUNTIME_SENTINEL }
            ?.forEach { it.delete() }
    }

    /**
     * PRoot rootfs 搭建（幂等）：filesDir/proot-rootfs 下纯 symlink 林。
     * 每次启动都跑（覆盖安装后 nativeLibraryDir 路径哈希变化，symlink 需重指）。
     * proot/busybox 二进制缺失时不建 rootfs —— JS 补丁层探测 DSHT_PROOT_BIN 不存在即回退 fs 边界。
     */
    private fun ensureProotRootfs() {
        try {
            val nativeLib = File(applicationInfo.nativeLibraryDir)
            val prootBin = File(nativeLib, "libproot.so")
            val busyboxBin = File(nativeLib, "libbusybox.so")
            if (!prootBin.exists() || !busyboxBin.exists()) {
                // 【L4 2026-09-14】不只 logcat：把降级原因带到等待屏（见 sandboxFallback 注释）
                sandboxFallback = "proot-missing"
                recordLine("proot/busybox missing in ${nativeLib.path}; sandbox keeps fs-boundary fallback")
                return
            }
            // proot loader 必须有 exec 位（zip 解压不带权限位；proot 会把它拷成临时文件交给内核执行，
            // 实测缺 +x 时 execve EACCES 直接失败）
            val rtLib = File(filesDir, "$RUNTIME_DIR/lib")
            for (name in listOf("proot-loader", "proot-loader32")) {
                val f = File(rtLib, name)
                if (f.exists()) try { Os.chmod(f.path, 493) } catch (_: Throwable) {}
            }
            val rootfs = File(filesDir, PROOT_ROOTFS_DIR)
            val bbLink = File(rootfs, "bin/busybox")
            var current: String? = null
            try { current = Os.readlink(bbLink.path) } catch (_: Throwable) {}
            if (current != busyboxBin.absolutePath) {
                rootfs.deleteRecursively()
                listOf("bin", "system/bin", "usr/bin", "sbin", "tmp").forEach { File(rootfs, it).mkdirs() }
                Os.symlink(busyboxBin.absolutePath, bbLink.path)
                for (dir in listOf("bin", "system/bin", "usr/bin", "sbin")) {
                    for (applet in BUSYBOX_APPLETS) {
                        val link = File(rootfs, "$dir/$applet")
                        try { Os.symlink("/bin/busybox", link.path) } catch (_: Throwable) {}
                    }
                }
                recordLine("proot rootfs rebuilt at ${rootfs.path} (busybox -> ${busyboxBin.path})")
            } else {
                recordLine("proot rootfs ready at ${rootfs.path}")
            }
        } catch (t: Throwable) {
            // 失败不致命：JS 层探测不到可用 proot 会自动回退 warn+fs 边界
            // 【L4 2026-09-14】同样带到等待屏（见 sandboxFallback 注释）
            sandboxFallback = "rootfs-failed"
            recordLine("proot rootfs setup failed: ${t.message} (fallback stays)")
        }
    }

    /**
     * 【P1 2026-09-20】能力工具 symlink 林（幂等，每次启动都跑——覆盖安装后 nativeLibraryDir
     * 路径哈希变化，symlink 需重指）。
     *  ① filesDir/dsh-runtime/bin/<cmd> → nativeLibraryDir/libdsht-*.so（node 直 spawn 用，PATH 含）
     *  ② proot rootfs /bin/<cmd> → 同上（sandbox 包裹的 guest 内用，nativeLibDir 已被 bind）
     * 自测：bash --version 直跑一次（app 域真实 exec 验证），结果写诊断面板。
     */
    private fun ensureToolLinks() {
        val nld = applicationInfo.nativeLibraryDir
        val homes = listOf(
            File(filesDir, "$RUNTIME_DIR/bin"),
            File(filesDir, "$PROOT_ROOTFS_DIR/bin"),
        )
        var linked = 0
        for (dir in homes) {
            dir.mkdirs()
            for ((cmd, so) in DSHT_TOOL_LINKS) {
                val target = File(nld, so)
                if (!target.exists()) continue
                val link = File(dir, cmd)
                var cur: String? = null
                try { cur = Os.readlink(link.path) } catch (_: Throwable) {}
                if (cur == target.absolutePath) { linked++; continue }
                link.delete()
                try { Os.symlink(target.absolutePath, link.path); linked++ } catch (_: Throwable) {}
            }
        }
        // 自测（真实 app 域 exec 验证；run-as 的 runas_app 域是 granted 不能代表——SELinux 实证）
        for (cmd in DSHT_TOOL_LINKS.keys) {
            val bin = File(filesDir, "$RUNTIME_DIR/bin/$cmd")
            if (!bin.exists()) { recordLine("P1 tool self-test: $cmd MISSING"); continue }
            try {
                val p = ProcessBuilder(bin.absolutePath, "--version")
                    .redirectErrorStream(true).apply {
                        // 与 node 进程同款库路径（bash 依赖 readline/ncursesw/iconv/android-support）
                        environment()["LD_LIBRARY_PATH"] =
                            applicationInfo.nativeLibraryDir + ":" + File(filesDir, "$RUNTIME_DIR/lib").absolutePath
                    }.start()
                val out = p.inputStream.bufferedReader().readText().trim().lineSequence().firstOrNull() ?: ""
                val rc = p.waitFor()
                recordLine("P1 tool self-test: $cmd rc=$rc ${out.take(70)}")
            } catch (t: Throwable) {
                recordLine("P1 tool self-test: $cmd FAILED ${t.message}")
            }
        }
        recordLine("P1 tool links ready ($linked/${DSHT_TOOL_LINKS.size * homes.size})")
    }

    /**
     * 【T-67 / 心跳 62】pre-boot 静态预检的 NODE_OPTIONS 片段。
     *
     * **为什么必须放在这一层**：`dsh-workspace` 在 **`[cordis.init]` 插件树加载期**枚举会话
     * header（`listStoredHeaders` → `listArtifacts` → `assertStoredIdentity`），一旦某个会话
     * 目录名 ≠ `projectKey(header.cwd)` 就抛 `corrupt session log` → `plugin tree failed to load`
     * → node exit 1 → 本文件 watchdog 每 3 秒重启一次 → **无限 crash-loop，整机不可用**。
     * 我方所有会话修复器都住在**插件体内**，这一层根本够不着（LEARNINGS **L88**）。
     *
     * **为什么用 `--import` 而不是改官方入口**：官方源零修改是合规红线。`--import` 让 node 在
     * 主入口求值**之前**先跑我们的模块（`dsht-preflight` 内部用顶层 await，故不存在
     * "预检还在搬目录、插件树已经开始枚举"的竞态）。
     *
     * `file://` 前缀用字符串拼而非 `File.toURI()`：后者产出 `file:/data/…`（单斜杠形态），
     * URL 解析虽能归一化，但没必要赌传输层的宽容度 —— 用规范的三斜杠形态。
     * 产物不存在时返回空串（**fail-open**）：预检缺失只该意味着"防线为空"，
     * 绝不该让 app 起不来（`build-wb.sh` 的 **A8** 断言负责让它不会静默缺失）。
     */
    private fun preflightOption(preflight: File): String =
        if (preflight.exists()) " --import file://${preflight.absolutePath}" else ""

    /** 启动 node 并守护：进程退出后 3 秒重启，直到服务销毁。 */
    private fun startNodeForever() {
        val nodeBin = File(applicationInfo.nativeLibraryDir, "libnode.so")
        val runtimeDir = File(filesDir, RUNTIME_DIR)
        val entry = File(runtimeDir, "node_modules/@deepseek-ai/dsh/lib/bin.js")
        // 【T-67 / 心跳 62】壳侧 **pre-boot 静态预检**产物路径（见下方 NODE_OPTIONS 注释）。
        val preflight = File(runtimeDir, "node_modules/dsht-preflight/lib/index.js")
        recordLine("nodeBin: ${nodeBin.absolutePath} (exists=${nodeBin.exists()})")
        recordLine("entry: ${entry.absolutePath} (exists=${entry.exists()})")
        recordLine("preflight: ${preflight.absolutePath} (exists=${preflight.exists()})")
        recordLine("LD path: ${applicationInfo.nativeLibraryDir}:${File(runtimeDir, "lib").absolutePath}")
        check(nodeBin.exists()) { "libnode.so missing in ${applicationInfo.nativeLibraryDir}" }
        check(entry.exists()) { "dsh bin.js missing in ${runtimeDir.path}" }

        watchdog = Thread {
            val myGen = ++watchdogGen // 新代上岗：旧代 watchdog（若有）将检测到代际落后而退出
            while (!Thread.currentThread().isInterrupted && myGen == watchdogGen && serviceAlive) {
                // W-B：维护模式（备份/恢复）期间不拉起 node，本代看门狗直接退役
                if (maintenanceMode) {
                    recordLine("maintenance mode: watchdog stands down")
                    break
                }
                // W-C：连续 5 次起不来 → 端口可能在 node 缺席期间被别人占了，重探测一次
                if (startFailStreak >= 5) {
                    val prev = activePort
                    activePort = findFreePort()
                    startFailStreak = 0
                    recordLine("start failed 5 times; port re-probe: $prev → $activePort")
                }
                // W-A：每次启动重读开关（立即重启路径下新值生效）并同步 LAN 代理
                lanEnabled = getSharedPreferences("dsht", MODE_PRIVATE).getBoolean("lan_enabled", false)
                ensureLanProxy()
                try {
                    state = "STARTING"
                    restartCount += 1
                    startFailStreak += 1
                    recordLine("starting node (attempt $restartCount, port $activePort, lan=$lanEnabled)…")
                    Log.i(TAG, "starting node: $nodeBin")
                    // W-C/W-A：--port 指定实际端口；LAN 开时给 /api 信任栅栏登记
                    // 本机各 IPv4 的代理地址（DSH 官方 flag，不动上游源码）
                    val args = mutableListOf(
                        nodeBin.absolutePath,
                        // --expose-internals：cordis-plugin-hmr 必需（缺它启动即崩）
                        "--expose-internals",
                        entry.absolutePath, "web", "--no-open",
                        "--port", activePort.toString(),
                    )
                    if (lanEnabled) {
                        for (ip in lanIpv4s()) {
                            args.add("--trusted-host")
                            args.add("$ip:${activePort + LAN_PORT_OFFSET}")
                        }
                    }
                    val pb = ProcessBuilder(args).apply {
                        redirectErrorStream(true)
                        environment().apply {
                            put("HOME", filesDir.absolutePath)
                            put("DSH_NO_OPEN", "1")
                            // 双库路径：nativeLibraryDir（纯 .so）+ runtime lib/（带版本号 so）
                            put("LD_LIBRARY_PATH",
                                applicationInfo.nativeLibraryDir + ":" + File(runtimeDir, "lib").absolutePath)
                            // 【P1 2026-09-20】runtime bin/ 入 PATH：bash/rg/zstd/git 的 symlink 林
                            // （ensureToolLinks 维护 → nativeLibraryDir 伪装 .so；dsh-subprocess-local
                            // resolveExecutable 走 env PATH 发现命令名）
                            put("PATH", applicationInfo.nativeLibraryDir + ":" +
                                File(runtimeDir, "bin").absolutePath + ":" + (get("PATH") ?: ""))
                            // 平台补丁（terminal-bash / fs-search）按此定位真工具；缺失即走各自降级
                            put("DSHT_RUNTIME_BIN_DIR", File(runtimeDir, "bin").absolutePath)
                            // V8 老生代堆上限 2048MB：node 默认按物理内存扩堆（手机上可达数 GB），
                            // 无上限 → 后台挂机缓慢膨胀 → LMK 整进程杀（会话断）。上限 = 失败
                            // 模式选择：撞上限只是单个请求报错（可控），总比进程死好。实测锚点：
                            // 用户最大会话 12.38MB jsonl（320 条消息、单条内嵌状态栏 HTML +
                            // MVU 变量，对象树膨胀 10x+）→ 512 必挂（"历史加载失败"真机回归
                            // 实证）、1024 临界 → 2048 给足余量（12GB RAM 设备安全）。
                            put("NODE_OPTIONS",
                                "--max-old-space-size=2048" + preflightOption(preflight))
                            put("TMPDIR", cacheDir.absolutePath)
                            // PRoot 真隔离：JS 补丁层（dsh-sandbox-local DSHT-ANDROID-PROOT）读这些 env 组装 proot argv；
                            // 缺失/探测失败时 JS 层自动回退 warn+fs 边界（见 build-dsht.ps1 Step 3.5）
                            put("DSHT_PROOT_BIN", File(applicationInfo.nativeLibraryDir, "libproot.so").absolutePath)
                            put("DSHT_PROOT_ROOTFS", File(filesDir, PROOT_ROOTFS_DIR).absolutePath)
                            put("DSHT_NATIVE_LIB_DIR", applicationInfo.nativeLibraryDir)
                            put("DSHT_RUNTIME_LIB_DIR", File(runtimeDir, "lib").absolutePath)
                            put("PROOT_LOADER", File(runtimeDir, "lib/proot-loader").absolutePath)
                            put("PROOT_TMP_DIR", cacheDir.absolutePath)
                            // T-27（2026-09-11 心跳 46）：把 APK 自身版本号交给运行时。
                            // 动机：会话里能查"DSH 运行时版本"和"解压哨兵"，却查不到
                            // **这个 APK 是什么版本** —— 而"检查更新"必须拿它当比较基准。
                            // BuildConfig.VERSION_NAME/CODE 由 Gradle 注入，永远与
                            // build.gradle.kts 一致（不手抄，避免版本号漂移）。
                            put("DSHT_APP_VERSION", BuildConfig.VERSION_NAME)
                            put("DSHT_APP_VERSION_CODE", BuildConfig.VERSION_CODE.toString())
                            // 目标 ABI：更新源可能同时挂 arm64/x86_64 两个包，按本机挑对应资产
                            put("DSHT_APP_ABI", Build.SUPPORTED_ABIS.firstOrNull() ?: "")
                            // W-A：LAN 开关经 env 传给我方插件的信任栅栏（lanMode 判定见
                            // dsht-plugin-shared/http.ts isTrusted；DSH 本体的 /api 栅栏
                            // 走上面的 --trusted-host）。关 = 不设置（loopback 语义）
                            if (lanEnabled) put("DSHT_LAN_MODE", "1")
                        }
                        directory(runtimeDir)
                    }
                    nodeProcess = pb.start()
                    state = "RUNNING"
                    recordLine("node process started")
                    Thread {
                        try {
                            nodeProcess?.inputStream?.bufferedReader()?.forEachLine { line ->
                                recordLine(line)
                                Log.i(TAG, "[node] $line")
                                // 0.1.2 token 鉴权：捕获 web URL 的 launch token（详见 webToken 注释）
                                if (line.startsWith(TOKEN_LINE_PREFIX)) {
                                    TOKEN_REGEX.find(line)?.let { m ->
                                        webToken = m.groupValues[1]
                                        recordLine("web token captured (${webToken?.length ?: 0} chars)")
                                    }
                                }
                            }
                        } catch (_: Throwable) {
                        }
                    }.start()
                    val code = nodeProcess?.waitFor()
                    state = "EXITED"
                    nodeExitCode = code
                    recordLine("node exited with code $code; restart in 3s")
                    Log.w(TAG, "node exited with code $code; restart in 3s")
                } catch (t: Throwable) {
                    state = "FAILED"
                    lastError = "${t.javaClass.simpleName}: ${t.message}"
                    recordLine("START FAILED: $lastError")
                    Log.e(TAG, "node start failed", t)
                }
                if (Thread.currentThread().isInterrupted || myGen != watchdogGen || !serviceAlive) break
                try {
                    Thread.sleep(3000)
                } catch (_: InterruptedException) {
                    break
                }
            }
        }.apply { name = "node-watchdog"; start() }
    }

    // ---------------------------------------------------------------------------
    // W-C（2026-09-21）端口冲突自动回退
    // ---------------------------------------------------------------------------

    /** 3080..3089 逐个试 bind，返回第一个可用端口（全占则抛错——好于静默起不来） */
    private fun findFreePort(): Int {
        for (p in DSH_PORT..PORT_PROBE_MAX) {
            try {
                java.net.ServerSocket().use { ss ->
                    ss.reuseAddress = false
                    ss.bind(InetSocketAddress("127.0.0.1", p))
                    return p
                }
            } catch (_: Exception) { /* 被占，试下一个 */ }
        }
        throw IllegalStateException("端口 $DSH_PORT..$PORT_PROBE_MAX 全被占用")
    }

    // ---------------------------------------------------------------------------
    // W-A（2026-09-21）局域网访问（loopback 反代到 0.0.0.0；上游刻意拒绑 0.0.0.0，
    // 代理形态 = 不动上游安全防线，token 鉴权 fail-closed 不变）
    // ---------------------------------------------------------------------------

    private var lanProxy: LanProxy? = null

    /** 本机 site-local IPv4 清单（LAN 地址展示 + --trusted-host 登记用） */
    private fun lanIpv4s(): List<String> = try {
        java.net.NetworkInterface.getNetworkInterfaces().toList()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { it.inetAddresses.toList() }
            .filter { it is java.net.Inet4Address && !it.isLoopbackAddress }
            .map { it.hostAddress ?: "" }
            .filter { it.isNotEmpty() }
            .distinct()
            .sorted()
    } catch (_: Throwable) { emptyList() }

    /** 按当前开关/端口同步 LAN 代理生命周期（幂等：状态没变就什么都不做） */
    private fun ensureLanProxy() {
        val wantPort = activePort + LAN_PORT_OFFSET
        if (!lanEnabled || maintenanceMode) {
            lanProxy?.stop()
            lanProxy = null
            lanUrls = emptyList()
            return
        }
        val cur = lanProxy
        if (cur != null && cur.listenPort == wantPort && cur.targetPort == activePort) {
            // 已在跑：只刷新地址清单（DHCP 换 IP 时展示面跟上）
            lanUrls = lanIpv4s().map { "http://$it:$wantPort/" }
            return
        }
        lanProxy?.stop()
        lanProxy = try {
            LanProxy(wantPort, "127.0.0.1", activePort).also { it.start() }
        } catch (t: Throwable) {
            recordLine("LAN proxy bind failed on :$wantPort (${t.message})")
            null
        }
        lanUrls = if (lanProxy != null) lanIpv4s().map { "http://$it:$wantPort/" } else emptyList()
        if (lanProxy != null) recordLine("LAN access on :$wantPort → 127.0.0.1:$activePort (${lanUrls.size} addr)")
    }

    /**
     * 极简 TCP 反代：0.0.0.0:listenPort → 127.0.0.1:targetPort。
     * 纯字节转发（HTTP/WS/SSE 都透传）；鉴权完全交给 DSH 的 token 栅栏（无 token = 401），
     * 本层不做任何明文判断——「代理不解密、不放宽」是它和「直接绑 0.0.0.0」的本质区别。
     * 连接级两条泵线程 + SO_TIMEOUT 防僵死；daemon 线程随进程退出。
     */
    private class LanProxy(val listenPort: Int, private val targetHost: String, val targetPort: Int) {
        @Volatile private var running = false
        private var server: java.net.ServerSocket? = null
        private val clients = java.util.concurrent.ConcurrentHashMap<Socket, Boolean>()

        fun start() {
            val ss = java.net.ServerSocket()
            ss.reuseAddress = true
            ss.bind(InetSocketAddress("0.0.0.0", listenPort))
            server = ss
            running = true
            Thread {
                while (running) {
                    val client = try { ss.accept() } catch (_: Throwable) { break }
                    clients[client] = true
                    Thread { serve(client) }.apply { isDaemon = true; start() }
                }
            }.apply { name = "lan-proxy"; isDaemon = true; start() }
        }

        private fun serve(client: Socket) {
            var upstream: Socket? = null
            try {
                client.soTimeout = 120_000
                upstream = Socket()
                upstream.soTimeout = 120_000
                upstream.connect(InetSocketAddress(targetHost, targetPort), 3000)
                val up = upstream
                val t2 = Thread { pipe(client, up) } // 上行：client → upstream
                t2.isDaemon = true
                t2.start()
                pipe(up, client) // 下行：upstream → client（本线程跑）
            } catch (_: Throwable) {
            } finally {
                try { client.close() } catch (_: Throwable) {}
                try { upstream?.close() } catch (_: Throwable) {}
                clients.remove(client)
            }
        }

        private fun pipe(from: Socket, to: Socket) {
            try {
                val buf = ByteArray(1 shl 15)
                val inp = from.getInputStream()
                val out = to.getOutputStream()
                while (running) {
                    val n = inp.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                    out.flush()
                }
            } catch (_: Throwable) {
            } finally {
                // 半关：让对端读到 EOF（HTTP keep-alive / WS 关帧的最低礼仪）
                try { to.shutdownOutput() } catch (_: Throwable) {}
            }
        }

        fun stop() {
            running = false
            try { server?.close() } catch (_: Throwable) {}
            clients.keys.forEach { try { it.close() } catch (_: Throwable) {} }
            clients.clear()
        }
    }

    // ---------------------------------------------------------------------------
    // W-B（2026-09-21）维护模式（备份/恢复：停 node，防活备份带半行残尾）
    // ---------------------------------------------------------------------------

    /** 进入维护：失效看门狗 + 停 node + 停 LAN 代理（保留服务本体与端口探活） */
    fun stopForMaintenance() {
        ++watchdogGen
        try { nodeProcess?.destroy() } catch (_: Throwable) {}
        lanProxy?.stop()
        lanProxy = null
        lanUrls = emptyList()
        state = "EXITED"
        recordLine("maintenance: node stopped")
    }

    /** 退出维护：幂等重同步（profile 插件/symlink 林可能被恢复包改变）后重新拉起 */
    fun resumeFromMaintenance() {
        try {
            ensureRpPluginPatch()
            ensureToolLinks()
        } catch (t: Throwable) {
            recordLine("maintenance resume re-sync warn: ${t.message}")
        }
        recordLine("maintenance: resuming node")
        startNodeForever()
    }

    /** 按最新设置立即重启 node（失效当前看门狗 → 新代接管 → 新一轮启动重读所有启动参数） */
    fun restartNodeNow() {
        ++watchdogGen
        try { nodeProcess?.destroy() } catch (_: Throwable) {}
        webToken = null // 旧 token 随进程作废，等新一轮 dsht-token 落盘
        startNodeForever()
    }

    // ---------------------------------------------------------------------------
    // W-D（2026-09-21）自检面板 + 一键修补
    // ---------------------------------------------------------------------------

    private fun check(id: String, name: String, ok: Boolean, detail: String, repairable: Boolean): org.json.JSONObject =
        org.json.JSONObject()
            .put("id", id).put("name", name).put("ok", ok)
            .put("detail", detail).put("repairable", repairable)

    /** 逐项体检（每项 = 一个可核的事实 + 是否可自动修；不夸大、不静默） */
    fun runSelfCheck(): String {
        val items = mutableListOf<org.json.JSONObject>()
        // 1. 运行时解压（sentinel 在 = 已安装）
        val sentinel = File(File(filesDir, RUNTIME_DIR), RUNTIME_SENTINEL)
        items += check("runtime", "运行时解压", sentinel.exists(),
            if (sentinel.exists()) RUNTIME_SENTINEL else "哨兵缺失（未解压或被清除）", false)
        // 2. node 进程状态
        items += check("node", "node 进程", state == "RUNNING" && nodeProcess != null,
            "state=$state exit=${nodeExitCode ?: "-"}", false)
        // 3. 端口
        items += check("port", "端口 $activePort", portOpen, if (portOpen) "已开放" else "未监听", false)
        // 4. web token
        items += check("token", "web 令牌", webToken != null,
            if (webToken != null) "已捕获" else "未捕获（等 node 打印/落盘）", false)
        // 5. 工具 symlink 林（四件套 × 两处）
        val nld = applicationInfo.nativeLibraryDir
        var linkOk = 0
        var linkTotal = 0
        for (dir in listOf(File(filesDir, "$RUNTIME_DIR/bin"), File(filesDir, "$PROOT_ROOTFS_DIR/bin"))) {
            for ((cmd, so) in DSHT_TOOL_LINKS) {
                linkTotal++
                val link = File(dir, cmd)
                var cur: String? = null
                try { cur = Os.readlink(link.path) } catch (_: Throwable) {}
                if (cur == File(nld, so).absolutePath) linkOk++
            }
        }
        items += check("toollinks", "工具链 symlink 林", linkOk == linkTotal,
            "$linkOk/$linkTotal 就位", true)
        // 6. proot rootfs（或如实报降级原因）
        val rootfsOk = sandboxFallback == null &&
            File(filesDir, "$PROOT_ROOTFS_DIR/bin/busybox").let { f ->
                try { Os.readlink(f.path) != null } catch (_: Throwable) { false }
            }
        items += check("sandbox", "沙箱（proot 隔离）", rootfsOk,
            if (rootfsOk) "就绪" else "已降级：${sandboxFallback ?: "rootfs 缺失"}", true)
        // 7. profile 插件 patch
        val patch = File(filesDir, ".dsh/profiles/web/cordis.patch.yml")
        val patchOk = try { patch.readText().contains("dsht-rp-plugin") } catch (_: Throwable) { false }
        items += check("profile", "RP 插件 profile 注册", patchOk,
            if (patchOk) "cordis.patch.yml 就位" else "patch 行缺失", true)
        // 8. 磁盘余量（<200MB 报警：会话 jsonl 追加 + 备份都需要空间）
        val freeMb = filesDir.usableSpace / (1024 * 1024)
        items += check("disk", "磁盘余量", freeMb >= 200, "${freeMb}MB 可用", false)
        // 9. 数据目录可读
        val dshHome = File(filesDir, ".dsh")
        items += check("data", "数据目录（.dsh）", dshHome.isDirectory,
            if (dshHome.isDirectory) "在" else "缺失（首启未初始化？）", false)
        return org.json.JSONObject().put("checks", org.json.JSONArray().apply { items.forEach { put(it) } }).toString()
    }

    /** 一键修补：跑全部幂等修复器（symlink 林 / rootfs / profile 插件），不修运行时本体 */
    fun runBasicRepairs() {
        recordLine("self-repair: tool links / proot rootfs / profile plugins")
        try { ensureToolLinks() } catch (t: Throwable) { recordLine("repair toollinks failed: ${t.message}") }
        try { ensureProotRootfs() } catch (t: Throwable) { recordLine("repair rootfs failed: ${t.message}") }
        try { ensureRpPluginPatch() } catch (t: Throwable) { recordLine("repair profile failed: ${t.message}") }
    }

    /** 重装运行时（W-D 重度修复：停 node → 删哨兵 → 重解压 → 拉起；UI 确认后调） */
    fun reinstallRuntimeNow() {
        ++watchdogGen
        try { nodeProcess?.destroy() } catch (_: Throwable) {}
        val runtimeDir = File(filesDir, RUNTIME_DIR)
        runtimeDir.listFiles { f -> f.name.startsWith(".installed-v") }?.forEach { it.delete() }
        recordLine("runtime sentinel removed; re-extracting")
        Thread {
            try {
                state = "EXTRACTING"
                ensureRuntime()
                ensureProotRootfs()
                ensureToolLinks()
                state = "EXTRACTED"
                startNodeForever()
            } catch (t: Throwable) {
                state = "FAILED"
                lastError = t.message ?: t.javaClass.name
                recordLine("FATAL(reinstall): $lastError")
            }
        }.start()
    }

    override fun onDestroy() {
        serviceAlive = false
        instance = null
        ++watchdogGen // 失效所有代次的 watchdog（防 interrupt 被 waitFor 吞掉后复活）
        watchdog?.interrupt()
        nodeProcess?.destroy()
        lanProxy?.stop()
        lanProxy = null
        lanUrls = emptyList()
        // 正常销毁路径清标记：下次启动 marker 不在 = 上次是干净退出（非异常）
        try { File(filesDir, ALIVE_MARKER).delete() } catch (_: Throwable) { }
        recordLine("node service destroyed")
        Log.i(TAG, "node service destroyed")
        super.onDestroy()
    }
}
