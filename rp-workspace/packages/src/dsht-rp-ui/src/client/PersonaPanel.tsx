/**
 * 批次修复 5：「我的」persona 面板（RpOverlay 新 tab）。
 *
 * 存储契约（给后端/组装层对接用，勿随意改）：
 * - 文件：$DSH_HOME/rp/persona.json
 * - 结构：{ schemaVersion: 1, active: string | null, list: Array<{ name, description }> }
 *   active = 默认 persona 的名字（list 中某条 name）；null = 未选择。
 * - 写：优先 POST /dsht-rp/rp/persona {active, list}（后端轻量路由，并行任务可提供）；
 *   路由缺失（404）时回退既有 /dsht-rp/write-files 写 rp/persona.json（白名单含 rp/）。
 * - 读：POST /dsht-rp/rp/persona（空 body → 返回 {active, list}）；路由缺失回退空表。
 * - 消费（组装层，另一任务）：rp.json 的 macros.user 从 active persona 取 name 作
 *   {{user}}，description 作 {{persona}}/personaDescription 注入 persona 槽位。
 *   迁移的 ST persona（如 示例人设甲/示例人设乙/示例人设丙）由迁移 agent 写入本文件。
 */
import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import { rpApi } from './rpc.ts'

export interface PersonaEntry { name: string; description: string }
interface PersonaFile { schemaVersion: 1; active: string | null; list: PersonaEntry[] }

const EMPTY: PersonaFile = { schemaVersion: 1, active: null, list: [] }

/** 读取结果三态：成功 / 失败。**失败绝不返回空表** ——
 *  【2026-09-13 修复·静默数据破坏】原实现 `catch {}` 后 `return EMPTY`，调用方仍 `setLoaded(true)`
 *  ⇒ ① 界面显示「还没有人设——点下方新增…」（与"真的一篇都没有"无法区分）；
 *    ② **保存按钮可用** ⇒ 用户顺手点保存，`rp/persona` 收到 `{active:null,list:[]}`
 *       ⇒ **把用户已有的人设全部清空**。这是数据破坏级缺陷，与 PluginCards 同型。
 *  ⇒ 现改为显式返回成败，由调用方区分「空」与「读不到」，且失败时禁止保存。 */
async function loadPersona(): Promise<{ ok: true; file: PersonaFile } | { ok: false; error: string }> {
  try {
    const r = await rpApi<{ active?: string | null; list?: PersonaEntry[] }>('rp/persona')
    return { ok: true, file: { schemaVersion: 1, active: r.active ?? null, list: Array.isArray(r.list) ? r.list : [] } }
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || '人设读取失败' }
  }
}

async function savePersona(file: PersonaFile): Promise<void> {
  try {
    await rpApi('rp/persona', { active: file.active, list: file.list })
  } catch {
    // 回退：write-files 白名单直写（路由由后端任务提供前的保底通道）
    await rpApi('write-files', { files: [{ path: 'rp/persona.json', content: JSON.stringify(file, null, 2) }] })
  }
}

