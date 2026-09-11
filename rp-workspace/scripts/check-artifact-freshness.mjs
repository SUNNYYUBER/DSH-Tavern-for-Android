#!/usr/bin/env node
/**
 * check-artifact-freshness.mjs — 核验产物是否含指定标记（**按产物编码形态解码后比对**）
 * =====================================================================
 * L38 铁律：esbuild 会把中文写成转义序列，用原中文 `includes()` 查产物恒为 false。
 * 实测至少有**两种**转义形态，必须都处理：
 *   ① `\uXXXX`（标准 Unicode 转义）
 *   ② `\<CJK>`（在模板串里给每个中文字符加反斜杠 —— esbuild 的另一种写法）
 * 用法：node check-artifact-freshness.mjs <file> <needle...>
 */
import fs from 'node:fs'
import path from 'node:path'

const [file, ...needles] = process.argv.slice(2)
if (!file || needles.length === 0) {
  console.error('用法: node check-artifact-freshness.mjs <file> <needle...>')
  process.exit(2)
}
if (!fs.existsSync(file)) { console.error(`✗ 文件不存在: ${file}`); process.exit(2) }

const raw = fs.readFileSync(file, 'utf8')
/** 解码产物里的转义形态（两种） + 剥掉给 CJK 加的反斜杠 */
const decoded = raw
  .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/\\([\u4e00-\u9fff\uff00-\uffef\u3000-\u303f])/g, '$1')

let bad = 0
console.log(`文件: ${path.basename(file)}  ${raw.length} B  mtime=${fs.statSync(file).mtime.toISOString()}`)
for (const n of needles) {
  const c = decoded.split(n).length - 1
  if (c === 0) bad++
  console.log(`  ${c > 0 ? '✓' : '✗'} ${JSON.stringify(n.slice(0, 48))} × ${c}`)
}
process.exit(bad ? 1 : 0)
