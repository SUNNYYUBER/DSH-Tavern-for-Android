/**
 * 任务 C2 + 2026-09-05 全量重做（用户拍板）：dsht 插件在 设置→插件→「可配置」tab 的
 * 卡片必须与原生「网页搜索」等插件卡 **结构+风格完全一致**，且设置面 1:1 复刻
 * SillyTavern 扩展时期的全部选项。
 *
 * 结构复刻（@deepseek-ai/dsh-client-ui-settings-plugins PluginCard）：
 *   li.card(cardOpen) > button.header(name+description+chevron) > body(fields+footer)
 * 样式：dsht-npc-*（style.ts 内逐字复制原生 CSS 值，类名换稳定前缀）。
 * 数据：分相位草稿（draft）+ 脏检查（dirty）+ 保存（PUT 全对象）/放弃（回滚）——
 *   与原生卡「未保存 pill + 放弃/保存 footer」同交互。
 *
 * 设置面盘点（源码级，MASTER_TODO §2.0k）：
 * - 酒馆助手（JS-Slash-Runner GlobalSettings）：脚本总开关+宏开关+渲染 7 项+优化 8 开关+监听器 4 项
 * - 提示词模板（ST-Prompt-Template settings.html）：19 项全量
 * - MVU：变量键值面（经酒馆助手脚本的启用走脚本总开关）
 * - 剧情记忆：我方原创 6 项
 * 接线原则：已有机制的开关已接线生效（TH：脚本/宏；EJS：总开关/生成/楼层/深度/沙箱/调试）；
 * 暂无对应管线的项**存盘但不悄悄砍**，UI 明确标注「暂无对应管线/不适用」。
 */
import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import { PROBES } from './MigrationStatusPanel.tsx'
import { memApi } from './rpc.ts'

type Json = Record<string, unknown>

