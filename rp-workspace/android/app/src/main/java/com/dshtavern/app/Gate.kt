package com.dshtavern.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * Gate —— 危险操作守门人（W-4）
 *
 * ## 定位
 * 设备通道里 **danger-full-access 档**的操作（输入模拟：点击/滑动/输入/按键——
 * 它们能操作**别的 App**，含转账按钮这类不可逆动作）必须**用户显式批准**。
 *
 * ## 设计口径（GOAL W-4 拍板：复用 DSH 权限档位语义扩展）
 * · 档位判定与声明在 [DeviceBridge.OpDef.tier]（**命令模板与档位同处一地**，防漂移）；
 * · **批准闸在本层（native）**——node 是 agent 可影响的层，在那拦等于让被判者当法官；
 * · **默认拒绝（fail-closed）**：任何异常/超时/无法询问 ⇒ 拒绝，绝不放行；
 * · **单次有效**：每次调用单独批准，不做「记住 N 分钟」（不可逆操作不该有隐式窗口）；
 * · 全部决策（批准/拒绝/超时）写审计日志。
 *
 * ## 为什么要「挂起 + 通知」而不是「同步弹窗」
 * 请求来自 node 的 HTTP 调用（后台线程），而此时用户可能不在 App 界面
 * （甚至屏幕是关的）。通知是唯一能在任意时刻触达用户的通道，且**通知被忽略
 * 就等于拒绝**——这与 fail-closed 语义天然一致（不需要额外的超时兜底逻辑，
 * 但保留超时以防通知被系统吞掉）。
 *
 * ## 超时取值
 * 60 秒。依据：手机用户看到通知、看清「哪个操作」、决定是否点击，60s 是合理的
 * 响应窗口；过短会把「用户正在看」误判为拒绝（造成 agent 侧莫名的失败），
 * 过长会让 agent 长时间挂起（DSH 工具调用有超时）。超时即拒（不是放行）。
 */
object Gate {

    private const val TAG = "DSHT-Gate"

    private const val CHANNEL_ID = "dsht_gate"
    private const val ACTION_APPROVE = "com.dshtavern.app.GATE_APPROVE"
    private const val ACTION_DENY = "com.dshtavern.app.GATE_DENY"
    private const val EXTRA_REQ_ID = "req_id"

    /** 批准等待窗口（毫秒）。超时 ⇒ 拒绝（fail-closed）。 */
    private const val APPROVAL_TIMEOUT_MS = 60_000L

    private val nextReqId = AtomicInteger(1000)

    /** 挂起中的请求：id → latch。用户点通知后经 [resolve] 释放。 */
    private val pending = ConcurrentHashMap<Int, CountDownLatch>()

    /** 结果：true = 批准，false = 拒绝/超时。 */
    private val results = ConcurrentHashMap<Int, Boolean>()

    @Volatile private var channelReady = false

    /**
     * 请求用户批准一次 danger 档操作。
     *
     * @return true = 用户批准（放行一次）；false = 拒绝 / 超时 / 无法询问（**默认拒绝**）
     */
    fun requestApproval(ctx: Context?, op: String): Boolean {
        if (ctx == null) {
            Log.w(TAG, "无 Context，按拒绝处置（fail-closed）")
            return false
        }
        val id = nextReqId.incrementAndGet()
        val latch = CountDownLatch(1)
        pending[id] = latch
        return try {
            ensureChannel(ctx)
            postApprovalNotification(ctx, id, op)
            val got = latch.await(APPROVAL_TIMEOUT_MS, TimeUnit.MILLISECONDS)
            val approved = got && (results[id] == true)
            Log.i(TAG, "op=$op id=$id approved=$approved（got=$got）")
            DeviceBridge.recordGateDecision(op, approved, got)
            approved
        } catch (t: Throwable) {
            Log.w(TAG, "批准流程异常，按拒绝处置: ${t.message}")
            false
        } finally {
            pending.remove(id)
            results.remove(id)
        }
    }

    /**
     * 通知按钮回调入口（由 [GateReceiver] 调用）。
     *
     * 【为什么放在 Receiver】通知 action 的 PendingIntent 必须指向一个
     * 可以在 App 进程不在前台时被系统拉起的组件——BroadcastReceiver 是最轻的选择。
     */
    fun resolve(ctx: Context, reqId: Int, approved: Boolean) {
        results[reqId] = approved
        pending[reqId]?.countDown()
        try {
            val nm = ctx.getSystemService(NotificationManager::class.java)
            nm.cancel(reqId)
        } catch (_: Throwable) { }
        Log.i(TAG, "user decision: id=$reqId approved=$approved")
    }

    private fun ensureChannel(ctx: Context) {
        if (channelReady) return
        val nm = ctx.getSystemService(NotificationManager::class.java)
        // IMPORTANCE_HIGH：批准请求必须**立刻可见**（默认拒绝语义下，
        // 用户没看到通知 = 操作被拒 ⇒ 通知的可见性直接决定功能可用性）
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "设备操作批准", NotificationManager.IMPORTANCE_HIGH)
        )
        channelReady = true
    }

    private fun postApprovalNotification(ctx: Context, id: Int, op: String) {
        val approveIntent = PendingIntent.getBroadcast(
            ctx, id * 10 + 1,
            Intent(ctx, GateReceiver::class.java).apply {
                action = ACTION_APPROVE
                putExtra(EXTRA_REQ_ID, id)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val denyIntent = PendingIntent.getBroadcast(
            ctx, id * 10 + 2,
            Intent(ctx, GateReceiver::class.java).apply {
                action = ACTION_DENY
                putExtra(EXTRA_REQ_ID, id)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        // 文案要点名**具体操作**（用户要在几秒内判断「这是不是我要的」）
        val what = when (op) {
            "input_tap" -> "点击屏幕坐标"
            "input_swipe" -> "滑动屏幕"
            "input_text" -> "输入文本"
            "input_key" -> "按下按键"
            else -> op
        }
        val n = Notification.Builder(ctx, CHANNEL_ID)
            .setContentTitle("AI 请求操作你的手机")
            .setContentText("$what —— 这能操作其它应用，需你确认")
            .setStyle(Notification.BigTextStyle().bigText(
                "AI 请求：$what\n\n" +
                    "这类操作可以操作**其它应用**（含不可逆动作），故需你逐次确认。\n" +
                    "60 秒内未确认将自动拒绝。"
            ))
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            // 优先级由 channel 的 IMPORTANCE_HIGH 决定（setPriority 在 channel 模式已废弃）
            .addAction(Notification.Action.Builder(null, "拒绝", denyIntent).build())
            .addAction(Notification.Action.Builder(null, "批准本次", approveIntent).build())
            .setAutoCancel(true)
            .build()
        ctx.getSystemService(NotificationManager::class.java).notify(id, n)
    }
}

/**
 * 守门人通知按钮的接收器。
 *
 * 【导出性说明】不导出（exported=false，见 Manifest）——只有系统通知栏的
 * PendingIntent 能触发它（PendingIntent 以本 App 身份发出，不受 exported 限制）。
 */
class GateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getIntExtra("req_id", -1)
        if (id < 0) return
        when (intent.action) {
            "com.dshtavern.app.GATE_APPROVE" -> Gate.resolve(context, id, true)
            "com.dshtavern.app.GATE_DENY" -> Gate.resolve(context, id, false)
        }
    }
}
