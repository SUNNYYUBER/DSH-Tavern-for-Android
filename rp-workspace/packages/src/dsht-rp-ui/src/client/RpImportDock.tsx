/**
 * T2.6：会话内「📥 导入」入口（conversation.input.dock list 席位）。
 *
 * 用户定案：导入按钮 UI 嵌进 DSH webui——点击打开 RP 启动器的「导入」页
 * （文件选择 → 导入 → 完成后角色工作区出现在侧栏）。导入过程在欢迎工作区
 * 会话里呈现摘要（方案 B，见插件 /rp/import-card）。
 */
import type { JSX } from 'react'
import { RP_OPEN_EVENT } from './RpOverlay.tsx'

/** dock 席位收到的 owner props（InputZone：session + input 快照——本组件只做入口不需要） */
interface DockProps {
  session?: unknown
  input?: unknown
}

export function RpImportDockEntry(_props: DockProps): JSX.Element | null {
  return (
    <button
      type="button"
      className="dsht-rp-import-dock"
      title="导入角色卡 / 世界书 / SillyTavern 数据包"
      aria-label="导入"
      onClick={() => { window.dispatchEvent(new CustomEvent(RP_OPEN_EVENT, { detail: { tab: 'import' } })) }}
    >
      📥 导入
    </button>
  )
}
