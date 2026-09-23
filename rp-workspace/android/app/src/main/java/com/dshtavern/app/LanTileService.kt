package com.dshtavern.app

import android.app.PendingIntent
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import androidx.annotation.RequiresApi

/**
 * W-8 系统轻入口：快速设置磁贴（「切 LAN」）。
 *
 * ## 为什么只做「切 LAN」而不做「回会话」
 * 任务原文写的是「回会话 / 切 LAN」两个诉求。实测后定案：
 *   · **「回会话」不需要磁贴** —— 点 App 图标就是回前台，且 `MainActivity` 是 `launchMode=singleTask`
 *     ⇒ 不会重建、会话现场保留。多做一个磁贴只是给同一动作加个入口（净增维护面，零新增能力）。
 *   · **「切 LAN」确实需要一个系统级入口** —— 现在它埋在 WebView 的 ⚙ 设置面板里（要先进 App、
 *     等前端加载、点开面板）。而 LAN 的典型使用场景恰恰是「我不想动手机、在电脑上操作」
 *     ⇒ 从系统快捷设置里直接开，是真实的体验差距。故本项目实做这一个。
 * 这与 §四「明确不追」的取舍口径一致：只做有真实增量的那一半。
 *
 * ## 状态与副作用
 * LAN 开关的真值是 `SharedPreferences("dsht").lan_enabled`（`NodeService.kt:270` 读取），
 * 它作为 **env `DSHT_LAN_MODE`** 在 node 启动时传给插件的信任栅栏
 * （`NodeService.kt:937`）⇒ **改它必须重启 node 才生效**。
 * 故本磁贴的动作 = 写 pref + 重启 node 服务（与设置面板里的开关同语义）。
 *
 * ## 为什么不复用「设置面板那条链路」
 * 那条链路是 WebView 内 JS 桥（前端 → JSInterface → 原生），依赖**前端已加载**。
 * 磁贴必须在「App 没在前台、前端可能没起」时也能用 ⇒ 必须直接操作 pref + 服务，
 * 不能绕前端。两处最终都落到同一个 pref key 与同一个服务重启入口，口径一致。
 */
@RequiresApi(Build.VERSION_CODES.N)
class LanTileService : TileService() {

    private val prefs by lazy { getSharedPreferences("dsht", MODE_PRIVATE) }

    /** 磁贴被加入快捷设置时：刷新一次显示状态。 */
    override fun onTileAdded() {
        super.onTileAdded()
        refreshTile()
    }

    /** 每次下拉快捷面板：按当前 pref 刷新，保证显示与真值一致。 */
    override fun onStartListening() {
        super.onStartListening()
        refreshTile()
    }

    /** 点击：翻转开关 → 重启 node 让 env 生效 → 刷新磁贴。 */
    override fun onClick() {
        super.onClick()
        val next = !prefs.getBoolean("lan_enabled", false)
        prefs.edit().putBoolean("lan_enabled", next).apply()
        // 与设置面板同语义：LAN 是启动期 env，必须重启服务才生效
        NodeService.restartForLanToggle(this)
        refreshTile()
    }

    /**
     * 刷新磁贴显示。
     *
     * ⚠️ 这里只反映 **pref 真值**，不反映「node 是否已按新值重启完成」——
     * 后者需要等服务回调，磁贴的生命周期不适合做异步等待。
     * 若重启尚未完成，磁贴会短暂显示「已开/已关」而实际仍在切换中；
     * 这是可接受的（用户下拉面板在下一次 `onStartListening` 就会看到最终态）。
     */
    private fun refreshTile() {
        val tile = qsTile ?: return
        val on = prefs.getBoolean("lan_enabled", false)
        tile.state = if (on) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        tile.label = "DSH 局域网"
        tile.icon = Icon.createWithResource(this, R.mipmap.ic_launcher)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            tile.subtitle = if (on) "已开启（重启生效中）" else "已关闭"
        }
        tile.updateTile()
    }
}
