/**
 * DSHTavern 角色卡导入（M1 / T1.15，计划文档 §4.8 + §4.8.1）
 *
 * ST 角色卡 V1/V2/V3 解析：PNG tEXt chunk（char / ccv3 双关键字，base64 JSON）
 * + JSON 文件直读。复合卡拆解：内嵌世界书/正则/深度提示/scope 绑定（§4.8.1）。
 */

import { importLoreBook, type LoreBook, type LoreEntry } from '../lore/entry.ts'
import { importRegexScripts, type RegexScript } from '../regex/engine.ts'

/** 角色卡解析结果（V1 顶层 + V2 data 归一） */
export interface CharacterCard {
  spec: 'chara_card_v1' | 'chara_card_v2' | 'chara_card_v3'
  name: string
  description: string
  personality: string
  scenario: string
  firstMes: string
  alternateGreetings: string[]
  mesExample: string
  creatorNotes: string
  systemPrompt: string
  postHistoryInstructions: string
  tags: string[]
  creator: string
  characterVersion: string
  /** 复合卡拆解产物 */
  embeddedBook: LoreBook | null
  embeddedRegex: RegexScript[]
  depthPrompt: { prompt: string; depth: number; role: 'system' | 'user' | 'assistant' } | null
  /** 外部世界书引用（extensions.world——绑定关系，不复制内容） */
  externalWorldRef: string | null
  importWarnings: string[]
  /** T3.1b 导出对称：导入时的原始 ST JSON 文本（原样保留，无损重打包 tEXt 用） */
  rawJson?: string
  /** T3.1b 导出对称：立绘 PNG 字节（JSON 卡的配对 avatar.png；无则导出时占位兜底） */
  avatar?: Uint8Array
  /** R2：卡来源文件名（去扩展名；chats/<目录名> 与它同名——三键匹配的第二键） */
  sourceFileName?: string
}

// ---------------------------------------------------------------------------
// PNG tEXt chunk 解析（M0 调研时 PowerShell 验证过的算法转译）
// ---------------------------------------------------------------------------

/** 从 PNG 字节流解出 tEXt chunk 的 char/ccv3 关键字数据（base64 → JSON 字符串） */
export function extractCardJsonFromPng(bytes: Uint8Array): string | null {
  // PNG 签名校验
  if (bytes.length < 8) return null
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) return null

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const decoder = new TextDecoder('latin1') // tEXt 关键字与 base64 均为 ASCII
  let pos = 8

  while (pos + 12 <= bytes.length) {
    const length = view.getUint32(pos)
    const type = decoder.decode(bytes.subarray(pos + 4, pos + 8))
    if (type === 'tEXt') {
      const dataStart = pos + 8
      // 找 null 分隔符
      let kwEnd = dataStart
      while (kwEnd < dataStart + length && bytes[kwEnd] !== 0) kwEnd++
      const keyword = decoder.decode(bytes.subarray(dataStart, kwEnd))
      if (keyword === 'char' || keyword === 'ccv3') {
        const textStart = kwEnd + 1
        const b64 = decoder.decode(bytes.subarray(textStart, pos + 8 + length))
        try {
          // base64 → UTF-8 JSON
          const bin = atob(b64.trim())
          const jsonBytes = new Uint8Array(bin.length)
          for (let i = 0; i < bin.length; i++) jsonBytes[i] = bin.charCodeAt(i)
          return new TextDecoder('utf-8').decode(jsonBytes)
        } catch {
          return null
        }
      }
    }
    if (type === 'IEND') break
    pos = pos + 8 + length + 4
  }
  return null
}

// ---------------------------------------------------------------------------
// JSON 归一（V1/V2/V3 → CharacterCard）
// ---------------------------------------------------------------------------

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

