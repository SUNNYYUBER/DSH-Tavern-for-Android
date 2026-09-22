package com.dshtavern.app

import android.content.Context
import android.util.Log
import java.io.File

/**
 * ExchangeDir —— 共享交换目录（W-6）
 *
 * ## 定位
 * 给「App 私有区」与「用户可见的文件管理器」之间开一个**显式交换口**：
 * 用户导角色卡 / 导日志 / 换备份不用每次走 SAF 授权，直接往手机里的
 * `Documents/dsht-exchange/` 丢文件即可。
 *
 * ## 为什么是「显式交换口」而不是「把数据搬出去」
 * W-H 评估已定案**不迁主驻地**（四判据：备份等效 / FUSE IO 开销 / 卓易通未知 /
 * 机制破坏面），本模块不推翻那个决策——主驻地仍 `$DSH_HOME` 不动，
 * 只是多一个**明示的**交换目录。
 *
 * ## 设计要点
 * · **同步时机**：进 App / 手动点同步时跑（**不引入守护进程**，也不依赖
 *   FileObserver——它跨 FUSE（/sdcard 是 sdcardfs/FUSE）不可靠）。
 * · **冲突策略**：mtime 新者胜；同 mtime 则 size 大者胜；再相同则跳过。
 *   每次有覆盖都计入报告并出声（不静默覆盖用户文件）。
 * · **凭据永不映射**：`.credentials.yaml` / `dsht-token` 一类的文件名**双向都拒绝**
 *   （即使有人手动放进交换目录，也不会被搬进 App 私有区）。
 * · **不递归整树**：只同步一层（交换目录是「投递口」不是「第二个数据目录」），
 *   避免用户误把大目录整个塞进来。
 */
object ExchangeDir {

    private const val TAG = "DSHT-Exchange"

    /** 交换目录名（用户可见位置：`/sdcard/Documents/<这个名字>/`）。 */
    private const val EXTERNAL_DIR_NAME = "dsht-exchange"

    /**
     * 永不映射的文件名（双向）。
     *
     * 【为什么按文件名拒绝而不是按内容扫描】内容扫描要读全文件（交换目录可能很大），
     * 且「看起来像凭据」的判定不可靠。凭据文件名是**已知的、有限的**——
     * 用白名单式的显式拒绝更可靠，也与备份排除清单（`BACKUP_EXCLUDE`）同口径。
     */
    private val NEVER_MIRROR = setOf(
        ".credentials.yaml",
        "dsht-token",
        ".dsht-alive",
        "device-audit.jsonl",
    )

    /** 单次同步的结果（供 UI 展示与诊断）。 */
    data class Report(
        val toApp: Int,
        val toExternal: Int,
        val skipped: Int,
        val blocked: List<String>,
        val errors: List<String>,
    ) {
        val changed: Boolean get() = toApp > 0 || toExternal > 0
        fun summary(): String = buildString {
            append("交换目录同步：进 App $toApp · 出到文件管理器 $toExternal")
            if (skipped > 0) append(" · 跳过 $skipped")
            if (blocked.isNotEmpty()) append(" · 拒绝凭据 ${blocked.size} 个（${blocked.joinToString(", ")}）")
            if (errors.isNotEmpty()) append(" · 失败 ${errors.size} 个")
        }
    }

    /** App 侧交换目录（`$DSH_HOME/exchange/`）。 */
    fun appSide(ctx: Context): File = File(ctx.filesDir, ".dsh/exchange").apply { mkdirs() }

