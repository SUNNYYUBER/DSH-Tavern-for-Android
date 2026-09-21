package com.dshtavern.app

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.util.Base64
import android.view.View
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.URLUtil
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import org.json.JSONArray
import org.json.JSONObject

/**
 * DSHTavern M2 壳（T2.11 收口后单态）：
 * - 首页 = DSH 原生前端（RP 聊天即原生会话流；导入/正则/预设都在 DSH 内的
 *   RP 启动器，不再有独立「导入中心」appassets 页）
 * - 等待屏 = 实时诊断（解压进度/node 状态/输出尾部）→ 端口通了才加载 3080
 * - 文件选择 = SAF（RP 启动器「数据迁移」iframe 内的 <input type=file> 消费）
 */
class MainActivity : AppCompatActivity() {

    companion object {
        /** AbortSignal.any polyfill（旧 System WebView 缺失；DSH 前端工作区/会话渲染依赖） */
        private const val ABORT_SIGNAL_ANY_POLYFILL =
            "if(window.AbortSignal&&!AbortSignal.any){AbortSignal.any=function(signals){" +
            "var c=new AbortController();var onAbort=function(){try{c.abort(c.signal.reason)}catch(e){c.abort()}};" +
            "var list=signals||[];for(var i=0;i<list.length;i++){if(list[i]&&list[i].aborted)" +
            "{try{c.abort(list[i].reason)}catch(e){c.abort()}return c.signal}if(list[i])list[i].addEventListener('abort',onAbort)}" +
            "return c.signal};}"
        /**
         * 【W-G 2026-09-21】旧 WebView polyfill 补齐（对齐 DSHA 公开清单形态）：
         *  · AbortSignal.timeout（DSH 前端超时的第二个消费点；与 any 同源族）
         *  · crypto.randomUUID —— **局域网 HTTP（非 secure context）必需**：
         *    WebView 经 http://<lan-ip> 访问时 window.crypto.randomUUID 不存在
         *    （secure context 才暴露），DSH 前端与部分社区插件直接调用它。
         *    用 crypto.getRandomValues（非 secure context 也在）实现 RFC4122 v4。
         * 只补缺失键（已有实现不覆盖）；注入时机 = onPageStarted（页面 JS 执行前）。
         */
        private const val EXTRA_POLYFILLS =
            "if(window.AbortSignal&&!AbortSignal.timeout){AbortSignal.timeout=function(ms){" +
            "var c=new AbortController();setTimeout(function(){try{c.abort(new DOMException('TimeoutError','TimeoutError'))}catch(e){c.abort()}},ms);" +
            "return c.signal};}" +
            "if(window.crypto&&!crypto.randomUUID&&crypto.getRandomValues){crypto.randomUUID=function(){" +
            "var b=new Uint8Array(16);crypto.getRandomValues(b);b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;" +
            "var h=[];for(var i=0;i<16;i++)h.push(b[i].toString(16).padStart(2,'0'));" +
            "return h[0]+h[1]+h[2]+h[3]+'-'+h[4]+h[5]+'-'+h[6]+h[7]+'-'+h[8]+h[9]+'-'+h[10]+h[11]+h[12]+h[13]+h[14]+h[15]};}"

        /** SAF 目录授权 requestCode（1001=文件选择 / 1002=通知权限已占用） */
        private const val REQ_TREE = 1003
        /** 【W-B 2026-09-21】备份：SAF 创建文档（导出 zip 的目标位置） */
        private const val REQ_BACKUP_CREATE = 1010
        /** 【W-B】恢复：SAF 选择备份 zip */
        private const val REQ_RESTORE_PICK = 1011
        /** 【W-B】备份包内清单文件名（恢复体检时优先读它做预览） */
        private const val BACKUP_MANIFEST = "dsht-backup.json"
        /**
         * 【W-B】备份排除清单（$DSH_HOME 根下的文件名）：本机凭据与运行时令牌。
         * 凭据不进备份（备份经 SAF 落在用户自选位置，不该带走这台机器的钥匙）——
         * 恢复后需重新填 API key，这是刻意的安全取舍（DSHA 同款口径）。
         */
        private val BACKUP_EXCLUDE = setOf(".credentials.yaml", "dsht-token")

        /** §4.16.2 深链派发重试上限：前端 rp-ui 未就绪时 400ms × 25 ≈ 10s 内等监听注册 */
        private const val LOCATE_RETRY_MAX = 25

        /**
         * T-45（2026-09-11 心跳 53）主框架加载失败自愈：
         * 触发条件 = 端口已开放 + token 已捕获 + 加载仍失败（401 / 启动期竞态 / 渲染进程被杀）。
         * 原逻辑只在 **token 变化** 时重载 → 上述场景 token 不变 → 三个分支全不命中 →
         * **永久停在等待屏**（设备实证：等 40s / 40 次轮询零次重载；界面显示
         * 「端口 3080：已开放 ✓ / web 令牌：已捕获 ✓」却不再推进 = 静默失败）。
         * 现补一条**带预算**的重载分支（不改变既有 token 变化路径的优先级）。
         */
        private const val RELOAD_INTERVAL_MS = 3000L
        private const val RELOAD_MAX = 20

        /** 【L4 2026-09-14】renderer 重建预算（跨 Activity 重建持久化；见 rebuildWebView 注释） */
        private const val RENDERER_REBUILD_MAX = 5
        private const val KEY_RENDERER_REBUILDS = "renderer_rebuilds"
    }

    private lateinit var webView: WebView
    private lateinit var bootTitle: TextView
    private lateinit var bootDetail: TextView
    private lateinit var bootOutput: TextView
    private lateinit var bootingView: LinearLayout
    private var dshLoaded = false
    /** 0.1.2 token 等待轮数（端口开放后 token 打印可能滞后；见 loadUrl 处注释） */
    private var tokenWaits = 0
    /** 已降级过干净 URL（401 场景不再重复降级——等 token 到达即带 token 重载） */
    private var tokenDegraded = false
    /** 上次带 token 加载用的令牌（仅当 webToken 变化才重载——修 401↔重载死循环） */
    private var lastTokenAttempt: String? = null
    /** 上次实际加载的 URL（T-45：失败重载必须回到"本该加载的那个地址"，不能拿当前 url） */
    private var bootUrl: String? = null
    /** T-45 主框架加载失败标记（由 onReceivedError / onReceivedHttpError 置位） */
    private var reloadNeeded = false
    /** T-45 重载预算（连续失败计数；端口 0→1、token 变化时归零） */
    private var reloadAttempts = 0
    /** T-45 上次加载时刻（重载节流） */
    private var lastLoadAt = 0L
    /** T-45 端口上一轮状态（用于识别 0→1 跳变以刷新重载预算） */
    private var lastPortState = false
    /** T2.11 首启标记：仅第一次打开 app 自动显示导入/新手教程页（之后直接进 DSH） */
    private val prefs by lazy { getSharedPreferences("dsht", MODE_PRIVATE) }
    /**
     * 【L4 2026-09-14】renderer 重建预算的**跨 Activity 重建**计数器。
     *
     * 为什么不能复用 `reloadAttempts`：renderer 被杀的恢复手段是 `recreate()`（整 Activity
     * 重建，见 `rebuildWebView`），而 `reloadAttempts` 是 Activity 内存字段 —— 重建即归零，
     * 「崩 → 建 → 崩」会变成**无限重建**（每次都是第 1 次）。故必须跨重建持久化。
     *
     * 用 `prefs` 而非 `savedInstanceState`：后者在「系统杀 app 后恢复」时才保留，而
     * renderer 被杀时 Activity 未必被回收 ⇒ 需要更强的持久化。`prefs` 同时覆盖两种情形。
     *
     * 归零时机与 `reloadAttempts` 一致：端口 0→1（运行时重启成功）或 token 变化。
     */
    private var rendererRebuilds: Int
        get() = prefs.getInt(KEY_RENDERER_REBUILDS, 0)
        set(v) = prefs.edit().putInt(KEY_RENDERER_REBUILDS, v).apply()

