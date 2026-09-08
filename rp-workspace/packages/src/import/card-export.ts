/**
 * DSHTavern 卡包导出对称（M3 / T3.1b，计划文档 §4.8.1 导出对称性）
 *
 * 目标：「进得来 ST 生态，出得去 ST 生态」。导入时把原始 ST JSON 原样存为
 * card.rawJson + 立绘 card.avatar（见 character-card.ts / data-zip.ts），
 * 导出时：
 *  - ST PNG 卡：以立绘（或占位 PNG）为载体，重打 tEXt chunk（char/ccv3 关键字
 *    = base64(原始 ST JSON)），CRC32 重算——ST 1.16 可直接导入，内容无损。
 *  - 原生卡包目录：card.json + worldbook.json + regex.json + depth.txt + avatar.png
 *    的目录形态（本项目原生分享格式）。
 *
 * PNG tEXt 写入是 extractCardJsonFromPng（character-card.ts）的逆向：
 * 在保留图像 chunk（IHDR/IDAT/IEND）的同时，把 keyword=json 的 tEXt chunk
 * 写入/替换到 IEND 之前。ST 读取时扫 tEXt 的 char/ccv3 关键字即可还原。
 */

import type { CharacterCard } from './character-card.ts'
import type { LoreBook } from '../lore/entry.ts'
import type { RegexScript } from '../regex/engine.ts'

// ---------------------------------------------------------------------------
// PNG tEXt chunk 写入（逆向 extractCardJsonFromPng）
// ---------------------------------------------------------------------------

/** CRC32（PNG chunk 校验，标准多项式 0xEDB88320） */
const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8)
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

/** 构造一个 PNG chunk：length(4) + type(4) + data + crc(4) */
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type)
  const out = new Uint8Array(4 + 4 + data.length + 4)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, data.length)
  out.set(typeBytes, 4)
  out.set(data, 8)
  const crcInput = new Uint8Array(4 + data.length)
  crcInput.set(typeBytes, 0)
  crcInput.set(data, 4)
  dv.setUint32(4 + 4 + data.length, crc32(crcInput))
  return out
}

/** tEXt chunk：keyword(可打印 ASCII) + \0 + text */
function pngTextChunk(keyword: string, text: string): Uint8Array {
  const kwBytes = new TextEncoder().encode(keyword)
  const textBytes = new TextEncoder().encode(text)
  const data = new Uint8Array(kwBytes.length + 1 + textBytes.length)
  data.set(kwBytes, 0)
  data[kwBytes.length] = 0
  data.set(textBytes, kwBytes.length + 1)
  return pngChunk('tEXt', data)
}

/**
 * 在 PNG 字节流写入/替换 char(+ccv3) tEXt chunk（ST 卡格式）。
 * 保留所有图像 chunk（IHDR/PLTE/IDAT/IEND），tEXt 插入到 IEND 之前。
 * 若已有同关键字 tEXt（ST 卡自带），先删除旧 chunk 再写新（避免重复）。
 */
