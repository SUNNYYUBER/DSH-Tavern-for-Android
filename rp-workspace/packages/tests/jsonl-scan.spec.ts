/**
 * JSONL 边缘扫描（T-70 · 心跳 63D）—— `scanJsonlEdges`
 *
 * 动因：`/rp/sessions-audit` 原实现为了拿一个「行数」，用 `readline` 把会话日志的**全部字节**
 * 逐行字符串化（设备上 81 个会话 / 约 242 MB ⇒ 暖态 6.4 s）。实测根因是 **CPU**（宿主 62.3 MB
 * 逐行 442 ms vs 字节扫描 21 ms，8–21×），不是 I/O（设备裸读 65 MB 仅 65 ms）。
 *
 * 本文件钉住的**唯一判据 = 与旧实现逐字等价** —— 用同一套边界语料，把新实现
 *（`scanJsonlEdges`）与「改造前那条 readline 慢路径」的**参考实现**（`scanJsonlEdgesReference`）
 * 逐字段对拍。等价性不是靠读代码相信，而是可执行的断言。
 *
 * 判据纪律：只比对**输出**（lines / header / lastTime），不检查内部实现（分块大小、慢路径触发）。
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { scanJsonlEdges, scanJsonlEdgesReference } from '../src/dsht-plugin-shared/jsonl-scan.ts'

let dir = ''
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'jsonl-scan-')) })
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

let seq = 0
/** 写入一个语料文件并返回路径 */
async function put(content: string | Buffer, name?: string): Promise<string> {
  const p = join(dir, name ?? `case-${++seq}.jsonl`)
  await writeFile(p, content)
  return p
}

/**
 * 核心判据：新实现与参考实现在该文件上**逐字相同**。
 * 返回新实现的结果供进一步断言（正控：先确认参考实现给出的确实是我们期望的值，
 * 否则「两者相同」可能只是两者都错 —— L44）。
 */
async function expectParity(p: string, expectNonZero = true): Promise<Awaited<ReturnType<typeof scanJsonlEdges>>> {
  const ref = await scanJsonlEdgesReference(p)
  const got = await scanJsonlEdges(p)
  expect(got).toEqual(ref)
  if (expectNonZero) {
    // 正控：语料必须真的被读到了东西，否则「等价」退化成「两个空结果相等」
    expect(ref.lines > 0 || Object.keys(ref.header).length > 0).toBe(true)
  }
  return got
}

const H = JSON.stringify({ parentSession: null, isSeeded: false, origin: 'rp', createdAt: 1700000000000 })
const ev = (time: number, i = 0) => JSON.stringify({ type: 'assistant/message', time, seq: i })

