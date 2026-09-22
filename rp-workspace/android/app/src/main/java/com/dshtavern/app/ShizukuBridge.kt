package com.dshtavern.app

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import rikka.shizuku.Shizuku

/**
 * ShizukuBridge —— Shizuku 通道接入骨架（W-2）
 *
 * ## 定位
 * 「DSH for Android 做彻底」的设备可触达面：让 agent 的手够到 app 沙盒外
 * （截屏 / 输入模拟 / 通知读取 / 系统状态），**全程不 root**。
 *
 * 设计依据见 [docs/SHIZUKU-RESEARCH-2026-09-21.md]（含实证与三处联网更正）。
 *
 * ## 本类的职责边界（首期骨架）
 * · **状态机**：未安装 / 已装未启动 / 已启动未授权 / 已授权可用 / 不支持 —— 五态
 * · **权限**：requestPermission（不走 onActivityResult，走独立 listener 通道）
 * · **降级**：任何一环缺失都如实报「需要 Shizuku」而非崩溃（W-2 验收口径）
 * · **不做**：真正的设备命令执行（W-3 的工作面）；本类只提供「通道是否可用」的判据
 *
 * ## 四条硬边界（必须如实呈现给用户，不许假装能做到）
 * 1. **配对码无 API**：我们不实现配对，引导用户在 Shizuku 官方 App 里做（那份 adb 协议
 *    实现 + TLS + 密钥管理自造 = 重造 Shizuku，单人项目的净负债）；
 * 2. **重启后无法自动复活**：Shizuku server 不是系统服务，无线调试默认关闭且端口随机
 *    ⇒ 只能提示 + 一键跳转（不 root 的平台硬约束）；
 * 3. **uid 2000 看不到 app 私有目录**（本机实测 `Permission denied`）⇒ 设备工具只能
 *    操作 /sdcard 与 /data/local/tmp，工作区不可达；
 * 4. **Android 11 以下无无线调试通道** ⇒ 本能力不可用（minSdk 28 的下限机型要如实显示）。
 *
 * ## 为什么 listener 注册在这里而不是 Activity
 * bash/设备能力由 **node 侧**触发（不是 Activity 触发），而 NodeService 是常驻前台服务、
 * MainActivity 可能随时被回收（onDestroy 故意不 stopService）。⇒ 权限状态必须能在
 * 服务进程里读到，故 listener 注册在本单例（进程级），而非仅 Activity。
 */
object ShizukuBridge {

    private const val TAG = "DSHT-Shizuku"

    /**
     * Shizuku 权限请求码。
     *
     * 【为什么单列一个值】MainActivity 已占用 1001（文件选择）/ 1002（通知权限）/
     * 1003（SAF tree）/ 1010（备份创建）/ 1011（恢复选择）。Shizuku 的回调**不走**
     * onActivityResult（走 OnRequestPermissionResultListener），机制上不冲突，
     * 但取值仍独立以防将来混用。
     */
    const val REQ_SHIZUKU_PERMISSION = 1020

    /** 通道状态（W-7 看板要显示的五态）。 */
    enum class State {
        /** 系统版本 < Android 11：无线调试通道不存在（硬边界 4） */
        UNSUPPORTED_OS,

        /** 未安装 Shizuku 官方 App */
        NOT_INSTALLED,

        /** 已安装但服务未启动（需用户去 Shizuku 里「启动」；重启后回到此态） */
        NOT_RUNNING,

        /** 服务在跑，但我们未获授权 */
        NOT_AUTHORIZED,

        /** 可用 */
        READY,
    }

    /** Shizuku 官方 App 包名（其 README 明确：这是它唯一的 applicationId）。 */
    private const val SHIZUKU_PKG = "moe.shizuku.privileged.api"

    /** 后端身份（root=0 / ADB=2000）——W-7 用它与「不做 root 路线」的纪律对照显示。 */
    private const val UID_ROOT = 0
    private const val SHELL_UID = 2000

    @Volatile
    private var appContext: Context? = null

    @Volatile
    private var listenerRegistered = false