export function PersonaPanel(): JSX.Element {
  const [file, setFile] = useState<PersonaFile>(EMPTY)
  const [loaded, setLoaded] = useState(false)
  /** 读取失败原因（'' = 无错）。非空时表单区显示错误 + 重试，且保存被禁止 */
  const [loadError, setLoadError] = useState('')
  const [reloadSeq, setReloadSeq] = useState(0)
  const [status, setStatus] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)
  /** 【2026-09-13 修复·可重复提交】保存是整表覆盖写，无 busy 守卫时连点会重复提交。 */
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cur = true
    setLoadError('')
    setLoaded(false)
    void loadPersona().then(r => {
      if (!cur) return
      if (r.ok) { setFile(r.file); setLoaded(true) }
      else {
        // 关键：**不写空表、不放行保存**（否则会把用户已有的人设覆盖成空）
        setFile(EMPTY); setLoaded(false); setLoadError(r.error)
      }
    })
    return () => { cur = false }
  }, [reloadSeq])

  const patchEntry = (i: number, next: PersonaEntry): void => {
    setFile(prev => {
      const list = [...prev.list]
      list[i] = next
      // 改名时同步 active 引用（active 按 name 索引）
      const active = prev.active === prev.list[i]?.name ? next.name : prev.active
      return { ...prev, list, active }
    })
  }

  const addEntry = (): void => {
    setFile(prev => ({ ...prev, list: [...prev.list, { name: `新人设 ${prev.list.length + 1}`, description: '' }] }))
    setExpanded(file.list.length)
  }

  const removeEntry = (i: number): void => {
    setFile(prev => {
      const removed = prev.list[i]
      const list = prev.list.filter((_, j) => j !== i)
      return { ...prev, list, active: prev.active === removed?.name ? null : prev.active }
    })
    setExpanded(null)
  }

  const save = useCallback(async (): Promise<void> => {
    if (saving) return
    setSaving(true)
    setStatus('保存中…')
    try {
      await savePersona(file)
      setStatus('✓ 已保存（下一轮对话生效）')
    } catch (e) {
      setStatus(`保存失败：${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }, [file, saving])

  return (
    <div className="dsht-rp-preset">
      <div className="dsht-rp-section">
        <h3>👤 我的设定（persona）</h3>
        <p className="desc">
          {/* 【D2 术语桥接 2026-09-13】ST 老用户找的是「User Persona / 用户设定」，
              而本项目的 tab 叫「我的」⇒ 加了 ST 原词对照，避免找不到。
              只加对照、不改名（「我的」是既定命名，见 boundary B5）。 */}
          你在角色扮演里的身份（<b>SillyTavern 里叫「User Persona / 用户设定」</b>）：
          默认人设的名字填进 {'{{user}}'}，描述填进 {'{{persona}}'}。
          迁移来的 SillyTavern 人设会出现在下面的列表里。
        </p>
        {loadError !== '' && (
          <p className="dsht-rp-note" role="status" data-testid="dsht-rp-persona-loaderr"
            style={{ color: 'var(--dsw-alias-state-error, #e5534b)' }}>
            ⚠ 人设读取失败：{loadError}
            <button type="button" className="dsht-rp-btn" style={{ marginLeft: 8, height: 26, fontSize: 12 }}
              onClick={() => { setReloadSeq(n => n + 1) }}>重试</button>
            <span style={{ marginLeft: 8, opacity: .8 }}>（已禁用保存，以免把现有人设覆盖为空）</span>
          </p>
        )}
        {loadError === '' && !loaded && <p className="dsht-rp-note">读取中…</p>}
        {loadError === '' && loaded && file.list.length === 0 && (
          <p className="dsht-rp-note">还没有人设——点下方「＋ 新增人设」创建一个，或先做数据迁移。</p>
        )}
        {file.list.map((p, i) => (
          <div key={i} className="dsht-rp-persona-row" data-open={expanded === i || undefined}>
            <div className="pr-head">
              <label className="rx-check" title="设为默认人设">
                <input type="radio" name="dsht-persona-active" checked={file.active === p.name}
                  onChange={() => { setFile(prev => ({ ...prev, active: p.name })) }} />
                <span style={{ color: 'var(--dsw-alias-label-primary)', fontSize: 13 }}>{p.name || '（未命名）'}</span>
              </label>
              {file.active === p.name && <span className="rx-badge rx-timing">默认</span>}
              {/* 【2026-09-14 L1 穷举修复】原用 `dsht-rp-back`（返回钮）类 + 内联 28×28。
                  两个问题：① 语义误用——这不是返回钮；② 内联 width/height 会压制
                  `@media (max-width:700px)` 里 `.dsht-rp-back { width:44px; height:44px }`
                  （inline 优先于类选择器）⇒ 手机上仍是 28px，远低于 38 拇指下限（P1）。
                  改用本组件自己的类（`pr-expand`）统一由 CSS 管尺寸，桌面 32 / 窄屏 44。 */}
              <button type="button" className="pr-expand"
                aria-label={expanded === i ? '收起' : '编辑'}
                onClick={() => { setExpanded(expanded === i ? null : i) }}>{expanded === i ? '▴' : '✎'}</button>
            </div>
            {expanded === i && (
              <div className="pr-edit">
                <input className="dsht-rp-field" value={p.name} placeholder="名字（显示名）"
                  onChange={e => { patchEntry(i, { ...p, name: e.target.value }) }} />
                <textarea className="dsht-rp-field" rows={4} value={p.description}
                  placeholder="人设描述（外貌/身份/口癖……会注入提示词）"
                  onChange={e => { patchEntry(i, { ...p, description: e.target.value }) }} />
                <button type="button" className="dsht-rp-btn" style={{ height: 30, fontSize: 12, alignSelf: 'flex-start' }}
                  onClick={() => { removeEntry(i) }}>删除此人设</button>
              </div>
            )}
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button type="button" className="dsht-rp-btn" style={{ background: 'transparent', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l2)' }}
            onClick={() => { addEntry() }}>＋ 新增人设</button>
          <button type="button" className="dsht-rp-btn" disabled={!loaded || saving} onClick={() => { void save() }}>{saving ? '保存中…' : '保存'}</button>
        </div>
        {status && <p className="dsht-rp-note" role="status" style={{ marginTop: 8 }}>{status}</p>}
      </div>
    </div>
  )
}
