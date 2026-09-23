package com.dshtavern.app

import android.content.Context
import android.os.Build
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * DiagPack —— 诊断包导出（2026-09-23，为「外部用户能自助报 bug」而建）
 *
 * ## 解决什么问题
 * 本项目的 bug 大量属于「只在别人的设备上复现」：机型差异（phantom process killer /
 * SELinux 策略）、Android 版本、时区、鸿蒙、Shizuku 状态、以及只有真实数据才会触发的
 * 会话/卡脚本路径。维护者手上只有一台小米 11 Pro + 一个 x86_64 模拟器 ⇒
 * **用户报「我这里不行」时，维护者无法复现，只能来回追问**。
 *
 * 本模块把「来回追问」变成「用户点一下、交一个文件」：把排障真正需要的事实
 * 一次性落进一个**用户可读、可自行检查**的文本文件，用户拖进 Issue 即可。
 *
 * ## 隐私红线（本模块的第一约束）
 * 排障需要事实，但**不能拿用户的数据换**。故采用**白名单式收集**：
 *
 *   1. **只取已知安全字段**——版本号、机型、系统版本、时区、自检结果、进程状态。
 *      不扫描目录、不枚举文件、不做「看起来像什么」的猜测（那种判据不可靠且会漏）。
 *   2. **凭据永不入包**——`.credentials.yaml` / `dsht-token` / API Key / web token
 *      **一个都不进**（与 `ExchangeDir.NEVER_MIRROR`、备份排除清单同口径）。
 *   3. **会话正文永不入包**——聊天记录、角色卡、世界书正文**一律不采集**。
 *      本模块**不读** `sessions/` 下的任何文件。这条是硬的：宁可少一个线索，
 *      也不把用户的 RP 正文交出去。
 *   4. **日志按行白名单过滤**——`NodeService` 的环形日志含本机路径与 token，
 *      故逐行过 [sanitizeLine]：命中凭据形态的行**整行丢弃**（不部分替换——
 *      部分替换会留下残片，那是更坏的结果）。
 *   5. **落点用户可见**——写进 `ExchangeDir`（文件管理器可见），用户**交之前能自己打开看**。
 *      这一点是刻意的：不搞「偷偷上传」，也**不自动上传**（本项目无任何遥测）。
 *
 * ## 与既有装置的关系（不重复造）
 * - **自检 11 项**：复用 `NodeService.selfCheckJson()`（不重写判据）。
 * - **设备通道状态**：复用 `DeviceBridge.capabilityReport()`（W-3 诚实面同源）。
 * - **运行日志**：复用 `NodeService.diagJson()` 的 `output` 尾（不另起日志系统）。
 * - **投递通道**：复用 `ExchangeDir`（不新开目录，且自动继承其凭据拒绝名单）。
 *
 * ## 诚实边界（不夸大本模块的能力）
 * 本包**不能**替代真机复现：它记录的是「状态快照」，不是「操作序列」。
 * 涉及时序/竞态的 bug（本项目历史上最贵的一类）仍可能需要用户配合描述步骤。
 */
object DiagPack {

    private const val TAG = "DSHT-DiagPack"

    /** 文件名前缀（便于用户按名字认出来；带时间戳避免多次导出互相覆盖）。 */
    private const val FILE_PREFIX = "dsht-diag"

    /**
     * 单行长度上限。
     *
     * 【为什么截断】环形日志里可能有超长行（如整段 JSON / 模型原文尾）。
     * 不截断会让包体不可控，且超长行更可能夹带正文片段。
     */
    private const val MAX_LINE = 400

    /** 落进包里的日志行数上限（与 `diagJson()` 的 40 条同源，略放宽给「导出」场景）。 */
    private const val MAX_LOG_LINES = 120

    /**
     * 凭据/敏感形态的黑名单（**整行丢弃**，不做部分替换）。
     *
     * 【判据选取】都是「出现即说明该行含凭据或用户隐私」的**具体**形态，
     * 而不是「像不像密码」的模糊猜测。宁可误丢几行，不可漏出一行。
     */
    private val DROP_PATTERNS = listOf(
        Regex("""token=[A-Za-z0-9_\-]+""", RegexOption.IGNORE_CASE),   // web token 的 URL 形态
        Regex("""dsht-token""", RegexOption.IGNORE_CASE),
        Regex("""credentials\.yaml""", RegexOption.IGNORE_CASE),
        Regex("""(api[_-]?key|authorization|bearer)\s*[:=]""", RegexOption.IGNORE_CASE),
        Regex("""sk-[A-Za-z0-9]{8,}"""),                                // 常见 API Key 前缀形态
        Regex("""/data/user/\d+/[^\s]*"""),                             // 本机应用私有路径（含包名外的个人痕迹）
        Regex("""/storage/emulated/\d+/[^\s]*"""),                      // 用户存储路径
        Regex("""C:\\Users\\[^\s]+""", RegexOption.IGNORE_CASE),        // 桌面端路径（构建/迁移期会出现）
    )

