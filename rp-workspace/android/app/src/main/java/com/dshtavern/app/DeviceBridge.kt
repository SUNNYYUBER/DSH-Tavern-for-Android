package com.dshtavern.app

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/**
 * DeviceBridge —— 设备能力桥（W-3）
 *
 * ## 定位
 * agent（DSH 运行时，node 侧）与设备能力（Shizuku，Java 侧）之间的桥。
 * node 发 JSON 请求（op + args），本类**查表构造命令**并执行。
 *
 * 设计依据：docs/W3-DEVICE-TOOLS-DESIGN-2026-09-21.md
 *
 * ## 核心纪律：命令构造固定在**本层**，node 侧不产生 shell 字符串
 *
 * 本项目有实证教训（W-2 调研 §6.3）：同一命令经多层转发得 87 条、
 * 直接执行得 29 条——「看起来完全正常」的假结论。故本类从**结构上**消除该风险：
 *
 *   1. `op` 只能是**枚举**（[Op] 的键）——未知 op 直接 400，**不存在**「任意命令」通道；
 *   2. 命令以 `List<String>` 构造，逐项是**数组元素**（不经 shell 解析）
 *      ⇒ 引号 / 分号 / 反引号 / 空格全部是普通字符，注入面为零；
 *   3. 参数值逐项**白名单校验**（正则 / 枚举 / 范围），校验不过即拒，**不执行**。
 *
 * ## 为什么批准闸（W-4 守门人）必须在这一层
 * node 是 **agent 可影响的层**——在那拦等于让被判者自己当法官。本类在
 * DSH 看不穿的 native 侧，且是唯一真正构造命令的地方 ⇒ 是守门人的正确位置。
 * 首期（W-4 未就绪）按 [Tier.DANGER] 的 op **默认拒绝**（fail-closed）。
 *
 * ## 硬边界（继承 W-2 调研）
 * · uid 2000 **读不到 app 私有目录** ⇒ 产物落 /sdcard/Android/data/<pkg>/（双方可达）；
 * · 传输仅 127.0.0.1，但 Android 不隔离 loopback ⇒ **token 是必需**（无 token = 401）。
 */
object DeviceBridge {

    private const val TAG = "DSHT-Device"

    /**
     * 能力档位——**复用 DSH 权限档位语义**（GOAL 的 W-4 拍板口径：
     * 「设备通道命令按 read-only / workspace-write / danger-full-access 归级」）。
     *
     * 【取名的诚实说明】DSH 的档位名来自其权限模型；这里用同名枚举是为了
     * **语义对齐**（便于 W-4 直接映射），不代表 DSH 已经知道这些 op 的存在。
     */
    enum class Tier {
        /** 只读，不改设备状态 */
        READ_ONLY,

        /** 读系统状态但含隐私面（通知等） */
        WORKSPACE_WRITE,

        /** 能操作其它 App，含不可逆动作 ⇒ 必须用户显式批准 */
        DANGER_FULL_ACCESS,
    }

    /** 失败原因（枚举）——node 侧据它给出可处置的提示，而不是糊成一团文本。 */
    enum class Err {
        /** Shizuku 不可用（未安装 / 未启动 / 未授权 / 系统不支持） */
        NEED_SHIZUKU,

        /** 参数校验不过 */
        BAD_ARGS,

        /** 守门人拒绝（danger 档未批准；W-4 就绪前的默认行为） */
        DENIED_BY_POLICY,

        /** 执行失败（命令返回非 0 / IO 异常） */
        EXEC_FAILED,

        /** 未实现的 op（框架就位、实现待补） */
        NOT_IMPLEMENTED,
    }

    /**
     * op 定义：**命令模板 + 档位声明同处一地**。
     *
     * 【为什么同处一地】GOAL 的 W-4 口径要求「档位声明与实现一致」——
     * 若声明写在文档、实现写在别处，必然漂移（本项目 P-30 家族：代理量与事实脱钩）。
     * 故 tier 是本表的一个字段，改命令必须同时看到档位。
     */
    private data class OpDef(
        val tier: Tier,
        /** 人类可读说明（审计日志与错误提示用） */
        val desc: String,
    )

