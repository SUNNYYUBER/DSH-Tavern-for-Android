#!/usr/bin/env node
/**
 * cli.mjs —— dsh-plugin-lint 命令行入口
 * ============================================================================
 * 用法：
 *   dsh-plugin-lint <包目录|包.tgz> [--json]     # lint 一个插件包
 *   dsh-plugin-lint --selftest                    # 仓库内自检（规则↔类型学对账）
 *
 * ## 退出码
 *   0 = pass / info   1 = risk（⚠）   2 = fail（❌）   3 = 用法错误
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { lintPackage } from './lint.mjs'
import { RULES } from './rules.mjs'

const ICON = { fail: '❌', risk: '⚠️ ', info: 'ℹ️ ' }
const VERDICT = { pass: '✅ PASS', risk: '⚠️  RISK', fail: '❌ FAIL' }

function unpackTgz (tgz) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lint-'))
  execFileSync('tar', ['-xzf', tgz, '-C', tmp], { stdio: 'pipe' })
  // npm tgz 解开为 package/
  const inner = path.join(tmp, 'package')
  return fs.existsSync(inner) ? inner : tmp
}

/** 仓库内自检：规则表 typology 编号 ↔ PLUGIN-COMPAT §5.3 编号对账（防两份真相漂移） */
function selftest () {
  const doc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'PLUGIN-COMPAT.md')
  if (!fs.existsSync(doc)) { console.log('[selftest] SKIP：不在仓库内（PLUGIN-COMPAT.md 不可达）'); return 0 }
  const text = fs.readFileSync(doc, 'utf8')
  const anchor = text.search(/^### 5\.3/m)
  if (anchor < 0) { console.error('✗ PLUGIN-COMPAT.md 里找不到「### 5.3」节（文档结构变了？）'); return 2 }
  const sec = text.slice(anchor)
  const docNums = new Set([...sec.matchAll(/[①-⑨]/g)].map(m => m[0]))
  const ruleNums = new Set(RULES.filter(r => r.typology).map(r => r.typology))
  let bad = 0
  for (const n of ruleNums) {
    if (!docNums.has(n)) { console.error(`✗ 规则引用类型学 ${n} 在 PLUGIN-COMPAT §5.3 不存在`); bad++ }
  }
  console.log(bad ? `[selftest] ✗ ${bad} 项漂移` : `[selftest] ✓ 规则表 ↔ 类型学编号对账一致（${[...ruleNums].join('')}）`)
  return bad ? 2 : 0
}

// ---- 主流程 ----
const args = process.argv.slice(2)
if (args.includes('--selftest')) process.exit(selftest())
const target = args.find(a => !a.startsWith('--'))
if (!target) {
  console.error('用法：dsh-plugin-lint <包目录|包.tgz> [--json] | --selftest')
  process.exit(3)
}
const dir = target.endsWith('.tgz') ? unpackTgz(target) : path.resolve(target)
if (!fs.existsSync(dir)) { console.error(`路径不存在：${target}`); process.exit(3) }

const { verdict, faces, findings } = lintPackage(dir)
if (args.includes('--json')) {
  console.log(JSON.stringify({ target, verdict, faces, findings }, null, 2))
} else {
  const name = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name } catch { return path.basename(dir) } })()
  console.log(`\n${VERDICT[verdict]}  ${name}`)
  // 分面：host=装得上/加载不崩 · android=Android 适配预判 · stability=跨版本稳定风险（⑧非契约面）
  console.log(`  host=${faces.host}  android=${faces.android}  stability=${faces.stability}\n`)
  for (const f of findings) {
    const typo = f.typology ? `（类型学 ${f.typology}，见 PLUGIN-COMPAT §5.3）` : ''
    console.log(`  ${ICON[f.severity]} [${f.rule}]${typo} ${f.detail}${f.file ? `  @ ${f.file}` : ''}`)
  }
  if (!findings.length) console.log('  无命中')
  console.log('')
}
process.exit(verdict === 'fail' ? 2 : verdict === 'risk' ? 1 : 0)
