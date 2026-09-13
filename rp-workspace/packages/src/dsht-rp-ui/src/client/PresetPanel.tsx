/**
 * T2.7 RP 预设管理面板（嵌 RP 启动器第四页）。
 *
 * - 列表：内置示范（直答/轻 agent）+ 用户导入（rp-presets 目录下各 preset.json）
 * - 条目开关面板（用户定案）：点开预设 → slots 逐条开关 + toggles 组"选一"——
 *   写回表层 JSON（编译期展开语义不变：未启用条目不进 prompt）
 * - 内置预设只读（复制为自定义后可改）
 * - 会话内切换入口见 RpPresetSwitch（conversation.session.header.actions 席位）
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { rpApi, thApi } from './rpc.ts'
import { showDomConfirm } from './toast.ts'

/** RPPreset 最小面（对照 packages/src/preset/schema.ts） */
interface PresetSlotUi {
  id: string
  type: string
  content?: string
  skill?: string
  enabled: boolean
  depth?: number
  role?: string
}
interface ToggleGroupUi {
  group: string
  label: string
  /** 多选组（ST 迁移预设：selected = ST enabled，可任意勾选；缺省 false = 选一） */
  multi?: boolean
  options: Array<{ id: string; label: string; content: string; selected?: boolean }>
}
export interface RPPresetUi {
  schemaVersion: 1
  id: string
  displayName: string
  description?: string
  path: string
  toggles: ToggleGroupUi[]
  slots: PresetSlotUi[]
}

const PATH_LABELS: Record<string, string> = {
  direct: '直答', lightAgent: '轻 agent', heavyAgent: '重 agent',
}