    private val OPS: Map<String, OpDef> = linkedMapOf(
        "screencap" to OpDef(Tier.READ_ONLY, "截屏到 /sdcard/Android/data/<pkg>/files/device-out/"),
        "system_status" to OpDef(Tier.READ_ONLY, "读系统状态（电量/网络/显示/存储）"),
        "notifications" to OpDef(Tier.WORKSPACE_WRITE, "读通知摘要（系统默认遮蔽敏感字段）"),
        "input_tap" to OpDef(Tier.DANGER_FULL_ACCESS, "点击坐标"),
        "input_swipe" to OpDef(Tier.DANGER_FULL_ACCESS, "滑动"),
        "input_text" to OpDef(Tier.DANGER_FULL_ACCESS, "输入文本"),
        "input_key" to OpDef(Tier.DANGER_FULL_ACCESS, "按键（枚举白名单）"),
    )

    /** `input_key` 允许的键——**不接受任意 keycode**（agent 不该有能力按任意键）。 */
    private val ALLOWED_KEYS = setOf(
        "HOME", "BACK", "ENTER", "DEL", "TAB", "ESCAPE",
        "DPAD_UP", "DPAD_DOWN", "DPAD_LEFT", "DPAD_RIGHT",
        "VOLUME_UP", "VOLUME_DOWN", "POWER", "MENU", "APP_SWITCH",
    )

    /** `system_status` 允许的 what 值。 */
    private val ALLOWED_STATUS = setOf("battery", "wifi", "display", "storage", "all")

    private const val PORT_PROBE_MAX = 10
    private const val PORT_BASE = 3100

    private const val MAX_TEXT_LEN = 512
    private const val COORD_RE = """^-?\d{1,5}$"""

    @Volatile private var server: ServerSocket? = null
    @Volatile private var running = false
    @Volatile private var port: Int = 0
    @Volatile private var token: String? = null
    @Volatile private var appCtx: Context? = null

    private val lastError = AtomicInteger(0)

    /** 最近一次错误原因（诊断面用；0 = 无）。 */
    val lastErr: Int get() = lastError.get()

    val activePort: Int get() = port
    val isRunning: Boolean get() = running

    /** 产物目录（uid 2000 可写、app 可读、用户文件管理器可见、卸载即清）。 */
    private fun outDir(ctx: Context): File =
        File(ctx.getExternalFilesDir(null) ?: File(ctx.filesDir, "device-out"), "device-out")

    /**
     * 启动本机 HTTP 服务（幂等）。
     *
     * @param tok 鉴权令牌（由 NodeService 生成并经 env 传给 node；无 token 的请求一律 401）
     */
    fun start(ctx: Context, tok: String): Int {
        appCtx = ctx.applicationContext
        token = tok
        if (running) return port
        val ss = bindFreePort() ?: run {
            Log.w(TAG, "无可用端口（$PORT_BASE..${PORT_BASE + PORT_PROBE_MAX - 1}）")
            return 0
        }
        server = ss
        port = ss.localPort
        running = true
        outDir(ctx).mkdirs()
        Thread {
            Log.i(TAG, "device bridge listening on 127.0.0.1:$port")
            while (running) {
                val sock = try { ss.accept() } catch (t: Throwable) {
                    if (running) Log.w(TAG, "accept 失败: ${t.message}")
                    break
                }
                try { handle(sock) } catch (t: Throwable) {
                    Log.w(TAG, "handle 异常: ${t.message}")
                } finally {
                    try { sock.close() } catch (_: Throwable) {}
                }
            }
        }.apply { isDaemon = true; name = "dsht-device-bridge" }.start()
        return port
    }

    fun stop() {
        running = false
        try { server?.close() } catch (_: Throwable) {}
        server = null
        port = 0
    }

