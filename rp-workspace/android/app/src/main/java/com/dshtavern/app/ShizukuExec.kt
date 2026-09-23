package com.dshtavern.app

import android.os.IBinder
import android.os.ParcelFileDescriptor
import android.os.RemoteException
import rikka.shizuku.Shizuku
import rikka.shizuku.ShizukuRemoteProcess

/**
 * Shizuku UserService —— 以 **shell(uid 2000)** 身份跑本项目自己的代码。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么是 UserService 而不是 `Shizuku.newProcess`（W-2 调研定案，不重开）
 * ─────────────────────────────────────────────────────────────────────────
 * 官方 13.1.1 changelog 原文：*"Prepare to remove `Shizuku#newProcess`, developers
 * should have to use `UserService` instead"*，并给出三条理由 —— 其中第三条是致命的：
 * **`newProcess` lacks tty support, it is not possible to implement an interactive
 * shell with it** ⇒ 与 W-1 刚打通的 PTY 面不兼容。故本项目走 UserService。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 官方注意事项（W-2 调研 §4.2，逐条处理）
 * ─────────────────────────────────────────────────────────────────────────
 * · 服务类必须实现 `IBinder`（本类 `extends IShizukuExec.Stub`，由 AIDL 生成）；
 * · 构造器拿到的 `Context` **不是正常 app Context**（`registerReceiver` /
 *   `getContentResolver` 不可用）⇒ 本类**一律不碰 Context**；
 * · `unbindUserService` **不会杀进程** ⇒ 必须实现 `destroy`（transaction 16777115）
 *   并在里面清理（本类交给 AIDL 的 `destroy()` 方法承载）；
 * · `UserServiceArgs.tag` 用于判定「是否同一个服务」，不设则用类名而 **R8 后不稳定**
 *   ⇒ 见 [ShizukuExec] 里显式设的 `TAG`。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 本类**不做任何输入校验**（重要的分层结论）
 * ─────────────────────────────────────────────────────────────────────────
 * 参数白名单与命令构造**全部在 App 进程侧**（[DeviceBridge.buildCommand]，唯一构造点，
 * `List<String>` 数组形态）。本服务只负责「把给我的 argv 跑掉」——
 * 若把校验也放一份在这里，两处判据会漂移（本项目 P-1 形态），且**多一层就有多一层
 * 能被绕过的可能**。故本类的纪律是：**只执行，不判断**。
 */
class ShizukuExecService : IShizukuExec.Stub() {

    override fun destroy() {
        // 官方要求：unbind 后本方法会被调到（transaction 16777115），
        // 且 unbind **不会**自动杀进程 ⇒ 必须自己退，否则残留 shell 身份进程。
        System.exit(0)
    }

    /**
     * 执行一条命令，返回 `{code, out, err}`。
     *
     * 【为什么用 ProcessBuilder 而不是 Runtime.exec(String)】
     * 数组形态 ⇒ 参数是数组元素、**不经 shell 解析**（引号/分号/反引号都是普通字符）。
     * 这正是设计 §1.1 的核心纪律：`String[]` 逐项，杜绝拼接。
     */
    override fun exec(argv: List<String>): String {
        return try {
            val pb = ProcessBuilder(argv)
            pb.redirectErrorStream(false)
            val p = pb.start()
            // 先读干净输出再 waitFor，避免管道缓冲写满而互相阻塞（经典死锁）
            val out = p.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            val err = p.errorStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            val code = p.waitFor()
            jo(code, out, err)
        } catch (t: Throwable) {
            jo(-1, "", "UserService 执行异常：${t.javaClass.simpleName}: ${t.message}")
        }
    }

    /**
     * 读文件的**字节**（供截屏等产物回传）。
     *
     * 【为什么不用 exec("cat", path)】二进制经 UTF-8 解码会损坏（PNG 必坏）。
     * 这里直接按字节读并 base64 回传，避免任何字符集转换。
     */
    override fun readBase64(path: String): String {
        return try {
            val f = java.io.File(path)
            if (!f.isFile) return "ERR:not-a-file:$path"
            val bytes = f.readBytes()
            if (bytes.size > MAX_RETURN_BYTES) return "ERR:too-large:${bytes.size}"
            android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
        } catch (t: Throwable) {
            "ERR:${t.javaClass.simpleName}:${t.message}"
        }
    }

