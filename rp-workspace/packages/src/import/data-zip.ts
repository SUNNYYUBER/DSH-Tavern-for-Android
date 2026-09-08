/**
 * DSHTavern data 整包迁移引擎——浏览器版（计划 §4.16.1 六阶段流水线的 M1 分析层）
 *
 * 输入：ST data 文件夹的 zip 压缩包
 * 阶段 0 预检：解包 + 结构识别（data/<user>/ | data/ | 裸文件）+ 清单
 * 阶段 1 资源入库：worlds/characters/presets/chats 全量解析（引擎复用）
 * 阶段 2 关系重建：卡→书引用配对、globalSelect 全局书单、chats 目录→角色归属
 * 阶段 3 逐项分类：跳过（LLM 层，M2）
 * 阶段 4 聊天分析：chat_metadata 提取（变量/绑定书/persona）
 * 阶段 5 全局设置：world_info_settings / persona / tags
 * 阶段 6 报告：全清单 + 配对率 + 待认领 + 警示
 *
 * M1 测试版范围：只分析不入库（持久化在 M2 接后端）。
 */

import JSZip from 'jszip'
import { importLoreBook, type LoreBook } from '../lore/entry.ts'
import { importCharacterPng, type CharacterCard } from './character-card.ts'

// ---------------------------------------------------------------------------
// 最近一次导入的会话级缓存（分析 → 转换两段式：分析完成缓存 zip + 解析产物，
// 转换阶段懒读 zip 内容流式生成 DSH 文件，避免二次解包 374MB 大包）
// ---------------------------------------------------------------------------

export interface DataImportSession {
  zip: JSZip
  root: string
  worlds: Map<string, LoreBook>
  characters: CharacterCard[]
  /** chats/ 下全部 .jsonl 路径（含角色目录名，转换时懒读） */
  chatFiles: Array<{ path: string; ownerDir: string }>
  report: ZipMigrationReport
}

let _lastImport: DataImportSession | null = null

/** 取最近一次 analyzeDataZip 的会话缓存（页面刷新即失效；转换前调用） */
export function lastDataImport(): DataImportSession | null {
  return _lastImport
}

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** R8：从 settings.json power_user 提取的一个用户 persona */
export interface ImportedPersona {
  name: string
  description: string
  isDefault: boolean
  /** power_user.personas 映射的 avatar 文件名（如 user-default.png） */
  avatar: string | null
}