    private fun bindFreePort(): ServerSocket? {
        for (p in PORT_BASE until PORT_BASE + PORT_PROBE_MAX) {
            try {
                // 只绑 loopback：不暴露到局域网（与 LAN 反代是两条独立通道）
                return ServerSocket(p, 8, InetAddress.getByName("127.0.0.1"))
            } catch (_: Throwable) {
                continue
            }
        }
        return null
    }

    // ---------------------------------------------------------------------
    // HTTP 处理（极简：单请求单响应，无 keep-alive）
    // ---------------------------------------------------------------------

    private fun handle(sock: Socket) {
        sock.soTimeout = 15000
        val reader = BufferedReader(InputStreamReader(sock.getInputStream(), Charsets.UTF_8))
        val requestLine = reader.readLine() ?: return
        val parts = requestLine.split(' ')
        if (parts.size < 2) return
        val method = parts[0]
        val path = parts[1]

        // 读 headers（取 content-length + 鉴权头）
        var contentLength = 0
        var auth = ""
        while (true) {
            val line = reader.readLine() ?: break
            if (line.isEmpty()) break
            val idx = line.indexOf(':')
            if (idx <= 0) continue
            val k = line.substring(0, idx).trim().lowercase()
            val v = line.substring(idx + 1).trim()
            when (k) {
                "content-length" -> contentLength = v.toIntOrNull() ?: 0
                "x-dsht-token" -> auth = v
                "authorization" -> if (v.startsWith("Bearer ")) auth = v.removePrefix("Bearer ").trim()
            }
        }

        if (method != "POST" || !path.startsWith("/device")) {
            respond(sock, 404, JSONObject().put("ok", false)
                .put("error", Err.BAD_ARGS.name).put("detail", "未知路径（仅 POST /device）"))
            return
        }

        // ★ 鉴权 fail-closed：token 未配置 或 不匹配 ⇒ 401（绝不静默放行）
        val expected = token
        if (expected.isNullOrEmpty() || auth != expected) {
            respond(sock, 401, JSONObject().put("ok", false)
                .put("error", Err.BAD_ARGS.name).put("detail", "鉴权失败"))
            return
        }

        val body = if (contentLength in 1..(64 * 1024)) {
            val buf = CharArray(contentLength)
            var read = 0
            while (read < contentLength) {
                val n = reader.read(buf, read, contentLength - read)
                if (n < 0) break
                read += n
            }
            String(buf, 0, read)
        } else ""

        val result = try {
            dispatch(body)
        } catch (t: Throwable) {
            Log.w(TAG, "dispatch 异常: ${t.message}")
            JSONObject().put("ok", false)
                .put("error", Err.EXEC_FAILED.name).put("detail", t.message ?: "执行异常")
        }
        respond(sock, if (result.optBoolean("ok")) 200 else 400, result)
    }

    private fun respond(sock: Socket, code: Int, body: JSONObject) {
        val bytes = body.toString().toByteArray(Charsets.UTF_8)
        val head = "HTTP/1.1 $code ${if (code == 200) "OK" else "Bad Request"}\r\n" +
            "Content-Type: application/json; charset=utf-8\r\n" +
            "Content-Length: ${bytes.size}\r\n" +
            "Connection: close\r\n\r\n"
        val out: OutputStream = sock.getOutputStream()
        out.write(head.toByteArray(Charsets.US_ASCII))
        out.write(bytes)
        out.flush()
    }

    // ---------------------------------------------------------------------
    // 分发：op 查表 → 参数校验 → 档位判定 → 执行
    // ---------------------------------------------------------------------