    private val handler = Handler(Looper.getMainLooper())
    private val diagPoller = object : Runnable {
        override fun run() {
            // T-45：端口 0→1 跳变（node 首次就绪 / watchdog 重启后回来）→ 刷新重载预算，
            // 并视为一次合法的"该重载"信号（此刻 WebView 可能停在错误页）。
            val portNow = NodeService.portOpen
            if (portNow && !lastPortState) {
                reloadAttempts = 0
                // 【L4 2026-09-14】端口 0→1 = 运行时真的起来了 ⇒ 上一轮 renderer 重建
                // 是成功的（页面能正常加载），预算归零。否则「偶发一次 OOM + 后续正常」
                // 的会话会累积计数，最终在无关的时刻误触上限。
                rendererRebuilds = 0
                if (!dshLoaded) reloadNeeded = true
            }
            lastPortState = portNow
            if (!dshLoaded) {
                val d = NodeService.diagJson()
            try {
                val o = org.json.JSONObject(d)
                val state = o.optString("state")
                val port = o.optBoolean("portOpen")
                val files = o.optInt("extractedFiles")
                val exit = if (o.isNull("exitCode")) null else o.optInt("exitCode")
                val err = if (o.isNull("lastError")) null else o.optString("lastError")
                val restarts = o.optInt("restartCount")
                val output = o.optJSONArray("output") ?: org.json.JSONArray()

                val sb = StringBuilder()
                sb.append("状态：").append(when (state) {
                    "EXTRACTING" -> "解压运行时中（$files 个文件）…"
                    "EXTRACTED", "STARTING" -> "启动 node 进程中…"
                    "RUNNING" -> "node 运行中，等待端口就绪…"
                    "EXITED" -> "node 已退出（code=$exit），3 秒后重启（第 $restarts 次）"
                    "FAILED" -> "启动失败：$err"
                    else -> state
                })
                sb.append("\n端口 ").append(NodeService.activePort).append("：").append(if (port) "已开放 ✓" else "未监听")
                // 【W-A 2026-09-21】LAN 地址可见（token 不印在等待屏——防肩窥；复制走设置面板）
                if (o.optBoolean("lanEnabled", false)) {
                    sb.append("\n局域网访问：已开启（地址与复制在右下角 ⚙ 设置面板）")
                }
                if (o.optBoolean("maintenanceMode", false)) {
                    sb.append("\n维护模式：备份/恢复进行中，node 已暂停…")
                }
                // 【L4 2026-09-14 R8 出声】上次进程级被杀归因（此前只赋值不显示，
                // docs/B-DEVICE-VERIFY-CHECKLIST.md 却声称已显示 —— 文档与代码不一致）
                if (o.optBoolean("lastAbnormalExit", false)) {
                    sb.append("\n上次退出：⚠️ 异常（被系统/内存回收强杀，非正常关闭）")
                }
                // 【L4 2026-09-14 R8 出声】沙箱降级（无进程隔离，仅 fs 层工作区边界）
                if (!o.isNull("sandboxFallback")) {
                    val why = when (o.optString("sandboxFallback")) {
                        "proot-missing" -> "proot/busybox 缺失"
                        "rootfs-failed" -> "rootfs 搭建失败"
                        else -> o.optString("sandboxFallback")
                    }
                    sb.append("\n沙箱：⚠️ 已降级（$why）—— 无进程隔离，仅按文件系统边界约束")
                }
                // 【F3 2026-09-14 R8 出声】滚动截屏：本 App 已**声明**可捕获（hint=INCLUDE），
                // 但**系统是否真的提供捕获实现，我们测不出来**（见 scrollCaptureStatus 注释：
                // 五条探测路径全部失败，且失败原因本身不可解释）。故这里**只陈述事实**，
                // **不下结论** —— 不下结论比下错结论好（P-3/P-11）。
                // 为什么仍要出声：这是「能对用户产生实际影响、而我们无法确证」的一格，
                // 用户遇到「长截图只有一屏」时，这条日志能立刻给出线索。
                if (scrollCaptureHintValue == View.SCROLL_CAPTURE_HINT_INCLUDE) {
                    sb.append("\n滚动截屏：已声明可捕获（hint=INCLUDE）；系统是否提供捕获实现本机测不出")
                }
                if (port && dshLoaded == false) {
                    val tok = com.dshtavern.app.NodeService.webToken
                    sb.append("\nweb 令牌（0.1.2 鉴权）：").append(if (tok != null) "已捕获 ✓" else "未捕获（等 node 打印 dsh web: 行）")
                }
                // T-45：加载失败/重试状态**必须可见**（L42：有意跳过与做成了/失败了同等留痕）
                if (reloadNeeded || reloadAttempts > 0) {
                    sb.append("\n页面加载：").append(
                        if (reloadAttempts >= RELOAD_MAX) {
                            "连续失败 $reloadAttempts 次，已停止自动重试 —— 请重启应用"
                        } else {
                            "失败，${RELOAD_INTERVAL_MS / 1000} 秒后自动重试（第 ${reloadAttempts + 1}/$RELOAD_MAX 次）"
                        },
                    )
                }
                bootDetail.text = sb.toString()
                bootDetail.setTextColor(
                    if (state == "FAILED") Color.parseColor("#E65A6A") else Color.parseColor("#9FB0C6")
                )

                val out = StringBuilder()
                val start = maxOf(0, output.length() - 15)
                for (i in start until output.length()) out.append(output.optString(i)).append('\n')
                bootOutput.text = out.toString()

                if (port && !dshLoaded) {
                    // @adapt contract:web.token-file
                    // 0.1.2 token 鉴权：首次 index 请求必须带 ?token=（30 天签名 cookie 随后
                    // 生效）。token 双通道：NodeService stdout 捕获 + dsht-token 文件轮询
                    //（绕行卓易通 stdout 静默）。等待最多 30 轮后降级干净 URL（旧版 DSH/
                    // 异常兼容）。**轮询线程永生（见 run() 末尾 postDelayed）**。
                    // 仅当 webToken 变化才重载（lastTokenAttempt）：node 每次启动重生成
                    // launchToken，插件 1s 内重写 token 文件——陈旧 token 首载 401 后，
                    // 新 token 落盘自动触发重载，不进 401↔重载死循环。
                    val tok = com.dshtavern.app.NodeService.webToken
                    if (tok != null && tok != lastTokenAttempt) {
                        lastTokenAttempt = tok
                        dshLoaded = true
                        reloadNeeded = false
                        reloadAttempts = 0
                        bootUrl = "http://127.0.0.1:${NodeService.activePort}/?token=$tok"
                        lastLoadAt = System.currentTimeMillis()
                        hideBoot()
                        webView.loadUrl(bootUrl!!)
                        maybeOpenFirstLaunchImport()
                        if (pendingShareOpenImport) {
                            pendingShareOpenImport = false
                            handler.postDelayed({ dispatchShareChanged(openImportTab = true) }, 1500)
                        }
                        if (pendingLocateSessionId != null) {
                            val id = pendingLocateSessionId!!
                            pendingLocateSessionId = null
                            handler.postDelayed({ dispatchLocateSession(id, attempt = 0) }, 1500)
                        }
                    } else if (tok == null && tokenWaits < 30) {
                        tokenWaits += 1
                    } else if (tok == null && !tokenDegraded && tokenWaits >= 30) {
                        // 30 秒仍无 token：降级干净 URL（0.1.2 下会 401 显示错误页，但
                        // token 文件/stdout 到达后下一轮 dshLoaded 分支即带 token 重载）
                        tokenDegraded = true
                        dshLoaded = true
                        reloadNeeded = false
                        lastTokenAttempt = ""
                        bootUrl = "http://127.0.0.1:${NodeService.activePort}"
                        lastLoadAt = System.currentTimeMillis()
                        hideBoot()
                        webView.loadUrl(bootUrl!!)
                        maybeOpenFirstLaunchImport()
                    } else if (reloadNeeded && reloadAttempts < RELOAD_MAX &&
                        System.currentTimeMillis() - lastLoadAt >= RELOAD_INTERVAL_MS
                    ) {
                        // ★ T-45（心跳 53）：token 未变但**主框架加载失败** → 带预算重载。
                        // 原逻辑此处无分支命中 = 永久停在等待屏（设备实证：40s 零次重载）。
                        // 重载目标用 bootUrl（上次"本该加载"的地址），不是 webView.url
                        //（失败时它是 chrome-error://，拿它重载等于再失败一次）。
                        val url = bootUrl
                        if (url != null) {
                            reloadAttempts += 1
                            dshLoaded = true
                            reloadNeeded = false
                            lastLoadAt = System.currentTimeMillis()
                            hideBoot()
                            android.util.Log.w(
                                "DSHTavern",
                                "main-frame load failed → reload (attempt $reloadAttempts/$RELOAD_MAX): $url",
                            )
                            webView.loadUrl(url)
                            maybeOpenFirstLaunchImport()
                        }
                    }
                    // 其余情况（等 token 窗口内 / 重载节流窗口内）：不加载，只更新 UI
                }
            } catch (_: Exception) {
            }
            }
            // 无条件重排：轮询永生（加载后 WebView 主框架错误 → dshLoaded 复位）。
            // 【T-45 心跳 53 更正】原注释声称"下一轮按 token 变化重载"，但 token 不变时
            // **没有任何分支命中** → 等待屏永久冻结（设备实证）。现补带预算的重载分支，
            // 生命周期为：失败即重载（3s 节流，上限 20 次），端口 0→1 或 token 变化时归零。
            handler.postDelayed(this, 1000)
        }
    }

    /**
     * T2.11 首启体验：首次打开 app 自动打开 RP 启动器「导入」tab（即数据迁移/新手教程页）。
     * 之后启动直接进 DSH 前端。实现：DSH 页面加载后轮询等待 dsht-rp-ui 侧栏按钮就绪，
     * 然后 dispatch RP_OPEN_EVENT（tab=import）——与用户手动点「🎭 角色扮演 → 导入」同路径，
     * 零独立页、复用同源 iframe 导入中心。
     */
    private fun maybeOpenFirstLaunchImport() {
        if (prefs.getBoolean("first_launch_done", false)) return
        prefs.edit().putBoolean("first_launch_done", true).apply()
        ensureBatteryWhitelist()
        handler.postDelayed(object : Runnable {
            override fun run() {
                webView.evaluateJavascript(
                    "(() => { const b = document.querySelector('.dsht-rp-sidebar-btn'); " +
                        "if (b) { window.dispatchEvent(new CustomEvent('dsht-rp-ui:open', { detail: { tab: 'import' } })); return 'ok' } " +
                        "return 'no-btn' })()",
                ) { r ->
                    if (r != "\"ok\"") handler.postDelayed(this, 400) // rp-ui 未就绪，重试
                    else android.util.Log.d("DSHTavern", "first-launch: import tab auto-opened")
                }
            }
        }, 800)
    }

    /**
     * 卓易通/鸿蒙省电治理（2026-09-04）：等效 HiSmartPerf 可及范围内的保活增强。
     * HiSmartPerf 的频点锁定/cgroup 提权需要系统签名权限，普通应用无法调用；应用侧
     * 可用的最高保活通道 = 电池优化白名单（用户一次性授权，此后系统不对本进程做
     * Doze/App Standby 后台限制）。仅首次启动询问一次（用户拒绝后不再打扰）。
     */
    private fun ensureBatteryWhitelist() {
        try {
            val pm = getSystemService(android.os.PowerManager::class.java)
            if (pm.isIgnoringBatteryOptimizations(packageName)) return
            if (prefs.getBoolean("battery_whitelist_asked", false)) return
            prefs.edit().putBoolean("battery_whitelist_asked", true).apply()
            startActivity(
                Intent(
                    android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:$packageName"),
                ),
            )
        } catch (e: Exception) {
            android.util.Log.w("DSHTavern", "battery whitelist request failed", e)
        }
    }

    /** WebView 文件选择回调（<input type="file"> → SAF 系统文件管理器） */
    private var filePickerCallback: android.webkit.ValueCallback<Array<android.net.Uri>>? = null

    /** 分享冷启动：DSH 页面还没加载完时收到 zip，先记标记，端口通了再拉起导入 tab */
    private var pendingShareOpenImport = false

    /** §4.16.2 深链：WebView/前端还没就绪时暂存的 sessionId（端口通了再派发） */
    private var pendingLocateSessionId: String? = null

    /**
     * 【F3 2026-09-14】滚动截屏的真实能力（运行期读回，供探针断言）。
     *
     * 为什么必须读回而不能只靠「源码里设了」：设 `scrollCaptureHint` 只是**声明候选**，
     * 系统取「下一屏」靠的是 `getScrollCaptureCallback()`——而 `View` 基类默认为 null
     * （WebView 是否自带实现属 Chromium 版本细节）。**只设 hint 就宣称已接通**
     * 正是 R7「未验证即声称」的形态，故这里把两个事实都读回来、可被设备端断言。
     *
     * `scrollCaptureHintValue` 初值 Int.MIN_VALUE = 「未探测」（区别于任何合法 hint 值）。
     */
    private var scrollCaptureHintValue: Int = Int.MIN_VALUE
    /** `getScrollCaptureCallback() != null`（API 31+；低版本恒 false = 该 API 不存在） */
    private var scrollCaptureHasCallback: Boolean = false
    /**
     * 【F3 2026-09-14】**探测手段本身是否可用** —— 与「事实是否为真」严格分开。
     *
     * 为什么必须分开（P-11 的核心）：设备实测发现 `getScrollCaptureCallback` 在
     * sdk=35 的设备上**反射也抛 NoSuchMethodException**。此时有两种可能：
     *   (a) 系统真的没提供实现 → 结论「不支持」；
     *   (b) **我们的探测手段失效**（方法名/签名与 OEM 实现不符）→ 结论「未知」。
     * 二者混为一谈会得出**假结论** —— 而这正是 F3 上一版「✅ 已接通」的翻版
     * （用不可靠的判据支撑一个确定的结论）。
     * 故单列本字段：探针先看 `probeAvailable`，为 false 时**只报未知**，不报「不支持」。
     */
    private var scrollCaptureProbeAvailable: Boolean = false
    /** 枚举到的 `ScrollCapture*` 方法名（诊断用；为空 = 该设备 android.view.View 无此族方法） */
    private var scrollCaptureMethods: String = ""
    /**
     * 【F3 2026-09-14】行为探测的结果：`onScrollCaptureSearch` 回调里拿到的滚动内容尺寸。
     * 取值：`"none"`（回调来了但 Rect 为 null）/ `"w=..,h=.."` / `"no-entry"`（无此方法）/
     * `"probe-error"`（调用抛异常）。它是「系统认可本 View 可滚动捕获」的直接证据。
     */
    private var scrollCaptureSearchResult: String = ""

    /**
     * 【L2/A1 2026-09-14】软键盘避让的运行期读回（纯观测，供设备探针断言）。
     *
     * 为什么必须读回（P-11「产物即事实」）：`setOnApplyWindowInsetsListener` 可能因
     * ① 未被调用（视图未 attach / 监听被覆盖）② `ime()` 恒 0（系统未派发 IME insets）
     * ③ 代码在产物里但分支没走到 —— 等原因「写了但没生效」。只有读回**被调用时的实参**，
     * 才能区分「修了且生效」与「修了但没生效」。`insetLastEvtAt == 0` = 监听一次都没跑过。
     *
     * 【为什么必须同时读 margin 与 padding 两个通道】
     * 上一版用 `setPadding` 时，实测 `webView.paddingBottom == 767`（视图**接受了**）但页面
     * 视口恒 873（**语义没变**）⇒ 只读自己写的那一路会得出「已生效」的假结论。
     * 故这里两路都读，并**以页面视口是否真的收缩**作为最终判据（见探针 K1）。
     */
    private var insetImeBottomPx: Int = -1
    /** 同一次回调里 `systemBars().bottom` 的值（对照用：证明取的是较大者） */
    private var insetBarsBottomPx: Int = -1
    /** 实际写入视图避让量的 bottom（`max(ime, bars)`） */
    private var insetAppliedBottomPx: Int = -1
    /** 最近一次 insets 回调的时间戳（0 = 从未回调过） */
    private var insetLastEvtAt: Long = 0L
    /** 实际写进了哪条通道：`"margin"` / `"padding"`（诊断「修法形态」是否正确） */
    private var insetChannel: String = "none"

    /** 文件名清洗：去路径 + 只留安全字符（分享显示名 / 授权目录文件名都过它） */
    private fun sanitizeFileName(name: String, max: Int = 80): String =
        File(name).name.replace(Regex("[^\\w.\\-\\u4e00-\\u9fff]"), "_").take(max).ifEmpty { "export.zip" }

