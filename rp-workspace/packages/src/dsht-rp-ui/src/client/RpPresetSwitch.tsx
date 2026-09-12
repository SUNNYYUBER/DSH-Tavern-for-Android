/**
 * T2.7：会话内预设切换（conversation.session.header.actions list 席位）。
 *
 * 用户定案：DSHT 必须能在 session 里随时换预设（DSH 原生 agentPreset.select
 * 对已开始会话返回 agent-preset-locked——历史在该组合下产生）。解法 = RP 预设
 * 是组装层关注点：切换写会话状态文件（/dsht-rp/preset/select），下一轮 pre-step
 * 注入新预设内容（快照消息），历史零搁浅。
 */
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { rpApi } from './rpc.ts'
import { DSHT_MAIN_API } from '../../../dsht-plugin-shared/st-compat.ts'
import { emitThEventToFrames } from './th-host-events.ts'
import { notifyDisplayMutation } from './RpNativeChat.tsx'

interface PresetLite { id: string; displayName: string }

/** header action 席位收到的标准件（framework 注入；owner 无 props） */
interface HeaderActionProps {
  useSession: <T>(selector: (snapshot: { sessionId?: unknown }) => T) => T
  sessionId: string
}

export function RpPresetSwitch({ useSession, sessionId }: HeaderActionProps): JSX.Element | null {
  const [presets, setPresets] = useState<PresetLite[]>([])
  const [current, setCurrent] = useState<string>('')
  const [switching, setSwitching] = useState(false)
  // 会话切换时重读（sessionId 变化即重挂/重取）
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [list, state] = await Promise.all([
          rpApi<{ presets: PresetLite[] }>('preset/list'),
          rpApi<{ presetId: string | null }>('preset/state', { sessionId }),
        ])
        if (!alive) return
        setPresets(list.presets ?? [])
        setCurrent(state.presetId ?? '')
      } catch { /* 数据面不可达时控件静默 */ }
    })()
    return () => { alive = false }
  }, [sessionId])

  /** 清单实时化：点开下拉时重拉（迁移/管理面板写入的新预设不等会话重开即可见） */
  const refreshList = async (): Promise<void> => {
    try {
      const list = await rpApi<{ presets: PresetLite[] }>('preset/list')
      setPresets(list.presets ?? [])
    } catch { /* 数据面不可达保持旧清单 */ }
  }

  const select = async (presetId: string): Promise<void> => {
    if (switching) return
    setSwitching(true)
    try {
      await rpApi('preset/select', { sessionId, presetId: presetId || null })
      setCurrent(presetId)
      // 【T-80 心跳 74】对齐基准 `scripts/openai.js:6825-6826` 的**顺序与时机**：
      // 应用预设 delta 成功后先 `OAI_PRESET_CHANGED_AFTER`（无参），再 `PRESET_CHANGED`（{apiId,name}）。
      // 两条都不存在"补了但形状/时机错"的风险（L126）：
      //   · AFTER 基准无参、语料消费端零参；
      //   · PRESET_CHANGED 的语料 3 处消费端（示例卡二×2 / 梦鲸思客预设助手）**全部零参、不读载荷**
      //     ⇒ 基线里"apiId 取值未定、卡可能按 apiId 分支"的顾虑已被全语料普查**证伪**。
      //   · `apiId` 填 `DSHT_MAIN_API`（'openai'）= 我方实际主 API，非编造。
      emitThEventToFrames('oai_preset_changed_after', [], sessionId)
      emitThEventToFrames('preset_changed', [{
        apiId: DSHT_MAIN_API,
        name: presets.find(p => p.id === presetId)?.displayName ?? presetId,
      }], sessionId)
      // 【2026-09-08 鲁棒性】display epoch 必须随预设切换 bump（旧代码只 invalidateWsCache
      // 清缓存——useDisplayRegexes 的 effect 依赖 [slug, sessionId, epoch]，epoch 不变则
      // 已挂载楼层永不重取预设作用域 display 正则，切换后显示面滞留旧正则直到重开会话）。
      // notifyDisplayMutation = 清缓存 + bump epoch + 订阅者重渲染（TH 脚本 preset:put 同款语义）。
      notifyDisplayMutation()
    } catch { /* 失败回显旧值：下次渲染纠正 */ }
    finally { setSwitching(false) }
  }

  if (presets.length === 0) return null
  return (
    <label className="dsht-rp-preset-switch" title="RP 预设（切换即时生效于下一轮）">
      <span className="ps-ico">🎛</span>
      <select className="ps-select" value={current} disabled={switching}
        onFocus={() => { void refreshList() }}
        onChange={e => { void select(e.target.value) }}>
        <option value="">RP 预设：未启用</option>
        {presets.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}
      </select>
    </label>
  )
}