    data class Result(
        val ok: Boolean,
        /** 落盘位置（用户可读描述，直接展示给用户）。 */
        val locationLabel: String,
        val file: File?,
        val bytes: Long,
        val droppedLines: Int,
        val error: String? = null,
    )

    /**
     * 生成诊断包并落到交换目录。
     *
     * 【为什么放主线程外调用】读写磁盘 + 序列化 JSON ⇒ 调用方（MainActivity）
     * 必须放在后台线程，与既有 `startBackup` / `showSelfCheckDialog` 同款处置。
     */
    fun export(ctx: Context): Result {
        return try {
            val body = buildReport(ctx)
            val outDir = ExchangeDir.externalSide(ctx)
            val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())
            val file = File(outDir, "$FILE_PREFIX-$stamp.txt")
            file.writeText(body.text)
            Result(
                ok = true,
                locationLabel = ExchangeDir.externalLabel(ctx),
                file = file,
                bytes = file.length(),
                droppedLines = body.droppedLines,
            )
        } catch (t: Throwable) {
            Result(
                ok = false,
                locationLabel = "",
                file = null,
                bytes = 0,
                droppedLines = 0,
                error = t.message ?: t.javaClass.name,
            )
        }
    }

    private data class Report(val text: String, val droppedLines: Int)

    /**
     * 组装报告正文。
     *
     * 【为什么是纯文本而不是 JSON】读者是「用户 + 维护者看 Issue」，
     * 纯文本可直接阅读、可粘贴、diff 友好；JSON 还要人解一层。
     */
    private fun buildReport(ctx: Context): Report {
        val sb = StringBuilder()
        var dropped = 0

        sb.appendLine("# DSHTavern 诊断包")
        sb.appendLine("#")
        sb.appendLine("# 这个文件是给你自己看、然后拖进 GitHub Issue 用的。")
        sb.appendLine("# 里面【不含】你的聊天记录、角色卡、世界书正文，也【不含】API Key。")
        sb.appendLine("# 交之前你可以自己打开检查一遍。")
        sb.appendLine()

        // ---- 1. 版本与设备（排障第一问：你装的是哪版、跑在什么上）----
        sb.appendLine("## 版本")
        sb.appendLine("app_version      = ${BuildConfig.VERSION_NAME} (versionCode ${BuildConfig.VERSION_CODE})")
        sb.appendLine("runtime_sentinel = ${runtimeSentinel(ctx)}")
        sb.appendLine()

        sb.appendLine("## 设备")
        sb.appendLine("manufacturer = ${Build.MANUFACTURER}")
        sb.appendLine("model        = ${Build.MODEL}")
        sb.appendLine("android      = ${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT})")
        sb.appendLine("abi          = ${Build.SUPPORTED_ABIS.joinToString(", ")}")
        // 时区是本项目的高频坑（README Alpha 限制 #4：偏移式时区会导致「发消息完全没反应」）
        // ⇒ 单列，且同时给 ID 与 offset，便于一眼区分「真 IANA 名」与「GMT 式偏移」。
        sb.appendLine("timezone_id  = ${TimeZone.getDefault().id}")
        sb.appendLine("timezone_off = ${TimeZone.getDefault().rawOffset / 3600000}h")
        sb.appendLine()

        // ---- 2. 运行时状态（等价于诊断面板所见，复用同源数据）----
        sb.appendLine("## 运行时状态")
        try {
            val diag = JSONObject(NodeService.diagJson())
            for (k in listOf(
                "state", "portOpen", "activePort", "restartCount", "exitCode",
                "lastError", "lastAbnormalExit", "sandboxFallback", "lanEnabled",
            )) {
                // LAN URL 含 token ⇒ 绝不输出其值，只报「开了没」
                sb.appendLine("$k = ${diag.opt(k)}")
            }
        } catch (t: Throwable) {
            sb.appendLine("（运行时状态不可用：${t.message}）")
        }
        sb.appendLine()

        // ---- 3. 自检 11 项（复用既有装置，不重写判据）----
        sb.appendLine("## 自检结果")
        try {
            val arr = JSONObject(NodeService.selfCheckJson()).optJSONArray("checks")
            if (arr == null) {
                sb.appendLine("（自检数据不可用）")
            } else {
                for (i in 0 until arr.length()) {
                    val c = arr.getJSONObject(i)
                    val mark = if (c.optBoolean("ok")) "OK  " else "FAIL"
                    sb.appendLine("[$mark] ${c.optString("name")} — ${c.optString("detail")}")
                }
            }
        } catch (t: Throwable) {
            sb.appendLine("（自检不可用：${t.message}）")
        }
        sb.appendLine()

        // ---- 4. 设备能力通道（W-3 诚实面同源）----
        sb.appendLine("## 设备工具通道")
        try {
            val rep = DeviceBridge.capabilityReport()
            // 【字段白名单】`capabilityReport()` 还会返回 `out_dir`（本机私有路径）
            // 与 `last_error`（可能含路径）——两者**故意不取**（隐私红线 §2）。
            for (k in listOf(
                "running", "port", "exec_wired", "shizuku_state", "exec_link",
                "exec_detail", "exec_backend_uid", "tier_counts",
            )) {
                sb.appendLine("$k = ${rep.opt(k)}")
            }
        } catch (t: Throwable) {
            sb.appendLine("（设备通道报告不可用：${t.message}）")
        }
        sb.appendLine()

        // ---- 5. 运行日志尾（★ 逐行过白名单，命中即整行丢弃）----
        sb.appendLine("## 运行日志（尾 ${MAX_LOG_LINES} 行，已过滤凭据行）")
        try {
            val arr = JSONObject(NodeService.diagJson()).optJSONArray("output")
            if (arr == null || arr.length() == 0) {
                sb.appendLine("（无日志）")
            } else {
                val lines = (0 until arr.length()).map { arr.optString(it) }
                for (line in lines.takeLast(MAX_LOG_LINES)) {
                    val safe = sanitizeLine(line)
                    if (safe == null) { dropped++; continue }
                    sb.appendLine(safe)
                }
            }
        } catch (t: Throwable) {
            sb.appendLine("（日志不可用：${t.message}）")
        }
        sb.appendLine()
        sb.appendLine("## 过滤统计")
        sb.appendLine("dropped_lines = $dropped  （命中凭据/路径形态而整行丢弃的行数）")

        return Report(sb.toString(), dropped)
    }

    /**
     * 单行脱敏。
     *
     * 【返回 null = 整行丢弃，而不是替换成 ***】
     * 部分替换有两个问题：① 替换规则不可能穷举，残片照样泄露；
     * ② 替换后的行看起来「正常」，读者会以为它是完整的 ⇒ **制造假证据**。
     * 整行丢弃 + 计数上报是诚实形态：读者知道「这里少了一行」。
     */
    private fun sanitizeLine(line: String): String? {
        if (line.isBlank()) return ""
        for (p in DROP_PATTERNS) {
            if (p.containsMatchIn(line)) return null
        }
        return if (line.length > MAX_LINE) line.take(MAX_LINE) + " …(截断)" else line
    }

    /**
     * 运行时哨兵（安装代次）。
     *
     * 【为什么自检里已有还要再取一次】自检是**布尔**（在/不在），
     * 而排障需要**哪个代次**——它决定「解压出来的运行时是新是旧」，
     * 直接影响「用户跑的到底是不是我以为的那份代码」。
     */
    private fun runtimeSentinel(ctx: Context): String {
        return try {
            // "dsh-runtime" 与 NodeService 的 RUNTIME_DIR 同值（该常量是 private，
            // 不为此扩大可见性——此处是只读探测，值漂移时只会退化为「未找到哨兵」，
            // 不会造成误报「已安装」）。
            val runtimeDir = File(ctx.filesDir, "dsh-runtime")
            runtimeDir.listFiles { f -> f.name.startsWith(".installed-v") }
                ?.firstOrNull()?.name ?: "（未找到哨兵）"
        } catch (t: Throwable) {
            "（读取失败：${t.message}）"
        }
    }
}