export interface ZipMigrationReport {
  /** 识别的根路径（如 "data/default-user"） */
  rootPath: string
  /** 各类资源统计 */
  stats: {
    characters: number
    charactersFailed: number
    worldBooks: number
    loreEntries: number
    presets: number
    chats: number
    chatFilesAnalyzed: number
    quickReplies: number
    themes: number
    backgrounds: number
    skippedFiles: number
  }
  /** 关系重建结果 */
  relations: {
    /** 卡→外部书引用，配对成功的 */
    cardWorldPairs: Array<{ card: string; world: string }>
    /** 卡引用了但 zip 里没有的书 */
    cardWorldMissing: Array<{ card: string; world: string }>
    /** chats/ 目录名与角色卡对上的 */
    chatOwnerPairs: Array<{ character: string; chatCount: number }>
    /** 对不上角色的聊天目录（待认领） */
    chatOrphans: Array<{ dir: string; chatCount: number }>
    /** settings.globalSelect 全局启用书 */
    globalSelectedBooks: string[]
    /** 全局启用但 zip 缺失的书 */
    globalSelectedMissing: string[]
    /** 配对率（0-100） */
    pairingRate: number
  }
  /** 全局设置提取 */
  settings: {
    scanDepth: number | null
    budgetPercent: number | null
    caseSensitive: boolean | null
    matchWholeWords: boolean | null
    personaName: string | null
    /** 用户档案描述（§4.4：personaDescription——组装走 persona 槽位） */
    personaDescription: string | null
    /** R8：power_user 三处提取的全部 persona（默认 persona 在首位语义由 isDefault 标记） */
    personas: ImportedPersona[]
  }
  /** 复合卡拆解汇总 */
  compositeCards: Array<{
    name: string
    embeddedBookEntries: number
    embeddedRegexCount: number
    hasDepthPrompt: boolean
    externalWorldRef: string | null
  }>
  /** 警示（弃用特性/解析失败） */
  warnings: string[]
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

/** 路径按 / 规整 */
function norm(p: string): string {
  return p.replace(/\\/g, '/')
}

/** zip 内文件按目录前缀分组（不含子目录递归） */
function listDir(files: string[], dirPrefix: string): string[] {
  const prefix = dirPrefix.endsWith('/') ? dirPrefix : dirPrefix + '/'
  return files.map(norm).filter(f => {
    if (!f.startsWith(prefix) || f.endsWith('/')) return false
    // 仅直接子文件：排除 characters/<名字>/avatar.png 这类子目录内容
    return f.slice(prefix.length).indexOf('/') === -1
  })
}

/**
 * 角色卡文件清单（T2.11 修正：真实 ST 1.12+ 是 characters/<角色名>/character.json
 * 子目录结构，旧 listDir 只扫直接子文件导致整包迁移漏检全部角色卡——0 卡）。
 * 覆盖两种形态：
 * - characters/xxx.json|png（老版直接文件）
 * - characters/<角色名>/character.json|png（新版子目录，固定文件名）
 * 子目录里的 avatar.png 等非卡文件不解析。
 * 统一 norm：Windows 压缩工具（PS Compress-Archive）可能产出反斜杠 zip 条目路径，
 * 不归一化会全部漏检（实测 0 卡 0 书）。
 */
function listCharacterFiles(files: string[], dirPrefix: string): string[] {
  const prefix = dirPrefix.endsWith('/') ? dirPrefix : dirPrefix + '/'
  const out: string[] = []
  for (const raw of files) {
    const f = norm(raw)
    if (!f.startsWith(prefix) || f.endsWith('/')) continue
    const rel = f.slice(prefix.length)
    const lastSeg = rel.split('/').pop() ?? ''
    if (rel.indexOf('/') === -1) {
      if (/\.(png|json)$/i.test(rel)) out.push(f) // 直接文件
    } else if (/^character\.(png|json)$/i.test(lastSeg)) {
      out.push(f) // 新版子目录角色卡：characters/<名>/character.json|png
    }
  }
  return out
}

/** ST 数据根的标志目录/文件（至少命中 2 个才认定为根） */
const ST_MARKERS = ['worlds', 'characters', 'chats', 'settings.json', 'OpenAI Settings', 'QuickReplies']

/**
 * 识别 data 根。支持三种形态（取含 ST 标志最多的最长前缀）：
 * - data/<user>/…（ST 1.12+ 多用户结构，如 data/default-user）
 * - data/…（老版 ST 直接把用户数据放 data 下）
 * - zip 根直接是 ST 内容（裸 worlds/characters/…）
 */
function detectRoot(files: string[]): string {
  const normed = files.map(norm)
  // 候选前缀：zip 根（''）+ 每个文件的 1 段、2 段前缀
  const candidates = new Set<string>([''])
  for (const f of normed) {
    const parts = f.split('/')
    if (parts.length >= 1 && parts[0]) candidates.add(parts[0])
    if (parts.length >= 2) candidates.add(parts.slice(0, 2).join('/'))
  }
  let best = ''
  let bestScore = 0
  for (const c of candidates) {
    const prefix = c === '' ? '' : c + '/'
    const score = ST_MARKERS.filter(m =>
      normed.some(f => f === prefix + m || f.startsWith(prefix + m + '/')),
    ).length
    // ≥2 个标志才认；同分取更长前缀（data/default-user 优先于 data）
    if (score >= 2 && (score > bestScore || (score === bestScore && c.length > best.length))) {
      best = c
      bestScore = score
    }
  }
  return best
}

/**
 * R8：persona 三处读取（真实 ST 实证：persona 在 power_user 下，不在顶层）。
 * - power_user.personas：{avatar文件名: 名字} 映射
 * - power_user.persona_descriptions：{名字: 描述字符串} 或 {名字: {description}}（两种形态兼容）
 * - power_user.default_persona：默认 persona 的 avatar key 或名字（两种形态兼容）
 * 向后兼容：power_user 缺失时回退旧路径（顶层 persona_descriptions[persona_id]）。
 */
export function extractPersonas(sj: Record<string, unknown>): ImportedPersona[] {
  const pu = (sj.power_user && typeof sj.power_user === 'object'
    ? sj.power_user : {}) as Record<string, unknown>
  const avatarToName = (pu.personas && typeof pu.personas === 'object'
    ? pu.personas : {}) as Record<string, unknown>
  const descMap = (pu.persona_descriptions && typeof pu.persona_descriptions === 'object'
    ? pu.persona_descriptions : {}) as Record<string, unknown>

  const descOf = (name: string): string => {
    const d = descMap[name]
    if (typeof d === 'string') return d.trim()
    if (d && typeof d === 'object') {
      const inner = (d as Record<string, unknown>).description
      if (typeof inner === 'string') return inner.trim()
    }
    return ''
  }

  // default_persona：avatar key 或名字两种形态
  let defaultName: string | null = null
  const dp = pu.default_persona
  if (typeof dp === 'string' && dp.trim()) {
    const key = dp.trim()
    const mapped = avatarToName[key]
    defaultName = typeof mapped === 'string' && mapped.trim() ? mapped.trim() : key
  }

  const personas: ImportedPersona[] = []
  const seen = new Set<string>()
  for (const [avatar, raw] of Object.entries(avatarToName)) {
    if (typeof raw !== 'string' || !raw.trim()) continue
    const name = raw.trim()
    if (seen.has(name)) continue
    seen.add(name)
    personas.push({ name, description: descOf(name), isDefault: name === defaultName, avatar })
  }
  // default 指向的 persona 不在 personas 映射里（仅描述存在）也补上
  if (defaultName && !seen.has(defaultName)) {
    personas.push({ name: defaultName, description: descOf(defaultName), isDefault: true, avatar: null })
    seen.add(defaultName)
  }
  // default_persona 缺失但有 persona：取第一个为默认
  if (defaultName === null && personas.length > 0) personas[0].isDefault = true

  // 向后兼容：power_user 无任何 persona 时回退旧路径
  if (personas.length === 0) {
    const topDesc = (sj.persona_descriptions && typeof sj.persona_descriptions === 'object'
      ? sj.persona_descriptions : {}) as Record<string, unknown>
    const legacy = typeof sj.persona_id === 'string' ? topDesc[sj.persona_id] : undefined
    if (legacy && typeof legacy === 'object') {
      const l = legacy as Record<string, unknown>
      const name = typeof l.name === 'string' && l.name.trim() ? l.name.trim() : null
      const desc = typeof l.description === 'string' ? l.description.trim() : ''
      if (name) personas.push({ name, description: desc, isDefault: true, avatar: null })
    }
  }
  return personas
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

/**
 * 分析 data zip（六阶段的浏览器分析版）。
 * @param zipData zip 二进制
 * @param onProgress 进度回调（阶段号 0-6，描述，总进度百分比 0-100）
 */
export async function analyzeDataZip(
  zipData: ArrayBuffer,
  onProgress?: (stage: number, desc: string, percent: number) => void,
): Promise<ZipMigrationReport> {
  const report: ZipMigrationReport = {
    rootPath: '',
    stats: {
      characters: 0, charactersFailed: 0, worldBooks: 0, loreEntries: 0,
      presets: 0, chats: 0, chatFilesAnalyzed: 0, quickReplies: 0,
      themes: 0, backgrounds: 0, skippedFiles: 0,
    },
    relations: {
      cardWorldPairs: [], cardWorldMissing: [], chatOwnerPairs: [],
      chatOrphans: [], globalSelectedBooks: [], globalSelectedMissing: [], pairingRate: 0,
    },
    settings: {
      scanDepth: null, budgetPercent: null, caseSensitive: null,
      matchWholeWords: null, personaName: null, personaDescription: null,
      personas: [],
    },
    compositeCards: [],
    warnings: [],
  }

  // ---- 阶段 0：解包 + 结构识别 ----
  onProgress?.(0, '解包中…')
  const zip = await JSZip.loadAsync(zipData)
  const allFiles = Object.keys(zip.files).filter(f => !zip.files[f].dir)

  report.rootPath = detectRoot(allFiles)
  const root = report.rootPath ? report.rootPath + '/' : ''
  onProgress?.(0, `结构识别：${report.rootPath || '（zip 根）'}，共 ${allFiles.length} 个文件`)

  // 检测 TauriTavern 运行时数据（不在 ST 生态范围，明确跳过并告知）
  const ttCount = allFiles.filter(f => norm(f).startsWith('data/_tauritavern/') || norm(f).startsWith('_tauritavern/')).length
  if (ttCount > 0) {
    report.warnings.push(`检测到 TauriTavern 运行时数据（_tauritavern/，${ttCount} 个文件，含 agent-workspaces/checkpoints）：不属于 ST 生态内容，已跳过（TT 聊天记录迁移在 M2 评估）`)
  }

  // ---- 阶段 1：资源解析 ----
  const worlds = new Map<string, LoreBook>()
  const characters: CharacterCard[] = []

  // norm 后路径 → 原始 zip key（反斜杠 zip 条目的读取映射；找不到则按 norm 本身尝试）
  const zipKey = (n: string): string => Object.keys(zip.files).find(k => norm(k) === n) ?? n

  // 世界书
  const worldFiles = listDir(allFiles, root + 'worlds').filter(f => f.endsWith('.json'))
  for (let i = 0; i < worldFiles.length; i++) {
    const f = worldFiles[i]
    onProgress?.(1, `解析世界书（${i + 1}/${worldFiles.length}）…`, 15 + Math.round((i / Math.max(1, worldFiles.length)) * 30))
    try {
      const text = await zip.files[zipKey(f)].async('string')
      const name = f.split('/').pop()!.replace(/\.json$/, '')
      const book = importLoreBook(name, JSON.parse(text))
      worlds.set(name, book)
      report.stats.worldBooks++
      report.stats.loreEntries += book.entries.length
      for (const w of book.importWarnings.slice(0, 3)) report.warnings.push(`「${name}」${w}`)
    } catch {
      report.stats.skippedFiles++
      report.warnings.push(`世界书解析失败：${f}`)
    }
  }

  // 角色卡（PNG + JSON；T2.11 支持子目录角色卡，见 listCharacterFiles）
  const charFiles = listCharacterFiles(allFiles, root + 'characters')
  // JSON 卡的立绘候选：同目录 avatar.png / <角色名>.png（ST 目录结构常见）
  const avatarCandidates = listDir(allFiles, root + 'characters').filter(f => /\.png$/i.test(f))
  const avatarByDir = new Map<string, string>()
  for (const a of avatarCandidates) {
    const dir = a.split('/').slice(0, -1).join('/')
    if (!avatarByDir.has(dir)) avatarByDir.set(dir, a)
  }
  let charDone = 0
  for (const f of charFiles) {
    if (/\.(png|json)$/i.test(f)) {
      onProgress?.(1, `解析角色卡（${charDone}/${charFiles.filter(x => /\.(png|json)$/i.test(x)).length}）…`, 45 + Math.round((charDone / Math.max(1, charFiles.length)) * 25))
      try {
        let name = f.split('/').pop()!.replace(/\.(png|json)$/i, '')
        // 新版子目录卡（characters/<角色名>/character.png|json）：文件名恒为 character，
        // 来源名取父目录名（chats/<目录名> 与该目录同名）
        if (name.toLowerCase() === 'character') {
          const parent = norm(f).split('/').slice(-2, -1)[0]
          if (parent) name = parent
        }
        let card: CharacterCard | null = null
        if (/\.png$/i.test(f)) {
          const buf = await zip.files[zipKey(f)].async('uint8array')
          card = importCharacterPng(buf, name)
        } else {
          const text = await zip.files[zipKey(f)].async('string')
          card = (await import('./character-card.ts')).importCharacterJson(text, name)
          // T3.1b：JSON 卡配对同目录立绘（avatar.png），导出对称用
          if (card) {
            const dir = norm(f).split('/').slice(0, -1).join('/')
            const avatar = avatarByDir.get(dir)
            if (avatar) {
              try { card.avatar = await zip.files[zipKey(avatar)].async('uint8array') } catch { /* 无立绘跳过 */ }
            }
          }
        }
        if (card) {
          card.sourceFileName = name // R2 三键匹配第二键：卡来源文件名
          characters.push(card)
          report.stats.characters++
          report.compositeCards.push({
            name: card.name,
            embeddedBookEntries: card.embeddedBook?.entries.length ?? 0,
            embeddedRegexCount: card.embeddedRegex.length,
            hasDepthPrompt: card.depthPrompt !== null,
            externalWorldRef: card.externalWorldRef,
          })
        } else {
          report.stats.charactersFailed++
        }
      } catch {
        report.stats.charactersFailed++
      }
      charDone++
    }
  }

  // 预设 / 快捷回复 / 主题 / 背景（计数级）
  report.stats.presets = listDir(allFiles, root + 'OpenAI Settings').filter(f => f.endsWith('.json')).length
  report.stats.quickReplies = listDir(allFiles, root + 'QuickReplies').filter(f => f.endsWith('.json')).length
  report.stats.themes = listDir(allFiles, root + 'themes').filter(f => f.endsWith('.json')).length
  report.stats.backgrounds = listDir(allFiles, root + 'backgrounds').length

  // ---- 阶段 2：关系重建 ----
  onProgress?.(2, '重建交叉引用…', 75)
  // 卡 → 外部书
  for (const card of characters) {
    if (card.externalWorldRef) {
      if (worlds.has(card.externalWorldRef)) {
        report.relations.cardWorldPairs.push({ card: card.name, world: card.externalWorldRef })
      } else {
        report.relations.cardWorldMissing.push({ card: card.name, world: card.externalWorldRef })
      }
    }
  }
  // chats 目录 → 角色
  const chatDirs = new Map<string, number>()
  for (const f of allFiles) {
    const rel = norm(f).startsWith(root) ? norm(f).slice(root.length) : norm(f)
    const m = rel.match(/^chats\/([^/]+)\/.+\.jsonl$/)
    if (m) {
      report.stats.chats++
      chatDirs.set(decodeURIComponent(m[1]), (chatDirs.get(decodeURIComponent(m[1])) ?? 0) + 1)
    }
  }
  // R2 三键匹配：卡内 name / 卡来源文件名 / 归一化 name（去空格、小写）
  const normNameKey = (s: string): string => s.replace(/\s+/g, '').toLowerCase()
  const cardByKey = new Map<string, CharacterCard>()
  for (const c of characters) {
    for (const k of [c.name, c.sourceFileName ?? '', normNameKey(c.name)]) {
      if (k && !cardByKey.has(k)) cardByKey.set(k, c)
    }
  }
  for (const [dir, count] of chatDirs) {
    const hit = cardByKey.get(dir) ?? cardByKey.get(normNameKey(dir))
    if (hit) {
      report.relations.chatOwnerPairs.push({ character: hit.name, chatCount: count })
    } else {
      report.relations.chatOrphans.push({ dir, chatCount: count })
    }
  }

  // ---- 阶段 4：聊天分析（chat_metadata 抽样）----
  let analyzed = 0
  const chatJsonlFiles = allFiles.filter(f => norm(f).startsWith(root + 'chats/') && f.endsWith('.jsonl'))
  for (let i = 0; i < Math.min(50, chatJsonlFiles.length); i++) {
    const f = chatJsonlFiles[i]
    onProgress?.(4, `分析聊天元数据（${i + 1}/${Math.min(50, chatJsonlFiles.length)}）…`, 80 + Math.round((i / Math.max(1, Math.min(50, chatJsonlFiles.length))) * 15))
    try {
      const text = await zip.files[f].async('string')
      const firstLine = text.split('\n')[0]
      const meta = JSON.parse(firstLine)
      if (meta && typeof meta === 'object' && ('user_name' in meta || 'chat_metadata' in meta)) {
        analyzed++
      }
    } catch { /* 跳过坏行 */ }
  }
  report.stats.chatFilesAnalyzed = analyzed

  // ---- 阶段 5：全局设置 ----
  onProgress?.(5, '提取全局设置…', 96)
  const settingsFile = zip.files[zipKey(root + 'settings.json')]
  if (settingsFile) {
    try {
      const text = await settingsFile.async('string')
      // settings.json 可能很大（36MB），只提取关键片段——用宽松 JSON.parse（完整解析在移动端可能慢，接受一次性成本）
      const sj = JSON.parse(text)
      const wi = sj.world_info_settings ?? {}
      report.settings.scanDepth = typeof wi.world_info_depth === 'number' ? wi.world_info_depth : null
      report.settings.budgetPercent = typeof wi.world_info_budget === 'number' ? wi.world_info_budget : null
      report.settings.caseSensitive = typeof wi.world_info_case_sensitive === 'boolean' ? wi.world_info_case_sensitive : null
      report.settings.matchWholeWords = typeof wi.world_info_match_whole_words === 'boolean' ? wi.world_info_match_whole_words : null
      // R8：persona 三处读取（power_user.personas / persona_descriptions / default_persona）
      const personas = extractPersonas(sj)
      report.settings.personas = personas
      const def = personas.find(p => p.isDefault) ?? null
      report.settings.personaName = def?.name ?? null
      report.settings.personaDescription = def?.description || null
      // globalSelect（数组或对象两种形态）
      const gs = wi.world_info?.globalSelect
      const gsNames: string[] = Array.isArray(gs)
        ? gs.map(String)
        : gs && typeof gs === 'object' ? Object.keys(gs) : []
      report.relations.globalSelectedBooks = gsNames
      for (const n of gsNames) if (!worlds.has(n)) report.relations.globalSelectedMissing.push(n)
    } catch {
      report.warnings.push('settings.json 解析失败（可能过大或损坏）')
    }
  }

  // ---- 阶段 6：配对率 + 会话缓存 ----
  onProgress?.(6, '生成报告…', 99)
  const totalRefs = report.relations.cardWorldPairs.length
    + report.relations.cardWorldMissing.length
    + report.relations.globalSelectedBooks.length
  const matched = report.relations.cardWorldPairs.length
    + (report.relations.globalSelectedBooks.length - report.relations.globalSelectedMissing.length)
  report.relations.pairingRate = totalRefs === 0 ? 100 : Math.round((matched / totalRefs) * 100)

  // 会话缓存：分析产物 + zip 实例（懒解压引用，供转换阶段流式读取）
  _lastImport = {
    zip,
    root,
    worlds,
    characters,
    chatFiles: chatJsonlFiles.map(p => {
      const rel = norm(p).startsWith(root) ? norm(p).slice(root.length) : norm(p)
      const ownerDir = decodeURIComponent(rel.split('/')[1] ?? '')
      return { path: p, ownerDir }
    }),
    report,
  }
  onProgress?.(6, '完成', 100)

  return report
}
