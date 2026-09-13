/**
 * 真实数据回归：105 本世界书 + 真实复合角色卡全量导入（M1 验收锚点，计划 §6 M1）
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { importLoreBook } from './src/lore/entry.ts'
import { importCharacterPng, summarizeBundle } from './src/import/character-card.ts'

const dataDir = 'D:\\SillyTavern-1.16.0\\SillyTavern（now using）\\SillyTavern-1.16.0\\.Luker-现在在用的版本\\data\\default-user'

// ---- 世界书全量 ----
const worldsDir = path.join(dataDir, 'worlds')
const worldFiles = fs.readdirSync(worldsDir).filter(f => f.endsWith('.json'))
let totalEntries = 0
let bookCount = 0
let warnBooks = 0
let constantCount = 0
let atDepthCount = 0
for (const f of worldFiles) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(worldsDir, f), 'utf-8'))
    const book = importLoreBook(f.replace('.json', ''), raw)
    bookCount++
    totalEntries += book.entries.length
    if (book.importWarnings.length > 0) warnBooks++
    constantCount += book.entries.filter(e => e.constant).length
    atDepthCount += book.entries.filter(e => e.position === 4).length
  } catch (e) {
    console.log(`  [FAIL] ${f}: ${e instanceof Error ? e.message : String(e)}`)
  }
}
console.log(`世界书: ${bookCount}/${worldFiles.length} 本导入成功，共 ${totalEntries} 条目`)
console.log(`  constant 条目: ${constantCount}，atDepth 深度注入: ${atDepthCount}`)
console.log(`  含弃用特性警告的书: ${warnBooks} 本（timed effects/概率/组 → diff 报告）`)

// ---- 复合角色卡（挑最重的 ExampleGame + 示例世界书 + XP大全）----
const charsDir = path.join(dataDir, 'characters')
const targets = ['ExampleGame ExampleWorld MVU Edition 0607.png', '示例世界书与黄昏之歌v4.2.png', 'XP大全.png']
for (const t of targets) {
  const p = path.join(charsDir, t)
  if (!fs.existsSync(p)) { console.log(`  [跳过] ${t} 不存在`); continue }
  const card = importCharacterPng(new Uint8Array(fs.readFileSync(p)), t)
  if (!card) { console.log(`  [FAIL] ${t} 解析失败`); continue }
  const bundle = summarizeBundle(card)
  console.log(`复合卡: ${bundle.manifest.character}`)
  console.log(`  内嵌书: ${bundle.manifest.embeddedBook ? `${bundle.manifest.embeddedBook.name}（${bundle.manifest.embeddedBook.entryCount} 条）` : '无'}`)
  console.log(`  内嵌正则: ${bundle.manifest.embeddedRegexCount} 个；深度提示: ${bundle.manifest.depthPrompt ? '有' : '无'}；外部书引用: ${bundle.manifest.externalWorldRef ?? '无'}`)
}

// ---- 全部角色卡扫描 ----
const pngs = fs.readdirSync(charsDir).filter(f => f.endsWith('.png'))
let ok = 0, fail = 0
for (const f of pngs) {
  const card = importCharacterPng(new Uint8Array(fs.readFileSync(path.join(charsDir, f))), f)
  if (card) ok++; else fail++
}
console.log(`\n角色卡全量: ${ok} 成功 / ${fail} 失败（共 ${pngs.length}）`)
