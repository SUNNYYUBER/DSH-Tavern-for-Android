import { describe, it, expect } from 'vitest'
import {
  importCharacterJson, importCharacterPng, summarizeBundle,
} from '../src/import/character-card.ts'
import {
  writeCardTextChunks, bytesToBase64, makePlaceholderPng, exportCardBundleFiles,
} from '../src/import/card-export.ts'

// 最小 PNG：手工构造 1x1 白图 + char tEXt chunk（复刻 ST 打包形态）
function makePngWithCard(json: object): Uint8Array {
  const crcTable: number[] = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crcTable[n] = c >>> 0
  }
  const crc32 = (buf: Uint8Array): number => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length)
    const dv = new DataView(out.buffer)
    dv.setUint32(0, data.length)
    out.set(new TextEncoder().encode(type), 4)
    out.set(data, 8)
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
    return out
  }

  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, 1); dv.setUint32(4, 1); ihdr[8] = 8; ihdr[9] = 2 // 1x1 8bit RGB

  // char tEXt：keyword + \0 + base64(json)（UTF-8 安全的 base64 编码，不用已废弃的 unescape）
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json))
  let bin = ''
  for (const b of jsonBytes) bin += String.fromCharCode(b)
  const b64 = btoa(bin)
  const textData = new Uint8Array(5 + b64.length)
  textData.set(new TextEncoder().encode('char'), 0)
  textData[4] = 0
  textData.set(new TextEncoder().encode(b64), 5)

  const iend = new Uint8Array(0)
  // 先组装 chunks 再算总长（避免预分配不足导致 put 越界静默丢失）
  const chunks = [
    chunk('IHDR', ihdr),
    chunk('tEXt', textData),
    chunk('IDAT', new Uint8Array([0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01])), // 占位压缩数据（解析不校验）
    chunk('IEND', iend),
  ]
  const total = sig.length + chunks.reduce((s, c) => s + c.length, 0)
  const png = new Uint8Array(total)
  let pos = 0
  const put = (b: Uint8Array) => { png.set(b, pos); pos += b.length }
  put(sig)
  for (const c of chunks) put(c)
  return png
}

/** 用户真实复合卡形态（ExampleGame 卡的简化结构） */
const complexCard = {
  spec: 'chara_card_v2',
  data: {
    name: 'ExampleGame 测试角色',
    description: '示例游戏世界观的测试角色。',
    personality: '冷静',
    scenario: '今州城',
    first_mes: '你好，旅行者。',
    mes_example: '<START>',
    system_prompt: '按世界观扮演',
    post_history_instructions: '',
    alternate_greetings: ['第二开场白'],
    tags: ['测试'],
    creator: 'tester',
    character_version: '1.0',
    character_book: {
      entries: {
        '0': { comment: '世界观总纲', content: '示例游戏世界的基础设定', key: ['示例游戏'], constant: true },
        '1': { comment: '地点', content: '今州城设定', key: ['今州城'], position: 4, depth: 2 },
      },
    },
    extensions: {
      world: 'ExampleGame World Info MVU 0607',
      depth_prompt: { prompt: '保持世界观一致', depth: 4, role: 'system' },
      regex_scripts: [
        { id: 'r1', scriptName: '显示美化', findRegex: '<status>(.*?)</status>', replaceString: '$1', placement: [2], markdownOnly: true, promptOnly: false },
      ],
    },
  },
}

describe('importCharacterJson', () => {
  it('复合卡全量拆解（§4.8.1：内嵌书/正则/深度提示/外部书引用）', () => {
    const card = importCharacterJson(JSON.stringify(complexCard), 'wuwa.png')!
    expect(card.name).toBe('ExampleGame 测试角色')
    expect(card.embeddedBook).not.toBeNull()
    expect(card.embeddedBook!.entries).toHaveLength(2)
    expect(card.embeddedBook!.entries[0].constant).toBe(true)
    expect(card.embeddedRegex).toHaveLength(1)
    expect(card.embeddedRegex[0].markdownOnly).toBe(true)
    expect(card.depthPrompt).toEqual({ prompt: '保持世界观一致', depth: 4, role: 'system' })
    expect(card.externalWorldRef).toBe('ExampleGame World Info MVU 0607')
    expect(card.alternateGreetings).toEqual(['第二开场白'])
  })

  it('V1 顶层形态', () => {
    const v1 = { name: '旧卡', description: '旧版卡描述', first_mes: 'hi' }
    const card = importCharacterJson(JSON.stringify(v1), 'old.json')!
    expect(card.name).toBe('旧卡')
    expect(card.embeddedBook).toBeNull()
    expect(card.spec).toBe('chara_card_v1')
  })

  it('坏 JSON 返回 null', () => {
    expect(importCharacterJson('{broken', 'x')).toBeNull()
  })
})

