/**
 * T2.8 正则管理面板（ST extensions/regex 界面复刻，嵌 RP 启动器第三页）。
 *
 * - 三层作用域（用户定案）：全局（rp/regex/global.json）/ 预设（T2.7 接线）/
 *   角色局部（rp.json.regex）——ST global_scripts/scoped_scripts 同构
 * - 每行：开关 + 名称 + placement 徽章 + 三时机标识（ST 列表形态）
 * - 编辑器：全字段（findRegex/replaceString/placement/markdownOnly/promptOnly/depth）
 * - 测试器：输入样本文本 → /dsht-rp/regex/test 显示替换结果（ST 同款）
 * - 导入/导出 JSON；保存走 /regex/save-global 或 /regex/save-scoped
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { rpApi, type RpWorkspaceInfo } from './rpc.ts'

/** RegexScript 最小面（对照 packages/src/regex/engine.ts；序列化兼容 ST 字段名） */
export interface RegexScriptUi {
  id: string
  scriptName: string
  findRegex: string
  replaceString: string
  trimStrings: string[]
  placement: number[]
  disabled: boolean
  markdownOnly: boolean
  promptOnly: boolean
  runOnEdit: boolean
  substituteRegex: number
  minDepth: number | null
  maxDepth: number | null
}

const PLACEMENT_LABELS: Record<number, string> = {
  1: '用户输入', 2: 'AI输出', 3: '斜杠命令', 5: '世界书', 6: '推理',
}