export function writeCardTextChunks(png: Uint8Array, jsonText: string): Uint8Array {
  if (png.length < 8) throw new Error('PNG 字节过短（<8），非合法 PNG')
  const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
  for (let i = 0; i < 8; i++) {
    if (png[i] !== sig[i]) throw new Error('PNG 签名不匹配（非合法 PNG）')
  }

  // base64(JSON)：ST 卡 tEXt 的负载是 latin1 兼容的 base64（非原始 JSON）
  const b64 = uint8ToBase64(new TextEncoder().encode(jsonText))

  // 定位 IEND：PNG 以 IEND 收尾（type=49 45 4E 44，data 为空，length=0）。
  // 搜索的是 「length=0 + IEND」 的 8 字节序列，避免依赖逐 chunk 长度推进累积误差。
  let iendPos = -1
  for (let p = png.length - 8; p >= 8; p--) {
    if (png[p] === 0 && png[p + 1] === 0 && png[p + 2] === 0 && png[p + 3] === 0
      && png[p + 4] === 0x49 && png[p + 5] === 0x45 && png[p + 6] === 0x4E && png[p + 7] === 0x44) {
      iendPos = p
      break
    }
  }
  if (iendPos === -1) throw new Error('PNG 无 IEND chunk，无法写入')

  // 在 IEND 前已有的 char/ccv3 tEXt chunk 位置（用于替换，避免导出累积多个旧卡数据）
  const dropOffsets: Array<{ start: number; end: number }> = []
  // 逐 chunk 扫描（只用于剔除旧 tEXt，终点就是 iendPos）
  let pos = 8
  while (pos + 12 <= iendPos) {
    const length = (png[pos] << 24) | (png[pos + 1] << 16) | (png[pos + 2] << 8) | png[pos + 3]
    const type = new TextDecoder('latin1').decode(png.subarray(pos + 4, pos + 8))
    if (type === 'tEXt') {
      const dataStart = pos + 8
      let kwEnd = dataStart
      while (kwEnd < dataStart + length && png[kwEnd] !== 0) kwEnd++
      const keyword = new TextDecoder('latin1').decode(png.subarray(dataStart, kwEnd))
      if (keyword === 'char' || keyword === 'ccv3') {
        dropOffsets.push({ start: pos, end: pos + 12 + length })
      }
    }
    pos += 12 + length
  }

  // 组装：签名 + 非丢弃 chunk（跳过旧 char/ccv3）+ 新 char + 新 ccv3 + IEND
  const out: Uint8Array[] = [png.subarray(0, 8) // 签名
    , png.subarray(8, dropOffsets.length > 0 ? dropOffsets[0].start : iendPos)]
  let cursor = dropOffsets.length > 0 ? dropOffsets[0].end : 8
  for (let i = 0; i < dropOffsets.length; i++) {
    const next = i + 1 < dropOffsets.length ? dropOffsets[i + 1].start : iendPos
    out.push(png.subarray(cursor, next))
    cursor = next
  }
  out.push(pngTextChunk('char', b64))
  out.push(pngTextChunk('ccv3', b64))
  out.push(png.subarray(iendPos)) // IEND 原样追加
  return concatBytes(out)
}

// ---------------------------------------------------------------------------
// 原生卡包目录格式
// ---------------------------------------------------------------------------

/** 导出的一个文件（path 为包内相对路径；content 文本 / base64 二进制） */
export interface ExportCardFile {
  path: string
  content: string
  binary?: boolean
}

/** 立绘 PNG 字节 → base64（供二进制落盘/下载） */
export function bytesToBase64(bytes: Uint8Array): string {
  return uint8ToBase64(bytes)
}

/**
 * 把角色卡拆成原生卡包目录形态（本项目分享格式）：
 * card.json（完整 ST JSON，原样）+ worldbook.json（内嵌书）+ regex.json（内嵌正则）
 * + depth.txt（深度提示）+ avatar.png（立绘，无则占位）。
 * @param card 角色卡（rawJson 为原样 ST JSON；无则用归一结构重建 V2）
 */
export function exportCardBundleFiles(card: CharacterCard, avatar: Uint8Array | null): ExportCardFile[] {
  const files: ExportCardFile[] = []
  // 卡本体：优先原样 rawJson；无则从归一结构重建 ST V2 JSON
  files.push({ path: 'card.json', content: card.rawJson ?? buildStV2Json(card) })
  if (card.embeddedBook && card.embeddedBook.entries.length > 0) {
    files.push({ path: 'worldbook.json', content: loreBookToStWorld(card.embeddedBook) })
  }
  if (card.embeddedRegex.length > 0) {
    files.push({ path: 'regex.json', content: JSON.stringify(card.embeddedRegex, null, 1) })
  }
  if (card.depthPrompt) {
    files.push({ path: 'depth.txt', content: card.depthPrompt.prompt })
  }
  const avatarBytes = avatar ?? makePlaceholderPng(card.name)
  files.push({ path: 'avatar.png', content: bytesToBase64(avatarBytes), binary: true })
  return files
}

// ---------------------------------------------------------------------------
// 归一结构 → ST V2 JSON（rawJson 缺失时兜底；字段语义与 parseCharacterCard 对齐）
// ---------------------------------------------------------------------------

/** 由归一 CharacterCard 重建 ST chara_card_v2 JSON（无损字段覆盖，缺失字段给空串） */
export function buildStV2Json(card: CharacterCard): string {
  const data: Record<string, unknown> = {
    name: card.name,
    description: card.description,
    personality: card.personality,
    scenario: card.scenario,
    first_mes: card.firstMes,
    mes_example: card.mesExample,
    creator_notes: card.creatorNotes,
    system_prompt: card.systemPrompt,
    post_history_instructions: card.postHistoryInstructions,
    alternate_greetings: card.alternateGreetings,
    tags: card.tags,
    creator: card.creator,
    character_version: card.characterVersion,
    extensions: {
      depth_prompt: card.depthPrompt ? { prompt: card.depthPrompt.prompt, depth: card.depthPrompt.depth, role: card.depthPrompt.role } : undefined,
      regex_scripts: card.embeddedRegex.length ? card.embeddedRegex : undefined,
      world: card.externalWorldRef ?? undefined,
    },
  }
  if (card.embeddedBook && card.embeddedBook.entries.length > 0) {
    data.character_book = loreBookToStWorld(card.embeddedBook)
  }
  const root: Record<string, unknown> = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data,
  }
  return JSON.stringify(root, null, 1)
}

