/**
 * 酒馆助手 API 服务端门面路由——数据面真路由实现（原记名拒绝项的落地）。
 *
 * 纯函数族设计：resolveDshHome 的 $DSH_HOME 环境变量不可按调用注入，故所有
 * 处理函数显式接收 dshHome 首参（index.ts 闭包传入），IO 之外的转换逻辑全可单测。
 *
 * 数据面（$DSH_HOME 布局）：
 * - 预设：rp-presets/<id>/preset.json（RPPreset：slots + toggles + sampling 等；id/displayName）
 * - 正则：global = rp/regex/global.json（{scripts:[]}）；character = rp/<slug>/rp.json 的 regex 键；
 *   preset = rp-presets/<id>/regex.json（{scripts:[]}）——脚本对象即 ST RegexScript 形状
 * - 世界书：skills 下 wb-* 目录的 references/lore.json（LoreBook）+ rp/global-books.json（{books:[{name,lorePath}]}）
 * - 会话状态：rp/state/<sessionId>.json（presetId 键；历史扁平 MVU 裸树兼容）
 * - 会话消息：sessions/<projectKey>/<sid>/session.jsonl（首行 header + {type,seq,data} 事件行）
 *
 * 写文件前统一走 snapshotBeforeWrite 快照（归属会话尽量解析——有 sessionId 才记；
 * 解析不到 turn 锚点/快照失败都不阻塞写）。
 *
 * 诚实边界：扩展管理/importRaw*、persona/character CRUD、聊天消息写路径等不做——
 * index.ts 维持记名拒绝（404），不在本文件实现。generate/generateRaw 不在本文件（C9：
 * index.ts 的 /generate loopback 转发 dsh-plugin /dsht-rp/llm/classify）。
 */

import { createReadStream } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { emptyPreset, type PresetSlot, type RPPreset } from '../preset/schema.ts'
import { demoDirectPreset, demoLightAgentPreset } from '../preset/demo.ts'
import { WI_POSITION, type LoreBook, type LoreEntry } from '../lore/entry.ts'
import { scanSessionHeaders } from '../dsht-plugin-shared/session-surgery.ts'
import { snapshotBeforeWrite } from '../dsht-plugin-shared/file-snapshots.ts'
import { validateSchemaSubset } from '../dsht-plugin-shared/schema.ts'
import { appendUndoEntries, diffUndoEntries } from '../dsht-plugin-shared/undo.ts'
import { deepMergeVars } from './variables.ts'
import { loadActivePersona } from './macros.ts'
import {
  STATE_RESERVED_KEYS, activePresetNameFromSettings, matchPresetByDisplayName, presetIdFromStateFile,
} from './for-session.ts'

// ---------------------------------------------------------------------------
// 形态定义（ST 酒馆助手侧的最小面）
// ---------------------------------------------------------------------------

/** ST 预设条目（chatCompletionSettings.prompts 元素；ST OpenAI Settings prompts 形状） */
export interface StPrompt {
  identifier: string
  name: string
  role: string
  content: string
  system_prompt: boolean
  marker: boolean
  injection_position: number
  injection_depth: number
}

/** ST prompt_order（character_id 100001 = 通用档） */
export interface StPromptOrder {
  character_id: number
  order: Array<{ identifier: string; enabled: boolean }>
}

/** ST 聊天消息（getChatMessages 形态） */
export interface StMessage {
  message_id: number
  /** L1a：事件 seq（TH 事件桥楼层解析锚 + P3a setChatMessages replace 目标定位；可选——老版本导出没有） */
  seq?: number
  name: string
  /** P3a：TH 写桥系统楼层（source.thSystem）导出为 'system' */
  role: 'user' | 'assistant' | 'system'
  message: string
  is_system: boolean
  /** P3a：楼层附加数据（source.thData）——卡脚本回读（飞讯 is_feixun_record 等靠它定位） */
  data?: unknown
}

/** 世界书清单条目 */
export interface WorldbookListItem {
  name: string
  lorePath: string
}

/** 门面处理结果（index.ts 统一 sendJson(r.status, r.body)） */
export interface FacadeResult {
  status: number
  body: Record<string, unknown>
}

function isTree(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

// ---------------------------------------------------------------------------
// StPrompt 视图构建（/context 与 /preset/get 两处共用）
// ---------------------------------------------------------------------------

/**
 * RPPreset → ST 预设视图 { prompts, prompt_order }：
 * - slots → StPrompt（depth 有值 = injection_position 1 绝对深度注入；marker 槽 system_prompt=false）
 * - toggles 每个 option → `toggle-<group>-<option>` 条目（system 注入位）
 * - prompt_order 单档 character_id 100001，按上面顺序全量列出：
 *   enabled = slot.enabled / option.selected（选一组里非 selected 的也列出 enabled:false）
 */
export function buildStPromptView(preset: RPPreset): { prompts: StPrompt[]; prompt_order: StPromptOrder[] } {
  const prompts: StPrompt[] = []
  const order: StPromptOrder['order'] = []
  for (const slot of preset.slots) {
    prompts.push({
      identifier: slot.id,
      name: slot.id,
      role: slot.role ?? 'system',
      content: slot.content ?? '',
      system_prompt: slot.type === 'system' || slot.type === 'skillRef',
      marker: slot.type === 'marker',
      injection_position: slot.depth != null ? 1 : 0,
      injection_depth: slot.depth ?? 100,
    })
    order.push({ identifier: slot.id, enabled: slot.enabled })
  }
  for (const group of preset.toggles) {
    for (const option of group.options) {
      const identifier = `toggle-${group.group}-${option.id}`
      prompts.push({
        identifier,
        name: option.label,
        role: 'system',
        content: option.content,
        system_prompt: true,
        marker: false,
        injection_position: 0,
        injection_depth: 100,
      })
      order.push({ identifier, enabled: option.selected === true })
    }
  }
  return { prompts, prompt_order: [{ character_id: 100001, order }] }
}

// ---------------------------------------------------------------------------
// 预设解析（rp-presets 清单 / 会话有效预设 / displayName 匹配）
// ---------------------------------------------------------------------------

/** rp-presets 清单项 */
export interface PresetFileEntry {
  id: string
  displayName: string
  preset: RPPreset
}

/** rp-presets/<id>/preset.json 清单（坏 preset.json 跳过；按 id 排序稳定输出） */
export async function listPresets(dshHome: string): Promise<PresetFileEntry[]> {
  const out: PresetFileEntry[] = []
  let dirs: string[] = []
  try { dirs = await readdir(join(dshHome, 'rp-presets')) } catch { return out }
  for (const id of dirs.sort()) {
    try {
      const p = JSON.parse(await readFile(join(dshHome, 'rp-presets', id, 'preset.json'), 'utf8')) as RPPreset
      if (isTree(p)) out.push({ id, displayName: typeof p.displayName === 'string' && p.displayName ? p.displayName : id, preset: p })
    } catch { /* 坏 preset.json 跳过 */ }
  }
  return out
}

/**
 * 会话有效预设解析（与 index.ts /scripts/for-session 同款语义）：
 * rp/state/<sid>.json 的 presetId 键（presetIdFromStateFile，历史扁平 MVU 裸树 = 无 presetId）
 * → 缺省回落最近 rp-import 批次 settings.json 的 ST 激活预设名，按 displayName 匹配 rp-presets。
 */
export async function resolveSessionPresetId(dshHome: string, sessionId: string): Promise<string | null> {
  try {
    const file = JSON.parse(await readFile(join(dshHome, 'rp', 'state', `${sessionId}.json`), 'utf8'))
    const pid = presetIdFromStateFile(file)
    if (pid) return pid
  } catch { /* 无状态文件 */ }
  try {
    const batches = (await readdir(join(dshHome, 'rp-import')))
      .filter(b => /^[a-z0-9][a-z0-9-]{0,60}$/.test(b)).sort().reverse()
    for (const b of batches) {
      const dir = join(dshHome, 'rp-import', b)
      let stRoot = 'data/default-user'
      try {
        const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as { manifest?: { stRoot?: unknown } }
        if (typeof meta.manifest?.stRoot === 'string' && meta.manifest.stRoot) stRoot = meta.manifest.stRoot
      } catch { /* 无 meta 用默认 */ }
      let activeName: string | null = null
      try {
        activeName = activePresetNameFromSettings(JSON.parse(await readFile(join(dir, 'unpacked', stRoot, 'settings.json'), 'utf8')))
      } catch { continue }
      if (!activeName) continue
      const presets = (await listPresets(dshHome)).map(p => ({ id: p.id, displayName: p.displayName }))
      return matchPresetByDisplayName(presets, activeName)
    }
  } catch { /* 无批次 = 无默认预设 */ }
  return null
}

/** displayName 精确匹配 → presetId（matchPresetByDisplayName 语义；null = 未匹配） */
export async function presetIdByName(dshHome: string, name: string): Promise<string | null> {
  if (!name) return null
  const presets = await listPresets(dshHome)
  return matchPresetByDisplayName(presets.map(p => ({ id: p.id, displayName: p.displayName })), name)
}

/** 预设名 → 新建 preset id（[a-z0-9][a-z0-9-]*，与既有 preset id / rp-import 批次约定一致） */
export function slugifyPresetId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '')
  if (!slug) return 'preset'
  return /^[a-z0-9]/.test(slug) ? slug : `p-${slug}`
}

/** rp/<slug>/rp.json 的 characterName（缺省回落 slug） */
async function characterNameOf(dshHome: string, slug: string): Promise<string> {
  try {
    const rp = JSON.parse(await readFile(join(dshHome, 'rp', slug, 'rp.json'), 'utf8')) as { characterName?: unknown }
    return typeof rp?.characterName === 'string' && rp.characterName ? rp.characterName : slug
  } catch { return slug }
}

/** 写前快照（归属会话尽量解析：有 sessionId 才记；解析不到/失败不阻塞写） */
async function snapshotFor(dshHome: string, sessionId: string, relPaths: string[]): Promise<void> {
  if (!sessionId) return
  try {
    await snapshotBeforeWrite(dshHome, sessionId, relPaths)
  } catch { /* 快照失败不阻塞写操作 */ }
}