    /**
     * 免 root 读取 TauriTavern 数据的 JS 桥（注入名 DSHTShare；JSInterface 方法跑在
     * JavaBridge 线程，IO 安全）。两条通道共用 inbox 暂存目录（filesDir/inbox）：
     *  - 通道 1（分享接收）：ACTION_SEND 的 zip 已拷入 inbox，前端 readSharedInbox 列出来
     *  - 通道 2（SAF 目录授权）：授权后 stageTreeFile 把选中 zip 流式拷进 inbox
     * 前端统一用 readInboxChunk 分片读（base64 直接喂 /rp/import-stage 分块协议）。
     */
    inner class DSHTShareBridge {
        private fun inbox(): File = File(filesDir, "inbox").apply { mkdirs() }
        private fun errJson(msg: String): String = JSONObject().put("ok", false).put("error", msg).toString()

        /** inbox 文件清单（mtime 倒序）：{ok, files:[{name,size,mtime}]} */
        @JavascriptInterface
        fun readSharedInbox(): String {
            val arr = JSONArray()
            inbox().listFiles()?.filter { it.isFile }
                ?.sortedByDescending { it.lastModified() }
                ?.forEach { f ->
                    arr.put(JSONObject().put("name", f.name).put("size", f.length()).put("mtime", f.lastModified()))
                }
            return JSONObject().put("ok", true).put("files", arr).toString()
        }

        /** 分片读 inbox 文件：{ok, data(base64)}——片长由前端控制（4MB），base64 直通 import-stage.chunk */
        @JavascriptInterface
        fun readInboxChunk(name: String, offset: Long, length: Int): String {
            return try {
                val f = File(inbox(), sanitizeFileName(name))
                if (!f.isFile || offset < 0 || length <= 0 || offset >= f.length() && f.length() > 0) {
                    return errJson("文件不存在或参数非法：$name")
                }
                RandomAccessFile(f, "r").use { raf ->
                    raf.seek(offset)
                    val buf = ByteArray(minOf(length.toLong(), f.length() - offset).toInt().coerceAtLeast(1))
                    var got = 0
                    while (got < buf.size) {
                        val n = raf.read(buf, got, buf.size - got)
                        if (n < 0) break
                        got += n
                    }
                    JSONObject().put("ok", true).put("data", Base64.encodeToString(buf, 0, got, Base64.NO_WRAP)).toString()
                }
            } catch (e: Exception) {
                errJson(e.message ?: "read error")
            }
        }

        /** 上传完成后清理 inbox 暂存（分享/落盘都是一次性消费） */
        @JavascriptInterface
        fun removeInboxFile(name: String): String {
            val f = File(inbox(), sanitizeFileName(name))
            return JSONObject().put("ok", !f.exists() || f.delete()).toString()
        }

        /** 拉起 SAF 目录选择器（UI 线程）；结果在 onActivityResult 持久化读权限 */
        @JavascriptInterface
        fun requestTreeGrant() {
            handler.post {
                try {
                    startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE), REQ_TREE)
                } catch (e: Exception) {
                    android.util.Log.e("DSHTavern", "OPEN_DOCUMENT_TREE 拉起失败", e)
                }
            }
        }

        /** 【2026-09-08】所有文件访问状态：{granted: bool}（MANAGE_EXTERNAL_STORAGE，
         *  Android 11+；低版本恒 true——LEGACY 外部存储无此开关） */
        @JavascriptInterface
        fun allFilesAccessStatus(): String {
            val granted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                android.os.Environment.isExternalStorageManager()
            } else true
            return JSONObject().put("ok", true).put("granted", granted).toString()
        }

        /**
         * 【F3 2026-09-14】滚动截屏能力状态（**运行期读回**，供设备探针断言）。
         *
         * 返回：`{ok, sdkInt, hint, hintIncluded, probeAvailable, hasCallback, methods, supported}`
         *  - `hint`        ：读回的 `scrollCaptureHint` 实际值（`null` = 未探测）
         *  - `hintIncluded`：hint 是否 == `SCROLL_CAPTURE_HINT_INCLUDE`
         *  - `probeAvailable`：**探测手段是否可用**（View 上是否真有该 getter）。
         *    为 false 时 `hasCallback` 无意义 ⇒ 探针必须报「未知」而非「不支持」。
         *  - `methods`     ：枚举到的 `ScrollCapture*` 方法名（诊断：OEM 差异时看它）
         *  - `supported`   ：仅当 `probeAvailable` 为 true 才有确定值；
         *    为 false 时返回 JSON null（**显式表达「未知」**，不用 false 冒充「不支持」）
         *
         * 为什么把判据放在原生侧：只有 Native 能读 View 属性。暴露给前端后，
         * `eg-mobile-actions.mjs` 的「⑥ 滚动截屏」即可从「恒 SKIP（不可读）」升级为
         * **有真值可判（或明确报未知）** —— P-11「探针必须先能取到事实，再谈判据」。
         */
        @JavascriptInterface
        fun scrollCaptureStatus(): String {
            // 【关键】每次调用都**重放探测**：探测语义是「询问**当前**滚动内容尺寸」，
            // 而 onCreate 时 WebView 是空的（必然 no-callback）。探针是在页面加载完成后
            // 才调的，故这里必须重探才能拿到真实结果（否则会得出「不支持」的假结论）。
            //
            // 【为什么用锁同步等待而不是 handler.post 后就返回】
            // JS 桥方法跑在 **JavaBridge 线程**，而 View 属性访问必须在**主线程**。
            // 若只 post 不等待，本次返回的会是**上一次**探测的字段值（竞态：探测还没跑，
            // 数据已序列化）——那又是一种「看起来对、实际是旧数据」的假结论。
            // 故用 CountDownLatch 把桥线程阻塞到主线程探测完成（探测是微秒级纯查询）。
            val latch = java.util.concurrent.CountDownLatch(1)
            handler.post {
                try {
                    probeScrollCapture("query")
                } catch (e: Exception) {
                    android.util.Log.w("DSHTavern", "query 时重探滚动捕获失败", e)
                } finally {
                    latch.countDown()
                }
            }
            try {
                latch.await(1500, java.util.concurrent.TimeUnit.MILLISECONDS)
            } catch (e: InterruptedException) {
                android.util.Log.w("DSHTavern", "等待滚动捕获探测超时", e)
            }
            val o = JSONObject()
            o.put("ok", true)
            o.put("sdkInt", Build.VERSION.SDK_INT)
            o.put(
                "hint",
                if (scrollCaptureHintValue == Int.MIN_VALUE) JSONObject.NULL else scrollCaptureHintValue,
            )
            o.put("hintIncluded", scrollCaptureHintValue == View.SCROLL_CAPTURE_HINT_INCLUDE)
            o.put("probeAvailable", scrollCaptureProbeAvailable)
            o.put("hasCallback", scrollCaptureHasCallback)
            o.put("methods", scrollCaptureMethods)
            o.put("searchResult", scrollCaptureSearchResult)
            // 【关键 · 为什么不给 supported 一个布尔值】
            // 本机实测（sdk=35）为「读 callback 是否存在」尝试了**五条路径，全部失败**：
            //   ① Kotlin 合成属性 / ② 显式 getter → 编译期 Unresolved
            //   ③ 反射 getScrollCaptureCallback   → 运行期 NoSuchMethodException
            //   ④ 反推 onScrollCaptureSearch 签名 → 签名错（真实是 Rect,Point,Consumer）
            //   ⑤ 枚举签名 + 动态构造调用          → 执行成功，但得 `no-callback`
            // 而 ⑤ 的 `no-callback` **不能推出「不支持」**：
            //   · `View.onScrollCaptureSearch` 在 AOSP 里是「**有 callback 才转发**」的内部
            //     hook，无 callback 时空实现正是**预期行为** ⇒ 该结果**无区分力**；
            //   · 且 `getScrollCaptureCallback` 在这台设备的 View 上**枚举不到**
            //     ⇒ 该设备的 View 实现与标准 AOSP 不一致 ⇒ 连 ⑤ 的语义都不能假定。
            // ⇒ 结论只能是**未知**。给 false 会是「用不可靠判据支撑确定结论」——
            //    正是本轮反复出现、且 F3 上一版「✅ 已接通」所犯的同一个错误（P-11/P-17）。
            // 故 supported 恒为 JSON null；**唯一确定的事实**单独给出（hintIncluded）。
            // 真机系统截屏操作才是这一格的最终判据（R7：模拟器不提供该 UI）。
            o.put("supported", JSONObject.NULL)
            // 明确区分「我们确定知道的」与「我们测不出的」：
            o.put("declared", scrollCaptureHintValue == View.SCROLL_CAPTURE_HINT_INCLUDE)
            o.put("verdict", "unknown")
            return o.toString()
        }

        /** 【2026-09-08】拉起「所有文件访问」系统设置页（用户手动开关后回到 app 即生效；
         *  node 运行时进程随后即可直读直写 /sdcard——沙箱外全盘通道） */
        @JavascriptInterface
        fun requestAllFilesAccess() {
            handler.post { launchAllFilesAccessSettings() }
        }

        /**
         * 【L2/A1 2026-09-14】软键盘避让的运行期读回（供设备探针断言，纯观测零副作用）。
         *
         * 返回：`{ok, imeBottomPx, barsBottomPx, appliedBottomPx, lastEvtAt, webViewPaddingBottomPx, sdkInt}`
         *  - `imeBottomPx`   ：最近一次 insets 回调里 `Type.ime().bottom`（**-1 = 监听未跑过**）
         *  - `appliedBottomPx`：实际写入 WebView padding 的 bottom（`max(ime, bars)`）
         *  - `webViewPaddingBottomPx`：**直接读视图当前 padding** ⇒ 与 applied 对照可发现
         *    「我们以为写了但视图没接受」（例如后续有人又 setPadding 覆盖）
         *
         * 为什么要有「直接读视图」这一路（P-11）：只信自己记的 applied 值 = 自证；
         * 读 `webView.paddingBottom` 才是**独立来源**，二者一致才算真的落到了视图上。
         */
        @JavascriptInterface
        fun keyboardInsetStatus(): String {
            val latch = java.util.concurrent.CountDownLatch(1)
            var padBottom = -1
            var marginBottom = -1
            var viewH = -1
            handler.post {
                try {
                    padBottom = webView.paddingBottom
                    val lp = webView.layoutParams
                    marginBottom = if (lp is android.widget.FrameLayout.LayoutParams) lp.bottomMargin else -2
                    viewH = webView.height
                } catch (e: Exception) {
                    android.util.Log.w("DSHTavern", "读 webView 布局失败", e)
                } finally {
                    latch.countDown()
                }
            }
            try {
                latch.await(1500, java.util.concurrent.TimeUnit.MILLISECONDS)
            } catch (e: InterruptedException) {
                android.util.Log.w("DSHTavern", "等待读布局超时", e)
            }
            return JSONObject()
                .put("ok", true)
                .put("sdkInt", Build.VERSION.SDK_INT)
                .put("imeBottomPx", insetImeBottomPx)
                .put("barsBottomPx", insetBarsBottomPx)
                .put("appliedBottomPx", insetAppliedBottomPx)
                .put("channel", insetChannel)
                // 【两条独立来源】实际落到视图上的值（不是我们自己记的 appliedBottomPx）
                .put("webViewPaddingBottomPx", padBottom)
                .put("webViewMarginBottomPx", marginBottom)
                .put("webViewHeightPx", viewH)
                .put("lastEvtAt", insetLastEvtAt)
                .put("listenerInstalled", insetLastEvtAt > 0)
                .toString()
        }

        /** 授权目录里的 zip 清单：{ok, granted, files:[{name,size,mtime}]}（DocumentsContract 裸查询，零新依赖） */
        @JavascriptInterface
        fun listTreeZips(): String {
            val treeStr = prefs.getString("tree_uri", null)
                ?: return JSONObject().put("ok", true).put("granted", false).put("files", JSONArray()).toString()
            val treeUri = Uri.parse(treeStr)
            val arr = JSONArray()
            try {
                val children = DocumentsContract.buildChildDocumentsUriUsingTree(
                    treeUri, DocumentsContract.getTreeDocumentId(treeUri))
                contentResolver.query(
                    children,
                    arrayOf(
                        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                        DocumentsContract.Document.COLUMN_SIZE,
                        DocumentsContract.Document.COLUMN_LAST_MODIFIED,
                    ),
                    null, null, null,
                )?.use { c ->
                    while (c.moveToNext()) {
                        val name = c.getString(0) ?: continue
                        if (!name.lowercase().endsWith(".zip")) continue
                        arr.put(
                            JSONObject()
                                .put("name", name)
                                .put("size", if (c.isNull(1)) 0 else c.getLong(1))
                                .put("mtime", if (c.isNull(2)) 0 else c.getLong(2)),
                        )
                    }
                }
            } catch (e: Exception) {
                return errJson("读取授权目录失败：${e.message}")
            }
            return JSONObject().put("ok", true).put("granted", true).put("files", arr).toString()
        }

        /** 把授权目录里的指定 zip 流式拷进 inbox（单次顺序读，避开 SAF 随机读的低效）→ 之后走 readInboxChunk */
        @JavascriptInterface
        fun stageTreeFile(name: String): String {
            val treeStr = prefs.getString("tree_uri", null) ?: return errJson("尚未授权目录")
            val treeUri = Uri.parse(treeStr)
            return try {
                var docUri: Uri? = null
                val children = DocumentsContract.buildChildDocumentsUriUsingTree(
                    treeUri, DocumentsContract.getTreeDocumentId(treeUri))
                contentResolver.query(
                    children,
                    arrayOf(
                        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    ),
                    null, null, null,
                )?.use { c ->
                    while (c.moveToNext()) {
                        if (c.getString(1) == name) {
                            docUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, c.getString(0))
                            break
                        }
                    }
                }
                val src = docUri ?: return errJson("授权目录中找不到：$name")
                val out = File(inbox(), "tree-${System.currentTimeMillis()}-${sanitizeFileName(name, 60)}")
                contentResolver.openInputStream(src)?.use { ins ->
                    out.outputStream().use { ins.copyTo(it) }
                } ?: return errJson("无法打开：$name")
                android.util.Log.d("DSHTavern", "tree staged: ${out.name} (${out.length()} B)")
                JSONObject().put("ok", true).put("name", out.name).put("size", out.length()).toString()
            } catch (e: Exception) {
                errJson(e.message ?: "stage error")
            }
        }
    }

    /** 通道 1：分享进来的 zip（ACTION_SEND）→ content resolver 读流 → filesDir/inbox/shared-<ts>.zip → 通知前端 */
    private fun handleIncomingIntent(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND) return
        val uri: Uri? = if (Build.VERSION.SDK_INT >= 33) {
            intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        } else {
            @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_STREAM)
        }
        if (uri == null) return
        Thread {
            try {
                val displayName = queryDisplayName(uri) ?: "tauritavern-export.zip"
                val out = File(
                    File(filesDir, "inbox").apply { mkdirs() },
                    "shared-${System.currentTimeMillis()}-${sanitizeFileName(displayName, 60)}",
                )
                contentResolver.openInputStream(uri)?.use { ins ->
                    out.outputStream().use { ins.copyTo(it) }
                } ?: throw java.io.IOException("无法读取分享内容")
                android.util.Log.d("DSHTavern", "share saved: ${out.name} (${out.length()} B)")
                handler.post { dispatchShareChanged(openImportTab = true) }
            } catch (e: Exception) {
                android.util.Log.e("DSHTavern", "share save failed", e)
            }
        }.start()
    }

    private fun queryDisplayName(uri: Uri): String? = try {
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        }
    } catch (_: Exception) {
        null
    }

    /**
     * 通知 WebView 前端「inbox / 授权目录有变化」：
     *  - dsht-share:changed 派发到顶层 window + 所有同源 iframe（导入中心 iframe 在同源
     *    127.0.0.1:3080 内，JSInterface 与事件都能直达）
     *  - openImportTab=true 时顺带派发 dsht-rp-ui:open(tab=import) 拉起 RP 启动器导入 tab
     *    （与 maybeOpenFirstLaunchImport 同机制）；页面未加载完则挂起待端口就绪
     */
    private fun dispatchShareChanged(openImportTab: Boolean) {
        if (!dshLoaded) {
            if (openImportTab) pendingShareOpenImport = true
            return
        }
        val openJs = if (openImportTab) {
            "window.dispatchEvent(new CustomEvent('dsht-rp-ui:open',{detail:{tab:'import'}}));"
        } else {
            ""
        }
        webView.evaluateJavascript(
            "(()=>{try{" +
                "window.dispatchEvent(new CustomEvent('dsht-share:changed'));" +
                "document.querySelectorAll('iframe').forEach(function(f){" +
                "try{f.contentWindow.dispatchEvent(new CustomEvent('dsht-share:changed'))}catch(e){}});" +
                openJs +
                "}catch(e){}})()",
            null,
        )
    }

    // ------------------------------------------------------------------
    // §4.16.2 C 类①：下载接管
    // ------------------------------------------------------------------

    /**
     * WebView 下载接管：页面触发下载（attachment / 不可内联渲染的 MIME）时回调 →
     * 转交系统 DownloadManager（最简可靠：落公共 Downloads 目录，通知栏可见进度）。
     * 不做 SAF 另存为（复杂度高，留 M3）。URL 空或非 http(s)（blob/data 等内部
     * 协议）一律忽略。
     */
    private fun setupDownloadListener() {
        webView.setDownloadListener { url, _, contentDisposition, mimetype, _ ->
            if (url.isNullOrEmpty() || (!url.startsWith("http://") && !url.startsWith("https://"))) {
                android.util.Log.d("DSHTavern", "download ignored (空或非 http(s)): $url")
                return@setDownloadListener
            }
            try {
                // guessFileName 综合 Content-Disposition 文件名 / URL 末段 / MIME 扩展名
                val fileName = URLUtil.guessFileName(url, contentDisposition, mimetype)
                val request = DownloadManager.Request(Uri.parse(url)).apply {
                    setTitle(fileName)
                    setDescription("DSHTavern 文件下载")
                    setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
                }
                getSystemService(DownloadManager::class.java).enqueue(request)
                Toast.makeText(this, "已开始下载：$fileName", Toast.LENGTH_SHORT).show()
                android.util.Log.d("DSHTavern", "download enqueued: $fileName ← $url")
            } catch (e: Exception) {
                android.util.Log.e("DSHTavern", "download enqueue failed: $url", e)
                Toast.makeText(this, "下载失败：${e.message}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    // ------------------------------------------------------------------
    // §4.16.2 B 类：通知深链 dsht://session/<id>
    // ------------------------------------------------------------------

    /**
     * 解析 ACTION_VIEW 深链（scheme=dsht、host=session、路径段=sessionId）。
     * WebView 已就绪立即派发；未就绪先暂存（pendingLocateSessionId），端口通了补派发。
     */
    private fun handleLocateDeepLink(intent: Intent?) {
        if (intent?.action != Intent.ACTION_VIEW) return
        val data = intent.data ?: return
        if (data.scheme != "dsht" || data.host != "session") return
        val sessionId = data.lastPathSegment
        if (sessionId.isNullOrEmpty()) return
        android.util.Log.d("DSHTavern", "deeplink locate-session: $sessionId")
        dispatchLocateSession(sessionId, attempt = 0)
    }

    /**
     * 向前端派发 locate-session 事件（前端 dsht-rp-ui 监听消费 → sessions.open 打开会话）：
     * 派发 JS 同步读前端置位的 __dshtLocateConsumed 回传消费结果——监听未注册（前端
     * 未就绪）则 400ms 重试，超上限放弃；WebView 未加载则挂起待端口就绪。
     */
    private fun dispatchLocateSession(sessionId: String, attempt: Int) {
        if (!dshLoaded) {
            pendingLocateSessionId = sessionId
            return
        }
        // __dshtLocateConsumed 由前端监听器同步置位 → dispatchEvent 返回即可判定消费成功
        val js = "(()=>{try{" +
            "window.__dshtLocateConsumed=false;" +
            "window.dispatchEvent(new CustomEvent('dsht-rp-ui:locate-session'," +
            "{detail:{sessionId:${JSONObject.quote(sessionId)}}}));" +
            "return window.__dshtLocateConsumed?'ok':'no-listener'" +
            "}catch(e){return 'err'}})()"
        webView.evaluateJavascript(js) { r ->
            when {
                r == "\"ok\"" -> {
                    pendingLocateSessionId = null
                    android.util.Log.d("DSHTavern", "locate-session dispatched+consumed: $sessionId")
                }
                attempt < LOCATE_RETRY_MAX ->
                    handler.postDelayed({ dispatchLocateSession(sessionId, attempt + 1) }, 400)
                else ->
                    android.util.Log.w("DSHTavern", "locate-session: 前端未就绪，放弃派发 $sessionId")
            }
        }
    }

    // ------------------------------------------------------------------
    // §4.16.2 C 类③：WebView 版本碎片检测
    // ------------------------------------------------------------------

    /**
     * 系统 WebView 版本检测：取 com.google.android.webview（老系统兜底
     * com.android.webview）的 versionName 解析 major。低于 100（缺大量现代 JS
     * 能力，AbortSignal.any polyfill 只能救一部分）时 Toast 一次性提示——
     * 不弹窗不打断启动。
     */
    private fun checkWebViewVersion() {
        try {
            @Suppress("DEPRECATION")
            fun versionOf(pkg: String): String? = try {
                packageManager.getPackageInfo(pkg, 0).versionName
            } catch (_: PackageManager.NameNotFoundException) {
                null
            }
            val versionName = versionOf("com.google.android.webview")
                ?: versionOf("com.android.webview")
                ?: return // 找不到 WebView 提供方（罕见）——静默跳过
            val major = versionName.substringBefore('.').toIntOrNull() ?: return
            android.util.Log.d("DSHTavern", "system webview: $versionName (major=$major)")
            if (major < 100) {
                Toast.makeText(
                    this,
                    "系统 WebView 版本过低（当前 $major），建议更新以获得完整体验",
                    Toast.LENGTH_LONG,
                ).show()
            }
        } catch (e: Exception) {
            android.util.Log.e("DSHTavern", "webview version check failed", e)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        startForegroundService(Intent(this, NodeService::class.java))

        // §4.16.2：WebView 版本碎片检测（低版本仅 Toast 提示，不打断启动）
        checkWebViewVersion()

        webView = WebView(this)
        // WebView CDP 调试通道（仅 debuggable 构建）：宿主机 adb forward 后可直接对 App 内页面做 DOM 级自动化测试
        if (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            WebView.setWebContentsDebuggingEnabled(true)
        }

        bootTitle = TextView(this).apply {
            text = "正在启动 DSH 运行时"
            textSize = 16f
            setPadding(48, 96, 48, 12)
        }
        bootDetail = TextView(this).apply {
            text = "初始化…"
            textSize = 13f
            setTextColor(Color.parseColor("#9FB0C6"))
            setPadding(48, 0, 48, 16)
        }
        bootOutput = TextView(this).apply {
            textSize = 11f
            typeface = Typeface.MONOSPACE
            setTextColor(Color.parseColor("#7A8DA5"))
            setPadding(48, 0, 48, 24)
            setTextIsSelectable(true)
        }
        bootingView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0F1B2D"))
            addView(bootTitle)
            addView(ScrollView(this@MainActivity).apply {
                addView(LinearLayout(this@MainActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    addView(bootDetail)
                    addView(bootOutput)
                })
            }, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f
            ))
        }

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            userAgentString = userAgentString + " DSHTavern/0.1"
        }
        // 【坑 #15 2026-09-08】WebView 磁盘缓存跨进程重启存活：runtime 热更新（sentinel
        // 变更重解压）后，缓存的 boot HTML 仍引用旧 rev 的 /plugins combo URL → WebView
        // 缓存命中 → 执行旧前端（模拟器实证：rev cddf… 旧实例 vs 服务器 dbf5… 新实例）。
        // 内容源是本机 127.0.0.1——缓存毫无收益，冷启动直接清空（热启动不清，保滚动位置
        // 等进程内状态不受影响）。
        if (savedInstanceState === null) {
            webView.clearCache(true)
        }
        // 渲染进程保护（API 29+）：renderer 是独立进程，默认 oom_adj 偏高——内存吃紧时
        // 首先被 LMK 杀掉 = 页面白屏/"闪退"观感（真机鸿蒙 6 实证）。本 app 的 WebView 就是
        // 前台主体，渲染进程与 app 同生共死：IMPORTANT + 可见时才渲染（后台不烧 GPU/CPU）。
        if (Build.VERSION.SDK_INT >= 29) {
            webView.setRendererPriorityPolicy(
                WebView.RENDERER_PRIORITY_IMPORTANT,
                /* arePrioritiesInvertedWhenBelowImportant = */ false,
            )
        }

        // 免 root 读 TauriTavern：分享 inbox + SAF 授权目录桥（顶层与同源 iframe 都可访问）
        webView.addJavascriptInterface(DSHTShareBridge(), "DSHTShare")

        // §4.16.2：下载接管（→ 系统 DownloadManager 落公共 Downloads）
        setupDownloadListener()

        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                super.onPageStarted(view, url, favicon)
                // Android WebView 部分版本缺 AbortSignal.any（DSH 工作区/会话渲染用到，
                // 用户实测选择工作区报错）——在页面 JS 执行前注入 polyfill（最早时机）
                view.evaluateJavascript(ABORT_SIGNAL_ANY_POLYFILL, null)
                // 【W-G 2026-09-21】AbortSignal.timeout + crypto.randomUUID（后者是 LAN
                // HTTP 非 secure context 的必需面）——同最早时机注入，只补缺失键
                view.evaluateJavascript(EXTRA_POLYFILLS, null)
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val host = request.url.host ?: return false
                return host != "127.0.0.1" && host != "localhost"
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                // DSH 页面加载失败：回到等待屏轮询（端口探活比 WebView 重试可靠）。
                // tokenWaits 不重置（修 401↔等待死循环）：401 = 干净 URL 无令牌被拒，
                // 只等 token 到达即带 token 重载；tokenDegraded 保证不再重复降级。
                // T-45：同时置 reloadNeeded —— token 未变时也必须有自愈路径。
                if (request.isForMainFrame) {
                    android.util.Log.w(
                        "DSHTavern",
                        "main-frame error ${error.errorCode} ${error.description} @ ${request.url}",
                    )
                    dshLoaded = false
                    reloadNeeded = true
                    showBoot()
                }
            }

            // @adapt contract:wire.auth-401
            override fun onReceivedHttpError(view: WebView, request: android.webkit.WebResourceRequest, errorResponse: android.webkit.WebResourceResponse) {
                // 0.1.2 token 鉴权：主框架 401（干净 URL 无令牌）——WebView 对 HTTP 错误
                // 走 onReceivedHttpError 而非 onReceivedError（踩过：漏处理导致卡在
                // "Webpage not available" 错误页，token 到达也无人重载）。回等待屏轮询，
                // token 到达（stdout/dsht-token 文件双通道）即带 token 重载。
                // T-45：同样置 reloadNeeded（token 迟到的场景下，重载分支先于 token 变化
                // 也是安全的——重载用的就是上次的 URL）。
                if (request.isForMainFrame && request.url.host == "127.0.0.1") {
                    android.util.Log.w(
                        "DSHTavern",
                        "main-frame http ${errorResponse.statusCode} @ ${request.url}",
                    )
                    dshLoaded = false
                    reloadNeeded = true
                    showBoot()
                }
            }

            // ------------------------------------------------------------------
            // 【L4 2026-09-14 内存压力自愈】渲染进程被 LMK 杀死 → 重建 WebView。
            //
            // ## 为什么必须在此层修（而不是继续依赖 T-45 的重载）
            // renderer 是独立进程（`:sandboxed_process`），内存吃紧时 oom_adj 高、**优先被杀**。
            // 被杀时：
            //   · 主框架**不会**走 `onReceivedError` / `onReceivedHttpError` —— 页面是「已经加载
            //     好了」的状态，只是渲染进程没了 ⇒ T-45 那套「主框架失败 → 带预算重载」分支
            //     **永不触发**；
            //   · 网页内容仍在（DOM 在 renderer 里），进程没了 ⇒ 现场表现是**整页白屏**，
            //     且 `webView.loadUrl` 是空操作（旧实例的 renderer 已不存在）。
            // 即：这是「静默失败」的又一例（P-3）——用户只看到白屏，零留痕、零自愈。
            //
            // ## 为什么是 recreate() 而不是「手动 new 一个 WebView」
            // 「重建 WebView」有两条路：
            //   (a) 本函数内 `WebView(this)` + 重跑一遍 settings/client/insets/scrollCapture 配置；
            //   (b) `recreate()` —— 整 Activity 重建，onCreate 原样跑一遍。
            // 选 (b)，因为 (a) 要求把 onCreate 里**约 20 处配置**（settings 7 项、WebViewClient
            // 6 个覆写、WebChromeClient 5 个覆写、JavascriptInterface、downloadListener、
            // insets 监听、scrollCaptureHint、clearCache 时机）抽成函数并保证**两处调用永不漂移**
            // ——这正是本项目主力缺陷族「同一语义多份实现」（P-1b）的典型形态。
            // `recreate()` 天然复用同一份 onCreate，**配置漂移在结构上不可能发生**。
            // 代价只是 Activity 重建（本 Activity 无重状态：状态都在 NodeService 与 prefs）。
            //
            // ## 预算为什么必须落 prefs
            // `recreate()` 会重建 Activity ⇒ `reloadAttempts` 归零 ⇒「崩→建→崩」无限循环
            // （每次都是「第 1 次」）。故用 `rendererRebuilds`（落 prefs，跨重建有效，见字段注释）。
            // 超预算即**出声**停在等待屏（R8：不静默兜底），绝不无限重建烧电。
            //
            // 返回 true = 「我处理了，系统不要杀我整个 app」（默认行为是杀进程）。
            // ------------------------------------------------------------------
            override fun onRenderProcessGone(
                view: WebView,
                detail: android.webkit.RenderProcessGoneDetail,
            ): Boolean {
                val n = rendererRebuilds + 1
                if (n > RENDERER_REBUILD_MAX) {
                    android.util.Log.e(
                        "DSHTavern",
                        "renderer 连续消失 ${n - 1} 次（已达上限 $RENDERER_REBUILD_MAX），" +
                            "停止自动重建 —— 请重启应用",
                    )
                    dshLoaded = false
                    reloadNeeded = true
                    showBoot()
                    return true
                }
                rendererRebuilds = n
                android.util.Log.w(
                    "DSHTavern",
                    "renderer gone (crashed=${detail.didCrash()}) → recreate() " +
                        "(attempt $n/$RENDERER_REBUILD_MAX)",
                )
                dshLoaded = false
                rebuildWebView()
                showBoot()
                return true
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(msg: ConsoleMessage): Boolean {
                android.util.Log.d("DSHTavern.Web", "[${msg.lineNumber()}] ${msg.message()}")
                return true
            }

            // ------------------------------------------------------------------
            // 【ST 对齐 2026-09-07】JS 对话框三件套：TH 卡脚本大量依赖 confirm()/
            // alert()/prompt()（飞讯锁定角色「是否强行提前解锁？」、删除确认等）。
            // 默认 WebChromeClient 不实现 = 静默返回 false/null → 脚本流程静默中断
            // （实机实证：飞讯联系人全部走 confirm 分支，点开后无响应 = 用户报
            // 「想给里面的角色发信息却不行」根因之一）。AlertDialog 实现 = ST 浏览器
            // 同语义（JS 阻塞等待用户操作，回调回填结果）。
            // ------------------------------------------------------------------
            override fun onJsAlert(view: WebView, url: String?, message: String?, result: android.webkit.JsResult): Boolean {
                android.app.AlertDialog.Builder(this@MainActivity)
                    .setMessage(message ?: "")
                    .setPositiveButton(android.R.string.ok) { _, _ -> result.confirm() }
                    .setOnCancelListener { result.cancel() }
                    .show()
                return true
            }

            override fun onJsConfirm(view: WebView, url: String?, message: String?, result: android.webkit.JsResult): Boolean {
                android.app.AlertDialog.Builder(this@MainActivity)
                    .setMessage(message ?: "")
                    .setPositiveButton(android.R.string.ok) { _, _ -> result.confirm() }
                    .setNegativeButton(android.R.string.cancel) { _, _ -> result.cancel() }
                    .setOnCancelListener { result.cancel() }
                    .show()
                return true
            }

            override fun onJsPrompt(
                view: WebView,
                url: String?,
                message: String?,
                defaultValue: String?,
                result: android.webkit.JsPromptResult,
            ): Boolean {
                val input = android.widget.EditText(this@MainActivity).apply { setText(defaultValue ?: "") }
                android.app.AlertDialog.Builder(this@MainActivity)
                    .setMessage(message ?: "")
                    .setView(input)
                    .setPositiveButton(android.R.string.ok) { _, _ -> result.confirm(input.text.toString()) }
                    .setNegativeButton(android.R.string.cancel) { _, _ -> result.cancel() }
                    .setOnCancelListener { result.cancel() }
                    .show()
                return true
            }

            /** 文件选择桥：HTML <input type="file"> → SAF 系统文件管理器（零权限） */
            override fun onShowFileChooser(
                view: WebView,
                filePathCallback: android.webkit.ValueCallback<Array<android.net.Uri>>,
                fileChooserParams: FileChooserParams,
            ): Boolean {
                filePickerCallback?.onReceiveValue(null)
                filePickerCallback = filePathCallback
                try {
                    startActivityForResult(fileChooserParams.createIntent(), 1001)
                } catch (e: android.content.ActivityNotFoundException) {
                    filePickerCallback = null
                    return false
                }
                return true
            }
        }

        setContentView(webView)
        addContentView(
            bootingView,
            android.widget.FrameLayout.LayoutParams(
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
            ),
        )
        // 【W-A/B/D 2026-09-21】悬浮设置入口（NoActionBar 主题没有菜单面——
        // 设置面板承载：局域网访问 / 备份恢复 / 自检修补 / 重装运行时 / 关于）。
        // 半透明圆底，常驻右下；不挡 DSH 侧边栏（其在左侧）。
        addContentView(
            TextView(this).apply {
                text = "⚙"
                textSize = 20f
                setTextColor(Color.parseColor("#CFD8E3"))
                setPadding(28, 16, 28, 16)
                setBackgroundColor(Color.parseColor("#660F1B2D"))
                setOnClickListener { showSettingsDialog() }
            },
            android.widget.FrameLayout.LayoutParams(
                android.widget.FrameLayout.LayoutParams.WRAP_CONTENT,
                android.widget.FrameLayout.LayoutParams.WRAP_CONTENT,
                android.view.Gravity.BOTTOM or android.view.Gravity.END,
            ).apply { setMargins(0, 0, 12, 96) },
        )

        // 【L2 2026-09-14 安全区修复】系统栏避让。
        //
        // 症状（L2 穷举发现）：我方 CSS 有 9 处 `env(safe-area-inset-*)`（汉堡、RP overlay、
        // 贴底面板、抽屉、脚本球…），但**全部恒为 0** —— 因为 `env(safe-area-inset-*)`
        // 要求两个前提同时成立：
        //   ① 页面 viewport 声明 `viewport-fit=cover`；
        //   ② 系统栏真的覆盖在应用内容之上（edge-to-edge）。
        // 实测：宿主 boot 页（@deepseek-ai/dsh-web-frontend/dist/index.html:5）是
        // `width=device-width, initial-scale=1`，**无 viewport-fit**；而 targetSdk=36
        // （Android 15+ 强制 edge-to-edge）⇒ 状态栏确实压住内容，但 CSS 拿不到 inset。
        // 净效果：**顶部内容被状态栏遮挡**，且我方那 9 处声明是**静默死代码**（P-3）。
        //
        // 责任划分（为什么不只改 CSS）：viewport meta 由**宿主 boot 页**提供（官方产物，
        // 不可改，B4）；在 WebView 里注入改 meta 会与宿主 SSR 冲突。故**在原生层消费
        // WindowInsets 收缩 WebView 的**布局尺寸**（margin）—— 这是最直接、不依赖页面配合的修法。
        //
        // ⚠️ 修法形态的更正（2026-09-14 设备实测推翻上一版）：上一版用 `setPadding`，
        //    实测**padding 写进了视图但页面视口不变** ⇒ 无效修法。详见下方「必须用 margin」注释。
        //
        // 与 CSS 的关系：本修法让内容避开系统栏（视图真的变矮），CSS 里的 env() 仍为 0（无害）。
        // 两者不冲突：即便将来宿主补了 viewport-fit=cover，这里的 margin 也在
        // （视图被收缩后 inset 变 0），不会出现「双重避让」。
        // 【L2/A1 2026-09-14 软键盘遮挡修复】底部输入区被软键盘盖住 191px（真缺口，设备实测）。
        //
        // 症状（L2「视口单位」+ A1「焦点与软键盘」交叉格）：点击 RP 输入框弹出软键盘后，
        // composer 底边被键盘盖住。设备实测（`scripts/ef-keyboard-inset.mjs`）：
        //   · 键盘真的弹出：`mInputShown=true`，IME frame `[0,1633][1080,2400]`（高 767px）
        //   · 页面几何**完全不变**：`window.innerHeight` 873→873、`visualViewport.height`
        //     873→873、`documentElement.clientHeight` 873→873
        //   · ⇒ 键盘顶边 593.8 CSS px 而 composerBottom=785 CSS px ⇒ **被盖 191 CSS px**
        //
        // 为什么 `adjustResize` 没生效（Manifest 确实声明了它）：
        //   `dumpsys window windows` 显示本窗口属性含 `EDGE_TO_EDGE_ENFORCED`
        //   （targetSdk=36 = Android 15+ 强制 edge-to-edge）⇒ 窗口恒为全屏 `[0,0][1080,2400]`，
        //   系统不再为 IME 收缩窗口 ⇒ `adjustResize` 对**窗口尺寸**失效，只剩 insets 通道。
        //   而此前这里只消费 `systemBars()`（不含 ime）⇒ 键盘弹出时 WebView 不避让。
        //
        // 为什么在**原生层**修而不是 CSS：
        //   ① 本环境 `visualViewport` **不反映键盘**（实测三项口径全部不变）⇒ 页面侧**测不出来**，
        //      任何基于 `dvh`/`visualViewport` 的 CSS 修法在此环境都是**无效修法**（P-17/P-20）；
        //   ② 宿主 boot 页无 `viewport-fit=cover`（官方产物，不可改 B4）⇒ `env(safe-area-inset-*)`
        //      恒 0，CSS 拿不到 inset；
        //   ③ 原生侧收缩 WebView 布局尺寸是最直接、不依赖页面配合的通道，与既有 systemBars 避让同源。
        //      **且必须用 margin 而非 padding**（实测：padding 会被视图接受但页面视口不变）。
        //
        // 取「较大者」而非相加：`systemBars().bottom`（导航栏 66px）与 `ime().bottom`（键盘 767px）
        // 在键盘弹出时是**同一块屏幕区域**的两个视角，相加会双重避让（多留一条导航栏高度）。
        // 键盘收起时 `ime().bottom == 0` ⇒ 自动回落为导航栏高度，无需额外状态机。
        //
        // 运行期读回（`insetImeBottomPx` 等）：纯观测，供 `ef-keyboard-inset.mjs` 断言
        // 「修复真的在产物里且真的被调用过」，而不是只看源码写了什么（P-11 产物即事实）。
        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(webView) { v, insets: androidx.core.view.WindowInsetsCompat ->
            val bars = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars())
            // 【L2/A1 2026-09-14 软键盘遮挡修复】见下方注释块。
            val ime = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.ime())
            val bottom = if (ime.bottom > bars.bottom) ime.bottom else bars.bottom
            // 【关键 · 必须用 margin 而不是 padding】
            // 设备实测（scripts/ef-keyboard-inset.mjs）：`setPadding(..., 767)` **确实写进了视图**
            // （读回 `webView.paddingBottom == 767`），但页面视口**完全不动**
            // （`window.innerHeight` 恒 873、`documentElement.clientHeight` 恒 873）。
            // ⇒ WebView 的 padding 只裁剪绘制区，**不改变 Chromium 的视口尺寸**，
            //   页面侧因此拿不到「可用高度变小了」的信息 ⇒ 修了等于没修（P-11 的典型：
            //   「写了就算修了」与「视图接受了但语义未变」是两回事）。
            // margin 走的是**布局尺寸**通道 ⇒ 视图真的变矮 ⇒ 网页视口随之收缩 ⇒ 页面
            // （含 `position:fixed; inset:0` 的 RP overlay）整体上移，输入区不再被盖。
            val lp = v.layoutParams
            if (lp is android.widget.FrameLayout.LayoutParams) {
                lp.leftMargin = bars.left
                lp.topMargin = bars.top
                lp.rightMargin = bars.right
                lp.bottomMargin = bottom
                v.layoutParams = lp
                insetChannel = "margin"
            } else {
                // 布局参数类型意外（理论上 setContentView(View) 必为 FrameLayout.LayoutParams）
                // ⇒ 退回 padding（至少不崩），并**出声**（R8：不静默兜底）
                v.setPadding(bars.left, bars.top, bars.right, bottom)
                insetChannel = "padding"
                android.util.Log.w(
                    "DSHTavern",
                    "WebView layoutParams 非 FrameLayout.LayoutParams（${lp?.javaClass?.simpleName}）" +
                        "→ 退回 padding 避让（可能不生效，请上报）",
                )
            }
            // 运行期读回（供设备探针断言 P-9/P-11）
            insetImeBottomPx = ime.bottom
            insetBarsBottomPx = bars.bottom
            insetAppliedBottomPx = bottom
            insetLastEvtAt = System.currentTimeMillis()
            insets
        }

        // 【F3 2026-09-14】滚动截屏（长截图）接通。
        //
        // 症状（用户实测）：Android 系统「滚动截屏」对本 App 无效——只能截当前一屏。
        // 排查结论：**从未接通**（非回归）——全仓无任何 scrollCaptureHint /
        // ScrollCaptureCallback 代码。
        //
        // ## 机制（2026-09-14 复核：hint 单独设**不构成**「已接通」）
        // Android 的滚动截屏由**两件事**共同决定，缺一不可：
        //   ① `scrollCaptureHint = SCROLL_CAPTURE_HINT_INCLUDE`
        //      —— 声明「本 View 里有可滚动内容，请把我也列为候选」；
        //   ② `View.getScrollCaptureCallback()` **非 null**
        //      —— 系统真正来取「下一屏」时调用的实现；`View` 基类默认返回 **null**。
        // 官方文档（`View.setScrollCaptureCallback`）明示：
        //   「If no callback is set, the system may provide an implementation.」
        // ⇒ 对 **WebView** 而言，「系统是否提供实现」属实现细节（Chromium 有内置
        // 支持，但不保证版本/形态），**沉默即未知**。
        // 所以：**只设 hint 时无法断言已接通**——此前版本据此写「✅ 已接通」属
        // 未验证即声称（R7 违规），本轮改为**运行期可自证**（P-3/P-9/P-11）。
        //
        // ## 为什么这里**不**手写 ScrollCaptureCallback
        // 官方文档明确警告：`setScrollCaptureCallback` 传入的值
        // 「**takes precedence over a system version**」（覆盖系统实现）。
        // 自研实现要接管「请求矩形 → 渲染到 Surface → 回传 Rect」的完整协议，
        // 出错会把**本来能用**的系统长截图弄坏（净负收益，且属 B5「需大架构改造」）。
        // 正解：**设 hint（让 WebView 有机会被选中）+ 探测真实能力并如实报告**。
        // 若探测结果为「无 callback」，UI 如实标注「系统未提供」，而不是假装接通。
        //
        // API 版本：`ScrollCaptureCallback` / `set/getScrollCaptureCallback` 均为
        // **API 31**（`SCROLL_CAPTURE_HINT_INCLUDE` 常量本身是 API 30）⇒ 探测按 31 判。
        applyScrollCaptureSetup()

        // 首页直接进 DSH（无导入中心独立页——导入机制全在 DSH 内 RP 启动器）
        showBoot()
        handler.removeCallbacks(diagPoller)
        handler.postDelayed(diagPoller, 200)

        // 冷启动即分享（ACTION_SEND）：拷入 inbox，端口就绪后拉起导入 tab
        handleIncomingIntent(intent)

        // §4.16.2：冷启动即深链（ACTION_VIEW dsht://session/<id>）→ 暂存待端口就绪后派发
        handleLocateDeepLink(intent)

        // Android 13+ 通知权限：NodeService 是前台服务，通知需用户授权才可见。
        // 之前声明了 POST_NOTIFICATIONS 但从未请求——补上（其余权限均无需运行时请求：
        // 写盘走内部存储、文件选择走 SAF 零权限、INTERNET 安装时自动授予）
        if (Build.VERSION.SDK_INT >= 33
            && ContextCompat.checkSelfPermission(this, android.Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(android.Manifest.permission.POST_NOTIFICATIONS),
                1002,
            )
        }

        // 【2026-09-08 用户需求】「所有文件访问」一次性引导（存储权限拉满：突破安卓沙箱，
        // node 运行时可直读直写 /sdcard）。仅提示一次（用户拒绝后不打扰——应用内设置/
        // JS 桥 requestAllFilesAccess 随时可再拉起）。
        maybePromptAllFilesAccess()
    }

    // ---------------------------------------------------------------------------
    // 设置面板（W-A 局域网访问 / W-B 备份恢复 / W-D 自检修补，2026-09-21）
    // ---------------------------------------------------------------------------

    private fun showSettingsDialog() {
        val lanOn = prefs.getBoolean("lan_enabled", false)
        val items = mutableListOf<String>()
        val actions = mutableListOf<() -> Unit>()
        items += "局域网访问：${if (lanOn) "已开启" else "已关闭"}"
        actions += { toggleLanAccess() }
        if (lanOn) {
            val urls = NodeService.lanUrls
            if (urls.isEmpty()) {
                items += "　局域网地址：（运行时重启后可见）"
                actions += { }
            } else {
                for (u in urls) {
                    items += "　复制地址：$u"
                    actions += { copyToClipboard("局域网地址", u) }
                }
            }
        }
        items += "备份数据（导出 zip，凭据不进包）…"
        actions += { startBackup() }
        items += "恢复数据（从备份 zip 还原）…"
        actions += { startRestorePick() }
        items += "自检与一键修补…"
        actions += { showSelfCheckDialog() }
        items += "关于（版本信息）"
        actions += { showAboutDialog() }
        android.app.AlertDialog.Builder(this)
            .setTitle("设置")
            .setItems(items.toTypedArray()) { _, which -> actions[which].invoke() }
            .setNegativeButton("关闭", null)
            .show()
    }

    /** W-A：LAN 开关（需重启运行时生效——启动参数面：--trusted-host / DSHT_LAN_MODE 都在 node 启动时注入） */
    private fun toggleLanAccess() {
        val next = !prefs.getBoolean("lan_enabled", false)
        val warn = if (next) {
            "开启后，同一局域网的电脑/平板可用浏览器访问本机的 DSH（地址在设置面板复制）。\n\n" +
                "安全口径：访问必须持有 web 令牌（无令牌一律 401）；请不要把带令牌的地址发给不可信的人。\n\n" +
                "需要重启运行时生效（约几秒钟）。"
        } else {
            "关闭后局域网代理停止，DSH 回到仅本机访问。\n\n需要重启运行时生效（约几秒钟）。"
        }
        android.app.AlertDialog.Builder(this)
            .setTitle(if (next) "开启局域网访问？" else "关闭局域网访问？")
            .setMessage(warn)
            .setPositiveButton("开启并重启" .let { if (next) it else "关闭并重启" }) { _, _ ->
                prefs.edit().putBoolean("lan_enabled", next).apply()
                startForegroundService(Intent(this, NodeService::class.java).setAction(NodeService.ACTION_RESTART_NODE))
                Toast.makeText(this, "运行时重启中…", Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton("取消", null)
            .show()
    }

    private fun copyToClipboard(label: String, text: String) {
        val cm = getSystemService(android.content.ClipboardManager::class.java)
        cm.setPrimaryClip(android.content.ClipData.newPlainText(label, text))
        Toast.makeText(this, "已复制：$text（完整地址含令牌请从运行日志或重开面板获取）", Toast.LENGTH_SHORT).show()
    }

    private fun showAboutDialog() {
        android.app.AlertDialog.Builder(this)
            .setTitle("关于")
            .setMessage(
                "DSHTavern v${BuildConfig.VERSION_NAME}（versionCode ${BuildConfig.VERSION_CODE}）\n" +
                    "运行时端口：${NodeService.activePort}\n" +
                    "局域网访问：${if (prefs.getBoolean("lan_enabled", false)) "开" else "关"}\n" +
                    "ABI：${Build.SUPPORTED_ABIS.firstOrNull() ?: "unknown"}",
            )
            .setPositiveButton("好", null)
            .show()
    }

    // ---- W-B 备份 ----

    private fun startBackup() {
        val stamp = java.text.SimpleDateFormat("yyyyMMdd-HHmm", java.util.Locale.US)
            .format(java.util.Date())
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "application/zip"
            putExtra(Intent.EXTRA_TITLE, "dsht-backup-$stamp.zip")
        }
        try {
            startActivityForResult(intent, REQ_BACKUP_CREATE)
        } catch (e: android.content.ActivityNotFoundException) {
            Toast.makeText(this, "系统文件管理器不可用", Toast.LENGTH_LONG).show()
        }
    }

    /**
     * 导出：停 node（维护模式，防活备份带半行残尾）→ zip $DSH_HOME（排除凭据/令牌）
     * → 恢复 node。失败原因写 toast + 记录（不静默）。
     */
    private fun exportBackup(uri: Uri) {
        Toast.makeText(this, "备份中：node 暂停片刻…", Toast.LENGTH_SHORT).show()
        Thread {
            var msg: String
            NodeService.enterMaintenance()
            try {
                val home = File(filesDir, ".dsh")
                var entries = 0
                var bytes = 0L
                var sessions = 0
                contentResolver.openOutputStream(uri, "wt")!!.use { raw ->
                    java.util.zip.ZipOutputStream(raw.buffered()).use { zip ->
                        home.walkTopDown().filter { it.isFile }.forEach { f ->
                            val rel = f.relativeTo(home).path.replace(File.separatorChar, '/')
                            if (BACKUP_EXCLUDE.contains(rel)) return@forEach
                            zip.putNextEntry(java.util.zip.ZipEntry(rel))
                            f.inputStream().use { it.copyTo(zip) }
                            zip.closeEntry()
                            entries++
                            bytes += f.length()
                            if (rel.endsWith(".jsonl")) sessions++
                        }
                        // 清单（恢复体检的预览数据源）
                        val manifest = JSONObject()
                            .put("createdAt", java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssZ", java.util.Locale.US).format(java.util.Date()))
                            .put("appVersion", BuildConfig.VERSION_NAME)
                            .put("abi", Build.SUPPORTED_ABIS.firstOrNull() ?: "")
                            .put("entries", entries)
                            .put("uncompressedBytes", bytes)
                            .put("sessionLogs", sessions)
                            .toString()
                        zip.putNextEntry(java.util.zip.ZipEntry(BACKUP_MANIFEST))
                        zip.write(manifest.toByteArray(Charsets.UTF_8))
                        zip.closeEntry()
                    }
                }
                msg = "备份完成：$entries 个文件 / ${bytes / (1024 * 1024)}MB（会话日志 $sessions 份）"
            } catch (t: Throwable) {
                msg = "备份失败：${t.message}"
                android.util.Log.e("DSHTavern", "backup failed", t)
            } finally {
                NodeService.exitMaintenance()
            }
            val finalMsg = msg
            handler.post { Toast.makeText(this, finalMsg, Toast.LENGTH_LONG).show() }
        }.start()
    }

    // ---- W-B 恢复 ----

    private fun startRestorePick() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "application/zip"
        }
        try {
            startActivityForResult(intent, REQ_RESTORE_PICK)
        } catch (e: android.content.ActivityNotFoundException) {
            Toast.makeText(this, "系统文件管理器不可用", Toast.LENGTH_LONG).show()
        }
    }

    /**
     * 恢复前体检（只读）：整个包过一遍 ZipInputStream（CRC 错直接抛）+
     * 读清单/统计预览。返回预览 JSON；坏包抛异常（原因给弹窗）。
     */
    private fun inspectBackup(uri: Uri): JSONObject {
        var entries = 0
        var bytes = 0L
        var sessions = 0
        var manifest: JSONObject? = null
        contentResolver.openInputStream(uri)!!.use { raw ->
            java.util.zip.ZipInputStream(raw.buffered()).use { zip ->
                var entry = zip.nextEntry
                val buf = ByteArray(1 shl 16)
                while (entry != null) {
                    if (entry.name == BACKUP_MANIFEST) {
                        manifest = try { JSONObject(zip.readBytes().toString(Charsets.UTF_8)) } catch (_: Throwable) { null }
                    } else if (!entry.isDirectory) {
                        var n = zip.read(buf)
                        while (n >= 0) { n = zip.read(buf) } // 读空 = CRC 校验顺带完成
                        entries++
                        bytes += entry.size.coerceAtLeast(0)
                        if (entry.name.endsWith(".jsonl")) sessions++
                    }
                    zip.closeEntry()
                    entry = zip.nextEntry
                }
            }
        }
        if (entries == 0) throw IllegalStateException("备份包是空的（0 个数据文件）")
        return JSONObject()
            .put("entries", entries)
            .put("bytes", bytes)
            .put("sessionLogs", sessions)
            .put("manifest", manifest ?: JSONObject.NULL)
    }

    /** 恢复：体检预览 → 用户确认 → 停 node → 清 .dsh → 解压 → 拉起（sentinel 机制不管 .dsh） */
    private fun startRestore(uri: Uri) {
        Toast.makeText(this, "体检备份包…", Toast.LENGTH_SHORT).show()
        Thread {
            try {
                val info = inspectBackup(uri)
                val m = info.optJSONObject("manifest")
                val preview = buildString {
                    append("文件 ${info.getInt("entries")} 个，约 ${info.getLong("bytes") / (1024 * 1024)}MB")
                    append("\n会话日志 ${info.getInt("sessionLogs")} 份")
                    if (m != null) {
                        append("\n备份时间：${m.optString("createdAt", "未知")}")
                        append("\n来自版本：v${m.optString("appVersion", "未知")}")
                    } else {
                        append("\n（无清单文件——可能是手工打包，仍可恢复）")
                    }
                    append("\n\n⚠️ 现有数据将被整体替换，API key 需恢复后重新填写。确定恢复？")
                }
                handler.post {
                    android.app.AlertDialog.Builder(this)
                        .setTitle("恢复确认")
                        .setMessage(preview)
                        .setPositiveButton("恢复") { _, _ -> doRestore(uri) }
                        .setNegativeButton("取消", null)
                        .show()
                }
            } catch (t: Throwable) {
                val msg = t.message ?: t.javaClass.simpleName
                handler.post {
                    android.app.AlertDialog.Builder(this)
                        .setTitle("备份包体检未通过")
                        .setMessage("这个包不能用于恢复：\n$msg")
                        .setPositiveButton("好", null)
                        .show()
                }
            }
        }.start()
    }

    private fun doRestore(uri: Uri) {
        Toast.makeText(this, "恢复中：node 暂停…", Toast.LENGTH_SHORT).show()
        Thread {
            var msg: String
            NodeService.enterMaintenance()
            try {
                val home = File(filesDir, ".dsh")
                home.deleteRecursively()
                home.mkdirs()
                var entries = 0
                contentResolver.openInputStream(uri)!!.use { raw ->
                    java.util.zip.ZipInputStream(raw.buffered()).use { zip ->
                        var entry = zip.nextEntry
                        val buf = ByteArray(1 shl 16)
                        while (entry != null) {
                            // 路径穿越防护：只接受规范相对路径（防恶意 zip 写出 .dsh 外）
                            val name = entry.name
                            val safe = !name.startsWith("/") && !name.startsWith("\\") &&
                                !name.split('/').any { it == ".." }
                            if (safe && name != BACKUP_MANIFEST) {
                                val out = File(home, name)
                                if (entry.isDirectory) {
                                    out.mkdirs()
                                } else {
                                    out.parentFile?.mkdirs()
                                    FileOutputStream(out).use { fos ->
                                        var n = zip.read(buf)
                                        while (n >= 0) { fos.write(buf, 0, n); n = zip.read(buf) }
                                    }
                                    entries++
                                }
                            }
                            zip.closeEntry()
                            entry = zip.nextEntry
                        }
                    }
                }
                msg = "恢复完成：$entries 个文件已还原。运行时重启后请重新填写 API key。"
            } catch (t: Throwable) {
                msg = "恢复失败：${t.message}（数据目录可能处于中间态，建议再恢复一次或重装）"
                android.util.Log.e("DSHTavern", "restore failed", t)
            } finally {
                NodeService.exitMaintenance()
            }
            val finalMsg = msg
            handler.post { Toast.makeText(this, finalMsg, Toast.LENGTH_LONG).show() }
        }.start()
    }

    // ---- W-D 自检面板 ----

    private fun formatSelfCheck(json: String): Pair<String, Boolean> {
        val o = JSONObject(json)
        val arr = o.optJSONArray("checks") ?: return "自检数据不可用" to false
        val sb = StringBuilder()
        var anyRepairable = false
        for (i in 0 until arr.length()) {
            val c = arr.getJSONObject(i)
            sb.append(if (c.optBoolean("ok")) "✓ " else "✗ ")
                .append(c.optString("name"))
                .append("：")
                .append(c.optString("detail"))
                .append('\n')
            if (!c.optBoolean("ok") && c.optBoolean("repairable")) anyRepairable = true
        }
        return sb.toString().trim() to anyRepairable
    }

    private fun showSelfCheckDialog() {
        Thread {
            val (text, anyRepairable) = formatSelfCheck(NodeService.selfCheckJson())
            handler.post {
                val b = android.app.AlertDialog.Builder(this)
                    .setTitle("自检")
                    .setMessage(text)
                    .setNegativeButton("关闭", null)
                if (anyRepairable) {
                    b.setPositiveButton("一键修补") { _, _ ->
                        Thread {
                            val (t2, _) = formatSelfCheck(NodeService.repairAndRecheck())
                            handler.post {
                                android.app.AlertDialog.Builder(this)
                                    .setTitle("修补后复检")
                                    .setMessage(t2)
                                    .setPositiveButton("好", null)
                                    .show()
                            }
                        }.start()
                    }
                }
                b.setNeutralButton("重装运行时…") { _, _ ->
                    android.app.AlertDialog.Builder(this)
                        .setTitle("重装运行时？")
                        .setMessage("删除运行时哨兵并重新解压约 2.4 万个文件（几分钟）。会话/设置等用户数据不受影响。")
                        .setPositiveButton("重装") { _, _ ->
                            NodeService.reinstallRuntime()
                            Toast.makeText(this, "运行时重装中（见等待屏进度）…", Toast.LENGTH_LONG).show()
                        }
                        .setNegativeButton("取消", null)
                        .show()
                }
                b.show()
            }
        }.start()
    }

    /** 「所有文件访问」系统设置页（MANAGE_EXTERNAL_STORAGE 的专用入口） */
    private fun launchAllFilesAccessSettings() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                startActivity(
                    Intent(android.provider.Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION)
                        .setData(Uri.parse("package:$packageName"))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            }
        } catch (e: Exception) {
            android.util.Log.e("DSHTavern", "MANAGE_APP_ALL_FILES_ACCESS 拉起失败", e)
        }
    }

    /** 首启一次性引导：未授予「所有文件访问」时弹窗解释 + 跳系统设置（prefs 记忆已问过） */
    private fun maybePromptAllFilesAccess() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
        if (android.os.Environment.isExternalStorageManager()) return
        if (prefs.getBoolean("all_files_prompted", false)) return
        prefs.edit().putBoolean("all_files_prompted", true).apply()
        try {
            android.app.AlertDialog.Builder(this)
                .setTitle("授予「所有文件访问」权限？")
                .setMessage(
                    "DSHTavern 需要「所有文件访问权限」才能直接读写 /sdcard 上的角色包、世界书、聊天记录与导出文件" +
                        "（绕过安卓 11+ 的应用沙箱限制）。\n\n" +
                        "不授予不影响基本使用（内部存储工作区照常），但导入/导出只能走分享或目录授权通道。" +
                        "随时可在 系统设置 → 应用 → DSHTavern → 权限 中修改。",
                )
                .setPositiveButton("去授权") { _, _ -> launchAllFilesAccessSettings() }
                .setNegativeButton("暂不", null)
                .show()
        } catch (e: Exception) {
            android.util.Log.w("DSHTavern", "all-files 引导弹窗失败", e)
        }
    }

    private fun showBoot() {
        bootingView.visibility = View.VISIBLE
    }

    /**
     * 【L4 2026-09-14】renderer 被 LMK 杀死后的重建入口。
     *
     * 实现 = `recreate()`（整 Activity 重建，onCreate 原样跑一遍）。理由见
     * `onRenderProcessGone` 处的长注释：手写「再 new 一个 WebView」需要把 onCreate 里
     * 约 20 处配置抽成函数并保证两处调用永不漂移 —— 那正是 P-1b「同一语义多份实现」
     * 的温床；`recreate()` 天然只有一份配置来源。
     *
     * 前置：旧 WebView 已随 renderer 一起失效，**先 destroy 再重建**（否则旧的
     * JavascriptInterface / WebViewClient 仍挂在失效实例上，占内存且可能持有泄漏引用）。
     */
    private fun rebuildWebView() {
        try {
            webView.destroy()
        } catch (e: Exception) {
            // destroy 失败不阻塞重建（失效实例上的 destroy 偶发抛）；出声便于排障
            android.util.Log.w("DSHTavern", "旧 WebView destroy 失败（继续重建）", e)
        }
        recreate()
    }

    private fun hideBoot() {
        bootingView.visibility = View.GONE
    }

    /**
     * 【F3 2026-09-14】滚动截屏接通 + **运行期能力探测**（P-3/P-9/P-11）。
     *
     * ## 为什么「设 hint」与「探测」必须放在一起
     * 设 hint 只是**声明候选**（把本 View 纳入系统的滚动截屏备选）；
     * 系统真正取「下一屏」时调的是 `getScrollCaptureCallback()`。
     * 二者都成立才叫「已接通」——只做前者就宣称接通，是**未验证即声称**（R7）。
     * 故本函数把两件事一次做完：
     *   ① `scrollCaptureHint = SCROLL_CAPTURE_HINT_INCLUDE`（API 30+）
     *   ② 读回 `getScrollCaptureCallback()` 与 hint，存入 `scrollCapture*` 字段，
     *      经 `DSHTShare.scrollCaptureStatus()` 暴露给前端 → 可被设备探针断言。
     *
     * 读回值本身**不改变**行为（纯观测），故对既有能力零风险。
     */
    private fun applyScrollCaptureSetup() {
        if (Build.VERSION.SDK_INT >= 30) {
            webView.scrollCaptureHint = View.SCROLL_CAPTURE_HINT_INCLUDE
        }
        // hint 读回（永远可读；用于确认「我们的声明真的写进去了」而不是静默被忽略）
        scrollCaptureHintValue = try {
            webView.scrollCaptureHint
        } catch (e: Exception) {
            android.util.Log.w("DSHTavern", "读 scrollCaptureHint 失败", e)
            Int.MIN_VALUE
        }
        // 方法族枚举只做一次（类结构不会变）；**行为探测**则每次按需重放（见 probeScrollCapture）
        try {
            val ms = View::class.java.methods.filter { it.name.contains("ScrollCapture") }
            scrollCaptureMethods = ms
                .sortedBy { it.name + it.parameterTypes.joinToString(",") { p -> p.name } }
                .joinToString(" | ") { m ->
                    m.name + "(" + m.parameterTypes.joinToString(",") { p -> p.simpleName } + ")"
                }
        } catch (e: Exception) {
            android.util.Log.w("DSHTavern", "枚举 View ScrollCapture* 方法失败", e)
            scrollCaptureMethods = ""
        }
        probeScrollCapture("onCreate")
    }

    /**
     * 【F3 2026-09-14】**行为探测**：问系统「本 View 有没有可捕获的滚动内容」。
     *
     * ## 为什么必须「按需可重放」而不是「只在 onCreate 探一次」
     * 这是本判据**最后一个、也是最隐蔽的坑**（前五次都栽在「假设 API 形态」，这次栽在
     * 「时机」）：`onScrollCaptureSearch` 的语义是「系统在寻找可滚动容器时询问**当前**
     * 滚动内容的尺寸」。而 `onCreate` 时 WebView **还是空的**（页面尚未加载）⇒
     * 平台自然不回填任何内容 ⇒ 得到 `no-callback`。
     * 若把这一次结果当作结论，就会得出**「本 App 不支持滚动截屏」的假结论**——
     * 而真因只是「探的时机太早」。**假结论的形态又变了一次**（不是符号错，是时机错）。
     * ⇒ 故探测抽成本函数，`scrollCaptureStatus()` 每次被调用时**重放一次**，
     *    让探针能在「页面加载完成、内容已渲染」之后取到真实结果。
     *
     * ## 实现要点（不猜任何 API 形态 —— P-17）
     * 1. 从**枚举出来的真实方法**里挑「名字含 Search + 参数含 Consumer」的那个；
     * 2. 按 `parameterTypes` **逐个构造真实实参**（`Rect`/`Point` 是输出容器，必须给
     *    真实空对象；给 null 会让平台内部解引用失败 —— 实测 `InvocationTargetException`）；
     * 3. `Consumer` 用**动态代理**捕获回填的 Rect（不依赖具体泛型）；
     * 4. 探测失败 ⇒ 记 `probe-error:xxx` 并把 `probeAvailable` 置 false ⇒ 上游报**未知**
     *    （绝不用 `false` 冒充「不支持」，见 P-17）。
     *
     * @param phase 触发时机标签（落日志用；排障时能看出「是哪个时机探的」）
     */
    private fun probeScrollCapture(phase: String) {
        val searchMethod = try {
            View::class.java.methods.firstOrNull { m ->
                m.name.contains("ScrollCapture") && m.name.contains("Search") &&
                    !java.lang.reflect.Modifier.isAbstract(m.modifiers) &&
                    m.parameterTypes.any { it.name.contains("Consumer") }
            }
        } catch (e: Exception) {
            android.util.Log.w("DSHTavern", "查找滚动捕获探测方法失败", e)
            null
        }
        scrollCaptureProbeAvailable = searchMethod != null
        if (searchMethod == null) {
            scrollCaptureHasCallback = false
            scrollCaptureSearchResult = "no-entry"
            android.util.Log.i("DSHTavern", "scrollCapture[$phase]: 无探测入口（probe=unavailable）")
            return
        }
        try {
            var got: android.graphics.Rect? = null
            val args: Array<Any?> = searchMethod.parameterTypes.map { pt ->
                when {
                    // 输出容器：必须给真实空对象，平台才有地方回填
                    pt.name == "android.graphics.Rect" -> android.graphics.Rect()
                    pt.name == "android.graphics.Point" -> android.graphics.Point()
                    pt.name == "android.os.CancellationSignal" -> android.os.CancellationSignal()
                    java.util.function.Consumer::class.java.isAssignableFrom(pt) ->
                        java.lang.reflect.Proxy.newProxyInstance(pt.classLoader, arrayOf(pt)) { _, method, a ->
                            if (method.name == "accept" && a != null && a.isNotEmpty()) {
                                val v = a[0]
                                if (v is android.graphics.Rect) got = v
                            }
                            null
                        }
                    pt.isPrimitive -> when (pt.name) {
                        "int" -> 0; "long" -> 0L; "boolean" -> false; "float" -> 0f; "double" -> 0.0
                        else -> 0
                    }
                    else -> null
                }
            }.toTypedArray()
            searchMethod.isAccessible = true
            searchMethod.invoke(webView, *args)
            // 双重取值：优先 Consumer 回填；其次读 Rect 实参（平台可能就地填它）
            val rectArg = args.firstOrNull { it is android.graphics.Rect } as? android.graphics.Rect
            val rect = got ?: rectArg?.takeIf { it.width() > 0 || it.height() > 0 }
            scrollCaptureHasCallback = rect != null && rect.width() > 0 && rect.height() > 0
            scrollCaptureSearchResult =
                if (rect == null) "no-callback" else "w=${rect.width()},h=${rect.height()}"
        } catch (e: Exception) {
            // 【R8 出声 + 不冒充否定】失败只说明探测手段不够 ⇒ 结论是「未知」
            android.util.Log.w("DSHTavern", "滚动捕获行为探测调用失败（按未知处理）", e)
            scrollCaptureHasCallback = false
            scrollCaptureSearchResult = "probe-error:" + (e.javaClass.simpleName)
        }
        android.util.Log.i(
            "DSHTavern",
            "scrollCapture[$phase]: sdk=${Build.VERSION.SDK_INT} hint=$scrollCaptureHintValue " +
                "probe=${if (scrollCaptureProbeAvailable) "available" else "unavailable"} " +
                "callback=${if (scrollCaptureHasCallback) "present" else "absent"} " +
                "search=$scrollCaptureSearchResult methods=[$scrollCaptureMethods]",
        )
    }

    /** singleTask 下运行中收到分享（ACTION_SEND）→ onNewIntent 而非重建 activity */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIncomingIntent(intent)
        // §4.16.2：运行中收到深链（通知点击/外部 VIEW）→ 派发 locate-session
        handleLocateDeepLink(intent)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == 1001) {
            val callback = filePickerCallback ?: return
            filePickerCallback = null
            callback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            return
        }
        if (requestCode == REQ_TREE) {
            // SAF 目录授权结果：持久化读权限（重启不失效）+ 记住 tree uri + 通知前端刷新清单
            val uri = data?.data
            if (resultCode == RESULT_OK && uri != null) {
                try {
                    contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    prefs.edit().putString("tree_uri", uri.toString()).apply()
                    android.util.Log.d("DSHTavern", "tree granted: $uri")
                } catch (e: Exception) {
                    android.util.Log.e("DSHTavern", "tree persist permission failed", e)
                }
            }
            dispatchShareChanged(openImportTab = false)
            return
        }
        // 【W-B 2026-09-21】备份目标已选 → 导出；恢复包已选 → 体检+确认+还原
        if (requestCode == REQ_BACKUP_CREATE) {
            val uri = data?.data
            if (resultCode == RESULT_OK && uri != null) exportBackup(uri)
            return
        }
        if (requestCode == REQ_RESTORE_PICK) {
            val uri = data?.data
            if (resultCode == RESULT_OK && uri != null) startRestore(uri)
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    override fun onDestroy() {
        handler.removeCallbacks(diagPoller)
        webView.destroy()
        super.onDestroy()
        // 注意：不 stopService——NodeService 是常驻前台服务（通知 + START_STICKY + watchdog）。
        // activity 重建（旋转屏/模拟器重启/系统回收）不该杀 node：重启一次 DSH 要 10 秒起（踩过）。
    }

    // ------------------------------------------------------------------
    // I8-6（移动端鲁棒性）：后台切换/内存告警 → 触发 node 侧全量 flush。
    // node 侧 200ms 批写窗口内进程被杀 = 会话尾部事件丢失（seq gap 主因之一）。
    // Android 无法直调 node 内部 → 写 $DSH_HOME/flush-request 触发文件，
    // 插件 1s 轮询消费后对所有 live 会话做 session/flush 耐久屏障。
    // $DSH_HOME 在应用私有目录（NodeService filesDir/.dsh），无需存储权限。
    // ------------------------------------------------------------------
    private fun requestRuntimeFlush(reason: String) {
        try {
            // $DSH_HOME = filesDir/.dsh（与 NodeService 的 dsht-token 同目录——不猜外部存储）
            val home = File(filesDir, ".dsh")
            File(home, "flush-request").writeText("$reason ${System.currentTimeMillis()}")
            android.util.Log.d("DSHTavern", "flush requested: $reason")
        } catch (e: Exception) {
            android.util.Log.w("DSHTavern", "flush request failed: $reason", e)
        }
    }

    override fun onPause() {
        super.onPause()
        requestRuntimeFlush("onPause")
    }

    override fun onStop() {
        super.onStop()
        requestRuntimeFlush("onStop")
    }

    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        if (level >= TRIM_MEMORY_RUNNING_LOW) requestRuntimeFlush("onTrimMemory:$level")
    }
}
