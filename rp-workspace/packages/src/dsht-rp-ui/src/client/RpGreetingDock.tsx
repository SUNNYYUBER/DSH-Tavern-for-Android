/**
 * 批次修复 1b：角色卡工作区空白会话的「开场白选择窗」。
 *
 * 场景（用户定案）：在角色卡工作区用原生「＋」新建的 session 是白板（无开场白）。
 * 本组件挂在 conversation.input.dock 席位：检测当前会话属于 RP 工作区（cwd 含 /rp/<slug>）
 * 且对话为空时，显示两个选项——
 *   「💬 带开场白开始」：调 /rp/open-chat 物化开场白（等同 ST「开始新聊天」）
 *   「留空（自定义用途）」：写卡/测试等，本次不再提示
 * 非角色卡工作区（cwd 不含 /rp/）不显示；选择只对当前 sessionId 记忆（会话级）。
 */
import { useState, type JSX } from 'react'
import { rpApi } from './rpc.ts'
import { useRpSlug } from './RpStateFloat.tsx'

/** dock 席位 owner props（InputZone 快照；session 形态按运行时实际字段防御性读取） */
interface DockProps {
  session?: unknown
  input?: unknown
}

interface SessionLike {
  sessionId?: string
  id?: string
  header?: { cwd?: string }
  cwd?: string
  /** 宿主 SessionSnapshot.blank（fiber 实证 2026-09-06）：true=空会话，false=已有消息 */
  blank?: boolean
}

/** 已选择「留空」的会话（模块级记忆，页面生命周期内不再提示） */
const dismissed = new Set<string>()

export function RpGreetingDock(props: DockProps): JSX.Element | null {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const s = (props.session ?? {}) as SessionLike
  const sessionId = s.sessionId ?? s.id ?? ''
  const cwd = s.header?.cwd ?? s.cwd
  // dock 席位 props 不带 cwd（在宿主 useSessions().byId）——缺失时向 host 补取
  const { slug } = useRpSlug(cwd, sessionId)
  // 【2026-09-06 实证修复】宿主 SessionSnapshot 没有 chat/surface 字段（fiber 实测 keys 全集），
  // 旧 msgCount 恒 0 → 长聊天会话里也弹「空白会话」横幅（真机实拍抓到）。改用快照自带的
  // blank 字段：true=空会话（弹窗），false=已有消息（隐藏）。
  if (!slug || !sessionId || s.blank !== true || dismissed.has(sessionId) || done) return null

  const withGreeting = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await rpApi('rp/open-chat', { slug, sessionId })
      setDone(true) // open-chat 落盘后会话不再为空，组件自然隐去
    } catch (e) {
      window.alert(`注入开场白失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dsht-rp-greeting-dock" role="note">
      <span className="txt">这是「{slug}」的空白会话——</span>
      <button type="button" className="dsht-rp-btn" disabled={busy} onClick={() => { void withGreeting() }}>
        {busy ? '注入中…' : '💬 带开场白开始'}
      </button>
      <button type="button" className="dsht-rp-btn" disabled={busy} onClick={() => { dismissed.add(sessionId); setDone(true) }}>
        留空（自定义用途）
      </button>
    </div>
  )
}