const newScript = (): RegexScriptUi => ({
  id: `rx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  scriptName: '新正则',
  findRegex: '',
  replaceString: '',
  trimStrings: [],
  placement: [2],
  disabled: false,
  markdownOnly: false,
  promptOnly: false,
  runOnEdit: false,
  substituteRegex: 0,
  minDepth: null,
  maxDepth: null,
})

type Scope = 'global' | 'scoped' | 'preset'

interface PresetOption { id: string; displayName: string }

export function RegexPanel({ workspaces }: { workspaces: RpWorkspaceInfo[] }): JSX.Element {
  const [scope, setScope] = useState<Scope>('global')
  const [slug, setSlug] = useState('')
  const [presetId, setPresetId] = useState('')
  const [presets, setPresets] = useState<PresetOption[]>([])
  const [scripts, setScripts] = useState<RegexScriptUi[]>([])
  const [editing, setEditing] = useState<RegexScriptUi | null>(null)
  const [status, setStatus] = useState('')
  const [testInput, setTestInput] = useState('')
  const [testOutput, setTestOutput] = useState('')
  const [loading, setLoading] = useState(false)
  /** 【2026-09-13 修复·可重复提交（C-4）】保存是整表覆盖写，无 busy 守卫时连点会重复提交。 */
  const [saving, setSaving] = useState(false)
  /** 【2026-09-13 修复·键盘不可达（F-4）】原「导入」是 label + 隐藏 file input
   *  （键盘不可达）——改为真按钮触发本 ref 的 click。 */
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (scope === 'preset') {
        // 预设作用域（批次修复 6 接线）：rp-presets/<id>/regex.json
        if (!presetId) { setScripts([]); return }
        const r = await rpApi<{ scripts: RegexScriptUi[] }>('regex/list-preset', { presetId })
        setScripts(r.scripts ?? [])
        setStatus('')
        return
      }
      const r = await rpApi<{ global: RegexScriptUi[]; scoped: RegexScriptUi[] }>('regex/list', slug ? { slug } : {})
      setScripts(scope === 'global' ? (r.global ?? []) : (r.scoped ?? []))
      setStatus('')
    } catch (e) {
      setStatus(`加载失败：${(e as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [scope, slug, presetId])

  useEffect(() => { void load() }, [load])

  /** 预设清单（进预设作用域时拉一次） */
  useEffect(() => {
    if (scope !== 'preset' || presets.length > 0) return
    void rpApi<{ presets: Array<{ id: string; displayName?: string; name?: string }> }>('preset/list')
      .then(r => {
        const list = (r.presets ?? []).map(p => ({ id: p.id, displayName: p.displayName ?? p.name ?? p.id }))
        setPresets(list)
        if (!presetId && list.length > 0) setPresetId(list[0].id)
      })
      .catch(() => setStatus('预设清单加载失败'))
  }, [scope, presets.length, presetId])

  /** 切换作用域时同步角色下拉默认值 */
  useEffect(() => {
    if (scope === 'scoped' && !slug && workspaces.length > 0) setSlug(workspaces[0].slug)
  }, [scope, slug, workspaces])

  const save = async (): Promise<void> => {
    // 【2026-09-13 修复·可重复提交（C-4）】busy 守卫：保存期间忽略重复点击
    if (saving) return
    setSaving(true)
    setStatus('保存中…')
    try {
      if (scope === 'global') {
        await rpApi('regex/save-global', { scripts })
      } else if (scope === 'preset') {
        if (!presetId) { setStatus('请先选择预设'); return }
        await rpApi('regex/save-preset', { presetId, scripts })
      } else {
        if (!slug) { setStatus('请先选择角色'); return }
        await rpApi('regex/save-scoped', { slug, scripts })
      }
      setStatus('✓ 已保存（下一轮对话生效）')
      void load()
    } catch (e) {
      setStatus(`保存失败：${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  const toggle = (id: string): void => {
    setScripts(list => list.map(s => (s.id === id ? { ...s, disabled: !s.disabled } : s)))
  }

  const remove = (id: string): void => {
    setScripts(list => list.filter(s => s.id !== id))
    if (editing?.id === id) setEditing(null)
  }

  const runTest = async (): Promise<void> => {
    if (!editing || !editing.findRegex) { setTestOutput('请先在编辑器里填写查找正则'); return }
    try {
      const r = await rpApi<{ result: string; hits: number }>('regex/test', {
        script: editing,
        text: testInput,
        placement: editing.placement[0] ?? 2,
      })
      setTestOutput(r.hits > 0 ? `✓ 命中 ${r.hits} 处：\n${r.result}` : `（无命中）\n${r.result}`)
    } catch (e) {
      setTestOutput(`测试失败：${(e as Error).message}`)
    }
  }

  const importJson = async (file: File): Promise<void> => {
    try {
      const raw = JSON.parse(await file.text()) as unknown
      // ST 导出形态：单对象或数组
      const arr = Array.isArray(raw) ? raw : [raw]
      const imported = arr.map((o, i) => {
        const s = o as Partial<RegexScriptUi>
        return {
          ...newScript(),
          ...s,
          id: `rx-imp-${Date.now()}-${i}`,
          trimStrings: Array.isArray(s.trimStrings) ? s.trimStrings : [],
          placement: Array.isArray(s.placement) ? s.placement : [2],
          disabled: s.disabled === true,
          markdownOnly: s.markdownOnly === true,
          promptOnly: s.promptOnly === true,
          runOnEdit: s.runOnEdit === true,
          substituteRegex: typeof s.substituteRegex === 'number' ? s.substituteRegex : 0,
          minDepth: typeof s.minDepth === 'number' ? s.minDepth : null,
          maxDepth: typeof s.maxDepth === 'number' ? s.maxDepth : null,
        } as RegexScriptUi
      })
      setScripts(list => [...list, ...imported])
      setStatus(`已导入 ${imported.length} 条（保存后生效）`)
    } catch (e) {
      setStatus(`导入失败：${(e as Error).message}`)
    }
  }

  const patchEditing = (patch: Partial<RegexScriptUi>): void => {
    setEditing(cur => (cur === null ? cur : { ...cur, ...patch }))
  }

  const timingLabel = (s: RegexScriptUi): string => {
    if (s.markdownOnly && s.promptOnly) return '显示+提示词'
    if (s.markdownOnly) return '仅显示'
    if (s.promptOnly) return '仅提示词'
    return '永久'
  }

  return (
    <div className="dsht-rp-regex">
      {/* 作用域切换（ST 三区：全局/角色局部/预设——预设区批次修复 6 已接线） */}
      <div className="dsht-rp-tabs" style={{ marginBottom: 10 }}>
        <button type="button" className={`dsht-rp-tab${scope === 'global' ? ' active' : ''}`} onClick={() => { setScope('global') }}>全局</button>
        <button type="button" className={`dsht-rp-tab${scope === 'scoped' ? ' active' : ''}`} onClick={() => { setScope('scoped') }}>角色（局部）</button>
        <button type="button" className={`dsht-rp-tab${scope === 'preset' ? ' active' : ''}`} onClick={() => { setScope('preset') }}>预设</button>
      </div>

      {scope === 'preset' && (
        <div className="dsht-rp-kv" style={{ marginBottom: 10 }}>
          <span className="k">预设</span>
          <select className="dsht-rp-field" value={presetId} onChange={e => { setPresetId(e.target.value) }}>
            {presets.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>
        </div>
      )}

      {scope === 'scoped' && (
        <div className="dsht-rp-kv" style={{ marginBottom: 10 }}>
          <span className="k">角色</span>
          <select className="dsht-rp-field" value={slug} onChange={e => { setSlug(e.target.value) }}>
            {workspaces.length === 0 && <option value="">（先导入角色卡）</option>}
            {workspaces.map(w => <option key={w.slug} value={w.slug}>{w.name}</option>)}
          </select>
        </div>
      )}

      {/* 脚本列表（ST 列表形态：开关 + 名称 + placement 徽章 + 三时机） */}
      <div className="dsht-rp-section" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>正则脚本（{scripts.length}）</h3>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="dsht-rp-btn" style={{ height: 28, padding: '0 10px', fontSize: 12 }} onClick={() => { setEditing(newScript()) }}>+ 新建</button>
            {/* 【2026-09-13 修复·键盘不可达（F-4）】原为 label 包隐藏 file input：Tab 到不了、
                回车点不动。改为真 button（键盘可达）+ 独立的隐藏 input（input 放 button 外，
                button 内嵌交互元素违反 HTML 内容模型），由 ref 触发选择器。 */}
            <button type="button" className="dsht-rp-btn" style={{ height: 28, padding: '0 10px', fontSize: 12 }}
              onClick={() => { fileRef.current?.click() }}>导入</button>
            <input
              ref={fileRef}
              type="file"
              accept=".json"
              tabIndex={-1}
              aria-hidden="true"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) void importJson(f); e.currentTarget.value = '' }}
            />
            <button type="button" className="dsht-rp-btn" style={{ height: 28, padding: '0 10px', fontSize: 12 }}
              onClick={() => {
                const blob = new Blob([JSON.stringify(scripts, null, 2)], { type: 'application/json' })
                const a = document.createElement('a')
                const url = URL.createObjectURL(blob)
                a.href = url
                a.download = `dsht-regex-${scope}.json`
                a.click()
                // 【2026-09-13 修复·点了导出没文件（D-13）】原同步 revokeObjectURL 在 WebView 里
                // 可能先于下载读 blob 执行 ⇒ 下载静默失败。延迟 2s 释放。
                setTimeout(() => { URL.revokeObjectURL(url) }, 2000)
              }}>导出</button>
            <button type="button" className="dsht-rp-btn" style={{ height: 28, padding: '0 10px', fontSize: 12 }} disabled={loading || saving} onClick={() => { void save() }}>{saving ? '保存中…' : '保存'}</button>
          </div>
        </div>
        {scripts.length === 0 && <p className="dsht-rp-note">暂无脚本。点「+ 新建」或导入 ST 正则 JSON。</p>}
        {scripts.map(s => (
          <div key={s.id} className="dsht-rp-regex-row" data-disabled={s.disabled || undefined}>
            <label className="rx-toggle">
              <input type="checkbox" checked={!s.disabled} onChange={() => { toggle(s.id) }} />
              <span />
            </label>
            <button type="button" className="rx-name" onClick={() => { setEditing(s) }}>{s.scriptName || '（未命名）'}</button>
            <span className="rx-badges">
              {s.placement.map(p => <span key={p} className="rx-badge">{PLACEMENT_LABELS[p] ?? `P${p}`}</span>)}
              <span className="rx-badge rx-timing">{timingLabel(s)}</span>
            </span>
            <button type="button" className="rx-del" aria-label="删除" onClick={() => { remove(s.id) }}>✕</button>
          </div>
        ))}
        {status && <p className="dsht-rp-note" style={{ marginTop: 8 }}>{status}</p>}
      </div>

      {/* 编辑器 */}
      {editing !== null && (
        <div className="dsht-rp-section" style={{ marginBottom: 12 }}>
          <h3>编辑：{editing.scriptName || '（未命名）'}</h3>
          <div className="dsht-rp-kv"><span className="k">名称</span>
            <input type="text" className="dsht-rp-field" value={editing.scriptName} onChange={e => { patchEditing({ scriptName: e.target.value }) }} /></div>
          <div className="dsht-rp-kv" style={{ marginTop: 6 }}><span className="k">查找正则</span>
            <input type="text" className="dsht-rp-field dsht-rp-field-code" placeholder="/pattern/flags 或裸 pattern" value={editing.findRegex} onChange={e => { patchEditing({ findRegex: e.target.value }) }} /></div>
          <div className="dsht-rp-kv" style={{ marginTop: 6 }}><span className="k">替换为</span>
            <input type="text" className="dsht-rp-field dsht-rp-field-code" placeholder="$1 / {{match}} / 文本" value={editing.replaceString} onChange={e => { patchEditing({ replaceString: e.target.value }) }} /></div>
          <div className="dsht-rp-kv" style={{ marginTop: 6 }}><span className="k">作用位置</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {Object.entries(PLACEMENT_LABELS).map(([p, label]) => {
                const n = Number(p)
                const on = editing.placement.includes(n)
                return (
                  <label key={p} className="rx-check">
                    <input type="checkbox" checked={on} onChange={() => {
                      patchEditing({ placement: on ? editing.placement.filter(x => x !== n) : [...editing.placement, n] })
                    }} />{label}
                  </label>
                )
              })}
            </div>
          </div>
          <div className="dsht-rp-kv" style={{ marginTop: 6 }}><span className="k">执行时机</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <label className="rx-check"><input type="checkbox" checked={editing.markdownOnly} onChange={e => { patchEditing({ markdownOnly: e.target.checked }) }} />仅显示</label>
              <label className="rx-check"><input type="checkbox" checked={editing.promptOnly} onChange={e => { patchEditing({ promptOnly: e.target.checked }) }} />仅提示词</label>
              <label className="rx-check"><input type="checkbox" checked={editing.runOnEdit} onChange={e => { patchEditing({ runOnEdit: e.target.checked }) }} />编辑时执行</label>
            </div>
          </div>
          <div className="dsht-rp-kv" style={{ marginTop: 6 }}><span className="k">深度过滤</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="number" className="dsht-rp-field" style={{ maxWidth: 100 }} placeholder="min" value={editing.minDepth ?? ''} onChange={e => { patchEditing({ minDepth: e.target.value === '' ? null : Number(e.target.value) }) }} />
              <input type="number" className="dsht-rp-field" style={{ maxWidth: 100 }} placeholder="max" value={editing.maxDepth ?? ''} onChange={e => { patchEditing({ maxDepth: e.target.value === '' ? null : Number(e.target.value) }) }} />
            </div>
          </div>

          {/* 测试器（ST 同款：输入样本文本 → 显示替换结果） */}
          <div style={{ marginTop: 12, borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>测试器</div>
            <textarea className="dsht-rp-field" rows={3} placeholder="粘贴样本文本（AI 输出片段）…" value={testInput} onChange={e => { setTestInput(e.target.value) }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <button type="button" className="dsht-rp-btn" style={{ height: 28, padding: '0 12px', fontSize: 12 }} onClick={() => { void runTest() }}>运行测试</button>
              <button type="button" className="dsht-rp-btn" style={{ height: 28, padding: '0 12px', fontSize: 12 }} onClick={() => { setEditing(null); setTestOutput('') }}>收起编辑器</button>
            </div>
            {testOutput && <pre className="rx-test-out">{testOutput}</pre>}
          </div>
        </div>
      )}

      <p className="dsht-rp-note">作用域语义（ST 对齐）：全局对所有会话生效；角色（局部）仅该角色工作区的消息生效；两者在组装层与显示层自动合并。display 时机由前端渲染层消费（T2.10 渲染器）。</p>
    </div>
  )
}
