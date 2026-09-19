/**
 * 双语文档结构对账：README.md 与 CONTRIBUTING.md 均为「中文段 + # English 英文段」
 * 单文件双语形态。两段的**结构**必须一致（标题数 / 表格行数 / 列表条目数 / 有序列表数），
 * 否则说明改了一边忘了另一边 —— 漂移即红。
 *
 * 为什么用「结构对账」而不是「逐句对照」：翻译允许措辞自由（英文不是机翻），
 * 但**信息的骨架**必须对齐 —— 多一节、多一行表格、多一条列表，就是单边漏改。
 *
 * 校验项（两边逐项相等）：
 * - `## ` 二级标题数（`# ` 一级标题双语命名不同，不参与对账；`### ` 三级参与）
 * - `### ` 三级标题数
 * - `| ` 开头的表格行数（含表头与分隔行 —— 对账口径一致即可）
 * - `- ` 无序列表条目数
 * - `\d+. ` 有序列表条目数
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..', '..', '..')

function splitBilingual(md: string, file: string): { zh: string; en: string } {
  // 兼容 CRLF/LF（工作区行尾不保证）；捕获组 1 = 标题行本体，英文段从它开始
  const m = /(?:^|\r?\n)(# English\r?\n)/.exec(md)
  if (m === null) throw new Error(`${file} 缺少英文段标记「# English」——双语文档的切分点被破坏了`)
  const enStart = m.index + (m[0].length - m[1].length)
  return { zh: md.slice(0, m.index), en: md.slice(enStart) }
}

interface DocStructure {
  h2: number
  h3: number
  tableRows: number
  bullets: number
  ordered: number
}

function structureOf(section: string): DocStructure {
  const count = (re: RegExp): number => (section.match(re) ?? []).length
  return {
    h2: count(/^## /gm),
    h3: count(/^### /gm),
    tableRows: count(/^\|/gm),
    bullets: count(/^- /gm),
    ordered: count(/^\d+\. /gm),
  }
}

const FILES = ['README.md', 'CONTRIBUTING.md'] as const

describe('双语文档结构对账（中/英骨架必须一致，漂移即红）', () => {
  for (const file of FILES) {
    it(`${file}：中英文段结构逐项相等`, () => {
      const md = readFileSync(join(ROOT, file), 'utf8')
      const { zh, en } = splitBilingual(md, file)
      const a = structureOf(zh)
      const b = structureOf(en)
      for (const key of ['h2', 'h3', 'tableRows', 'bullets', 'ordered'] as const) {
        expect(
          b[key],
          `${file} 的 ${key}：中文段 ${a[key]} vs 英文段 ${b[key]} —— 改了一边忘了另一边？`,
        ).toBe(a[key])
      }
    })
  }

  it('README 顶部与英文段顶部都有语言互链（读者能找到另一边）', () => {
    const md = readFileSync(join(ROOT, 'README.md'), 'utf8')
    const { zh, en } = splitBilingual(md, 'README.md')
    expect(zh).toContain('[English](#english)')
    expect(en).toContain('[中文](#dsh-tavern-for-android)')
  })
})