    private val mainHandler = Handler(Looper.getMainLooper())

    /**
     * 权限结果回调（供 UI 层订阅）。参数 = 最新状态。
     * 【线程】Shizuku 的 listener 可能在任意线程回调，故这里统一切回主线程再派发。
     */
    @Volatile
    var onStateChanged: ((State) -> Unit)? = null

    private val permissionListener = Shizuku.OnRequestPermissionResultListener { requestCode, grantResult ->
        if (requestCode != REQ_SHIZUKU_PERMISSION) return@OnRequestPermissionResultListener
        Log.i(TAG, "permission result: code=$requestCode grant=${grantResult == PackageManager.PERMISSION_GRANTED}")
        dispatch(currentState())
    }

    /**
     * binder 就绪/失效监听。
     *
     * 【为什么需要】Shizuku 的 binder 由 provider 在进程启动时异步送达——
     * **在 binder 到位前调用 Shizuku 类的任何方法都会抛 IllegalStateException**
     * （官方 README 原文：「You should call methods in Shizuku class when the binder
     * is alive or you will get an IllegalStateException」）。
     * 这正是「重启后 Shizuku 未启动」在代码里的可观测形态。
     */
    private val binderReceivedListener = Shizuku.OnBinderReceivedListener {
        Log.i(TAG, "binder received")
        dispatch(currentState())
    }

    private val binderDeadListener = Shizuku.OnBinderDeadListener {
        Log.i(TAG, "binder dead（Shizuku server 停止或系统重启）")
        dispatch(currentState())
    }

    /**
     * 初始化：注册监听器（**在进程启动时调一次**，幂等）。
     *
     * 【调用点】NodeService.onCreate（服务是常驻的，生命周期覆盖全部使用场景）。
     * 不在 Application 里调：本项目没有自定义 Application 类，且服务已经足够早。
     */
    fun init(context: Context) {
        appContext = context.applicationContext
        if (listenerRegistered) return
        listenerRegistered = true
        try {
            // Sui（Magisk 模块）自动初始化：本项目**明确不做 root 路线**，
            // 故显式 opt-out，避免「检测到 Magisk 就启用」的语义歧义
            // （官方：需在 ShizukuProvider#onCreate 被调前 opt-out；这里是最早时机之一）。
            rikka.shizuku.ShizukuProvider.disableAutomaticSuiInitialization()
        } catch (t: Throwable) {
            // provider 类不在场（理论不应发生，依赖已引入）——不致命，继续
            Log.w(TAG, "disableAutomaticSuiInitialization 失败（忽略）: ${t.message}")
        }
        try {
            Shizuku.addBinderReceivedListener(binderReceivedListener)
            Shizuku.addBinderDeadListener(binderDeadListener)
            Shizuku.addRequestPermissionResultListener(permissionListener)
            Log.i(TAG, "listeners registered")
        } catch (t: Throwable) {
            // addBinderReceivedListener 在 pre-v11 的 Shizuku 上可能不可用——
            // 不致命：currentState() 仍能给出准确判定
            Log.w(TAG, "listener 注册失败（pre-v11 Shizuku？）: ${t.message}")
        }
    }

    /**
     * 当前通道状态。**这是唯一的判据入口**——所有能力面（W-3 工具、W-7 看板）
     * 都应先问它，再决定：可用 / 降级 / 如实报错。
     *
     * 【为什么每一步都 try】Shizuku 类的方法在 binder 未就绪时会抛
     * IllegalStateException；本函数必须**永远返回状态而不抛**（降级纪律：
     * 任何一环缺失都如实报，不许崩）。
     */
    fun currentState(): State {
        // 硬边界 4：无线调试通道自 Android 11（API 30）起
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return State.UNSUPPORTED_OS

        val ctx = appContext ?: return State.NOT_INSTALLED
        if (!isShizukuInstalled(ctx)) return State.NOT_INSTALLED

        return try {
            if (!Shizuku.pingBinder()) return State.NOT_RUNNING
            // pre-v11 的 Shizuku 不支持自实现权限 API —— 如实标注为不可授权
            if (Shizuku.isPreV11()) return State.NOT_AUTHORIZED
            if (Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED) State.READY
            else State.NOT_AUTHORIZED
        } catch (t: Throwable) {
            // IllegalStateException（binder 未就绪）/ RemoteException / 其它
            Log.w(TAG, "currentState 探测异常，按 NOT_RUNNING 处置: ${t.message}")
            State.NOT_RUNNING
        }
    }