function thApi(path: string, payload?: unknown): Promise<Json> {
  return fetch(`/dsht-tavern-helper/${path}`, {
    method: payload === undefined ? 'GET' : 'PUT',
    headers: payload === undefined ? undefined : { 'content-type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  }).then(async r => ({ ...(await r.json() as Json), __status: r.status }))
}
function ejsApi(path: string, payload?: unknown): Promise<Json> {
  return fetch(`/dsht-prompt-template/${path}`, {
    method: payload === undefined ? 'GET' : 'PUT',
    headers: payload === undefined ? undefined : { 'content-type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  }).then(async r => ({ ...(await r.json() as Json), __status: r.status }))
}
function mvuApi(path: string, payload?: unknown): Promise<Json> {
  return fetch(`/dsht-mvu/${path}`, {
    method: payload === undefined ? 'GET' : 'PUT',
    headers: payload === undefined ? undefined : { 'content-type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  }).then(async r => ({ ...(await r.json() as Json), __status: r.status }))
}

/* ---- 原生形态基元组件（dsht-npc-*）---- */

/** 原生开关行（vCGm7G_switch 同款开关 + 左标签右控件） */
function ToggleRow(props: { label: string; hint?: string; na?: string; value: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <div className="dsht-npc-row">
      <span className="dsht-npc-rowLabel">
        {props.label}
        {props.hint !== undefined && <div className="dsht-npc-hint">{props.hint}</div>}
        {props.na !== undefined && <div className="dsht-npc-na">{props.na}</div>}
      </span>
      <button
        type="button" role="switch" aria-checked={props.value}
        className={'dsht-npc-switch' + (props.value ? ' dsht-npc-switchOn' : '')}
        onClick={() => props.onChange(!props.value)}
      >
        <span className="dsht-npc-thumb" />
      </button>
    </div>
  )
}

/** 下拉行（ST select 同语义） */
function SelectRow(props: { label: string; hint?: string; na?: string; value: string; options: Array<[string, string]>; onChange: (v: string) => void }): JSX.Element {
  return (
    <div className="dsht-npc-row">
      <span className="dsht-npc-rowLabel">
        {props.label}
        {props.hint !== undefined && <div className="dsht-npc-hint">{props.hint}</div>}
        {props.na !== undefined && <div className="dsht-npc-na">{props.na}</div>}
      </span>
      <select className="dsht-npc-select" value={props.value} onChange={e => props.onChange(e.target.value)}>
        {props.options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    </div>
  )
}

/** 数字行（ST range+counter 同款：滑条 + 数字框） */
function SliderRow(props: { label: string; hint?: string; na?: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }): JSX.Element {
  return (
    <div className="dsht-npc-row">
      <span className="dsht-npc-rowLabel">
        {props.label}
        {props.hint !== undefined && <div className="dsht-npc-hint">{props.hint}</div>}
        {props.na !== undefined && <div className="dsht-npc-na">{props.na}</div>}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="range" className="dsht-npc-range" min={props.min} max={props.max} step={props.step}
          value={props.value} onChange={e => props.onChange(Number(e.target.value))} />
        <input type="number" className="dsht-npc-input dsht-npc-inputNum" min={props.min} max={props.max} step={props.step}
          value={String(props.value)} onChange={e => props.onChange(Number(e.target.value))} />
      </span>
    </div>
  )
}

/** 文本行 */
// 【T-34 2026-09-11 修复】补 `na`（"不适用"说明）——ToggleRow/SelectRow/SliderRow 三者
// 都支持，唯独 TextRow 漏了；而 297 行「监听地址」传了 na 却无处显示 → 用户看不到
// "PC 联动特性——移动端不适用，仅存盘" 这句关键说明（改动的后果不透明）。
function TextRow(props: { label: string; hint?: string; na?: string; value: string; onChange: (v: string) => void }): JSX.Element {
  return (
    <div className="dsht-npc-row">
      <span className="dsht-npc-rowLabel">
        {props.label}
        {props.hint !== undefined && <div className="dsht-npc-hint">{props.hint}</div>}
        {props.na !== undefined && <div className="dsht-npc-na">{props.na}</div>}
      </span>
      <input type="text" className="dsht-npc-input dsht-npc-inputText" value={props.value}
        onChange={e => props.onChange(e.target.value)} />
    </div>
  )
}

/** 分组标题 + 说明行 */
function GroupTitle(props: { title: string }): JSX.Element {
  return <div className="dsht-npc-groupTitle">{props.title}</div>
}
function NoteRow(props: { text: string }): JSX.Element {
  return <p className="dsht-npc-rowNote">{props.text}</p>
}

/* ---- 卡片框架：草稿 + 脏检查 + 保存/放弃（原生 PluginCard 同交互）---- */

type SettingsApi = {
  get: () => Promise<Json>
  put: (draft: Json) => Promise<Json>
  pick: (data: Json) => Json
}

function usePluginSettings(api: SettingsApi, alive: boolean | null): {
  cfg: Json | null
  draft: Json | null
  setDraft: (next: Json) => void
  dirty: boolean
  saving: boolean
  failed: boolean
  save: () => Promise<void>
  discard: () => void
  /** 【T-34 2026-09-11 修复】`alive` 此前**未随返回值暴露**，而消费者读 `st.alive === false`
   *  判「插件不可用」→ 恒 `undefined === false` = false → 该提示**永不出现**（静默失效）。
   *  补进返回值：消费者现在读到的就是入参那份探测结果。 */
  alive: boolean | null
} {
  const [cfg, setCfg] = useState<Json | null>(null)
  const [draft, setDraftState] = useState<Json | null>(null)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (alive === false) return
    let cur = true
    api.get().then(d => { if (cur) { setCfg(api.pick(d)); setDraftState(api.pick(d)) } })
      .catch(() => { if (cur) { setCfg({}); setDraftState({}) } })
    return () => { cur = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alive])
  const dirty = useMemo(() => cfg !== null && draft !== null && JSON.stringify(draft) !== JSON.stringify(cfg), [cfg, draft])
  const setDraft = useCallback((next: Json) => setDraftState(next), [])
  const save = useCallback(async () => {
    if (draft === null || saving) return
    setSaving(true); setFailed(false)
    try {
      const r = await api.put(draft)
      const applied = (r.settings as Json | undefined) ?? draft
      setCfg(applied); setDraftState(applied)
    } catch { setFailed(true) } finally { setSaving(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, saving])
  const discard = useCallback(() => { if (cfg !== null) setDraftState(cfg) }, [cfg])
  return { cfg, draft, setDraft, dirty, saving, failed, save, discard, alive }
}

/** 原生 PluginCard 结构复刻（li.card > header > body+footer） */
function NativePluginCard(props: {
  name: string
  description: string
  alive: boolean | null
  form: (draft: Json, set: (next: Json) => void) => JSX.Element | null
  st: ReturnType<typeof usePluginSettings>
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const { st } = props
  const blocked = !st.dirty || st.saving
  const unavailable = st.alive === false
  return (
    <li className={'dsht-npc-card' + (open ? ' dsht-npc-cardOpen' : '')}>
      <button type="button" className="dsht-npc-header" aria-expanded={open}
        onClick={() => setOpen(v => !v)}>
        <span className="dsht-npc-headText">
          <span className="dsht-npc-name">{props.name}</span>
          <span className="dsht-npc-description">{props.description}</span>
        </span>
        {st.dirty && <span className="dsht-npc-description" style={{ color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap' }}>未保存</span>}
        <span className={'dsht-npc-chevron' + (open ? ' dsht-npc-chevronOpen' : '')} aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3.5 5.25L7 8.75L10.5 5.25" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      {open && (
        <div className="dsht-npc-body">
          {unavailable && (
            <p className="dsht-npc-readonly" role="status">插件数据面未响应——重启应用后仍如此请反馈。下方设置可能不可保存。</p>
          )}
          {st.cfg === null || st.draft === null
            ? <p className="dsht-npc-readonly" role="status">{unavailable ? '读取失败。' : '读取中…'}</p>
            : props.form(st.draft, st.setDraft)}
          <div className="dsht-npc-footer">
            {st.failed && <p className="dsht-npc-failed" role="status">保存失败——请重试。</p>}
            <button type="button" className="dsht-npc-discard" disabled={!st.dirty || st.saving} onClick={st.discard}>放弃</button>
            <button type="button" className="dsht-npc-save" disabled={blocked} onClick={() => { void st.save() }}>{st.saving ? '保存中…' : '保存'}</button>
          </div>
        </div>
      )}
    </li>
  )
}

/** 卡片工厂：探活 + 设置 hook + 表单一站组装 */
function makeNativeSettingsCard(listName: string, name: string, description: string,
  api: SettingsApi, form: (draft: Json, set: (next: Json) => void) => JSX.Element | null): () => JSX.Element {
  const probe = PROBES.find(p => p.listName === listName)
  return function Card(): JSX.Element {
    const [alive, setAlive] = useState<boolean | null>(null)
    useEffect(() => {
      let cur = true
      ;(probe?.ping ?? (() => Promise.resolve(false)))().then(ok => { if (cur) setAlive(ok) })
        .catch(() => { if (cur) setAlive(false) })
      return () => { cur = false }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    const st = usePluginSettings(api, alive)
    return <NativePluginCard name={name} description={description} alive={alive} st={st} form={form} />
  }
}

/* ===================== 酒馆助手（JS-Slash-Runner 全量设置面） ===================== */

const TH_API: SettingsApi = {
  get: () => thApi('settings'),
  put: draft => thApi('settings', draft),
  // GET 返回设置对象本身（不是 {settings} 包裹）——pick 必须透传，否则表单从空 draft
  // 渲染出假值、保存发稀疏对象（2026-09-05 模拟器实测踩坑）
  pick: d => d,
}

function TavernHelperForm(draft: Json, set: (next: Json) => void): JSX.Element {
  const render = (draft.render ?? {}) as Json
  const optimize = (draft.optimize ?? {}) as Json
  const listener = (draft.listener ?? {}) as Json
  const setR = (k: string, v: unknown) => set({ ...draft, render: { ...render, [k]: v } })
  const setO = (k: string, v: unknown) => set({ ...draft, optimize: { ...optimize, [k]: v } })
  const setL = (k: string, v: unknown) => set({ ...draft, listener: { ...listener, [k]: v } })
  const b = (v: unknown): boolean => v === true
  return (
    <div className="dsht-npc-rows">
      <GroupTitle title="脚本" />
      <ToggleRow label="执行脚本（总开关）" hint="关闭后预设/角色/全局脚本全部停用（= ST script.enabled.global）"
        value={b(draft.scriptEnabled)} onChange={v => set({ ...draft, scriptEnabled: v })} />
      <ToggleRow label="宏替换" hint="{{setvar}}、{{getvar}} 等宏的运行期展开（关闭 = 原文透传）"
        value={b(draft.macroEnabled)} onChange={v => set({ ...draft, macroEnabled: v })} />
      <GroupTitle title="渲染" />
      <ToggleRow label="启用渲染" hint="关闭 = 楼层里的前端 HTML/状态包裹退纯文本（立即生效）"
        value={render.enabled !== false} onChange={v => setR('enabled', v)} />
      <SelectRow label="折叠代码块" hint="全部/仅前端 = 长代码块默认折叠、点击展开（立即生效）"
        value={String(render.collapseCodeBlock ?? 'frontend_only')}
        options={[['all', '全部'], ['frontend_only', '仅前端'], ['none', '禁用']]}
        onChange={v => setR('collapseCodeBlock', v)} />
      <ToggleRow label="允许流式渲染" hint="关闭 = 生成中的楼层不出前端 HTML，定稿后一次渲染（立即生效）"
        value={b(render.allowStreaming)} onChange={v => setR('allowStreaming', v)} />
      <ToggleRow label="Blob URL 渲染" hint="前端文档 iframe 改用 blob: URL 装载（TH 同款形态，立即生效）"
        value={b(render.useBlobUrl)} onChange={v => setR('useBlobUrl', v)} />
      <ToggleRow label="优化代码高亮" hint="对代码块做轻量关键字着色（立即生效）"
        value={render.optimizeHljs !== false} onChange={v => setR('optimizeHljs', v)} />
      <SliderRow label="渲染深度" hint="0 = 仅最新楼层；深度超过此值的楼层退纯文本（立即生效）"
        value={typeof render.depth === 'number' ? render.depth : 0} min={0} max={100} step={1}
        onChange={v => setR('depth', v)} />
      <ToggleRow label="忽略隐藏楼层" hint="深度计算剔除被回退隐藏的楼层（立即生效）"
        value={b(render.depthIgnoreHidden)} onChange={v => setR('depthIgnoreHidden', v)} />
      <NoteRow text="渲染组已接入显示期管线（C3）：启用/深度/忽略隐藏/折叠代码块/允许流式/Blob URL/代码高亮全部即时生效——深度门只管前端 HTML 与状态包裹（display 正则/宏各有独立深度面）。" />
      <GroupTitle title="优化（ST 世界书/角色卡管线）" />
      <ToggleRow label="禁用不兼容选项" na="暂无对应管线——存盘不生效" value={b(optimize.disableIncompatibleOption)} onChange={v => setO('disableIncompatibleOption', v)} />
      <ToggleRow label="更好的消息加载" na="暂无对应管线——存盘不生效" value={b(optimize.betterMessageToLoad)} onChange={v => setO('betterMessageToLoad', v)} />
      <ToggleRow label="更好的角色卡更新" na="暂无对应管线——存盘不生效" value={b(optimize.betterCharacterUpdate)} onChange={v => setO('betterCharacterUpdate', v)} />
      <ToggleRow label="更好的角色卡导出" na="暂无对应管线——存盘不生效" value={b(optimize.betterCharacterExport)} onChange={v => setO('betterCharacterExport', v)} />
      <ToggleRow label="更好的角色卡删除" na="暂无对应管线——存盘不生效" value={b(optimize.betterCharacterDeletion)} onChange={v => setO('betterCharacterDeletion', v)} />
      <ToggleRow label="强制推荐世界书全局设置" na="暂无对应管线——存盘不生效" value={b(optimize.forceRecommendedWorldbookGlobalSettings)} onChange={v => setO('forceRecommendedWorldbookGlobalSettings', v)} />
      <ToggleRow label="保存预设时保存预设条目" na="暂无对应管线——存盘不生效" value={b(optimize.savePresetWhenSavingPresetEntries)} onChange={v => setO('savePresetWhenSavingPresetEntries', v)} />
      <ToggleRow label="最大化预设上下文长度" na="暂无对应管线——存盘不生效" value={b(optimize.maximizePresetContextLength)} onChange={v => setO('maximizePresetContextLength', v)} />
      <GroupTitle title="外部事件监听（PC 桌面联动）" />
      <ToggleRow label="启用监听器" na="PC 联动特性——移动端不适用，仅存盘" value={b(listener.enabled)} onChange={v => setL('enabled', v)} />
      <ToggleRow label="回声模式" na="PC 联动特性——移动端不适用，仅存盘" value={b(listener.enableEcho)} onChange={v => setL('enableEcho', v)} />
      <TextRow label="监听地址" na="PC 联动特性——移动端不适用，仅存盘"
        value={String(listener.url ?? 'http://localhost:6621')} onChange={v => setL('url', v)} />
      <SliderRow label="轮询间隔 (ms)" na="PC 联动特性——移动端不适用，仅存盘"
        value={typeof listener.duration === 'number' ? listener.duration : 1000} min={200} max={5000} step={100}
        onChange={v => setL('duration', v)} />
    </div>
  )
}

/* ===================== 提示词模板（ST-Prompt-Template 19 项全量） ===================== */

const EJS_API: SettingsApi = {
  get: () => ejsApi('settings'),
  put: draft => ejsApi('settings', draft),
  pick: d => d, // 同 TH：GET 返回设置对象本身，透传
}

function EjsForm(draft: Json, set: (next: Json) => void): JSX.Element {
  const b = (k: string, dflt = true): boolean => draft[k] === undefined ? dflt : draft[k] === true
  const n = (k: string, dflt: number): number => typeof draft[k] === 'number' ? draft[k] as number : dflt
  const s = (k: string, dflt: string): string => typeof draft[k] === 'string' ? draft[k] as string : dflt
  return (
    <div className="dsht-npc-rows">
      <GroupTitle title="总开关" />
      <ToggleRow label="启用扩展" value={b('enabled')} onChange={v => set({ ...draft, enabled: v })} />
      <GroupTitle title="生成" />
      <ToggleRow label="生成处理（生成期模板求值）" hint="生成提示词前做 EJS 求值（调用方传 phase=generate）"
        value={b('generateEnabled')} onChange={v => set({ ...draft, generateEnabled: v })} />
      <ToggleRow label="启用 [GENERATE] 特性" na="需世界书管线——当前版本暂未接线，仅存盘"
        value={b('generateLoaderEnabled', false)} onChange={v => set({ ...draft, generateLoaderEnabled: v })} />
      <ToggleRow label="启用 @INJECT 特性" na="需世界书管线——当前版本暂未接线，仅存盘"
        value={b('injectLoaderEnabled', false)} onChange={v => set({ ...draft, injectLoaderEnabled: v })} />
      <ToggleRow label="生成时忽略楼层模板语句" na="随生成管线接线——当前版本仅存盘"
        value={b('filterChatMessage', false)} onChange={v => set({ ...draft, filterChatMessage: v })} />
      <GroupTitle title="楼层消息" />
      <ToggleRow label="楼层消息处理（渲染期求值）" value={b('renderEnabled')} onChange={v => set({ ...draft, renderEnabled: v })} />
      <ToggleRow label="启用 [RENDER] 特性" hint="显示期把 [RENDER] 条目内容包裹楼层正文前后（B6，立即生效）"
        value={b('renderLoaderEnabled', false)} onChange={v => set({ ...draft, renderLoaderEnabled: v })} />
      <ToggleRow label="处理 <pre> 代码块" hint="关闭 = 代码块不做模板求值（服务端 /render 消费）"
        value={b('codeBlocks', false)} onChange={v => set({ ...draft, codeBlocks: v })} />
      <ToggleRow label="处理原始消息内容" hint="宏展开成功后把结果写回楼层正文（B8 永久写回，立即生效）"
        value={b('permanentEvaluation', false)} onChange={v => set({ ...draft, permanentEvaluation: v })} />
      <SliderRow label="楼层处理最大深度" hint="-1 = 无限制；仅处理深度小于此值的楼层（立即生效）"
        value={n('chatDepth', -1)} min={-1} max={100} step={1} onChange={v => set({ ...draft, chatDepth: v })} />
      <ToggleRow label="自动保存聊天" na="DSH 本身自动落盘——项保留，无实际作用"
        value={b('autosaveEnabled', false)} onChange={v => set({ ...draft, autosaveEnabled: v })} />
      <GroupTitle title="引擎" />
      <ToggleRow label="环境隔离（vm 沙箱引擎）" hint="开启后缺省用沙箱引擎渲染完整 EJS（立即生效）"
        value={b('sandbox', false)} onChange={v => set({ ...draft, sandbox: v })} />
      <ToggleRow label="禁用 with 语句块" na="沙箱引擎编译选项——当前版本仅存盘"
        value={b('withContextDisabled', false)} onChange={v => set({ ...draft, withContextDisabled: v })} />
      <ToggleRow label="控制台详细日志" hint="开启后渲染管线输出逐条日志（立即生效）"
        value={b('debugEnabled', false)} onChange={v => set({ ...draft, debugEnabled: v })} />
      <ToggleRow label="Web Worker 编译" hint="浏览器端 Web Worker 编译 EJS 模板（本轮已接线生效）"
        value={b('compileWorkers', false)} onChange={v => set({ ...draft, compileWorkers: v })} />
      <ToggleRow label="世界书代码编辑器" hint="世界书面板条目内容换行号轻量编辑器（B17，立即生效）"
        value={b('codeEditor', false)} onChange={v => set({ ...draft, codeEditor: v })} />
      <ToggleRow label="旧特性兼容（条目禁用视为启用）" hint="旧版世界书条目 disable 语义反转兼容（本轮已接线生效）"
        value={b('invertEnabled', false)} onChange={v => set({ ...draft, invertEnabled: v })} />
      <GroupTitle title="缓存（实验性）" />
      <SelectRow label="模板编译缓存" hint="模板编译结果缓存档位（本轮已接线生效）"
        value={String(n('cacheEnabled', 0))}
        options={[['0', '禁用'], ['1', '启用'], ['2', '仅世界书']]}
        onChange={v => set({ ...draft, cacheEnabled: Number(v) })} />
      <SliderRow label="缓存大小上限" hint="0 = 不限制（本轮已接线生效）"
        value={n('cacheSize', 0)} min={0} max={512} step={8} onChange={v => set({ ...draft, cacheSize: v })} />
      <SelectRow label="缓存 Hash 函数" hint="缓存键哈希算法（本轮已接线生效）"
        value={s('cacheHasher', 'h32ToString')}
        options={[['h32ToString', 'h32'], ['h64ToString', 'h64']]}
        onChange={v => set({ ...draft, cacheHasher: v })} />
    </div>
  )
}

/* ===================== MVU（变量面）与 剧情记忆（我方原创 6 项） ===================== */

const MVU_API: SettingsApi = {
  get: () => mvuApi('settings'),
  put: draft => mvuApi('settings', draft),
  pick: d => (d.settings as Json | undefined) ?? d,
}

function MvuForm(draft: Json, set: (next: Json) => void): JSX.Element {
  const entries = useMemo(
    () => Object.entries(draft).filter(([, v]) => typeof v !== 'object').map(([k, v]) => [k, String(v)] as [string, string]),
    [draft],
  )
  return (
    <div className="dsht-npc-rows">
      <NoteRow text="ST mvu_settings 的迁移落点（顶层标量键值；对象/数组键请直接改文件）。改动保存即生效——MVU 变量更新管线即时读取。" />
      {entries.length === 0 && <NoteRow text="（暂无顶层键值）" />}
      {entries.map(([k, v]) => (
        <TextRow key={k} label={k} value={v}
          onChange={nv => {
            const t = nv.trim()
            const typed: unknown = t === 'true' ? true : t === 'false' ? false : (/^-?\d+(\.\d+)?$/.test(t) ? Number(t) : nv)
            set({ ...draft, [k]: typed })
          }} />
      ))}
      <ToggleRow label="状态栏渲染（MVU 正则面）" hint="关闭 = 状态栏代码块按原文显示；开启 = 解析为表格"
        value={(draft as Json).renderEnabled !== false}
        onChange={v => set({ ...draft, renderEnabled: v })} />
    </div>
  )
}

const MEM_API: SettingsApi = {
  get: () => memApi('settings').then(d => d as Json),
  put: draft => memApi('settings', {
    总开关: draft.enabled, 每N楼总结: draft.everyN, 保留近M楼原文: draft.keepNearFloors,
    近窗字符预算: draft.charBudget, 折叠老楼层: draft.foldOldFloors, 摘要字数上限: draft.summaryMaxChars,
  }) as unknown as Promise<Json>,
  // 双键式兼容：GET 可能回英文键或中文键（数据面两版响应都见过）
  pick: d => ({
    enabled: (d.enabled ?? d.总开关) === true,
    everyN: Number(d.everyN ?? d.每N楼总结 ?? 10),
    keepNearFloors: Number(d.keepNearFloors ?? d.保留近M楼原文 ?? 0),
    charBudget: Number(d.charBudget ?? d.近窗字符预算 ?? 8000),
    foldOldFloors: (d.foldOldFloors ?? d.折叠老楼层) === true,
    summaryMaxChars: Number(d.summaryMaxChars ?? d.摘要字数上限 ?? 500),
  }),
}

function MemoryForm(draft: Json, set: (next: Json) => void): JSX.Element {
  const num = (k: string, label: string, min: number) => (
    <SliderRow label={label} value={Number(draft[k] ?? min)} min={min} max={k === 'summaryMaxChars' ? 2000 : 100000}
      step={k === 'summaryMaxChars' ? 50 : 1} onChange={v => set({ ...draft, [k]: v })} />
  )
  const chk = (k: string, label: string, hint?: string) => (
    <ToggleRow label={label} hint={hint} value={draft[k] === true} onChange={v => set({ ...draft, [k]: v })} />
  )
  return (
    <div className="dsht-npc-rows">
      {chk('enabled', '总开关', '关闭后不再自动总结')}
      {num('everyN', '每 N 楼总结', 2)}
      {num('keepNearFloors', '保留近 M 楼原文', 0)}
      {num('charBudget', '近窗字符预算', 1000)}
      {chk('foldOldFloors', '折叠老楼层')}
      {num('summaryMaxChars', '摘要字数上限', 100)}
    </div>
  )
}

/* ===================== 出口（与旧版同契约：listName → 卡片组件） ===================== */

const CARDS: Record<string, () => JSX.Element> = {
  'dsht-plugin-mvu': makeNativeSettingsCard(
    'dsht-plugin-mvu', '变量 / 状态栏（MVU）',
    '聊天变量与状态栏的自动更新（SillyTavern MVU 框架兼容）。', MVU_API, MvuForm),
  'dsht-plugin-tavern-helper': makeNativeSettingsCard(
    'dsht-plugin-tavern-helper', '酒馆助手（变量与脚本）',
    '脚本执行、宏展开与变量读写（SillyTavern JS-Slash-Runner 兼容）。', TH_API, TavernHelperForm),
  'dsht-plugin-prompt-template': makeNativeSettingsCard(
    'dsht-plugin-prompt-template', '提示词模板（EJS）',
    '提示词与楼层消息的 EJS 模板渲染（ST-Prompt-Template 兼容）。', EJS_API, EjsForm),
  'dsht-plugin-memory': makeNativeSettingsCard(
    'dsht-plugin-memory', '剧情记忆（楼层总结）',
    '每 N 楼自动把剧情浓缩成记忆本（世界书），长聊天不「失忆」。', MEM_API, MemoryForm),
}

/** 卡片组件工厂（按 listName 找到对应卡） */
export function makePluginCard(listName: string): () => JSX.Element {
  return CARDS[listName] ?? (function Fallback(): JSX.Element {
    return <li className="dsht-npc-card"><div className="dsht-npc-body"><p className="dsht-npc-readonly">未知插件：{listName}</p></div></li>
  })
}

/** 四个插件的命名空间 key（与 host 侧 registerSettingsNamespace 同名） */
export const PLUGIN_CARD_KEYS = [
  'dsht-plugin-mvu',
  'dsht-plugin-tavern-helper',
  'dsht-plugin-prompt-template',
  'dsht-plugin-memory',
] as const