    private fun dispatch(body: String): JSONObject {
        val req = try { JSONObject(body) } catch (_: Throwable) {
            return err(Err.BAD_ARGS, "请求体不是合法 JSON")
        }
        val op = req.optString("op", "")
        val args = req.optJSONObject("args") ?: JSONObject()

        val def = OPS[op] ?: return err(Err.BAD_ARGS, "未知 op：$op（可用：${OPS.keys.joinToString(", ")}）")

        // ★ 档位判定（W-4 守门人的接缝）。
        // 首期：danger 档**默认拒绝**（fail-closed）——W-4 就绪后这里改为
        // 「请求用户批准 → 批准则放行」。
        if (def.tier == Tier.DANGER_FULL_ACCESS && !dangerApproved(op)) {
            audit(op, args, def.tier, "denied")
            return err(Err.DENIED_BY_POLICY,
                "该操作属 danger 档（$op：${def.desc}），需用户显式批准；当前版本默认拒绝")
        }

        // 前置：设备能力可用性（如实报，不崩）
        val st = ShizukuBridge.currentState()
        if (st != ShizukuBridge.State.READY) {
            val (desc, _) = ShizukuBridge.describe(st)
            return err(Err.NEED_SHIZUKU, "设备能力不可用：$desc")
        }

        // 参数校验 + 构造命令（**本层**构造；数组形态，不经 shell）
        val cmd: List<String>
        try {
            cmd = buildCommand(op, args)
        } catch (e: BadArgs) {
            audit(op, args, def.tier, "bad-args")
            return err(Err.BAD_ARGS, e.message ?: "参数不合法")
        } catch (e: NotImplemented) {
            return err(Err.NOT_IMPLEMENTED, e.message ?: "未实现")
        }

        audit(op, args, def.tier, "exec")
        return exec(op, cmd)
    }

    private class BadArgs(msg: String) : Exception(msg)
    private class NotImplemented(msg: String) : Exception(msg)

    /**
     * **唯一**的命令构造点。
     *
     * 【铁律】只用 `listOf(...)` 逐项构造；**任何情况下不得**把用户输入
     * 拼进一个字符串再交给 shell。参数值先过正则/枚举校验。
     */
    private fun buildCommand(op: String, args: JSONObject): List<String> {
        val ctx = appCtx ?: throw BadArgs("服务未初始化")
        return when (op) {
            "screencap" -> {
                val disp = args.optInt("display", 0)
                if (disp !in 0..9) throw BadArgs("display 必须是 0~9 的整数")
                val out = File(outDir(ctx), "screenshot-${System.currentTimeMillis()}.png")
                // 数组形态：每个元素独立，路径里的任何字符都不会被 shell 解释。
                // display=0 用默认屏（-p 只写文件）；非 0 才带 -d <id>。
                if (disp == 0) listOf("screencap", "-p", out.absolutePath)
                else listOf("screencap", "-d", disp.toString(), "-p", out.absolutePath)
            }
            "system_status" -> {
                val what = args.optString("what", "battery")
                if (what !in ALLOWED_STATUS) throw BadArgs("what 必须是 ${ALLOWED_STATUS.joinToString("/")}")
                if (what == "all") listOf("dumpsys", "battery")
                else listOf("dumpsys", what)
            }
            "notifications" -> {
                val limit = args.optInt("limit", 20)
                if (limit !in 1..50) throw BadArgs("limit 必须是 1~50")
                // 不加 --noredact：系统会遮蔽验证码等敏感字段（设计 §2.4 的隐私边界）
                listOf("dumpsys", "notification")
            }
            "input_tap" -> {
                listOf("input", "tap", coord(args, "x"), coord(args, "y"))
            }
            "input_swipe" -> {
                val dur = args.optInt("duration", 300)
                if (dur !in 0..10000) throw BadArgs("duration 必须是 0~10000")
                listOf(
                    "input", "swipe",
                    coord(args, "x1"), coord(args, "y1"),
                    coord(args, "x2"), coord(args, "y2"),
                    dur.toString(),
                )
            }
            "input_text" -> {
                val t = args.optString("text", "")
                validateText(t)
                listOf("input", "text", t)
            }
            "input_key" -> {
                val k = args.optString("key", "")
                if (k !in ALLOWED_KEYS) throw BadArgs("key 必须是 ${ALLOWED_KEYS.joinToString("/")}")
                listOf("input", "keyevent", k)
            }
            else -> throw NotImplemented("op $op 的命令模板未实现")
        }
    }