describe('边界语料：新实现 ≡ readline 参考实现', () => {
  it('空文件 ⇒ lines 0 / header {} / lastTime null', async () => {
    const p = await put('')
    const r = await expectParity(p, false)
    expect(r).toEqual({ lines: 0, header: {}, lastTime: null })
  })

  it('只有 header 且**无末换行** ⇒ lines 0（末行不带换行符也要计入）', async () => {
    const p = await put(H)
    const r = await expectParity(p)
    expect(r.lines).toBe(0)
    expect(r.header.origin).toBe('rp')
  })

  it('只有 header 且**带末换行** ⇒ lines 0', async () => {
    const p = await put(H + '\n')
    const r = await expectParity(p)
    expect(r.lines).toBe(0)
  })

  it('header + 3 事件（带末换行）⇒ lines 3 / lastTime 取末行', async () => {
    const p = await put([H, ev(100), ev(200), ev(300)].join('\n') + '\n')
    const r = await expectParity(p)
    expect(r.lines).toBe(3)
    expect(r.lastTime).toBe(300)
  })

  it('header + 2 事件（**无**末换行）⇒ lines 2 / lastTime 取末行', async () => {
    const p = await put([H, ev(100), ev(200)].join('\n'))
    const r = await expectParity(p)
    expect(r.lines).toBe(2)
    expect(r.lastTime).toBe(200)
  })

  it('中间夹空行 ⇒ 空行不计入 lines', async () => {
    const p = await put([H, '', ev(100), '', '', ev(200), ''].join('\n') + '\n')
    const r = await expectParity(p)
    expect(r.lines).toBe(2)
    expect(r.lastTime).toBe(200)
  })

  it('行只含空白（空格/制表）⇒ 视为空行', async () => {
    const p = await put([H, '   ', ev(100), '\t\t', ev(200)].join('\n') + '\n')
    const r = await expectParity(p)
    expect(r.lines).toBe(2)
  })

  it('CRLF：尾部 \\r 被剥离，且与 readline 同值', async () => {
    const p = await put([H, ev(100), ev(200)].join('\r\n') + '\r\n')
    const r = await expectParity(p)
    expect(r.lines).toBe(2)
    expect(r.header.origin).toBe('rp')
    expect(r.lastTime).toBe(200)
  })

  it('🔴 行只含 U+00A0（不换行空格）⇒ 必须判为空行（快速路径会漏，慢路径兜住）', async () => {
    const p = await put([H, '\u00a0', ev(100), '\u3000', ev(200)].join('\n') + '\n')
    const r = await expectParity(p)
    expect(r.lines).toBe(2)                 // 若被快速路径误判为非空，这里会是 4
    expect(r.lastTime).toBe(200)
  })

  it('首行为空行、第二个非空行才是 header ⇒ header 取自第一个**非空**行', async () => {
    const p = await put(['', '  ', H, ev(100)].join('\n') + '\n')
    const r = await expectParity(p)
    expect(r.header.origin).toBe('rp')
    expect(r.lines).toBe(1)
  })

  it('首行是非法 JSON ⇒ header {}（与参考实现同）', async () => {
    const p = await put(['not-json', ev(100)].join('\n') + '\n')
    const r = await expectParity(p)
    expect(r.header).toEqual({})
    expect(r.lines).toBe(1)
    expect(r.lastTime).toBe(100)
  })

  it('末行非法 JSON ⇒ lastTime null', async () => {
    const p = await put([H, ev(100), 'broken{'].join('\n') + '\n')
    const r = await expectParity(p)
    expect(r.lines).toBe(2)
    expect(r.lastTime).toBe(null)
  })

  it('末行 time 为 0 ⇒ Number(0) || null ⇒ null（与参考实现同）', async () => {
    const p = await put([H, ev(100), JSON.stringify({ type: 'x', time: 0 })].join('\n') + '\n')
    const r = await expectParity(p)
    expect(r.lastTime).toBe(null)
  })

  it('末行缺 time 字段 ⇒ null', async () => {
    const p = await put([H, ev(100), JSON.stringify({ type: 'x' })].join('\n') + '\n')
    const r = await expectParity(p)
    expect(r.lastTime).toBe(null)
  })

  it('只有 1 个非空行（= header）⇒ lines 0（下限不为负）', async () => {
    const p = await put([H].join('\n') + '\n')
    const r = await expectParity(p)
    expect(r.lines).toBe(0)
  })
})

describe('跨块（> 1 MiB）与大批量', () => {
  it('单行超过 1 MiB ⇒ 跨块扫描仍与参考实现同值', async () => {
    const big = JSON.stringify({ type: 'assistant/message', time: 42, pad: 'x'.repeat(2 * 1024 * 1024) })
    const p = await put([H, big].join('\n') + '\n')
    const r = await expectParity(p)
    expect(r.lines).toBe(1)
    expect(r.lastTime).toBe(42)
  })

  it('大量行（3000）⇒ lines 精确等于参考实现', async () => {
    const rows = [H]
    for (let i = 0; i < 3000; i++) rows.push(ev(1000 + i, i))
    const p = await put(rows.join('\n') + '\n')
    const r = await expectParity(p)
    expect(r.lines).toBe(3000)
    expect(r.lastTime).toBe(3999)
  })

  it('多个块 + 末行无换行 + 尾部空行 ⇒ 仍与参考实现逐字同', async () => {
    const rows = [H]
    for (let i = 0; i < 1200; i++) rows.push(ev(2000 + i, i).padEnd(100, ' '))
    const p = await put(rows.join('\n') + '\n\n  \n')
    const r = await expectParity(p)
    expect(r.lines).toBe(1200)
    expect(r.lastTime).toBe(3199)
  })
})

describe('防线自检（L44：枚举器自身先过正控）', () => {
  it('参考实现自身在真实语料上给出非空结果（否则「等价」可能只是两者都空）', async () => {
    const p = await put([H, ev(1), ev(2), ev(3)].join('\n') + '\n')
    const ref = await scanJsonlEdgesReference(p)
    expect(ref.lines).toBe(3)
    expect(ref.lastTime).toBe(3)
    expect(ref.header.createdAt).toBe(1700000000000)
  })

  it('负控：故意用不同语料 ⇒ 两者不应「碰巧都相同」到掩盖差异', async () => {
    const a = await put([H, ev(1)].join('\n') + '\n')
    const b = await put([H, ev(1), ev(2)].join('\n') + '\n')
    expect((await scanJsonlEdges(a)).lines).not.toBe((await scanJsonlEdges(b)).lines)
  })
})