describe('importCharacterPng（tEXt chunk 解析）', () => {
  it('char 关键字 base64 JSON 解出', () => {
    const png = makePngWithCard(complexCard)
    const card = importCharacterPng(png, 'card.png')!
    expect(card.name).toBe('ExampleGame 测试角色')
    expect(card.embeddedBook!.entries).toHaveLength(2)
  })
  it('非 PNG 字节返回 null', () => {
    expect(importCharacterPng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), 'x')).toBeNull()
  })
})

describe('summarizeBundle（卡包 diff 预览）', () => {
  it('manifest 汇总复合卡拆解产物', () => {
    const card = importCharacterJson(JSON.stringify(complexCard), 'wuwa.png')!
    const bundle = summarizeBundle(card)
    expect(bundle.manifest.character).toBe('ExampleGame 测试角色')
    expect(bundle.manifest.embeddedBook).toEqual({ name: 'ExampleGame 测试角色::embedded', entryCount: 2 })
    expect(bundle.manifest.embeddedRegexCount).toBe(1)
    expect(bundle.manifest.depthPrompt).toBe(true)
    expect(bundle.manifest.externalWorldRef).toBe('ExampleGame World Info MVU 0607')
  })
})

describe('T3.1b 导出对称（round-trip 无损）', () => {
  it('PNG 卡重打 tEXt 后可无损读回（导入→导出→再导入，rawJson 逐字节一致）', () => {
    const src = makePngWithCard(complexCard) // ST 打包的 PNG 卡
    const card = importCharacterPng(src, 'card.png')!
    expect(card.name).toBe('ExampleGame 测试角色')
    expect(card.rawJson).toBeTruthy() // 导入侧补存原始 JSON

    // 用我们的 writeCardTextChunks 重新打包（以原立绘为底图）→ 应产出合法 PNG 且 tEXt=原始 JSON
    const rePacked = writeCardTextChunks(src, card.rawJson!)
    const card2 = importCharacterPng(rePacked, 're.png')!
    expect(card2.name).toBe('ExampleGame 测试角色')
    // 无损：二次解析的 rawJson 与原卡 JSON 一致（tEXt 载荷逐字节等价）
    expect(card2.rawJson === card.rawJson).toBe(true)

    // base64 可逆（下载/落盘用）
    const b64 = bytesToBase64(rePacked)
    expect(b64.length).toBeGreaterThan(100)
    const back = new Uint8Array(Uint8Array.from(atob(b64), c => c.charCodeAt(0)))
    expect(importCharacterPng(back, 'b64.png')!.name).toBe('ExampleGame 测试角色')
  })

  it('占位 PNG 兜底（无立绘）含图像 chunk 且能承载 tEXt', () => {
    const placeholder = makePlaceholderPng('测试占位')
    expect(placeholder.length).toBeGreaterThan(40)
    // 合法 PNG 签名
    expect(placeholder[0]).toBe(0x89); expect(placeholder[1]).toBe(0x50)
    // 写入卡 JSON 后能被读回
    const png = writeCardTextChunks(placeholder, cardJsonForRoundTrip())
    expect(importCharacterPng(png, 'ph.png')!.name).toBe('占位角色')
  })

  it('卡包目录文件集导出（card.json + avatar.png）', () => {
    const card = importCharacterJson(JSON.stringify(complexCard), 'wuwa.png')!
    card.avatar = makePlaceholderPng(card.name) // 模拟带立绘
    const files = exportCardBundleFiles(card, card.avatar)
    expect(files.find(f => f.path === 'card.json')!.content).toBe(card.rawJson)
    const avatar = files.find(f => f.path === 'avatar.png')!
    expect(avatar.binary).toBe(true)
    expect(avatar.content.length).toBeGreaterThan(40) // 占位 PNG base64 亦非空
  })
})

/** 构造一个带 rawJson 的最小卡 JSON（占位 PNG 往返用） */
function cardJsonForRoundTrip(): string {
  return JSON.stringify({ spec: 'chara_card_v2', data: { name: '占位角色', description: 'd', personality: '', scenario: '', first_mes: 'hi', mes_example: '', creator_notes: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], tags: [], creator: '', character_version: '1.0' } })
}
