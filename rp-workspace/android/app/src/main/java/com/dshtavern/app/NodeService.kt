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
        private const val RUNTIME_SENTINEL = ".installed-v220"
        private const val DSH_PORT = 3080
        private const val OUTPUT_CAP = 200
        private const val PROOT_ROOTFS_DIR = "proot-rootfs"
        /** PRoot 真隔离（targetSdk 36：SELinux 仅允许从 nativeLibraryDir exec，busybox 实体必须是 libbusybox.so）。
         *  rootfs = 纯 symlink 林：全部指向 nativeLibraryDir/libbusybox.so（guest 内经 -b nativeLibDir 可见）。 */
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
         * watchdog 自愈（2026-09-04 手机 agent 自检实证：ANR/内存峰值被杀，重启后
         * checkpoint 续跑——本标记让"上次异常退出"对用户可见）：启动时写 .dsht-alive
         * 标记，onDestroy（正常销毁路径）删除。下次启动若标记仍在 = 上次进程级被杀
         * （LMK/ANR，无 onDestroy 回调）→ lastAbnormalExit=true + 日志留痕。
         * node 层自动重启已由 node-watchdog 线程承担，本标记只做事后归因可见性。
         */
        @Volatile var lastAbnormalExit: Boolean = false
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
            o.put("exitCode", nodeExitCode ?: org.json.JSONObject.NULL)
            o.put("lastError", lastError ?: org.json.JSONObject.NULL)
            o.put("extractedFiles", extractedFiles)
            o.put("restartCount", restartCount)
            val arr = org.json.JSONArray()
            synchronized(outputLines) {
                outputLines.toList().takeLast(40).forEach { arr.put(it) }
            }
            o.put("output", arr)
            return o.toString()
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
        startPortProbe()
        if (started.compareAndSet(false, true)) {
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
                    // token 文件清旧（每次 node 进程的 launchToken 都不同——旧值必 401）
                    try { File(File(filesDir, ".dsh"), "dsht-token").delete() } catch (_: Throwable) { }
                    state = "EXTRACTING"
                    ensureRuntime()
                    ensureRpPluginPatch()
                    ensureProotRootfs()
                    state = "EXTRACTED"
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

    /** 端口探活线程：每秒 TCP 连 127.0.0.1:3080（比 WebView 报错可靠）+ token 文件轮询 */
    private fun startPortProbe() {
        if (portThread != null) return
        portThread = Thread {
            while (serviceAlive) {
                portOpen = try {
                    Socket().use { s ->
                        s.connect(InetSocketAddress("127.0.0.1", DSH_PORT), 400)
                        true
                    }
                } catch (_: Exception) {
                    false
                }
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
            for (pkg in listOf("dsht-plugin-mvu", "dsht-plugin-tavern-helper", "dsht-plugin-prompt-template", "dsht-plugin-memory")) {
                copyPackage(webProfile, pkg, "lib/index.js",
                    "{\"name\":\"$pkg\",\"version\":\"1.0.0\",\"type\":\"module\",\"main\":\"lib/index.js\"}")
            }
            // dsht-plugin-mobile（Step 4.77 双面形态）：patch 行在 pluginRows 里，缺拷贝会导致
            // loader 启动即崩（Cannot find package 'dsht-plugin-mobile'）
            val mobilePkgJson = "{\"name\":\"dsht-plugin-mobile\",\"version\":\"1.0.0\",\"type\":\"module\",\"main\":\"lib/index.js\",\"exports\":{\".\":\"./lib/index.js\",\"./client\":\"./lib/client.js\",\"./package.json\":\"./package.json\"},\"dsh\":{\"client\":{\"platform\":\"web\",\"external\":[\"@deepseek-ai/dsh-client-ui-layout\"]}}}"
            copyPackage(webProfile, "dsht-plugin-mobile", "lib/index.js", mobilePkgJson)
            copyPackage(webProfile, "dsht-plugin-mobile", "lib/client.js", mobilePkgJson)
            // 2. patch 写入（按包名逐个补齐 insert 行——已有安装升级时旧块不动，
            //    缺失的行以新的顶层 - insert 列表追加，cordis patch 允许多个 insert 操作）
            val pluginRows = listOf(
                "dsht-rp" to "dsht-rp-plugin",
                "dsht-mvu" to "dsht-plugin-mvu",
                "dsht-tavern-helper" to "dsht-plugin-tavern-helper",
                "dsht-prompt-template" to "dsht-plugin-prompt-template",
                "dsht-mobile" to "dsht-plugin-mobile",
                "dsht-memory" to "dsht-plugin-memory",
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
            recordLine("proot rootfs setup failed: ${t.message} (fallback stays)")
        }
    }

    /** 启动 node 并守护：进程退出后 3 秒重启，直到服务销毁。 */
    private fun startNodeForever() {
        val nodeBin = File(applicationInfo.nativeLibraryDir, "libnode.so")
        val runtimeDir = File(filesDir, RUNTIME_DIR)
        val entry = File(runtimeDir, "node_modules/@deepseek-ai/dsh/lib/bin.js")
        recordLine("nodeBin: ${nodeBin.absolutePath} (exists=${nodeBin.exists()})")
        recordLine("entry: ${entry.absolutePath} (exists=${entry.exists()})")
        recordLine("LD path: ${applicationInfo.nativeLibraryDir}:${File(runtimeDir, "lib").absolutePath}")
        check(nodeBin.exists()) { "libnode.so missing in ${applicationInfo.nativeLibraryDir}" }
        check(entry.exists()) { "dsh bin.js missing in ${runtimeDir.path}" }

        watchdog = Thread {
            val myGen = ++watchdogGen // 新代上岗：旧代 watchdog（若有）将检测到代际落后而退出
            while (!Thread.currentThread().isInterrupted && myGen == watchdogGen && serviceAlive) {
                try {
                    state = "STARTING"
                    restartCount += 1
                    recordLine("starting node (attempt $restartCount)…")
                    Log.i(TAG, "starting node: $nodeBin")
                    val pb = ProcessBuilder(
                        nodeBin.absolutePath,
                        // --expose-internals：cordis-plugin-hmr 必需（缺它启动即崩）
                        "--expose-internals",
                        entry.absolutePath, "web", "--no-open",
                    ).apply {
                        redirectErrorStream(true)
                        environment().apply {
                            put("HOME", filesDir.absolutePath)
                            put("DSH_NO_OPEN", "1")
                            // 双库路径：nativeLibraryDir（纯 .so）+ runtime lib/（带版本号 so）
                            put("LD_LIBRARY_PATH",
                                applicationInfo.nativeLibraryDir + ":" + File(runtimeDir, "lib").absolutePath)
                            put("PATH", applicationInfo.nativeLibraryDir + ":" + (get("PATH") ?: ""))
                            // V8 老生代堆上限 2048MB：node 默认按物理内存扩堆（手机上可达数 GB），
                            // 无上限 → 后台挂机缓慢膨胀 → LMK 整进程杀（会话断）。上限 = 失败
                            // 模式选择：撞上限只是单个请求报错（可控），总比进程死好。实测锚点：
                            // 用户最大会话 12.38MB jsonl（320 条消息、单条内嵌状态栏 HTML +
                            // MVU 变量，对象树膨胀 10x+）→ 512 必挂（"历史加载失败"真机回归
                            // 实证）、1024 临界 → 2048 给足余量（12GB RAM 设备安全）。
                            put("NODE_OPTIONS", "--max-old-space-size=2048")
                            put("TMPDIR", cacheDir.absolutePath)
                            // PRoot 真隔离：JS 补丁层（dsh-sandbox-local DSHT-ANDROID-PROOT）读这些 env 组装 proot argv；
                            // 缺失/探测失败时 JS 层自动回退 warn+fs 边界（见 build-dsht.ps1 Step 3.5）
                            put("DSHT_PROOT_BIN", File(applicationInfo.nativeLibraryDir, "libproot.so").absolutePath)
                            put("DSHT_PROOT_ROOTFS", File(filesDir, PROOT_ROOTFS_DIR).absolutePath)
                            put("DSHT_NATIVE_LIB_DIR", applicationInfo.nativeLibraryDir)
                            put("DSHT_RUNTIME_LIB_DIR", File(runtimeDir, "lib").absolutePath)
                            put("PROOT_LOADER", File(runtimeDir, "lib/proot-loader").absolutePath)
                            put("PROOT_TMP_DIR", cacheDir.absolutePath)
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

    override fun onDestroy() {
        serviceAlive = false
        ++watchdogGen // 失效所有代次的 watchdog（防 interrupt 被 waitFor 吞掉后复活）
        watchdog?.interrupt()
        nodeProcess?.destroy()
        // 正常销毁路径清标记：下次启动 marker 不在 = 上次是干净退出（非异常）
        try { File(filesDir, ALIVE_MARKER).delete() } catch (_: Throwable) { }
        recordLine("node service destroyed")
        Log.i(TAG, "node service destroyed")
        super.onDestroy()
    }
}