    /**
     * 外部侧交换目录。
     *
     * 【为什么用 getExternalFilesDir 的上级到 Documents】直接写 `/sdcard/Documents/`
     * 需要 MANAGE_EXTERNAL_STORAGE（本项目已申请，见 Manifest）；若用户没授权，
     * 退回 `getExternalFilesDir`（App 专属外部目录，**卸载即清**，但无需权限即可用）。
     * 两种形态都「文件管理器可见」，只是生命周期不同——如实返回实际用的那个。
     */
    fun externalSide(ctx: Context): File {
        val documents = File("/sdcard/Documents")
        val target = if (documents.isDirectory && documents.canWrite()) {
            File(documents, EXTERNAL_DIR_NAME)
        } else {
            // 无 Documents 写权限（未授权 MANAGE_EXTERNAL_STORAGE）⇒ 退回 App 专属外部目录
            File(ctx.getExternalFilesDir(null) ?: ctx.filesDir, EXTERNAL_DIR_NAME)
        }
        target.mkdirs()
        return target
    }

    /** 外部侧的**可读描述**（UI 展示用；两种形态文案不同，如实说）。 */
    fun externalLabel(ctx: Context): String {
        val f = externalSide(ctx)
        return if (f.absolutePath.startsWith("/sdcard/Documents")) {
            "文件管理器 → 内部存储/Documents/$EXTERNAL_DIR_NAME/"
        } else {
            "文件管理器 → Android/data/${ctx.packageName}/files/$EXTERNAL_DIR_NAME/（未授予「所有文件访问」时的回退位置，卸载会被清除）"
        }
    }

    /**
     * 执行一次双向增量同步。
     *
     * @return 同步报告（含被拒绝的凭据文件名）
     */
    fun sync(ctx: Context): Report {
        val app = appSide(ctx)
        val ext = externalSide(ctx)
        var toApp = 0
        var toExternal = 0
        var skipped = 0
        val blocked = mutableListOf<String>()
        val errors = mutableListOf<String>()

        // ---- 外部 → App ----
        for (f in ext.listFiles() ?: emptyArray()) {
            if (!f.isFile) continue
            if (isBlocked(f.name)) { blocked += f.name; continue }
            try {
                val dst = File(app, f.name)
                when (decide(f, dst)) {
                    Decision.COPY -> { f.copyTo(dst, overwrite = true); toApp++ }
                    Decision.SKIP -> skipped++
                }
            } catch (t: Throwable) {
                errors += "${f.name}: ${t.message}"
            }
        }

        // ---- App → 外部 ----
        for (f in app.listFiles() ?: emptyArray()) {
            if (!f.isFile) continue
            if (isBlocked(f.name)) { blocked += f.name; continue }
            try {
                val dst = File(ext, f.name)
                when (decide(f, dst)) {
                    Decision.COPY -> { f.copyTo(dst, overwrite = true); toExternal++ }
                    Decision.SKIP -> skipped++
                }
            } catch (t: Throwable) {
                errors += "${f.name}: ${t.message}"
            }
        }

        val r = Report(toApp, toExternal, skipped, blocked.distinct(), errors)
        Log.i(TAG, r.summary())
        return r
    }

    private enum class Decision { COPY, SKIP }

    /**
     * 冲突判定：**新者胜**。
     *
     * 判据顺序（确定性，避免两次同步结果漂移）：
     *   1. 目标不存在 ⇒ COPY
     *   2. 源 mtime 更新 ⇒ COPY
     *   3. mtime 相同但源更大 ⇒ COPY
     *   4. 否则 SKIP
     *
     * 【为什么不用内容哈希】交换目录可能放的是大文件（备份 zip），
     * 每次同步全量哈希代价高且无必要——mtime+size 对本场景足够，
     * 且**判据简单可解释**（用户能理解「我后改的那个赢了」）。
     */
    private fun decide(src: File, dst: File): Decision {
        if (!dst.exists()) return Decision.COPY
        val sm = src.lastModified()
        val dm = dst.lastModified()
        if (sm > dm) return Decision.COPY
        if (sm == dm && src.length() > dst.length()) return Decision.COPY
        return Decision.SKIP
    }

    private fun isBlocked(name: String): Boolean = NEVER_MIRROR.contains(name)

    /** 供自检/看板用：本模块的常量面（防文档与实现漂移）。 */
    fun neverMirrorList(): List<String> = NEVER_MIRROR.sorted()
}
