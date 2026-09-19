/**
 * 酒馆助手脚本库 → 会话执行清单——纯逻辑（可单测）。
 *
 * 数据形态（ST 酒馆助手预设/角色脚本库导出，backfill-assets 落盘）：
 *   rp/<slug>/tavern-helper-scripts.json          卡（character）作用域
 *   rp-presets/<presetId>/tavern-helper-scripts.json 预设作用域
 *   { scripts: [ Script | ScriptFolder ] }
 *   Script       = { type:'script', id, name, enabled, content, info?, button:{enabled, buttons:[{name,visible}]}, data }
 *   ScriptFolder = { type:'folder', id, name, enabled, scripts: Script[] }
 *
 * 会话有效预设解析（与 dsh-plugin resolveSessionPresetId 同款语义）：
 *   rp/state/<sid>.json 的 presetId 键（历史扁平 MVU 裸树兼容：无保留键 = 无 presetId）
 *   → 缺省回落最近 rp-import 批次 settings.json 的 oai_settings.preset_settings_openai
 *     按 displayName 匹配 rp-presets（ST 激活预设全局生效语义）。
 */

/** state 文件形状保留键（与 dsh-plugin STATE_RESERVED_KEYS 对齐） */
export const STATE_RESERVED_KEYS = new Set(['presetId', 'state', 'variables', 'variableSchema', 'cursor', 'loreTimed', 'tavern'])

// 【F5 2026-09-14 单源化·补漏】`isTree` 原为本地函数体，与
// `dsht-plugin-shared/deep-merge.ts` 的 `isMergeableObject` **逐字相同**（审计脚本
// 判据 4「不同名但函数体逐字相同」抓到；同包 facade.ts 亦为同名副本）。
// 「可合并对象」判据必须单源——一处收紧另一处不收，即两处对同一数据判得不一样。
import { isMergeableObject as isTree } from '../dsht-plugin-shared/deep-merge.ts'

/** 脚本库条目（原始形态，宽松） */
export interface RawScriptEntry {
  type?: unknown
  id?: unknown
  name?: unknown
  enabled?: unknown
  content?: unknown
  info?: unknown
  button?: unknown
  data?: unknown
  scripts?: unknown // folder
}

/** 归一后的可执行脚本（for-session 响应元素） */
export interface SessionScript {
  id: string
  name: string
  content: string
  /** button.enabled === true */
  buttonEnabled: boolean
  buttons: Array<{ name: string; visible: boolean }>
  /** 脚本私有变量树（script 作用域种子） */
  data: Record<string, unknown>
  source: 'preset' | 'character'
}

/* 【F5 2026-09-14 单源化·补漏】本地 `isTree` 已删：「可合并对象」判据的单源在
 * `dsht-plugin-shared/deep-merge.ts` 的 `isMergeableObject`（见顶部 import 别名）。 */

function normalizeButton(raw: unknown): { enabled: boolean; buttons: Array<{ name: string; visible: boolean }> } {
  if (!isTree(raw)) return { enabled: false, buttons: [] }
  const buttons = Array.isArray(raw.buttons)
    ? raw.buttons
        .filter((b): b is Record<string, unknown> => isTree(b))
        .map(b => ({ name: String(b.name ?? ''), visible: b.visible !== false }))
        .filter(b => b.name.length > 0)
    : []
  return { enabled: raw.enabled === true, buttons }
}

/**
 * 摊平脚本库（folder 递归一层语义；ST 导出只嵌一层 folder）。
 * 仅收 enabled !== false 的脚本（disabled 不执行）；folder disabled = 整组禁用。
 */
export function flattenScriptLibrary(raw: unknown, source: SessionScript['source']): SessionScript[] {
  if (!isTree(raw) || !Array.isArray(raw.scripts)) return []
  const out: SessionScript[] = []
  const walk = (entries: unknown[], folderEnabled: boolean): void => {
    for (const e of entries) {
      if (!isTree(e)) continue
      const entry = e as RawScriptEntry
      if (Array.isArray(entry.scripts)) {
        // folder：自身 disabled 则整组跳过
        walk(entry.scripts, folderEnabled && entry.enabled !== false)
        continue
      }
      if (!folderEnabled || entry.enabled === false) continue
      const id = String(entry.id ?? '')
      if (!id) continue
      const button = normalizeButton(entry.button)
      out.push({
        id,
        name: String(entry.name ?? id),
        content: typeof entry.content === 'string' ? entry.content : '',
        buttonEnabled: button.enabled,
        buttons: button.buttons,
        data: isTree(entry.data) ? entry.data : {},
        source,
      })
    }
  }
  walk(raw.scripts, true)
  return out
}

/**
 * 合并预设 + 卡两作用域（ST 顺序：预设脚本先执行，角色脚本后执行）。
 * id 冲突时后源（character）覆盖前源（preset）——与酒馆助手 id 唯一化语义一致。
 */
export function mergeSessionScripts(presetRaw: unknown, characterRaw: unknown): SessionScript[] {
  const byId = new Map<string, SessionScript>()
  for (const s of flattenScriptLibrary(presetRaw, 'preset')) byId.set(s.id, s)
  for (const s of flattenScriptLibrary(characterRaw, 'character')) byId.set(s.id, s)
  return [...byId.values()]
}

/**
 * 从 rp/state/<sid>.json 文件对象提取 presetId。
 * 历史扁平 MVU 裸树（无保留键）= 无 presetId（整树是 variables，不含会话元信息）。
 */
export function presetIdFromStateFile(file: unknown): string | null {
  if (!isTree(file)) return null
  if (!Object.keys(file).some(k => STATE_RESERVED_KEYS.has(k))) return null
  const pid = file.presetId
  return typeof pid === 'string' && pid ? pid : null
}

/**
 * 批次 settings.json → ST 激活预设名（oai_settings.preset_settings_openai）。
 * 返回 null = 该批次无有效激活预设名。
 */
export function activePresetNameFromSettings(raw: unknown): string | null {
  if (!isTree(raw)) return null
  const oai = raw.oai_settings
  if (!isTree(oai)) return null
  const name = oai.preset_settings_openai
  return typeof name === 'string' && name.trim() ? name.trim() : null
}

/** rp-presets 清单（{id, displayName}）按 ST 激活预设名匹配 → presetId（null = 未匹配） */
export function matchPresetByDisplayName(
  presets: Array<{ id: string; displayName?: unknown }>,
  activeName: string | null,
): string | null {
  if (!activeName) return null
  for (const p of [...presets].sort((a, b) => a.id.localeCompare(b.id))) {
    if (p.displayName === activeName) return p.id
  }
  return null
}

/** lodash 风格变量路径（a.b[0].c / a["b"]）→ JSONPointer（/a/b/0/c） */
export function lodashPathToPointer(path: string): string {
  if (path.startsWith('/')) return path // 已是 JSONPointer
  const segs: string[] = []
  const re = /[^.[\]]+|\[(\d+|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\]/g
  for (const m of path.matchAll(re)) {
    let seg = m[0]
    if (seg.startsWith('[')) {
      seg = seg.slice(1, -1)
      if ((seg.startsWith('"') && seg.endsWith('"')) || (seg.startsWith("'") && seg.endsWith("'"))) {
        seg = seg.slice(1, -1)
      }
    }
    if (seg) segs.push(seg.replace(/~/g, '~0').replace(/\//g, '~1'))
  }
  return '/' + segs.join('/')
}