export function PresetPanel(): JSX.Element {
  const [presets, setPresets] = useState<RPPresetUi[]>([])
  const [editing, setEditing] = useState<RPPresetUi | null>(null)
  const [isBuiltin, setIsBuiltin] = useState(false)
  const [status, setStatus] = useState('')
  /** 【2026-09-13 修复·可重复提交（C-4）】保存/删除是整表覆盖写，无 busy 守卫时连点会重复提交。 */
  const [busy, setBusy] = useState(false)
  /** 【2026-09-13 修复·键盘不可达（F-4）】原导入区是 label.dsht-rp-drop + 隐藏 file input
   *  （键盘不可达）——改为真 button 触发本 ref（input 放 button 外，避免 button 内嵌交互元素）。 */
  const presetFileRef = useRef<HTMLInputElement>(null)
  // 【T-34 2026-09-11 修复 · 运行时 ReferenceError】`expandedKey`/`setExpandedKey` 此前
  // **从未声明**，却被 5 处引用（切预设时 reset、槽位/Toggle 条目展开）。产物里同样是
  // 自由变量 → 用户在预设面板点任意条目「展开编辑」即抛 ReferenceError 整屏崩。
  // 该缺陷长期未被发现：`typecheck:core` 的 include 不含 UI 目录，而 UI 层此前无 tsc 覆盖。
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await rpApi<{ presets: RPPresetUi[] }>('preset/list')
      setPresets(r.presets ?? [])
    } catch (e) {
      setStatus(`加载失败：${(e as Error).message}`)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const open = (p: RPPresetUi, builtin: boolean): void => {
    setEditing(JSON.parse(JSON.stringify(p)) as RPPresetUi) // 深拷贝编辑
    setIsBuiltin(builtin)
    setExpandedKey(null)
    setStatus('')
  }

  const patch = (next: RPPresetUi): void => { setEditing(next) }

  const save = async (): Promise<void> => {
    if (!editing) return
    // 【2026-09-13 修复·可重复提交（C-4）】busy 守卫：保存期间忽略重复点击（整表覆盖写）
    if (busy) return
    setBusy(true)
    setStatus('保存中…')
    try {
      await rpApi('preset/save', { preset: editing })
      setStatus('✓ 已保存（生效于下一轮对话）')
      void load()
    } catch (e) {
      setStatus(`保存失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  /** 删除自定义预设（R5：st- 前缀的同步 agent preset 一并删除） */
  const removePreset = async (): Promise<void> => {
    if (!editing) return
    if (!await showDomConfirm(`删除预设「${editing.displayName}」？此操作不可恢复。`, { okText: '删除' })) return
    // 【2026-09-13 修复·可重复提交（C-4）】同 save：删除也不可重复提交
    if (busy) return
    setBusy(true)
    setStatus('删除中…')
    try {
      await rpApi('preset/delete', { presetId: editing.id })
      setEditing(null)
      setStatus('✓ 已删除')
      void load()
    } catch (e) {
      setStatus(`删除失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  /** 内置预设复制为自定义 */
  const duplicate = (): void => {
    if (!editing) return
    const id = `user-${editing.id}-${Date.now().toString(36)}`
    patch({ ...editing, id, displayName: `${editing.displayName}（副本）` })
    setIsBuiltin(false)
    setStatus('已复制为自定义预设——修改后点保存')
  }

  /** T3.1 预设分享（导出）：ST「OpenAI Settings」兼容 JSON（内嵌正则一并还原），
   *  对方经「导入 ST 预设」即可回灌——与导入构成分享闭环。 */
  const exportPreset = async (): Promise<void> => {
    if (!editing) return
    setStatus('导出中…')
    try {
      const r = await thApi<{ name: string; json: Record<string, unknown> }>('preset/export', { name: editing.displayName })
      const blob = new Blob([JSON.stringify(r.json, null, 1)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${r.name}.json`
      a.click()
      // 【2026-09-13 修复·点了导出没文件（D-13）】原同步 revokeObjectURL 可能先于 WebView
      // 读取 blob 执行 ⇒ 下载静默失败。延迟 2s 释放。
      setTimeout(() => { URL.revokeObjectURL(url) }, 2000)
      setStatus('✓ 已导出 ST 兼容 JSON（可分享给他人经「导入 ST 预设」回灌）')
    } catch (e) {
      setStatus(`导出失败：${(e as Error).message}`)
    }
  }

  /** T2.7 补丁：导入 ST 预设（示例预设/可待等 OpenAI Settings JSON） */
  const [importing, setImporting] = useState(false)
  const importSt = async (file: File): Promise<void> => {
    setImporting(true)
    setStatus('解析中…')
    try {
      const json = await file.text()
      const r = await rpApi<{ displayName: string; slots: number; regex: number; skipped: number; install?: string; note?: string }>('preset/import-st', {
        json,
        name: file.name.replace(/\.json$/i, ''),
      })
      if (r.install === 'conflict') {
        // P2#14：同 id 预设用户改过/已接管 → 后端保留用户版本，如实显示冲突说明
        setStatus(`⚠ 未导入「${r.displayName}」：${r.note ?? '与现有预设冲突，已保留现有版本'}`)
        return
      }
      setStatus(`✓ 已导入「${r.displayName}」：${r.slots} 个条目（开关 = ST 预设开关）+ ${r.regex} 个内嵌正则${r.skipped > 0 ? `（跳过 ${r.skipped} 个无对应槽位的条目）` : ''}——点开即可管理`)
      setEditing(null)
      void load()
    } catch (e) {
      setStatus(`导入失败：${(e as Error).message}`)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="dsht-rp-preset">
      <div className="dsht-rp-section" style={{ marginBottom: 12 }}>
        <h3>🎛 RP 预设（{presets.length}）</h3>
        <p className="desc">预设 = 行为指令包（示例预设/可待这类 ST 预设的适配版即在此）。会话内可随时切换（会话头下拉）；此处管理条目开关。</p>
        {/* 【2026-09-13 修复·键盘不可达（F-4）】label + 隐藏 file input 改为 button + 独立 input
            （Tab 可达、回车可点；input 在 button 之外，避免 button 内嵌交互元素）。 */}
        <button type="button" className="dsht-rp-drop" style={{ marginBottom: 10 }} disabled={importing}
          onClick={() => { presetFileRef.current?.click() }}>
          {importing ? '导入中…' : '导入 ST 预设（.json：SillyTavern「OpenAI Settings」里的预设文件，内嵌正则随预设导入）'}
        </button>
        <input
          ref={presetFileRef}
          type="file"
          accept=".json,application/json"
          tabIndex={-1}
          aria-hidden="true"
          style={{ display: 'none' }}
          disabled={importing}
          onChange={e => { const f = e.target.files?.[0]; if (f) void importSt(f); e.currentTarget.value = '' }}
        />
        {presets.map(p => (
          <button key={p.id} type="button" className="dsht-rp-preset-row" onClick={() => { open(p, p.id.startsWith('demo-')) }}>
            <span className="pr-name">{p.displayName}</span>
            <span className="pr-meta">{PATH_LABELS[p.path] ?? p.path} · {p.slots.length} 槽位 · {p.toggles.length} 开关组{p.id.startsWith('demo-') ? ' · 内置' : ''}</span>
          </button>
        ))}
        {status && <p className="dsht-rp-note" style={{ marginTop: 8 }}>{status}</p>}
      </div>

      {/* 条目开关面板（用户定案：点开就能设置哪些条目是否开启） */}
      {editing !== null && (
        <div className="dsht-rp-section">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0 }}>{editing.displayName}</h3>
            <div style={{ display: 'flex', gap: 6 }}>
              {isBuiltin && <button type="button" className="dsht-rp-btn" style={{ height: 28, padding: '0 10px', fontSize: 12 }} onClick={() => { duplicate() }}>复制为自定义</button>}
              {!isBuiltin && <button type="button" className="dsht-rp-btn" style={{ height: 28, padding: '0 10px', fontSize: 12 }} disabled={busy} onClick={() => { void save() }}>{busy ? '保存中…' : '保存'}</button>}
              {!isBuiltin && <button type="button" className="dsht-rp-btn" style={{ height: 28, padding: '0 10px', fontSize: 12 }} disabled={busy} onClick={() => { void removePreset() }}>删除</button>}
              <button type="button" className="dsht-rp-btn" style={{ height: 28, padding: '0 10px', fontSize: 12 }} disabled={busy} onClick={() => { void exportPreset() }}>导出</button>
              <button type="button" className="dsht-rp-btn" style={{ height: 28, padding: '0 10px', fontSize: 12 }} onClick={() => { setEditing(null) }}>收起</button>
            </div>
          </div>

          <div style={{ marginTop: 10, fontSize: 13, fontWeight: 600 }}>槽位（点条目展开编辑：名称/角色/深度/内容/启用——未启用不进 prompt）</div>
          {editing.slots.map((s, i) => {
            const key = `s-${i}`
            const isOpen = expandedKey === key
            const patchSlot = (next: Partial<PresetSlotUi>): void => {
              const n = { ...editing }
              n.slots = [...editing.slots]
              n.slots[i] = { ...s, ...next }
              patch(n)
            }
            return (
              // key 用序号不用 s.id——名称可编辑，key 抖动会打断输入焦点
              <div key={i} className="dsht-rp-preset-entry-wrap" data-open={isOpen || undefined}>
                <div className="dsht-rp-preset-entry">
                  <input type="checkbox" checked={s.enabled} disabled={isBuiltin} title="启用"
                    onChange={() => { patchSlot({ enabled: !s.enabled }) }} />
                  <span className="pe-id">{s.id}</span>
                  <span className="pe-type">{s.type}{s.depth !== undefined ? ` ·d${s.depth}` : ''}</span>
                  <span className="pe-preview">{(s.content ?? s.skill ?? '').slice(0, 60) || '（动态位）'}</span>
                  <button type="button" className="pe-expand" aria-label={isOpen ? '收起' : '展开编辑'}
                    onClick={() => { setExpandedKey(isOpen ? null : key) }}>{isOpen ? '▴' : '▾'}</button>
                </div>
                {isOpen && (
                  <div className="pe-editor">
                    <label className="pe-field"><span>名称</span>
                      <input className="dsht-rp-field" value={s.id} disabled={isBuiltin}
                        onChange={e => { patchSlot({ id: e.target.value }) }} /></label>
                    <div className="pe-field-row">
                      <label className="pe-field"><span>角色</span>
                        <select className="dsht-rp-field" value={s.role ?? 'system'} disabled={isBuiltin}
                          onChange={e => { patchSlot({ role: e.target.value }) }}>
                          <option value="system">system</option>
                          <option value="user">user</option>
                          <option value="assistant">assistant</option>
                        </select></label>
                      <label className="pe-field"><span>深度（可空）</span>
                        <input className="dsht-rp-field" type="number" min={0} value={s.depth ?? ''} disabled={isBuiltin}
                          placeholder="不填=顶部"
                          onChange={e => { patchSlot({ depth: e.target.value === '' ? undefined : Number(e.target.value) }) }} /></label>
                    </div>
                    {s.type === 'marker' || s.type === 'state' || s.type === 'configSummary'
                      ? <p className="dsht-rp-note">动态位（{s.type}）：内容由组装层填充，无正文可编。</p>
                      : <label className="pe-field"><span>{s.type === 'skillRef' ? '引用的 skill 名' : '内容'}</span>
                        <textarea className="dsht-rp-field dsht-rp-field-code" rows={6}
                          value={s.type === 'skillRef' ? (s.skill ?? '') : (s.content ?? '')} disabled={isBuiltin}
                          onChange={e => { patchSlot(s.type === 'skillRef' ? { skill: e.target.value } : { content: e.target.value }) }} /></label>}
                  </div>
                )}
              </div>
            )
          })}

          {editing.toggles.length > 0 && (
            <>
              <div style={{ marginTop: 12, fontSize: 13, fontWeight: 600 }}>开关组（multi=多选复选，其余互斥选一；点条目名展开编辑内容）</div>
              {editing.toggles.map((g, gi) => {
                const patchOptions = (options: ToggleGroupUi['options']): void => {
                  const next = { ...editing }
                  next.toggles = [...editing.toggles]
                  next.toggles[gi] = { ...g, options }
                  patch(next)
                }
                return (
                  <div key={g.group} className="dsht-rp-preset-toggle">
                    <div className="pt-label">{g.label}{g.multi === true ? '（多选）' : '（选一）'}</div>
                    <div className="pt-options">
                      {g.options.map((o, oi) => {
                        const key = `t-${gi}-${oi}`
                        const isOpen = expandedKey === key
                        const selected = g.multi === true ? o.selected === true : (o.selected ?? oi === 0)
                        return (
                          <div key={o.id} className="pt-opt-wrap">
                            <span className={`pt-opt${selected ? ' on' : ''}`}>
                              <input type={g.multi === true ? 'checkbox' : 'radio'} name={`tg-${gi}`}
                                checked={selected} disabled={isBuiltin}
                                onChange={() => {
                                  patchOptions(g.multi === true
                                    ? g.options.map(x => (x.id === o.id ? { ...x, selected: !(x.selected === true) } : x))
                                    : g.options.map(x => ({ ...x, selected: x.id === o.id })))
                                }} />
                              <button type="button" className="pt-opt-label" disabled={isBuiltin}
                                onClick={() => { setExpandedKey(isOpen ? null : key) }}>{o.label}{isOpen ? ' ▴' : ' ▾'}</button>
                            </span>
                            {isOpen && (
                              <div className="pe-editor">
                                <label className="pe-field"><span>条目名</span>
                                  <input className="dsht-rp-field" value={o.label} disabled={isBuiltin}
                                    onChange={e => { patchOptions(g.options.map(x => (x.id === o.id ? { ...x, label: e.target.value } : x))) }} /></label>
                                <label className="pe-field"><span>内容（选中后注入）</span>
                                  <textarea className="dsht-rp-field dsht-rp-field-code" rows={6} value={o.content} disabled={isBuiltin}
                                    onChange={e => { patchOptions(g.options.map(x => (x.id === o.id ? { ...x, content: e.target.value } : x))) }} /></label>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </>
          )}
          {isBuiltin && <p className="dsht-rp-note" style={{ marginTop: 8 }}>内置示范预设只读——点「复制为自定义」后可修改保存。</p>}
        </div>
      )}
    </div>
  )
}