    private fun coord(args: JSONObject, key: String): String {
        val raw = args.opt(key)
        val s = when (raw) {
            is Number -> raw.toInt().toString()
            is String -> raw
            else -> throw BadArgs("$key 必须是整数坐标")
        }
        // 白名单：只允许可选负号 + 最多 5 位数字。注入样本（"; rm -rf /" 等）在此被拒。
        if (!Regex(COORD_RE).matches(s)) throw BadArgs("$key 坐标不合法：$s")
        return s
    }

    private fun validateText(t: String) {
        if (t.isEmpty()) throw BadArgs("text 不能为空")
        if (t.length > MAX_TEXT_LEN) throw BadArgs("text 超长（上限 $MAX_TEXT_LEN）")
        // 拒绝控制字符（尤其 \n —— 「输入换行 = 提交」这类意外副作用的来源）
        for (ch in t) {
            if (ch == '\n' || ch == '\r' || ch == '\t' || ch.code < 0x20) {
                throw BadArgs("text 含控制字符（换行/制表等），已拒绝")
            }
        }
    }

    // ---------------------------------------------------------------------
    // 执行（占位：UserService 就绪后接入）
    // ---------------------------------------------------------------------

    /**
     * 执行已构造好的命令。
     *
     * 【现状】W-2 调研结论：走 `UserService`（官方推荐；`newProcess` 已被官方标记废弃
     * 且无 tty 支持）。UserService 的 AIDL 与 bindUserService 在**真机验证**后才能定稿
     * （自定义 AIDL 接口形态需按 Shizuku 版本核对），故本方法首期返回
     * `NOT_IMPLEMENTED`——**但命令构造与校验链路已完整可测**（判据 3/4/5/8）。
     */
    private fun exec(op: String, cmd: List<String>): JSONObject {
        Log.i(TAG, "would exec: ${cmd.joinToString(" ")}")
        return err(Err.NOT_IMPLEMENTED,
            "命令构造已就绪（${cmd.size} 个参数），执行层待 UserService 真机验证后接入")
    }

    // ---------------------------------------------------------------------
    // 审计 + 工具函数
    // ---------------------------------------------------------------------

    /**
     * 审计日志（设备操作轨迹，属敏感面 ⇒ **不进备份**）。
     * 落 `filesDir/.dsh/device-audit.jsonl`（备份排除清单已含 .dsh 下的白名单外文件语义）。
     */
    private fun audit(op: String, args: JSONObject, tier: Tier, decision: String) {
        val ctx = appCtx ?: return
        try {
            val f = File(File(ctx.filesDir, ".dsh"), "device-audit.jsonl")
            f.parentFile?.mkdirs()
            val rec = JSONObject()
                .put("ts", System.currentTimeMillis())
                .put("op", op).put("args", args.toString())
                .put("tier", tier.name).put("decision", decision)
            f.appendText(rec.toString() + "\n")
        } catch (t: Throwable) {
            Log.w(TAG, "审计写入失败: ${t.message}")
        }
    }

    /** danger 档批准判定。W-4 就绪前恒为 false（fail-closed）。 */
    private fun dangerApproved(op: String): Boolean = false

    private fun err(e: Err, detail: String): JSONObject =
        JSONObject().put("ok", false).put("error", e.name).put("detail", detail)

    /** 档位查询（供 W-7 看板 / 诊断展示）。 */
    fun tierOf(op: String): String? = OPS[op]?.tier?.name

    /** 全部 op 及其档位（供 W-7 看板列出能力面）。 */
    fun opTable(): List<Triple<String, String, String>> =
        OPS.map { (k, v) -> Triple(k, v.tier.name, v.desc) }
}
