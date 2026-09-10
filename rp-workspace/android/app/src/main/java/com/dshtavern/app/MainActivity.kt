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

        /** SAF 目录授权 requestCode（1001=文件选择 / 1002=通知权限已占用） */
        private const val REQ_TREE = 1003

        /** §4.16.2 深链派发重试上限：前端 rp-ui 未就绪时 400ms × 25 ≈ 10s 内等监听注册 */
        private const val LOCATE_RETRY_MAX = 25
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
    /** T2.11 首启标记：仅第一次打开 app 自动显示导入/新手教程页（之后直接进 DSH） */
    private val prefs by lazy { getSharedPreferences("dsht", MODE_PRIVATE) }

    private val handler = Handler(Looper.getMainLooper())
    private val diagPoller = object : Runnable {
        override fun run() {
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
                sb.append("\n端口 3080：").append(if (port) "已开放 ✓" else "未监听")
                if (port && dshLoaded == false) {
                    val tok = com.dshtavern.app.NodeService.webToken
                    sb.append("\nweb 令牌（0.1.2 鉴权）：").append(if (tok != null) "已捕获 ✓" else "未捕获（等 node 打印 dsh web: 行）")
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
                        hideBoot()
                        webView.loadUrl("http://127.0.0.1:3080/?token=$tok")
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
                        lastTokenAttempt = ""
                        hideBoot()
                        webView.loadUrl("http://127.0.0.1:3080")
                        maybeOpenFirstLaunchImport()
                    }
                    // 其余情况（等 token 窗口内 / 401 后 token 未变）：不加载，只更新 UI
                }
            } catch (_: Exception) {
            }
            }
            // 无条件重排：轮询永生（加载后 WebView 主框架错误 → dshLoaded 复位，
            // 下一轮按 token 变化重载——旧版 `if (dshLoaded) return` 让轮询死亡，
            // 401/网络错误后无人重载，等待屏永久冻结）
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

        /** 【2026-09-08】拉起「所有文件访问」系统设置页（用户手动开关后回到 app 即生效；
         *  node 运行时进程随后即可直读直写 /sdcard——沙箱外全盘通道） */
        @JavascriptInterface
        fun requestAllFilesAccess() {
            handler.post { launchAllFilesAccessSettings() }
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
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val host = request.url.host ?: return false
                return host != "127.0.0.1" && host != "localhost"
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                // DSH 页面加载失败：回到等待屏轮询（端口探活比 WebView 重试可靠）。
                // tokenWaits 不重置（修 401↔等待死循环）：401 = 干净 URL 无令牌被拒，
                // 只等 token 到达即带 token 重载；tokenDegraded 保证不再重复降级。
                if (request.isForMainFrame) {
                    dshLoaded = false
                    showBoot()
                }
            }

            // @adapt contract:wire.auth-401
            override fun onReceivedHttpError(view: WebView, request: android.webkit.WebResourceRequest, errorResponse: android.webkit.WebResourceResponse) {
                // 0.1.2 token 鉴权：主框架 401（干净 URL 无令牌）——WebView 对 HTTP 错误
                // 走 onReceivedHttpError 而非 onReceivedError（踩过：漏处理导致卡在
                // "Webpage not available" 错误页，token 到达也无人重载）。回等待屏轮询，
                // token 到达（stdout/dsht-token 文件双通道）即带 token 重载。
                if (request.isForMainFrame && request.url.host == "127.0.0.1") {
                    dshLoaded = false
                    showBoot()
                }
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

    private fun hideBoot() {
        bootingView.visibility = View.GONE
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