/** 解析角色卡 JSON（V1 顶层字段 / V2 data 对象）为归一形态 + 复合卡拆解 */
export function parseCharacterCard(json: string, sourceName: string): CharacterCard | null {
  let root: Record<string, unknown>
  try {
    root = JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
  const warnings: string[] = []

  const data = (root.data && typeof root.data === 'object'
    ? root.data as Record<string, unknown>
    : root) // V1：顶层即数据
  const spec = str(root.spec, data === root ? 'chara_card_v1' : 'chara_card_v2') as CharacterCard['spec']

  // ---- 复合卡拆解（§4.8.1）----
  let embeddedBook: LoreBook | null = null
  const rawBook = data.character_book
  if (rawBook && typeof rawBook === 'object') {
    embeddedBook = importLoreBook(`${str(data.name, sourceName)}::embedded`, rawBook)
    if (embeddedBook.entries.length === 0) embeddedBook = null
  }

  let embeddedRegex: RegexScript[] = []
  const ext = (data.extensions && typeof data.extensions === 'object'
    ? data.extensions as Record<string, unknown>
    : {})
  if (Array.isArray(ext.regex_scripts)) {
    const r = importRegexScripts(ext.regex_scripts)
    embeddedRegex = r.scripts
    warnings.push(...r.warnings)
  }

  let depthPrompt: CharacterCard['depthPrompt'] = null
  const dp = ext.depth_prompt
  if (dp && typeof dp === 'object') {
    const d = dp as Record<string, unknown>
    depthPrompt = {
      prompt: str(d.prompt),
      depth: typeof d.depth === 'number' ? d.depth : 4,
      role: (str(d.role, 'system') as 'system' | 'user' | 'assistant'),
    }
  }

  const externalWorldRef = typeof ext.world === 'string' && ext.world !== '' ? ext.world : null

  return {
    spec,
    name: str(data.name, sourceName),
    description: str(data.description),
    personality: str(data.personality),
    scenario: str(data.scenario),
    firstMes: str(data.first_mes),
    alternateGreetings: Array.isArray(data.alternate_greetings) ? (data.alternate_greetings as string[]) : [],
    mesExample: str(data.mes_example),
    creatorNotes: str(data.creator_notes),
    systemPrompt: str(data.system_prompt),
    postHistoryInstructions: str(data.post_history_instructions),
    tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
    creator: str(data.creator),
    characterVersion: str(data.character_version),
    embeddedBook,
    embeddedRegex,
    depthPrompt,
    externalWorldRef,
    importWarnings: warnings,
    // T3.1b：原样保留解析前的 ST JSON（无损导出；不覆盖调用方已设置的值）
    rawJson: typeof json === 'string' && json.length > 0 ? json : undefined,
  }
}

/** 便捷入口：PNG 字节 → CharacterCard（T3.1b：PNG 自身即立绘，保留为 avatar） */
export function importCharacterPng(bytes: Uint8Array, sourceName: string): CharacterCard | null {
  const json = extractCardJsonFromPng(bytes)
  if (json === null) return null
  const card = parseCharacterCard(json, sourceName)
  if (card) card.avatar = bytes
  return card
}

/** JSON 文件入口（.json 角色卡直读；无立绘——由调用方经 avatar 关联，或导出时占位兜底） */
export function importCharacterJson(json: string, sourceName: string): CharacterCard | null {
  return parseCharacterCard(json, sourceName)
}

// ---------------------------------------------------------------------------
// 卡包（bundle）汇总——§4.8.1 的"拖一张 PNG 拆出一堆"的 diff 预览数据结构
// ---------------------------------------------------------------------------

export interface CardBundle {
  card: CharacterCard
  /** bundle 清单（导入中心 diff 视图直接渲染） */
  manifest: {
    character: string
    embeddedBook: { name: string; entryCount: number } | null
    embeddedRegexCount: number
    depthPrompt: boolean
    externalWorldRef: string | null
  }
}

export function summarizeBundle(card: CharacterCard): CardBundle {
  return {
    card,
    manifest: {
      character: card.name,
      embeddedBook: card.embeddedBook
        ? { name: card.embeddedBook.name, entryCount: card.embeddedBook.entries.length }
        : null,
      embeddedRegexCount: card.embeddedRegex.length,
      depthPrompt: card.depthPrompt !== null,
      externalWorldRef: card.externalWorldRef,
    },
  }
}