/** $DSH_HOME 相对路径（posix 形态）→ 绝对路径 */
function homePath(dshHome: string, relPath: string): string {
  return join(dshHome, ...relPath.split('/'))
}

/**
 * 原子写（临时文件 + rename）：并发写同一 JSON 文件时，两个非原子 writeFile 交错
 * 会产出「新文档 + 旧文档尾部」的拼接损坏（实机实证：示例游戏内嵌书 lore.json 被世界书
 * 控制脚本 + MVU 初始化并发写撕裂，此后 locateBook name 匹配分支 parse 恒失败 →
 * 「worldbook not found」）。rename 在同目录内原子替换，后写者完整获胜（ST 同语义）。
 */
async function atomicWrite(path: string, data: string): Promise<void> {
  const tmp = `${path}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  await writeFile(tmp, data, 'utf8')
  try {
    await rename(tmp, path)
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => {})
    throw e
  }
}

// ---------------------------------------------------------------------------
// 端点 1：POST /context {sessionId, slug} → 会话有效预设的 ST 上下文视图
// ---------------------------------------------------------------------------

export async function context(dshHome: string, body: Record<string, unknown>): Promise<FacadeResult> {
  const sessionId = String(body.sessionId ?? '')
  const slug = String(body.slug ?? '')
  if (!sessionId) return { status: 400, body: { error: 'sessionId required' } }
  // 【2026-09-07 降级修复】会话无预设不再整体 404——TH 脚本（世界书绑定检测/飞讯发消息/
  // getContext 消费者）需要的是完整上下文快照（角色名/characterLorebook），预设缺席只
  // 影响预设相关字段。旧实现一票否决 → loadContextSnapshot 整体 reject → 卡内
  // getCharWorldbookNames 恒 null → 开场白「未绑定主世界书」误报（真机实证）。
  const presetId = await resolveSessionPresetId(dshHome, sessionId)
  let preset: RPPreset | null = null
  if (presetId !== null) {
    try {
      preset = JSON.parse(await readFile(homePath(dshHome, `rp-presets/${presetId}/preset.json`), 'utf8')) as RPPreset
    } catch {
      // 【实机验证修复 2026-09-06】内置示范预设没有磁盘文件（demo.ts 编译内联）——
      // rp-demo-direct/rp-demo-light-agent 回落到内存构建，否则 TH 上下文快照 404
      if (presetId === 'rp-demo-direct') preset = demoDirectPreset()
      else if (presetId === 'rp-demo-light-agent') preset = demoLightAgentPreset()
      else preset = null
    }
  }
  const view = preset !== null ? buildStPromptView(preset) : { prompts: [], prompt_order: [] }
  const characterName = slug ? await characterNameOf(dshHome, slug) : ''
  return {
    status: 200,
    body: {
      presetId: presetId,
      presetName: preset !== null && typeof preset.displayName === 'string' ? preset.displayName : presetId,
      character: { name: characterName },
      // ST getContext().name1 = 用户名（脚本读它当玩家名；飞讯 getPlayerName 等）。
      // ST 迁移会话的用户名取消息流的 name（'User'）；DSH 无独立 persona 存储，恒一致。
      name1: 'User',
      chatCompletionSettings: { prompts: view.prompts, prompt_order: view.prompt_order },
    },
  }
}

// ---------------------------------------------------------------------------
// 端点 2-6：预设清单 / 读 / 锚定写 / 删 / 改名 / 加载绑定
// ---------------------------------------------------------------------------

/** POST /preset/names {sessionId?} → { names, loaded } */
export async function presetNames(dshHome: string, body: Record<string, unknown>): Promise<FacadeResult> {
  const sessionId = String(body.sessionId ?? '')
  const presets = await listPresets(dshHome)
  let loaded: string | null = null
  if (sessionId) {
    const pid = await resolveSessionPresetId(dshHome, sessionId)
    loaded = presets.find(p => p.id === pid)?.displayName ?? null
  }
  return { status: 200, body: { names: presets.map(p => p.displayName), loaded } }
}

/**
 * 预设名 → presetId（ST 哨兵名 'in_use' = 会话当前加载的预设——ST 预设脚本惯例
 * getPreset('in_use')；resolveSessionPresetId 兜底最近导入批次激活预设）。
 * null = 未匹配（'in_use' 且会话无有效预设也归此列）。
 */
async function resolvePresetIdByName(dshHome: string, name: string, sessionId: string): Promise<string | null> {
  if (name === 'in_use') return resolveSessionPresetId(dshHome, sessionId)
  const presets = await listPresets(dshHome)
  return matchPresetByDisplayName(presets.map(p => ({ id: p.id, displayName: p.displayName })), name)
}

/** POST /preset/get {name, sessionId?} → { found, preset: { name, prompts, prompt_order } } */
export async function presetGet(dshHome: string, body: Record<string, unknown>): Promise<FacadeResult> {
  const name = String(body.name ?? '')
  if (!name) return { status: 400, body: { error: 'name required' } }
  const presetId = await resolvePresetIdByName(dshHome, name, String(body.sessionId ?? ''))
  const hit = presetId ? (await listPresets(dshHome)).find(p => p.id === presetId) : undefined
  if (!hit) return { status: 200, body: { found: false, preset: null } }
  const view = buildStPromptView(hit.preset)
  return {
    status: 200,
    body: { found: true, preset: { name: hit.displayName, prompts: view.prompts, prompt_order: view.prompt_order } },
  }
}

/**
 * POST /preset/export {name, sessionId?} → { name, json }（预设分享导出）。
 * json = ST「OpenAI Settings」兼容视图（prompts/prompt_order 走 /context 同款
 * buildStPromptView；预设作用域正则还原为 ST extensions.regex_scripts——字段一一
 * 对应，可直接经「导入 ST 预设」回灌，分享闭环）。
 */
export async function presetExport(dshHome: string, body: Record<string, unknown>): Promise<FacadeResult> {
  const name = String(body.name ?? '')
  if (!name) return { status: 400, body: { error: 'name required' } }
  const presetId = await resolvePresetIdByName(dshHome, name, String(body.sessionId ?? ''))
  const hit = presetId ? (await listPresets(dshHome)).find(p => p.id === presetId) : undefined
  if (!hit) return { status: 404, body: { error: `preset not found: ${name}` } }
  const view = buildStPromptView(hit.preset)
  const regexScripts: Array<Record<string, unknown>> = []
  try {
    const parsed = JSON.parse(await readFile(homePath(dshHome, `rp-presets/${hit.id}/regex.json`), 'utf8')) as {
      scripts?: Array<Record<string, unknown>>
    }
    for (const s of Array.isArray(parsed?.scripts) ? parsed.scripts : []) {
      regexScripts.push({
        scriptName: s.scriptName,
        findRegex: s.findRegex,
        replaceString: s.replaceString,
        trimStrings: s.trimStrings,
        placement: s.placement,
        disabled: s.disabled,
        markdownOnly: s.markdownOnly,
        promptOnly: s.promptOnly,
        runOnEdit: s.runOnEdit,
        substituteRegex: s.substituteRegex,
        minDepth: s.minDepth,
        maxDepth: s.maxDepth,
      })
    }
  } catch { /* 无 regex.json = 无内嵌正则 */ }
  return {
    status: 200,
    body: {
      name: hit.displayName,
      json: {
        name: hit.displayName,
        prompts: view.prompts,
        prompt_order: view.prompt_order,
        extensions: { regex_scripts: regexScripts },
      },
    },
  }
}

/**
 * POST /preset/put {name, prompts, prompt_order, create?, sessionId?} → identifier 锚定合并。
 * 不整体覆盖（保住 knowledge/budget/model/sampling/skill 槽），逐 StPrompt 归位：
 * 1. identifier 精确匹配现有 slot.id → 更新 content/enabled/depth/role（marker 槽只动 enabled）；
 * 2. `toggle-<group>-<option>` → 更新 option.content / option.selected(=enabled)；
 * 3. name 字段匹配 marker 槽位也认（ST marker identifier 与我方槽位名不一致时靠 name 对上）；
 * 4. 都没匹配上的非 marker 条目 → 追加新 system 槽（id 去重化）。
 */
export async function presetPut(dshHome: string, body: Record<string, unknown>): Promise<FacadeResult> {
  const name = String(body.name ?? '')
  if (!name) return { status: 400, body: { error: 'name required' } }
  const rawPrompts = Array.isArray(body.prompts) ? body.prompts : null
  if (!rawPrompts) return { status: 400, body: { error: 'prompts array required' } }
  const sessionId = String(body.sessionId ?? '')

  // displayName 匹配找 id（ST 哨兵 'in_use' = 会话当前预设）；找不到且 create=true → emptyPreset 骨架新建；否则 404
  const presetId = await resolvePresetIdByName(dshHome, name, sessionId)
  let preset: RPPreset
  let targetId: string
  if (presetId) {
    targetId = presetId
    preset = (await listPresets(dshHome)).find(p => p.id === presetId)!.preset
  } else if (body.create === true) {
    targetId = slugifyPresetId(name)
    preset = emptyPreset(targetId, name)
  } else {
    return { status: 404, body: { error: `preset not found: ${name}` } }
  }

  // prompt_order → identifier → enabled（取 100001 通用档，缺档取首个；不在表内的条目视为启用）
  const orders = Array.isArray(body.prompt_order) ? body.prompt_order.filter(isTree) : []
  const orderEntry = orders.find(o => o.character_id === 100001 && Array.isArray(o.order))
    ?? orders.find(o => Array.isArray(o.order))
  const enabledById = new Map<string, boolean>()
  if (orderEntry) {
    for (const it of (orderEntry.order as unknown[]).filter(isTree)) {
      if (typeof it.identifier === 'string') enabledById.set(it.identifier, it.enabled !== false)
    }
  }

  const usedIds = new Set(preset.slots.map(s => s.id))
  for (const raw of rawPrompts) {
    if (!isTree(raw)) continue
    const identifier = typeof raw.identifier === 'string' ? raw.identifier : ''
    const pName = typeof raw.name === 'string' ? raw.name : ''
    const content = typeof raw.content === 'string' ? raw.content : ''
    const role = raw.role === 'user' || raw.role === 'assistant' ? raw.role : 'system'
    const enabled = enabledById.get(identifier) ?? true
    const depth = raw.injection_position === 1 && typeof raw.injection_depth === 'number' && Number.isFinite(raw.injection_depth)
      ? raw.injection_depth
      : null

    // 1) identifier 精确匹配现有槽位
    const slot = preset.slots.find(s => s.id === identifier)
    if (slot) {
      slot.enabled = enabled
      if (slot.type !== 'marker') {
        slot.content = content
        slot.role = role
        if (depth != null) slot.depth = depth
        else delete slot.depth
      }
      continue
    }
    // 2) toggle-<group>-<option> 匹配（选一组/多选组统一：selected = ST enabled）
    let toggleHit = false
    for (const g of preset.toggles) {
      for (const o of g.options) {
        if (identifier === `toggle-${g.group}-${o.id}`) {
          o.content = content
          o.selected = enabled
          toggleHit = true
        }
      }
    }
    if (toggleHit) continue
    // 3) name 字段匹配 marker 槽位也认
    const markerSlot = preset.slots.find(s => s.type === 'marker' && s.id === pName)
    if (markerSlot) {
      markerSlot.enabled = enabled
      continue
    }
    // 4) 都没匹配上的非 marker 条目 → 追加新 system 槽（id 去重化；marker 条目无对应槽，跳过）
    if (raw.marker === true) continue
    let base = (pName || identifier || 'prompt').trim().slice(0, 40)
    if (!base) base = 'prompt'
    let id = base
    for (let n = 2; usedIds.has(id); n++) id = `${base}-${n}`
    usedIds.add(id)
    const newSlot: PresetSlot = { id, type: 'system', content, enabled, role }
    if (depth != null) newSlot.depth = depth
    preset.slots.push(newSlot)
  }

  const relPath = `rp-presets/${targetId}/preset.json`
  await snapshotFor(dshHome, sessionId, [relPath])
  await mkdir(dirname(homePath(dshHome, relPath)), { recursive: true })
  await atomicWrite(homePath(dshHome, relPath), JSON.stringify(preset, null, 1), 'utf8')
  console.log(`[dsht-th] preset/put: ${name} → ${targetId}（slots=${preset.slots.length}）`)
  return { status: 200, body: { ok: true, presetId: targetId } }
}

/** POST /preset/delete {name} → 删 rp-presets/<id> 目录 → {ok} */
export async function presetDelete(dshHome: string, body: Record<string, unknown>): Promise<FacadeResult> {
  const name = String(body.name ?? '')
  if (!name) return { status: 400, body: { error: 'name required' } }
  const presetId = await presetIdByName(dshHome, name)
  if (!presetId) return { status: 404, body: { error: `preset not found: ${name}` } }
  const sessionId = String(body.sessionId ?? '')
  await snapshotFor(dshHome, sessionId, [`rp-presets/${presetId}/preset.json`, `rp-presets/${presetId}/regex.json`])
  await rm(join(dshHome, 'rp-presets', presetId), { recursive: true, force: true })
  console.log(`[dsht-th] preset/delete: ${name} → ${presetId}`)
  return { status: 200, body: { ok: true } }
}

/** POST /preset/rename {name, newName} → 改 displayName → {ok} */
export async function presetRename(dshHome: string, body: Record<string, unknown>): Promise<FacadeResult> {
  const name = String(body.name ?? '')
  const newName = String(body.newName ?? '')
  if (!name || !newName) return { status: 400, body: { error: 'name and newName required' } }
  const presetId = await presetIdByName(dshHome, name)
  if (!presetId) return { status: 404, body: { error: `preset not found: ${name}` } }
  const relPath = `rp-presets/${presetId}/preset.json`
  let preset: RPPreset
  try {
    preset = JSON.parse(await readFile(homePath(dshHome, relPath), 'utf8')) as RPPreset
  } catch {
    return { status: 404, body: { error: `preset.json not found: ${presetId}` } }
  }
  preset.displayName = newName
  await snapshotFor(dshHome, String(body.sessionId ?? ''), [relPath])
  await atomicWrite(homePath(dshHome, relPath), JSON.stringify(preset, null, 1), 'utf8')
  console.log(`[dsht-th] preset/rename: ${name} → ${newName}（${presetId}）`)
  return { status: 200, body: { ok: true, presetId } }
}

/**
 * POST /preset/load {sessionId, name} → 解析 id，写 rp/state/<sid>.json 的 presetId（保留其他键）。
 * 历史扁平 MVU 裸树兼容：文件没有任何保留键且非空 = 整树是 variables（MVU 裸树），
 * 包成 { variables: 原树 } 再写 presetId（与 dsh-plugin STATE_RESERVED_KEYS 逻辑对齐）。
 */
export async function presetLoad(dshHome: string, body: Record<string, unknown>): Promise<FacadeResult> {
  const sessionId = String(body.sessionId ?? '')
  const name = String(body.name ?? '')
  if (!sessionId) return { status: 400, body: { error: 'sessionId required' } }
  if (!name) return { status: 400, body: { error: 'name required' } }
  const presetId = await presetIdByName(dshHome, name)
  if (!presetId) return { status: 404, body: { error: `preset not found: ${name}` } }
  const relPath = `rp/state/${sessionId}.json`
  let file: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(await readFile(homePath(dshHome, relPath), 'utf8'))
    if (isTree(parsed)) file = parsed
  } catch { /* 新会话状态文件 */ }
  if (!Object.keys(file).some(k => STATE_RESERVED_KEYS.has(k)) && Object.keys(file).length > 0) {
    file = { variables: file }
  }
  file.presetId = presetId
  await snapshotFor(dshHome, sessionId, [relPath])
  await mkdir(dirname(homePath(dshHome, relPath)), { recursive: true })
  await atomicWrite(homePath(dshHome, relPath), JSON.stringify(file), 'utf8')
  console.log(`[dsht-th] preset/load: ${name} → ${presetId}（sid=${sessionId}）`)
  return { status: 200, body: { ok: true, presetId } }
}

// ---------------------------------------------------------------------------
// 端点 8：POST /chat/messages {sessionId} → 只读聊天记录导出（StMessage[]）
// ---------------------------------------------------------------------------

/** header.cwd → rp 工作区 slug（cwd 在 <dshHome>/rp/ 下时取首段；否则 null） */
function rpSlugFromCwd(dshHome: string, cwd: string | undefined): string | null {
  if (!cwd) return null
  const rel = relative(join(dshHome, 'rp'), resolve(cwd))
  if (!rel || rel.startsWith('..')) return null // 不在 rp/ 下（或就是 rp/ 本身）
  const slug = rel.split(/[\\/]/)[0]
  return slug || null
}

// 【2026-09-07 轮询风暴根修】卡脚本（ExampleGame Logic masterLoop / MVU 心跳）持续轮询
// chat/messages + worldbook/get——旧实现每次调用都全量双遍重扫数 MB 的 session.jsonl
// （模拟器实测单次 4~6.8s、1.5MB payload），把 WebView 6 连接池打满 → 后续 fetch
// "Failed to fetch"（一分钟 114 次）→ 脚本判「前后端没连上」。会话日志在两轮生成之间
// 不变 → 按 (路径, mtimeMs, size) 缓存导出结果，未变化直接回缓存（ST 的 chat 本来
// 也驻内存）。写路径（setChatMessages 等）落盘后 mtime 变化自动失效，无需手动清。
interface FacadeCacheEntry {
  mtimeMs: number
  size: number
  body: { messages: StMessage[] }
}
const chatMessagesCache = new Map<string, FacadeCacheEntry>()
/** scanSessionHeaders 的目录枚举 TTL 缓存（会话目录文件多，每轮全扫 ×N 个轮询脚本） */
let sessionHeadersCache: { at: number; value: Awaited<ReturnType<typeof scanSessionHeaders>> } | null = null
const SESSION_HEADERS_TTL_MS = 3000

async function scanSessionHeadersCached(dshHome: string): Promise<Awaited<ReturnType<typeof scanSessionHeaders>>> {
  const now = Date.now()
  if (sessionHeadersCache !== null && now - sessionHeadersCache.at < SESSION_HEADERS_TTL_MS) return sessionHeadersCache.value
  const value = await scanSessionHeaders(dshHome)
  sessionHeadersCache = { at: now, value }
  return value
}

/**
 * 会话消息 → StMessage[]（只读）：
 * scanSessionHeaders 定位 session.jsonl → readline 流式逐行（大日志不整读），
 * 解析 user/message / assistant/message 事件（data 形状见 session-surgery findLastUserMessage：
 * user = Message 本体，assistant = {turn, step, message}）；快照注入不进导出。
 * 【P3a 2026-09-07】TH 写桥消息：source.thSystem → role:'system'/is_system:true/name:'System'
 * （ST createChatMessages 系统楼层同形）；source.thData → data 字段（卡脚本回读楼层附加数据，
 * 飞讯统合记录靠它定位 is_feixun_record）。thSystem 空文本保留（isHide 隐藏楼层数据仍需回读）；
 * 非 thSystem 空文本跳过。编号与 dsh-plugin /rp/chat/update 的 message_id→seq 映射同构（两处
 * 过滤规则必须一致，改动需同步）。
 */
export async function chatMessages(dshHome: string, body: Record<string, unknown>): Promise<FacadeResult> {
  const sessionId = String(body.sessionId ?? '')
  if (!sessionId) return { status: 400, body: { error: 'sessionId required' } }
  // 【2026-09-08 miss 补扫】头扫描缓存 3s TTL 内新建的会话会在这里 404（缓存投毒）——
  // 卡脚本 openChat 刚建的聊天立刻 getChatMessages 就是这个时序。miss 时绕缓存强制
  // 重扫一次（命中仍走缓存，轮询风暴根修不受影响），重扫结果回填缓存。
  let hit = (await scanSessionHeadersCached(dshHome)).find(h => h.sessionId === sessionId)
  if (!hit) {
    const fresh = await scanSessionHeaders(dshHome)
    sessionHeadersCache = { at: Date.now(), value: fresh }
    hit = fresh.find(h => h.sessionId === sessionId)
  }
  if (!hit) return { status: 404, body: { error: `session not found: ${sessionId}` } }
  const logPath = join(dshHome, 'sessions', hit.project, hit.sdir, 'session.jsonl')
  // 【轮询风暴根修】mtime+size 未变 → 直接回缓存（.stat ~µs 级 vs 全量重扫 ~6s）
  let cached: FacadeCacheEntry | undefined
  try {
    const st = await stat(logPath)
    cached = chatMessagesCache.get(logPath)
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
      return { status: 200, body: cached.body }
    }
  } catch { /* stat 失败按无缓存走 */ }
  // 角色名：header.cwd 指向 rp 工作区时读 rp.json.characterName；取不到回落 'Assistant'
  let charName = 'Assistant'
  const slug = rpSlugFromCwd(dshHome, hit.cwd)
  if (slug) {
    try {
      const rp = JSON.parse(await readFile(homePath(dshHome, `rp/${slug}/rp.json`), 'utf8')) as { characterName?: unknown }
      if (typeof rp?.characterName === 'string' && rp.characterName) charName = rp.characterName
    } catch { /* 无 rp.json 用缺省 */ }
  }
  const messages: StMessage[] = []
  // 第一遍：收集 compaction/prune 遮蔽集（replace 原语——旧事件留日志但不进视图/导出；
  // prune 先于 replacement 落盘但被遮事件更早，单遍会漏遮 → 先全量扫描再导出）
  const shadowed = new Set<number>()
  const rl0 = createInterface({ input: createReadStream(logPath, 'utf8'), crlfDelay: Infinity })
  for await (const line of rl0) {
    const t = line.trim()
    if (!t) continue
    let ev: { type?: unknown; data?: unknown }
    try { ev = JSON.parse(t) } catch { continue }
    if (ev.type !== 'compaction/prune') continue
    const d = ev.data as { shadowedSeqs?: unknown } | undefined
    if (Array.isArray(d?.shadowedSeqs)) for (const q of d.shadowedSeqs) if (typeof q === 'number') shadowed.add(q)
  }
  // 第二遍：导出（跳过被遮蔽事件）
  const rl = createInterface({ input: createReadStream(logPath, 'utf8'), crlfDelay: Infinity })
  for await (const line of rl) {
    const t = line.trim()
    if (!t) continue
    let ev: { type?: unknown; data?: unknown; seq?: unknown }
    try { ev = JSON.parse(t) } catch { continue } // 坏行跳过
    if (typeof ev.seq === 'number' && shadowed.has(ev.seq)) continue
    let role: 'user' | 'assistant' | 'system'
    let msg: unknown
    if (ev.type === 'user/message') { role = 'user'; msg = ev.data }
    else if (ev.type === 'assistant/message') { role = 'assistant'; msg = (ev.data as { message?: unknown } | undefined)?.message }
    else continue
    if (!isTree(msg)) continue
    const source = isTree(msg.source) ? msg.source : null
    if (source?.form === 'snapshot') continue // 快照注入（内部工作过程）不进聊天导出
    const isThSystem = source?.thSystem === true
    if (isThSystem) role = 'system'
    const content = msg.content
    const text = Array.isArray(content)
      ? content.filter(isTree).filter(b => b.type === 'text').map(b => String(b.text ?? '')).join('\n')
      : typeof content === 'string' ? content : ''
    if (!text && !isThSystem) continue // 非 TH 系统楼层的空文本不进导出
    messages.push({
      message_id: messages.length,
      // L1a：携带事件 seq（TH 事件桥的楼层解析锚——客户端节点视图以 seq 定位楼层；
      // P3a setChatMessages 写回同以 seq 定位 replace 目标）
      ...(typeof ev.seq === 'number' ? { seq: ev.seq } : {}),
      name: role === 'user' ? 'User' : role === 'system' ? 'System' : charName,
      role,
      message: text,
      is_system: isThSystem,
      ...(isThSystem && isTree(source?.thData) ? { data: source.thData } : {}),
    })
  }
  // 【轮询风暴根修】写缓存（以导出完成时刻的 stat 为准——写路径落盘后 mtime 变化即失效）
  try {
    const st = await stat(logPath)
    if (chatMessagesCache.size > 4) chatMessagesCache.clear()
    chatMessagesCache.set(logPath, { mtimeMs: st.mtimeMs, size: st.size, body: { messages } })
  } catch { /* stat 失败跳过缓存 */ }
  return { status: 200, body: { messages } }
}

// ---------------------------------------------------------------------------
// 端点 9-10：正则三源合并视图 + 整组替换
// ---------------------------------------------------------------------------

/** 附加 _dshtScope 标记的脚本（脚本写回时按此归位作用域） */
type TaggedScript = Record<string, unknown> & { _dshtScope: 'global' | 'character' | 'preset' }

/** 读 {scripts:[]} 文件，逐条加 _dshtScope 标记（文件缺失/坏 JSON = 空组） */
async function loadTaggedScripts(dshHome: string, relPath: string, scope: TaggedScript['_dshtScope']): Promise<TaggedScript[]> {
  try {
    const parsed = JSON.parse(await readFile(homePath(dshHome, relPath), 'utf8')) as { scripts?: unknown }
    if (!Array.isArray(parsed.scripts)) return []
    return parsed.scripts.filter(isTree).map(s => ({ ...s, _dshtScope: scope }))
  } catch {
    return []
  }
}

/** 读 rp.json 的 regex 键（角色作用域；与 global/preset 的 {scripts:[]} 包裹形态不同），逐条加标记 */
async function loadCharacterRegex(dshHome: string, slug: string): Promise<TaggedScript[]> {
  try {
    const rp = JSON.parse(await readFile(homePath(dshHome, `rp/${slug}/rp.json`), 'utf8')) as { regex?: unknown }
    if (!Array.isArray(rp.regex)) return []
    return rp.regex.filter(isTree).map(s => ({ ...s, _dshtScope: 'character' as const }))
  } catch {
    return []
  }
}

/** POST /regexes/get {slug?, sessionId?} → 三源合并 { regexes, presetId, slug }（global → character → preset） */
export async function regexesGet(dshHome: string, body: Record<string, unknown>): Promise<FacadeResult> {
  const slug = String(body.slug ?? '')
  const sessionId = String(body.sessionId ?? '')
  const regexes: TaggedScript[] = [
    ...(await loadTaggedScripts(dshHome, 'rp/regex/global.json', 'global')),
    ...(slug ? await loadCharacterRegex(dshHome, slug) : []),
  ]
  let presetId: string | null = null
  if (sessionId) {
    presetId = await resolveSessionPresetId(dshHome, sessionId)
    if (presetId) regexes.push(...(await loadTaggedScripts(dshHome, `rp-presets/${presetId}/regex.json`, 'preset')))
  }
  return { status: 200, body: { regexes, presetId, slug: slug || null } }
}

/**
 * POST /regexes/replace {regexes, scope, slug?, sessionId?, presetId?} → 整组替换语义。
 * global → rp/regex/global.json；character → rp/<slug>/rp.json 的 regex 键；
 * preset → rp-presets/<presetId>/regex.json（presetId 缺省时从 sessionId 解析会话有效预设）。
 */
export async function regexesReplace(dshHome: string, body: Record<string, unknown>): Promise<FacadeResult> {
  const scope = String(body.scope ?? '')
  const slug = String(body.slug ?? '')
  const sessionId = String(body.sessionId ?? '')
  if (!Array.isArray(body.regexes)) return { status: 400, body: { error: 'regexes array required' } }
  const scripts = body.regexes.filter(isTree)
  if (scope === 'global') {
    const relPath = 'rp/regex/global.json'
    await snapshotFor(dshHome, sessionId, [relPath])
    await mkdir(dirname(homePath(dshHome, relPath)), { recursive: true })
    await atomicWrite(homePath(dshHome, relPath), JSON.stringify({ scripts }, null, 1), 'utf8')
    console.log(`[dsht-th] regexes/replace global: ${scripts.length}`)
    return { status: 200, body: { ok: true, count: scripts.length } }
  }
  if (scope === 'character') {
    if (!slug) return { status: 400, body: { error: 'slug required for character scope' } }
    const relPath = `rp/${slug}/rp.json`
    let rp: Record<string, unknown>
    try {
      rp = JSON.parse(await readFile(homePath(dshHome, relPath), 'utf8')) as Record<string, unknown>
    } catch {
      return { status: 404, body: { error: `rp.json not found: ${slug}` } }
    }
    rp.regex = scripts
    await snapshotFor(dshHome, sessionId, [relPath])
    await atomicWrite(homePath(dshHome, relPath), JSON.stringify(rp, null, 1), 'utf8')
    console.log(`[dsht-th] regexes/replace character: ${slug} → ${scripts.length}`)
    return { status: 200, body: { ok: true, count: scripts.length } }
  }
  if (scope === 'preset') {
    const presetId = String(body.presetId ?? '') || (sessionId ? await resolveSessionPresetId(dshHome, sessionId) : null)
    if (!presetId) return { status: 400, body: { error: 'presetId required（或提供可解析的 sessionId）' } }
    const dir = join(dshHome, 'rp-presets', presetId)
    try { await readdir(dir) } catch { return { status: 404, body: { error: `预设不存在：${presetId}` } } }
    const relPath = `rp-presets/${presetId}/regex.json`
    await snapshotFor(dshHome, sessionId, [relPath])
    await atomicWrite(join(dir, 'regex.json'), JSON.stringify({ scripts }, null, 1), 'utf8')
    console.log(`[dsht-th] regexes/replace preset: ${presetId} → ${scripts.length}`)
    return { status: 200, body: { ok: true, count: scripts.length } }
  }
  return { status: 400, body: { error: 'scope must be global/character/preset' } }
}

// ---------------------------------------------------------------------------
// 端点 11-13：世界书清单 / 读（ST entry 形状）/ 条目锚定合并
// ---------------------------------------------------------------------------

/** 扫 skills 下 wb-* 目录的 references/lore.json + rp/global-books.json（lorePath 去重） */
export async function worldbookList(dshHome: string, _body: Record<string, unknown>): Promise<FacadeResult> {
  const books: WorldbookListItem[] = []
  const seen = new Set<string>()
  try {
    for (const dir of (await readdir(join(dshHome, 'skills'))).sort()) {
      if (!dir.startsWith('wb-')) continue
      const lorePath = `skills/${dir}/references/lore.json`
      if (seen.has(lorePath)) continue
      try {
        const parsed = JSON.parse(await readFile(homePath(dshHome, lorePath), 'utf8')) as { name?: unknown }
        seen.add(lorePath)
        books.push({ name: typeof parsed?.name === 'string' && parsed.name ? parsed.name : dir, lorePath })
      } catch { /* 无 lore.json 的目录跳过 */ }
    }
  } catch { /* 无 skills 目录 */ }
  try {
    const g = JSON.parse(await readFile(homePath(dshHome, 'rp/global-books.json'), 'utf8')) as { books?: unknown }
    if (Array.isArray(g.books)) {
      for (const b of g.books.filter(isTree)) {
        if (typeof b.lorePath !== 'string' || !b.lorePath || seen.has(b.lorePath)) continue
        seen.add(b.lorePath)
        books.push({ name: typeof b.name === 'string' && b.name ? b.name : b.lorePath, lorePath: b.lorePath })
      }
    }
  } catch { /* 无全局书单 */ }
  return { status: 200, body: { books } }
}

/** 按书名定位 lore.json（$DSH_HOME 相对路径）：目录名或 lore.json 的 name 字段，global-books 按名兜底。
 * 书名 → lorePath 定位缓存（批量 entry-put 每次 locateBook 全盘扫 skills + parse 数个
 * 1MB lore.json 是飞讯批量同步的隐藏大头；命中表按名字记忆，未命中不缓存） */
const locateBookCache = new Map<string, string>()

async function locateBook(dshHome: string, name: string): Promise<string | null> {
  const hit = locateBookCache.get(name)
  if (hit) return hit
  try {
    for (const dir of (await readdir(join(dshHome, 'skills'))).sort()) {
      if (!dir.startsWith('wb-')) continue
      const lorePath = `skills/${dir}/references/lore.json`
      if (dir === name) { locateBookCache.set(name, lorePath); return lorePath }
      try {
        const parsed = JSON.parse(await readFile(homePath(dshHome, lorePath), 'utf8')) as { name?: unknown }
        if (parsed?.name === name) { locateBookCache.set(name, lorePath); return lorePath }
      } catch { /* 坏文件跳过 */ }
    }
  } catch { /* 无 skills 目录 */ }
  try {
    const g = JSON.parse(await readFile(homePath(dshHome, 'rp/global-books.json'), 'utf8')) as { books?: unknown }
    if (Array.isArray(g.books)) {
      for (const b of g.books.filter(isTree)) {
        if (b.name === name && typeof b.lorePath === 'string' && b.lorePath) { locateBookCache.set(name, b.lorePath); return b.lorePath }
      }
    }
  } catch { /* 无全局书单 */ }
  // 【实机审计修复 2026-09-05】P1：会话绑定世界书（getOrCreateChatWorldbook 落点，
  // getWorldbook/getLorebookEntries/replaceLorebookEntries 因此可按名定位会话书）
  try {
    const dir = join(dshHome, 'rp', 'chat-worldbooks')
    for (const f of (await readdir(dir)).sort()) {
      if (!f.endsWith('.json')) continue
      const p = `rp/chat-worldbooks/${f}`
      if (f.replace(/\.json$/, '') === name) { locateBookCache.set(name, p); return p }
      try {
        const parsed = JSON.parse(await readFile(homePath(dshHome, p), 'utf8')) as { name?: unknown }
        if (parsed?.name === name) { locateBookCache.set(name, p); return p }
      } catch { /* 坏文件跳过 */ }
    }
  } catch { /* 无 chat-worldbooks 目录 */ }
  return null
}

/** LoreEntry → ST World Info entry 形状（uid = 数组下标，entry-put 锚定用）。
 * 附带 TH LorebookEntry 别名：name（= comment，卡脚本读 e.name 找 [initvar]/[opening]）、
 * enabled（TH 读面字段）；key/keysecondary 恒为数组（源文件可能缺 keys 字段）。 */
export function loreEntryToSt(entry: LoreEntry, uid: number): Record<string, unknown> {
  return {
    uid,
    comment: entry.comment,
    name: entry.comment,
    enabled: entry.enabled,
    content: entry.content,
    key: entry.keys ?? [],
    keysecondary: entry.secondaryKeys ?? [],
    selectiveLogic: entry.selectiveLogic,
    constant: entry.constant,
    selective: entry.selective,
    position: entry.position,
    depth: entry.depth,
    role: entry.role,
    scanDepth: entry.scanDepth,
    preventRecursion: entry.preventRecursion,
    excludeRecursion: entry.excludeRecursion,
    order: entry.insertionOrder,
    sticky: entry.sticky,
    cooldown: entry.cooldown,
    delay: entry.delay,
    group: entry.group,
    groupOverride: entry.groupOverride,
    disabled: !entry.enabled,
  }
}

/** ST World Info entry → LoreEntry（反转换；字段缺省走 importLoreBook 同款默认）。
 * 【2026-09-07 TH 形态兼容】真 TH getWorldbook 返回的 position 是对象
 * {type:'before_char'|'after_char'|…, depth, order, role}（脚本 {...e} 写回原样带回）——
 * 对象形态反解回 ST 数字；数字形态原样。strategy/use_regex 等 TH 别名字段忽略（不落盘）。 */
const TH_POSITION_TYPE_TO_ST: Record<string, number> = {
  before_char: WI_POSITION.BEFORE,
  after_char: WI_POSITION.AFTER,
  before_authors_note: WI_POSITION.AN_TOP,
  after_authors_note: WI_POSITION.AN_BOTTOM,
  at_depth: WI_POSITION.AT_DEPTH,
  before_example_messages: WI_POSITION.EM_TOP,
  after_example_messages: WI_POSITION.EM_BOTTOM,
}

export function stEntryToLore(st: Record<string, unknown>, bookName: string, id: string): LoreEntry {
  const arr = (v: unknown): string[] =>
    (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]).map(String).filter(k => k !== '')
  const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  // position：数字（ST）或对象（真 TH 形态写回）双形态
  let position = num(st.position, -1)
  if (position === -1 && st.position !== null && typeof st.position === 'object' && !Array.isArray(st.position)) {
    const po = st.position as Record<string, unknown>
    const mapped = typeof po.type === 'string' ? TH_POSITION_TYPE_TO_ST[po.type] : undefined
    position = mapped !== undefined ? mapped : WI_POSITION.BEFORE
  } else if (position === -1) position = WI_POSITION.BEFORE
  const posIsObject = st.position !== null && typeof st.position === 'object' && !Array.isArray(st.position)
  const po = posIsObject ? (st.position as Record<string, unknown>) : null
  return {
    id,
    comment: typeof st.comment === 'string' ? st.comment : '',
    content: typeof st.content === 'string' ? st.content : '',
    keys: arr(st.key ?? st.keys ?? (po ? po.keys ?? (po.strategy as Record<string, unknown> | undefined)?.keys : undefined)),
    secondaryKeys: arr(st.keysecondary ?? st.secondaryKeys ?? (po ? (po.strategy as Record<string, unknown> | undefined)?.secondary_keys : undefined)),
    selectiveLogic: num(st.selectiveLogic ?? (po ? (po.strategy as Record<string, unknown> | undefined)?.selective_logic : undefined), 0),
    constant: st.constant === true || (po ? (po.strategy as Record<string, unknown> | undefined)?.type === 'constant' : false),
    selective: st.selective === true || (po ? (po.strategy as Record<string, unknown> | undefined)?.type === 'selective' : false),
    position,
    depth: num(st.depth ?? (po ? po.depth : undefined), 4),
    role: st.role === 'user' || st.role === 'assistant' ? st.role : (po && (po.role === 'user' || po.role === 'assistant') ? po.role : 'system'),
    scanDepth: typeof st.scanDepth === 'number' && Number.isFinite(st.scanDepth) ? st.scanDepth : null,
    preventRecursion: st.preventRecursion === true,
    excludeRecursion: st.excludeRecursion === true,
    insertionOrder: num(st.order ?? st.insertionOrder ?? (po ? po.order : undefined), 100),
    sticky: num(st.sticky, 0),
    cooldown: num(st.cooldown, 0),
    delay: num(st.delay, 0),
    group: typeof st.group === 'string' ? st.group : '',
    groupOverride: st.groupOverride === true,
    enabled: st.disabled !== true && st.enabled !== false,
    book: bookName,
  }
}

/** POST /worldbook/get {name} → 按 name（目录名或 lore.json 的 name 字段）读 lore.json → ST entry 形状 */
// 【轮询风暴根修】同 chat/messages：按 (lorePath, mtimeMs, size) 缓存 lore.json 解析结果
// （示例游戏内嵌书 970KB，模拟器全量 parse 单次 ~4s；entry-put 落盘后 mtime 变化自动失效）。
interface BookCacheEntry { mtimeMs: number; size: number; book: LoreBook }
const loreBookCache = new Map<string, BookCacheEntry>()

export async function worldbookGet(dshHome: string, body: Record<string, unknown>): Promise<FacadeResult> {
  const name = String(body.name ?? '')
  if (!name) return { status: 400, body: { error: 'name required' } }
  const lorePath = await locateBook(dshHome, name)
  if (!lorePath) return { status: 404, body: { error: `worldbook not found: ${name}` } }
  // read-your-writes：该书有未 flush 的 entry-put 队列 → 先落盘再读
  if (entryPutQueues.has(lorePath)) await flushEntryPuts(dshHome, lorePath)
  const abs = homePath(dshHome, lorePath)
  let book: LoreBook
  try {
    const st = await stat(abs)
    const hit = loreBookCache.get(abs)
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
      book = hit.book
    } else {
      book = JSON.parse(await readFile(abs, 'utf8')) as LoreBook
      if (loreBookCache.size > 8) loreBookCache.clear()
      loreBookCache.set(abs, { mtimeMs: st.mtimeMs, size: st.size, book })
    }
  } catch {
    return { status: 404, body: { error: `lore.json 读取失败: ${lorePath}` } }
  }
  const entries: LoreEntry[] = Array.isArray(book.entries) ? book.entries : []
  return {
    status: 200,
    body: {
      name: typeof book.name === 'string' && book.name ? book.name : name,
      lorePath,
      entries: entries.map((e, i) => loreEntryToSt(e, i)),
      importWarnings: Array.isArray(book.importWarnings) ? book.importWarnings : [],
    },
  }
}

/**
 * POST /worldbook/entry-put {name, entry, sessionId?} → uid 或 comment 锚定合并回 lore.json。
 * uid（= 数组下标）命中 → 原位替换（保留原 id）；uid 越界/新条目 → comment 兜底；都没中 → 追加
 * （新 id = lore-<书名>-<下标>）。ST 形状反转换 LoreEntry（stEntryToLore）。
 *
 * 【2026-09-07 批量写合并】飞讯等脚本的同步机制一次生成前后批量 upsert 数百条
 * （实测 421 条 ×2 遍）——逐条全量读改写 1MB lore.json + 快照把一轮同步拖到分钟级。
 * 写请求进 per-book 内存队列（in-memory 单权威副本顺序应用，uid 语义不变），250ms
 * 空闲合并成一次读改写落盘；GET 前 flush（read-your-writes）。
 */
interface EntryPutQueue {
  book: LoreBook
  puts: Array<{ entry: Record<string, unknown>; sessionId: string }>
  timer: ReturnType<typeof setTimeout> | null
}
const entryPutQueues = new Map<string, EntryPutQueue>()
const ENTRY_PUT_COALESCE_MS = 250

/** 队列 flush（同书一次读改写落盘 + 读缓存预热）；导出：测试断言落盘前必须 flush（250ms 写合并）。
 *  【鲁棒轮 2026-09-09】并发洞修复：原实现先 delete 队列再异步落盘——窗口内新 entry-put
 *  会从磁盘读旧内容建新队列，后续 flush 用「旧盘内容+B」覆盖 → 已确认返回 ok 的 put A
 *  静默丢失；GET 窗口内 has()=false 直读盘 → 旧值（read-your-writes 失效）。
 *  修复：① flush 期间队列保留在 map（新 put 继续应用进同一内存权威副本）；② flush 完成后
 *  若期间又有新 put → 重新定 timer 二次落盘，没有才出队；③ per-book flush 串行链（并发
 *  flush 等前序完成，幂等写不再双写）。 */
const entryPutFlushChains = new Map<string, Promise<void>>()
export async function flushEntryPuts(dshHome: string, lorePath: string): Promise<void> {
  const prev = entryPutFlushChains.get(lorePath) ?? Promise.resolve()
  const run = prev.catch(() => { /* 前序失败不阻塞本次 */ }).then(async () => {
    const q = entryPutQueues.get(lorePath)
    if (!q) return
    if (q.timer !== null) { clearTimeout(q.timer); q.timer = null }
    const sessionId = q.puts[q.puts.length - 1]?.sessionId ?? ''
    q.puts = [] // 本批 puts 已被 q.book 吸收（内存权威），flush 后新增会重新积累
    await snapshotFor(dshHome, sessionId, [lorePath])
    await mkdir(dirname(homePath(dshHome, lorePath)), { recursive: true })
    await atomicWrite(homePath(dshHome, lorePath), JSON.stringify(q.book, null, 1), 'utf8')
    try {
      const st = await stat(homePath(dshHome, lorePath))
      loreBookCache.set(homePath(dshHome, lorePath), { mtimeMs: st.mtimeMs, size: st.size, book: q.book })
    } catch { /* stat 失败跳过预热 */ }
    // flush 窗口内又有新 put → 保留队列 + 重新定 timer（二次落盘携带新增）；否则出队
    if (q.puts.length > 0) {
      if (q.timer === null) q.timer = setTimeout(() => { void flushEntryPuts(dshHome, lorePath).catch(() => {}) }, ENTRY_PUT_COALESCE_MS)
    } else {
      entryPutQueues.delete(lorePath)
    }
    console.log(`[dsht-th] worldbook/entry-put flush: ${lorePath}（共 ${q.book.entries.length} 条）`)
  })
  entryPutFlushChains.set(lorePath, run)
  return run
}

export async function worldbookEntryPut(dshHome: string, body: Record<string, unknown>): Promise<FacadeResult> {
  const name = String(body.name ?? '')
  if (!name) return { status: 400, body: { error: 'name required' } }
  if (!isTree(body.entry)) return { status: 400, body: { error: 'entry object required' } }
  const entry = body.entry
  const lorePath = await locateBook(dshHome, name)
  if (!lorePath) return { status: 404, body: { error: `worldbook not found: ${name}` } }
  // 队列命中 = 在内存权威副本上继续应用（队列内 read-your-writes；uid 语义与直写一致）
  let q = entryPutQueues.get(lorePath)
  if (!q) {
    let book: LoreBook
    try {
      book = JSON.parse(await readFile(homePath(dshHome, lorePath), 'utf8')) as LoreBook
    } catch {
      return { status: 404, body: { error: `lore.json 读取失败: ${lorePath}` } }
    }
    q = { book, puts: [], timer: null }
    entryPutQueues.set(lorePath, q)
  }
  const entries: LoreEntry[] = Array.isArray(q.book.entries) ? q.book.entries : []
  const comment = typeof entry.comment === 'string' ? entry.comment : ''
  // 锚定：uid（数组下标）优先，comment 兜底；都没中 = 新条目追加
  const uidNum = Number(entry.uid)
  const uidOk = Number.isInteger(uidNum) && uidNum >= 0 && uidNum < entries.length
  let idx = uidOk ? uidNum : entries.findIndex(e => comment !== '' && e.comment === comment)
  if (idx >= 0) {
    entries[idx] = stEntryToLore(entry, name, entries[idx].id)
  } else {
    entries.push(stEntryToLore(entry, name, `lore-${name}-${entries.length}`))
    idx = entries.length - 1
  }
  q.book.name = typeof q.book.name === 'string' && q.book.name ? q.book.name : name
  q.book.entries = entries
  q.puts.push({ entry, sessionId: String(body.sessionId ?? '') })
  if (q.timer === null) {
    q.timer = setTimeout(() => { void flushEntryPuts(dshHome, lorePath).catch(() => {}) }, ENTRY_PUT_COALESCE_MS)
  }
  return { status: 200, body: { ok: true, uid: idx, count: entries.length } }
}

// ---------------------------------------------------------------------------
// 端点 14-15：变量深合并写入（insertOrAssignVariables 数据面）+ 变量 schema 注册（C7 收口）
// ---------------------------------------------------------------------------

/** 读 rp/state/<sid>.json（C7 变量收口用；历史扁平 MVU 裸树 = 包成 {variables: 原树}，与 presetLoad 对齐） */
async function loadSessionStateFile(dshHome: string, sessionId: string): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await readFile(homePath(dshHome, `rp/state/${sessionId}.json`), 'utf8'))
    if (!isTree(parsed)) return {}
    if (!Object.keys(parsed).some(k => STATE_RESERVED_KEYS.has(k)) && Object.keys(parsed).length > 0) {
      return { variables: parsed }
    }
    return parsed
  } catch { return {} }
}

/**
 * 端点 14：POST /variables/merge {sessionId, variables} → 变量深合并写入（C7：
 * shim insertOrAssignVariables chat 作用域的服务端语义——incoming 覆盖既有叶值，对象递归）。
 * 整树 variableSchema 存在时先做 D7 最小子集校验（422 {error, issues} 不落盘不记 undo）；
 * 内容变化时写前 undo 日志 + 文件快照（与 /dsht-mvu/variables/register 同款收口）。
 */
export async function variablesMerge(dshHome: string, body: Record<string, unknown>): Promise<FacadeResult> {
  const sessionId = String(body.sessionId ?? '')
  if (!sessionId) return { status: 400, body: { error: 'sessionId required' } }
  if (!isTree(body.variables)) return { status: 400, body: { error: 'variables object required' } }
  const relPath = `rp/state/${sessionId}.json`
  const file = await loadSessionStateFile(dshHome, sessionId)
  const before = isTree(file.variables) ? file.variables : {}
  const merged = deepMergeVars(before, body.variables)
  if (JSON.stringify(before) === JSON.stringify(merged)) {
    return { status: 200, body: { ok: true, variables: merged, unchanged: true } }
  }
  if (file.variableSchema != null) {
    const issues = validateSchemaSubset(merged, file.variableSchema)
    if (issues.length > 0) return { status: 422, body: { error: 'variableSchema 校验失败', issues } }
  }
  await appendUndoEntries(dshHome, sessionId, diffUndoEntries('chat', '', before, merged))
  await snapshotFor(dshHome, sessionId, [relPath])
  await mkdir(dirname(homePath(dshHome, relPath)), { recursive: true })
  await atomicWrite(homePath(dshHome, relPath), JSON.stringify({ ...file, variables: merged }), 'utf8')
  console.log(`[dsht-th] variables/merge: sid=${sessionId}（${Object.keys(body.variables).length} 顶层键）`)
  return { status: 200, body: { ok: true, variables: merged } }
}

/**
 * 端点 15：POST /variables/schema {sessionId, name?, variableSchema} → C7 registerVariableSchema
 * 数据面：zod 风格 schema（shim 侧经 zod v4 toJSONSchema 转换后过桥）落 rp/state 的 variableSchema。
 * name 给出 = 逐名子 schema（合成 {type:'object', properties:{[name]:…}} 并入既有整树 schema，
 * 使 D7 对后续写入自然生效）；name 空 = 整树 schema 直接替换。注册即校验既有值（不匹配 422；
 * 该键尚未写入时不拦——允许先立 schema 后补值）。
 */
export async function variableSchemaRegister(dshHome: string, body: Record<string, unknown>): Promise<FacadeResult> {
  const sessionId = String(body.sessionId ?? '')
  if (!sessionId) return { status: 400, body: { error: 'sessionId required' } }
  if (!isTree(body.variableSchema)) return { status: 400, body: { error: 'variableSchema object required' } }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const relPath = `rp/state/${sessionId}.json`
  const file = await loadSessionStateFile(dshHome, sessionId)
  const vars = isTree(file.variables) ? file.variables : {}
  const target = name ? vars[name] : vars
  if (target !== undefined) {
    const issues = validateSchemaSubset(target, body.variableSchema, name ? `$${name}` : '$')
    if (issues.length > 0) return { status: 422, body: { error: '既有变量与 schema 不匹配', issues } }
  }
  if (name) {
    const base = isTree(file.variableSchema) ? file.variableSchema : {}
    const props = isTree(base.properties) ? { ...(base.properties as Record<string, unknown>) } : {}
    props[name] = body.variableSchema
    file.variableSchema = { ...base, type: typeof base.type === 'string' ? base.type : 'object', properties: props }
  } else {
    file.variableSchema = body.variableSchema
  }
  await snapshotFor(dshHome, sessionId, [relPath])
  await mkdir(dirname(homePath(dshHome, relPath)), { recursive: true })
  await atomicWrite(homePath(dshHome, relPath), JSON.stringify(file), 'utf8')
  console.log(`[dsht-th] variables/schema: sid=${sessionId} ${name || '(整树)'}`)
  return { status: 200, body: { ok: true } }
}

// ---------------------------------------------------------------------------
// 端点 16-19（【实机审计修复 2026-09-05】P1 世界书写面：replaceLorebookEntries /
// rebindGlobalWorldbooks / rebindCharWorldbooks / getOrCreateChatWorldbook 数据面）
// ---------------------------------------------------------------------------

/**
 * 端点 16：POST /worldbook/replace-entries {name, entries, sessionId?} → 世界书条目整表替换
 * （replaceLorebookEntries 数据面）：ST World Info entry 形状数组逐条 stEntryToLore 反转换
 * 后整体覆盖 lore.json 的 entries（与 entry-put 的锚定合并不同——这是整表替换语义）。
 */
export async function worldbookReplaceEntries(dshHome: string, body: Record<string, unknown>): Promise<FacadeResult> {
  const name = String(body.name ?? '')
  if (!name) return { status: 400, body: { error: 'name required' } }
  if (!Array.isArray(body.entries)) return { status: 400, body: { error: 'entries array required' } }
  const lorePath = await locateBook(dshHome, name)
  if (!lorePath) return { status: 404, body: { error: `worldbook not found: ${name}` } }
  let book: LoreBook
  try {
    book = JSON.parse(await readFile(homePath(dshHome, lorePath), 'utf8')) as LoreBook
  } catch {
    return { status: 404, body: { error: `lore.json 读取失败: ${lorePath}` } }
  }
  const entries = body.entries
    .filter(isTree)
    .map((st, i) => stEntryToLore(st, name, typeof st.id === 'string' && st.id ? st.id : `lore-${name}-${i}`))
  book.name = typeof book.name === 'string' && book.name ? book.name : name
  book.entries = entries
  await snapshotFor(dshHome, String(body.sessionId ?? ''), [lorePath])
  await mkdir(dirname(homePath(dshHome, lorePath)), { recursive: true })
  await atomicWrite(homePath(dshHome, lorePath), JSON.stringify(book, null, 1), 'utf8')
  console.log(`[dsht-th] worldbook/replace-entries: ${name} → ${entries.length} 条`)
  return { status: 200, body: { ok: true, count: entries.length } }
}

/** 书名数组 → 定位为 [{name, lorePath}]（任一未定位 = null，调用方回 404） */
async function resolveBookList(dshHome: string, names: string[]): Promise<WorldbookListItem[] | null> {
  const out: WorldbookListItem[] = []
  for (const name of names) {
    const lorePath = await locateBook(dshHome, name)
    if (!lorePath) return null
    out.push({ name, lorePath })
  }
  return out
}

/**
 * 端点 17：POST /worldbook/rebind-global {books: name[], sessionId?} → 全局激活书单整组重绑
 * （rebindGlobalWorldbooks 数据面）：书名逐个定位后整组替换 rp/global-books.json 的 books。
 */
export async function worldbookRebindGlobal(dshHome: string, body: Record<string, unknown>): Promise<FacadeResult> {
  if (!Array.isArray(body.books)) return { status: 400, body: { error: 'books array required' } }
  const names = body.books.map(n => String(n)).filter(n => n !== '')
  const resolved = await resolveBookList(dshHome, names)
  if (resolved === null) return { status: 404, body: { error: `worldbook not found in: [${names.join(', ')}]` } }
  const relPath = 'rp/global-books.json'
  await snapshotFor(dshHome, String(body.sessionId ?? ''), [relPath])
  await mkdir(dirname(homePath(dshHome, relPath)), { recursive: true })
  await atomicWrite(homePath(dshHome, relPath), JSON.stringify({ books: resolved }, null, 1), 'utf8')
  console.log(`[dsht-th] worldbook/rebind-global: [${names.join(', ')}]`)
  return { status: 200, body: { ok: true, count: resolved.length } }
}

/**
 * 端点 18：POST /worldbook/rebind-char {slug, books: name[], sessionId?} → 角色工作区书单整组重绑
 * （rebindCharWorldbooks 数据面）：rp/<slug>/rp.json 的 books 数组整组替换（保留其余键）。
 */
export async function worldbookRebindChar(dshHome: string, body: Record<string, unknown>): Promise<FacadeResult> {
  const slug = String(body.slug ?? '')
  if (!slug) return { status: 400, body: { error: 'slug required' } }
  if (!Array.isArray(body.books)) return { status: 400, body: { error: 'books array required' } }
  const names = body.books.map(n => String(n)).filter(n => n !== '')
  const relPath = `rp/${slug}/rp.json`
  let rp: Record<string, unknown>
  try {
    rp = JSON.parse(await readFile(homePath(dshHome, relPath), 'utf8')) as Record<string, unknown>
  } catch {
    return { status: 404, body: { error: `rp.json not found: ${slug}` } }
  }
  const resolved = await resolveBookList(dshHome, names)
  if (resolved === null) return { status: 404, body: { error: `worldbook not found in: [${names.join(', ')}]` } }
  rp.books = resolved
  await snapshotFor(dshHome, String(body.sessionId ?? ''), [relPath])
  await atomicWrite(homePath(dshHome, relPath), JSON.stringify(rp, null, 1), 'utf8')
  console.log(`[dsht-th] worldbook/rebind-char: ${slug} → [${names.join(', ')}]`)
  return { status: 200, body: { ok: true, count: resolved.length } }
}

/**
 * 端点 19：POST /worldbook/chat-get-or-create {sessionId} → 会话绑定世界书缺则建
 * （getOrCreateChatWorldbook 数据面）：确定性命名 chat-<sessionId>，文件落在
 * rp/chat-worldbooks/<sessionId>.json（LoreBook；locateBook 已扩展按名定位）——
 * 幂等：已存在直接返回 {name, created:false}。
 */
export async function worldbookChatGetOrCreate(dshHome: string, body: Record<string, unknown>): Promise<FacadeResult> {
  const sessionId = String(body.sessionId ?? '')
  if (!sessionId) return { status: 400, body: { error: 'sessionId required' } }
  const name = `chat-${sessionId}`
  const lorePath = `rp/chat-worldbooks/${sessionId}.json`
  try {
    const existing = JSON.parse(await readFile(homePath(dshHome, lorePath), 'utf8')) as LoreBook
    if (isTree(existing)) return { status: 200, body: { name: typeof existing.name === 'string' && existing.name ? existing.name : name, created: false } }
  } catch { /* 不存在 → 创建 */ }
  const book: LoreBook = { name, entries: [], importWarnings: [] }
  await snapshotFor(dshHome, sessionId, [lorePath])
  await mkdir(dirname(homePath(dshHome, lorePath)), { recursive: true })
  await atomicWrite(homePath(dshHome, lorePath), JSON.stringify(book, null, 1), 'utf8')
  console.log(`[dsht-th] worldbook/chat-get-or-create: sid=${sessionId} → ${name}`)
  return { status: 200, body: { name, created: true } }
}

// ---------------------------------------------------------------------------
// 端点 16：generateRaw 真语义装配（ordered_prompts → 最终 prompt；TH generateRaw 数据源）
// 【2026-09-07 根修】旧 shim generateRaw 把 ST 的 ordered_prompts（世界书/人设/角色卡/
// 聊天历史）整体丢弃只发空串——飞讯 safeGenerate 拿到空 prompt 三连败（似其形不明其义）。
// 本装配对照 ST generateRaw/story 字符串语义：段落按 ordered_prompts 顺序拼接。
// ---------------------------------------------------------------------------

/** 世界书激活（ST 简化语义）：enabled +（constant 蓝灯 OR keys 扫描命中）。
 * 扫描文本 = 近段聊天 + user_input；条目 scanDepth 覆盖扫描窗（ST scan_depth 语义）。
 * 返回 before（position=BEFORE）与 after（其余位置）两段，条内按 insertionOrder 降序。 */
export function activateWorldInfo(
  entries: LoreEntry[],
  historyText: string,
  userInput: string,
): { before: string[]; after: string[] } {
  const before: Array<{ order: number; text: string }> = []
  const after: Array<{ order: number; text: string }> = []
  for (const e of entries) {
    if (!e.enabled || !e.content) continue
    if (!e.constant) {
      const windowChars = typeof e.scanDepth === 'number' && e.scanDepth > 0 ? e.scanDepth * 80 : historyText.length
      const hay = historyText.slice(-windowChars) + '\n' + userInput
      const keys = Array.isArray(e.keys) ? e.keys : []
      const hit = keys.some(k => {
        const t = k.trim()
        if (!t) return false
        if (t.startsWith('/') && t.lastIndexOf('/') > 0) {
          try { return new RegExp(t.slice(1, t.lastIndexOf('/')), t.slice(t.lastIndexOf('/') + 1)).test(hay) } catch { return false }
        }
        return hay.toLowerCase().includes(t.toLowerCase())
      })
      if (!hit) continue
    }
    const bucket = e.position === WI_POSITION.BEFORE ? before : after
    bucket.push({ order: e.insertionOrder, text: e.content })
  }
  const texts = (list: Array<{ order: number; text: string }>): string[] =>
    list.sort((a, b) => b.order - a.order).map(x => x.text)
  return { before: texts(before), after: texts(after) }
}

/** 角色主世界书名：rp/<slug>/books/ 第一本（与客户端 fetchPrimaryLorebook 同约定） */
async function primaryCharacterBook(dshHome: string, slug: string): Promise<string | null> {
  if (!slug) return null
  try {
    const dirs = (await readdir(join(dshHome, 'rp', slug, 'books'), { withFileTypes: true }))
      .filter(d => d.isDirectory()).map(d => d.name).sort()
    for (const dir of dirs) {
      try { await stat(homePath(dshHome, `rp/${slug}/books/${dir}/lore.json`)); return dir } catch { continue }
    }
  } catch { /* 无 books 目录 */ }
  return null
}

/** 卡片字段读面（card.json 的 data 包裹或平铺两形态） */
async function loadCardFields(dshHome: string, slug: string): Promise<Record<string, unknown>> {
  if (!slug) return {}
  try {
    const parsed = JSON.parse(await readFile(homePath(dshHome, `rp/${slug}/card.json`), 'utf8')) as unknown
    const root = isTree(parsed) ? parsed : {}
    return isTree(root.data) ? { ...root, ...(root.data as Record<string, unknown>), ...root } as Record<string, unknown> : root
  } catch { return {} }
}

const GEN_RAW_DEFAULT_ORDER = ['world_info_before', 'persona_description', 'char_description', 'char_personality', 'scenario', 'world_info_after', 'dialogue_examples', 'chat_history', 'user_input']

/**
 * generateRaw 装配：ordered_prompts 条目 → 段落文本（ST story string 语义，'\n' 连接）。
 * - 字符串标识符：world_info_before / persona_description / char_description /
 *   char_personality / scenario / world_info_after / dialogue_examples / chat_history /
 *   user_input（未知标识跳过——诚实缺失，不投毒 prompt）
 * - {role, content} 字面块：content 原样
 * - injects [{role?, content, depth?}]：按 depth 插入聊天历史行（depth 从历史尾部计，
 *   0 = 历史末尾；缺省 4，ST injection depth 语义）
 * - max_chat_history：历史条数上限（缺省全量）
 */
export async function assembleGenerateRawPrompt(
  dshHome: string,
  body: Record<string, unknown>,
): Promise<{ system: string; prompt: string; missing: string[] }> {
  const sessionId = String(body.sessionId ?? '')
  const slug = String(body.slug ?? '')
  const userInput = String(body.user_input ?? body.prompt ?? '')
  const ordered = Array.isArray(body.ordered_prompts) ? body.ordered_prompts : GEN_RAW_DEFAULT_ORDER
  const missing: string[] = []

  const [persona, card, primaryBook] = await Promise.all([
    loadActivePersona(dshHome),
    loadCardFields(dshHome, slug),
    primaryCharacterBook(dshHome, slug),
  ])
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  const cardDesc = str(card.description)
  const cardPersonality = str(card.personality)
  const cardScenario = str(card.scenario)
  const cardExamples = str(card.mes_example)

  // 聊天历史（含 TH 系统楼层；dsht 系统行也注入——飞讯扫描注入依赖它的 thData 记录）
  let history: Array<{ name: string; role: string; text: string }> = []
  if (sessionId) {
    try {
      const chat = await chatMessages(dshHome, { sessionId })
      const messages = (chat.body as { messages?: StMessage[] }).messages ?? []
      const maxN = Number(body.max_chat_history)
      const take = Number.isFinite(maxN) && maxN > 0 ? messages.slice(-maxN) : messages
      history = take.map(m => ({ name: m.name, role: m.role, text: m.message }))
    } catch { missing.push('chat_history:session-messages') }
  }
  const historyText = history.map(h => h.text).join('\n')

  // 世界书激活（角色主书 + 全局书）
  let wiBefore: string[] = []
  let wiAfter: string[] = []
  const bookNames: string[] = []
  if (primaryBook) bookNames.push(primaryBook)
  try {
    const g = JSON.parse(await readFile(homePath(dshHome, 'rp/global-books.json'), 'utf8')) as { books?: unknown }
    if (Array.isArray(g.books)) for (const b of g.books.filter(isTree)) if (typeof b.name === 'string' && b.name) bookNames.push(b.name)
  } catch { /* 无全局书单 */ }
  for (const name of bookNames) {
    try {
      const wb = await worldbookGet(dshHome, { name })
      if (wb.status !== 200) continue
      // worldbookGet 返回 ST 形状（key/constant/order...），转回 LoreEntry 激活语义
      const entries = (wb.body as { entries?: Array<Record<string, unknown>> }).entries
      if (!Array.isArray(entries)) continue
      const loreEntries: LoreEntry[] = entries.map(e => ({
        id: String(e.uid ?? ''),
        comment: str(e.comment),
        content: str(e.content),
        keys: Array.isArray(e.key) ? e.key.map(String) : [],
        secondaryKeys: Array.isArray(e.keysecondary) ? e.keysecondary.map(String) : [],
        selectiveLogic: typeof e.selectiveLogic === 'number' ? e.selectiveLogic : 0,
        constant: e.constant === true,
        selective: e.selective === true,
        position: typeof e.position === 'number' ? e.position : WI_POSITION.BEFORE,
        depth: typeof e.depth === 'number' ? e.depth : 4,
        role: (e.role === 'user' || e.role === 'assistant') ? e.role : 'system',
        scanDepth: typeof e.scanDepth === 'number' ? e.scanDepth : null,
        preventRecursion: e.preventRecursion === true,
        excludeRecursion: e.excludeRecursion === true,
        insertionOrder: typeof e.order === 'number' ? e.order : 100,
        sticky: 0, cooldown: 0, delay: 0, group: '', groupOverride: false,
        enabled: e.disabled !== true && e.enabled !== false,
        book: name,
      }))
      const act = activateWorldInfo(loreEntries, historyText, userInput)
      wiBefore.push(...act.before)
      wiAfter.push(...act.after)
    } catch { /* 单书失败不阻塞 */ }
  }

  // injects → 按深度插进历史行
  const historyLines = history.map(h => (h.role === 'system' ? h.text : `${h.name}: ${h.text}`))
  const injects = Array.isArray(body.injects) ? body.injects.filter(isTree) : []
  for (const inj of injects) {
    const content = str(inj.content)
    if (!content) continue
    const depthRaw = Number(inj.depth)
    const depth = Number.isFinite(depthRaw) && depthRaw >= 0 ? Math.round(depthRaw) : 4
    const at = Math.max(0, historyLines.length - depth)
    historyLines.splice(at, 0, content)
  }

  const sections: string[] = []
  for (const item of ordered) {
    if (typeof item === 'string') {
      switch (item) {
        case 'world_info_before': sections.push(wiBefore.join('\n')); break
        case 'persona_description': sections.push(persona?.description ?? ''); break
        case 'char_description': sections.push(cardDesc); break
        case 'char_personality': sections.push(cardPersonality); break
        case 'scenario': sections.push(cardScenario); break
        case 'world_info_after': sections.push(wiAfter.join('\n')); break
        case 'dialogue_examples': sections.push(cardExamples.replace(/<START>\s*/g, '').trim()); break
        case 'chat_history': sections.push('__DSHT_HISTORY__'); break
        case 'user_input': sections.push(userInput); break
        default: missing.push(`ordered:${item}`); break
      }
    } else if (isTree(item)) {
      sections.push(str(item.content))
    }
  }
  // 上下文预算：历史以外的段落固定，历史按剩余预算从尾部截取（保最旧截断标记）。
  // 实测教训：示例游戏卡 328 楼全量历史 ≈ 70 万字符 → 模型拒答/截断（121ch 应答）。
  const capRaw = Number(body.max_context_chars)
  const cap = Number.isFinite(capRaw) && capRaw > 4000 ? capRaw : 48000
  const nonHistory = sections.filter(s => s !== '__DSHT_HISTORY__').map(s => s.trim()).filter(Boolean)
  const fixedLen = nonHistory.join('\n').length + userInput.length + 64
  let historyText2 = historyLines.join('\n')
  if (fixedLen + historyText2.length > cap) {
    const budget = Math.max(2000, cap - fixedLen)
    let acc = 0
    let startIdx = historyLines.length
    for (let i = historyLines.length - 1; i >= 0; i--) {
      acc += historyLines[i].length + 1
      if (acc > budget) break
      startIdx = i
    }
    historyText2 = (startIdx > 0 ? '【更早的对话已省略】\n' : '') + historyLines.slice(startIdx).join('\n')
  }
  const finalSections = sections.map(s => (s === '__DSHT_HISTORY__' ? historyText2 : s))
  return {
    system: str(body.system),
    prompt: finalSections.map(s => s.trim()).filter(Boolean).join('\n'),
    missing,
  }
}
