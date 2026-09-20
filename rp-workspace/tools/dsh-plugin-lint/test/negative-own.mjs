/**
 * negative-own.mjs —— 负控：我方 6 个自研包零误报（host 面必须 pass）
 * ============================================================================
 * 对 publish staging（或 runtime node_modules）的我方包跑 lint：
 *   host 面必须全 pass（它们的加载完整性已被 1806 测试 + M4 核验证明）；
 *   stability 面必须无 N1（我方 client 全走 RPC/契约面——dsht-rp-ui 源码零命中实证）。
 *
 * 用法：node tools/dsh-plugin-lint/test/negative-own.mjs [dir]
 *   dir 缺省 = rp-workspace/dsh-runtime-android/node_modules
 *
 * ## 退出码
 *   0 = 零误报   1 = 有误报
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { lintPackage } from '../lint.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
// 缺省 = publish staging（发布形态，package.json 已重写完整）；runtime node_modules
// 里的构建内部形态是残缺的（无 description/license），不是负控对象
const NM = path.resolve(process.argv[2] ?? path.resolve(HERE, '..', '..', '..', 'tmp', 'publish-staging'))
const OWN = ['dsht-rp-plugin', 'dsht-plugin-mvu', 'dsht-plugin-tavern-helper', 'dsht-plugin-prompt-template', 'dsht-plugin-mobile', 'dsht-plugin-memory']

if (!fs.existsSync(NM)) {
  console.log(`[negative-own] staging 不存在（${NM}）——先跑 node scripts/publish-plugins.mjs 生成`)
  process.exit(1)
}
let bad = 0
for (const name of OWN) {
  const dir = path.join(NM, name)
  if (!fs.existsSync(dir)) { console.log(`SKIP ${name}`); continue }
  const { faces, findings } = lintPackage(dir)
  const hostFail = faces.host !== 'pass'
  const n1 = findings.filter(f => f.rule === 'N1-client-face')
  const ok = !hostFail && n1.length === 0
  if (!ok) bad++
  console.log(`${ok ? '✓' : '✗'} ${name}：host=${faces.host} android=${faces.android} stability=${faces.stability}`)
  if (!ok) for (const f of findings) console.log(`    [${f.rule}] ${f.detail}${f.file ? ' @ ' + f.file : ''}`)
}
if (bad) { console.error(`[negative-own] ✗ ${bad} 包误报`); process.exit(1) }
console.log('[negative-own] ✓ 我方包零误报')