    /**
     * 发起权限请求（仅当状态 = NOT_AUTHORIZED 时有意义）。
     *
     * 【与运行时权限的同形性】官方 v11+ 用自实现权限，API 形态与
     * `ActivityCompat.requestPermissions` 一致；但**结果不走 onActivityResult**，
     * 而是走 OnRequestPermissionResultListener（见 permissionListener）。
     *
     * @return true = 已发起请求（结果稍后经 listener 回来）；false = 当前不该请求
     *         （未安装 / 未启动 / 已授权 / 用户选了「拒绝且不再询问」）
     */
    fun requestPermission(): Boolean {
        return try {
            if (!Shizuku.pingBinder()) return false
            if (Shizuku.isPreV11()) return false
            if (Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED) return true
            if (Shizuku.shouldShowRequestPermissionRationale()) {
                // 用户选过「拒绝且不再询问」——再 requestPermission 也不会弹窗，
                // 如实返回 false，由 UI 引导用户去 Shizuku 里手动授权
                Log.i(TAG, "shouldShowRequestPermissionRationale=true（用户已拒绝且不再询问）")
                return false
            }
            Shizuku.requestPermission(REQ_SHIZUKU_PERMISSION)
            true
        } catch (t: Throwable) {
            Log.w(TAG, "requestPermission 失败: ${t.message}")
            false
        }
    }

    /**
     * 后端身份：0 = root / 2000 = shell(ADB) / null = 不可用或未知。
     *
     * 【用途】W-7 看板显示「经 ADB（uid 2000）」——本项目不做 root 路线，
     * 若探测到 0 应如实显示为「root 后端（非本项目推荐路径）」而不是假装没看见。
     */
    fun backendUid(): Int? {
        return try {
            if (!Shizuku.pingBinder()) null
            else Shizuku.getUid()
        } catch (t: Throwable) {
            null
        }
    }

    /** 后端身份的可读描述（诊断/看板用）。 */
    fun backendLabel(): String = when (val uid = backendUid()) {
        null -> "不可用"
        UID_ROOT -> "root（uid 0）"
        SHELL_UID -> "ADB / shell（uid 2000）"
        else -> "未知（uid $uid）"
    }

    /** 状态的可读描述 + 该状态下的处置建议（W-7 看板的「原因」列直接用它）。 */
    fun describe(state: State): Pair<String, String> = when (state) {
        State.UNSUPPORTED_OS ->
            "本机系统版本不支持" to "无线调试需 Android 11+（本机 API ${Build.VERSION.SDK_INT}）；设备能力不可用，其余功能不受影响"
        State.NOT_INSTALLED ->
            "未安装 Shizuku" to "安装 Shizuku 官方 App 后可解锁设备能力（截屏/输入/通知）"
        State.NOT_RUNNING ->
            "Shizuku 未启动" to "打开 Shizuku → 按引导启动（开发者选项 → 无线调试 → 启动）；系统重启后需重新启动"
        State.NOT_AUTHORIZED ->
            "未授权" to "点击授权，允许本应用经 Shizuku 使用设备能力"
        State.READY ->
            "可用（${backendLabel()}）" to "设备能力已就绪"
    }

    private fun isShizukuInstalled(ctx: Context): Boolean {
        return try {
            ctx.packageManager.getPackageInfo(SHIZUKU_PKG, 0)
            true
        } catch (_: PackageManager.NameNotFoundException) {
            false
        } catch (t: Throwable) {
            Log.w(TAG, "包可见性探测异常: ${t.message}")
            false
        }
    }

    private fun dispatch(state: State) {
        val cb = onStateChanged ?: return
        mainHandler.post { cb(state) }
    }
}