/** LoreBook → ST world 对象（character_book 字段；与 importLoreBook 逆向） */
export function loreBookToStWorld(book: LoreBook): Record<string, unknown> {
  return {
    name: book.name,
    scan_depth: 2,
    token_budget: 6000,
    recursive_scanning: false,
    entries: book.entries.map((e, i) => ({
      uid: i,
      key: e.keys.length ? e.keys.join(', ') : (e.constant ? undefined : ''),
      keysecondary: e.secondaryKeys.length ? e.secondaryKeys.join(', ') : undefined,
      comment: e.comment,
      content: e.content,
      constant: e.constant,
      selective: e.selective,
      selectiveLogic: e.selectiveLogic,
      order: e.insertionOrder,
      position: e.position,
      depth: e.depth,
      role: e.role,
      preventRecursion: e.preventRecursion,
      excludeRecursion: e.excludeRecursion,
      disable: !e.enabled,
      probability: 100,
    })),
  }
}

// ---------------------------------------------------------------------------
// 占位 PNG（无立绘时兜底：合法 PNG + 角色名转成的 ASCII art 负载）
// ---------------------------------------------------------------------------

/** 生成一张纯色 + 简单图形的占位 PNG（tEXt 载体用；ST 需图像 chunk） */
export function makePlaceholderPng(name: string): Uint8Array {
  // 1x1 纯色 PNG（最小合法图像，含 IHDR/IDAT/IEND）；tEXt 会由写入层另行追加。
  // 这里生成最简 1x1 像素（RGBA）PNG。PNG 卡的 tEXt 数据与图像解耦，ST 只认图 + tEXt。
  const width = 1
  const height = 1
  const raw = new Uint8Array(1 + height * (1 + width * 4))
  raw[0] = 0 // filter: None
  // RGBA 纯色（深靛蓝，随 RBG 卡主题）
  raw[1] = 44; raw[2] = 62; raw[3] = 96; raw[4] = 255
  const idat = deflateRaw(raw)
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, width)
  dv.setUint32(4, height)
  ihdr[8] = 8  // bit depth
  ihdr[9] = 6  // color type RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace
  const sig = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
  const out: Uint8Array[] = [sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat)]
  out.push(pngChunk('IEND', new Uint8Array(0)))
  return concatBytes(out)
}

/** deflate raw（PNG IDAT 用；无依赖轻量实现） */
function deflateRaw(input: Uint8Array): Uint8Array {
  // 用内置 CompressorStream 不可同步——这里走简化：PNG 允许无压缩块（zlib 未压缩，
  // 合法但不高效；1x1 尺寸无所谓）。构造 zlib 未压缩块：0x78 0x01 头 + stored block。
  const chunks: Uint8Array[] = []
  // zlib 头（CMF=0x78, FLG=0x01 无压缩/快速）
  chunks.push(new Uint8Array([0x78, 0x01]))
  // stored block：BFINAL=1(末块), BTYPE=00 未压缩；LEN+NLEN；数据
  const len = input.length
  const block = new Uint8Array(5 + len)
  block[0] = 1 // final, stored
  block[1] = len & 0xFF
  block[2] = (len >>> 8) & 0xFF
  block[3] = (~len) & 0xFF
  block[4] = ((~len) >>> 8) & 0xFF
  block.set(input, 5)
  chunks.push(block)
  // Adler32
  const adler = adler32(input)
  const tail = new Uint8Array(4)
  new DataView(tail.buffer).setUint32(0, adler)
  chunks.push(tail)
  return concatBytes(chunks)
}

function adler32(data: Uint8Array): number {
  let a = 1
  let b = 0
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function uint8ToBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

function concatBytes(arrays: Uint8Array[]): Uint8Array {
  let total = 0
  for (const a of arrays) total += a.length
  const out = new Uint8Array(total)
  let off = 0
  for (const a of arrays) { out.set(a, off); off += a.length }
  return out
}