    /** uid —— 用于**实证**「经 Shizuku 执行 `id` 返回 uid=2000」（W-2 验收口径）。 */
    override fun uid(): Int = android.os.Process.myUid()

    /** 极简 JSON 拼装（不引 org.json？—— 这里可用，UserService 进程是普通 JVM 环境）。 */
    private fun jo(code: Int, out: String, err: String): String =
        org.json.JSONObject()
            .put("code", code)
            .put("out", out)
            .put("err", err)
            .toString()

    private companion object {
        /** 回传上限（防一次拉爆 binder 事务：binder 单次约 1MB）。 */
        const val MAX_RETURN_BYTES = 512 * 1024
    }
}

/**
 * Shizuku UserService 的**客户端**（App 进程侧）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 职责边界
 * ─────────────────────────────────────────────────────────────────────────
 * · 只管「连上去 / 断开 / 发一条 argv / 读一个文件」；
 * · **不构造命令**（那是 [DeviceBridge.buildCommand] 的唯一职责）；
 * · **不判档位**（那是 [Gate] 的职责）；
 * · 全程 `try` 包裹、**永不抛**（降级纪律：设备能力缺席不得打断 DSH 本体）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么用 `Shizuku.bindUserService` 而不是 `newProcess`
 * ─────────────────────────────────────────────────────────────────────────
 * 见 [ShizukuExecService] 头注（官方废弃 + 无 tty）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 生命周期注意（官方 §4.2）
 * ─────────────────────────────────────────────────────────────────────────
 * · `UserServiceArgs.tag` **必须显式设**：不设则用类名，**R8 后不稳定** ⇒ 会把
 *   「同一个服务」判成两个，反复起新进程；
 * · `unbindUserService` 不会杀进程 ⇒ 依赖服务端 `destroy()` 自己退；
 * · `version` 不匹配时 Shizuku 会启新服务并 destroy 旧的 ⇒ 升级 App 后自动收敛。
 */
object ShizukuExec {

    private const val TAG = "dsht-device-exec"

    /** 连接状态（App 侧视角）。 */
    enum class Link {
        /** 未尝试 / Shizuku 不可用 */
        ABSENT,
        /** 已发起 bind，等 binder 回来 */
        BINDING,
        /** 可用 —— 已拿到 IShizukuExec */
        READY,
        /** 失败（含 bind 被拒 / binder 死亡） */
        FAILED,
    }

    @Volatile private var svc: IShizukuExec? = null

    @Volatile var link: Link = Link.ABSENT
        private set

    /** 最近一次失败原因（诊断面）。 */
    @Volatile var lastError: String? = null
        private set

    private val args: Shizuku.UserServiceArgs by lazy {
        Shizuku.UserServiceArgs(
            android.content.ComponentName(BuildConfig.APPLICATION_ID, ShizukuExecService::class.java.name),
        )
            .daemon(false)
            .processNameSuffix("dsht-exec")
            .debuggable(false)
            // ★ 必须显式设 tag（官方：不设则用类名，R8 后不稳定）
            .tag(TAG)
            .version(BuildConfig.VERSION_CODE)
    }

    private val conn = object : android.content.ServiceConnection {
        override fun onServiceConnected(name: android.content.ComponentName?, binder: IBinder?) {
            svc = IShizukuExec.Stub.asInterface(binder)
            link = if (svc != null) Link.READY else Link.FAILED
            if (svc == null) lastError = "binder 不是 IShizukuExec（AIDL 不匹配）"
            android.util.Log.i("DSHT-Device", "shizuku exec service connected: $link")
        }

        override fun onServiceDisconnected(name: android.content.ComponentName?) {
            svc = null
            link = Link.FAILED
            lastError = "UserService 断连"
        }
    }

    /**
     * 绑定 UserService（幂等）。
     *
     * 【为什么只在 READY 时才 bind】`Shizuku.bindUserService` 在 binder 未就绪时
     * 会抛 `IllegalStateException`（官方文档明示「make sure the binder is alive」）。
     * 故先问 [ShizukuBridge.currentState]，非 READY 就不尝试——降级要**安静**。
     */
    fun ensureBound(): Boolean {
        if (link == Link.READY && svc != null) return true
        if (ShizukuBridge.currentState() != ShizukuBridge.State.READY) {
            link = Link.ABSENT
            lastError = "Shizuku 未就绪"
            return false
        }
        return try {
            link = Link.BINDING
            // 【注意】`bindUserService` 在 shizuku-api 13.1.5 返回 **void** ——
            // 它是**异步**的：真正的结果经 `conn.onServiceConnected` 回来。
            // 故这里只能确认「bind 请求已发出且未抛」，不能当成「已连接」。
            // 调用方（[exec]）在拿到 svc==null 时会如实返回不可用，不会假装成功。
            Shizuku.bindUserService(args, conn)
            svc != null
        } catch (t: Throwable) {
            link = Link.FAILED
            lastError = "${t.javaClass.simpleName}: ${t.message}"
            false
        }
    }

    fun unbind() {
        try {
            Shizuku.unbindUserService(args, conn, true)
        } catch (_: Throwable) {
        } finally {
            svc = null
            link = Link.ABSENT
        }
    }

    /**
     * 执行一条已构造好的 argv。
     *
     * @return `Triple(code, stdout, stderr)`；失败时 code = -1 且 message 在 stderr。
     */
    fun exec(argv: List<String>): Triple<Int, String, String> {
        if (!ensureBound()) {
            return Triple(-1, "", "Shizuku 执行通道不可用：${lastError ?: link.name}")
        }
        val s = svc ?: return Triple(-1, "", "UserService 未连接")
        return try {
            val raw = s.exec(argv)
            val o = org.json.JSONObject(raw)
            Triple(o.optInt("code", -1), o.optString("out", ""), o.optString("err", ""))
        } catch (t: Throwable) {
            Triple(-1, "", "调用 UserService 失败：${t.javaClass.simpleName}: ${t.message}")
        }
    }

    /**
     * 读一个**产物文件**的字节（base64）。
     *
     * 【为什么必须让 UserService 读】产物写在 `/sdcard/Android/data/<pkg>/files/device-out/`，
     * app uid 与 shell uid **都能读**（这是 W-2 定的双方可达区）——但截屏命令由 shell
     * 身份执行，走同一条通道读回来最省事，也避免 app 侧再判一次 SELinux。
     */
    fun readBase64(path: String): ByteArray? {
        if (!ensureBound()) return null
        val s = svc ?: return null
        return try {
            val b64 = s.readBase64(path)
            if (b64.startsWith("ERR:")) {
                lastError = b64
                null
            } else {
                android.util.Base64.decode(b64, android.util.Base64.NO_WRAP)
            }
        } catch (t: Throwable) {
            lastError = "${t.javaClass.simpleName}: ${t.message}"
            null
        }
    }

    /** 经 Shizuku 后端拿 uid（**W-2 验收口径**：应等于 2000）。 */
    fun backendUid(): Int? {
        if (!ensureBound()) return null
        return try {
            svc?.uid()
        } catch (t: Throwable) {
            lastError = "${t.javaClass.simpleName}: ${t.message}"
            null
        }
    }

    /** 诊断串（W-7 看板用）。 */
    fun describe(): String = when (link) {
        Link.ABSENT -> "未绑定（Shizuku 未就绪）"
        Link.BINDING -> "绑定中…"
        Link.READY -> "已连接（经 Shizuku，uid ${backendUid() ?: "?"}）"
        Link.FAILED -> "连接失败：${lastError ?: "未知"}"
    }
}
