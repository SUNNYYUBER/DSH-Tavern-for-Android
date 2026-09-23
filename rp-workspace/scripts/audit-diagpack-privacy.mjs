#!/usr/bin/env node
/**
 * 诊断包隐私不变量审计（DiagPack 不得采集用户内容）
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么需要这条判据
 * ─────────────────────────────────────────────────────────────────────────
 * `DiagPack` 的目的恰恰是「把用户设备上的事实交出去」——
 * 这是一个**天生与隐私对立**的功能。它现在是对的（白名单收集、凭据整行丢弃、
 * 会话正文一律不读），但**没有任何机器守着它**。
 *
 * 这类功能的腐化路径非常具体、也非常常见：
 *   「这次排查需要看看会话里到底发生了什么」⇒ 顺手加一行读 session.jsonl
 *   ⇒ 从此每个报 bug 的用户都在不知情中交出自己的 RP 正文。
 *
 * 由于本项目的 bug 有相当比例只在**别人的设备**上复现，这个功能会被频繁使用，
 * 上述诱惑是真实存在的。⇒ 用判据把它钉住（同 `audit-native-deps.mjs` 的动机：
 * **把一次性结论固化成常驻门禁**，而不是「下次注意」）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 判据（四条，全部是「不许做什么」——白名单式，可证伪）
 * ─────────────────────────────────────────────────────────────────────────
 *   ① **不得读会话数据**：源码里不得出现 `sessions` / `session.jsonl` /
 *      `chat` 之类的目录或文件读取（会话正文是我们承诺永不采集的那一类）。
 *   ② **不得采集凭据**：不得出现 `credentials` / `token` 的**读取**（
 *      注意：`DROP_PATTERNS` 里出现这些词是**拒绝名单**，是允许且必需的，
 *      故判据只针对「读取动作」，用 `File(` / `readText` / `readBytes` 邻接判定）。
 *   ③ **必须保留整行丢弃语义**：`sanitizeLine` 返回 null 的分支必须存在
 *      —— 若被改成「部分替换」，残片泄露 + 假证据（见该函数注释）。
 *   ④ **必须保留过滤计数**：`droppedLines` 必须同时被写入报告与 UI，
 *      否则「丢了多少行」对用户不可见 ⇒ 无法判断诊断包是否可信。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 用法
 * ─────────────────────────────────────────────────────────────────────────
 *   node scripts/audit-diagpack-privacy.mjs
 *   node scripts/audit-diagpack-privacy.mjs --selftest
 *
 * 退出码
 *   0 = 通过
 *   1 = 锚点缺失（DiagPack.kt 不在 —— fail-closed，不静默放过）
 *   2 = 违反隐私不变量
 *   3 = selftest 失败
 */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const TARGET = join(ROOT, 'android/app/src/main/java/com/dshtavern/app/DiagPack.kt')
const MAIN = join(ROOT, 'android/app/src/main/java/com/dshtavern/app/MainActivity.kt')

/** 会话/内容类目录与文件（DiagPack 一律不得读取）。 */
const FORBIDDEN_READS = [
  { re: /File\s*\([^)]*["'][^"']*sessions?[^"']*["']/i, what: '读取 sessions 目录' },
  { re: /File\s*\([^)]*["'][^"']*session\.jsonl["']/i, what: '读取 session.jsonl' },
  { re: /File\s*\([^)]*["'][^"']*credentials[^"']*["']/i, what: '读取凭据文件' },
  { re: /File\s*\([^)]*["'][^"']*dsht-token[^"']*["']/i, what: '读取 token 文件' },
  { re: /File\s*\([^)]*["'][^"']*(worldbook|character|cards?|lore)[^"']*["']/i, what: '读取卡/世界书数据' },
]

function audit(src) {
  const violations = []

  // 判据 ① / ②：不得读取会话、凭据、卡与世界书数据
  for (const { re, what } of FORBIDDEN_READS) {
    if (re.test(src)) violations.push(`不得${what}（DiagPack 只做白名单事实收集）`)
  }

  // 判据 ③：必须保留「整行丢弃」语义（sanitizeLine 返回 null）
  if (!/private\s+fun\s+sanitizeLine[\s\S]{0,600}?return\s+null/.test(src)) {
    violations.push('sanitizeLine 必须保留「命中即返回 null（整行丢弃）」的分支——部分替换会留残片并制造假证据')
  }

  // 判据 ④：过滤计数必须存在
  if (!/droppedLines/.test(src)) {
    violations.push('必须保留 droppedLines（让用户看到「丢了多少行」，否则诊断包不可信）')
  }

  return violations
}

function selftest() {
  const src = existsSync(TARGET) ? readFileSync(TARGET, 'utf8') : ''
  if (!src) {
    console.error('[selftest] DiagPack.kt 不可读 —— 判据自身无法自证')
    process.exit(3)
  }
  let pass = 0
  let fail = 0
  const t = (name, cond) => { if (cond) { pass++ } else { fail++; console.error(`  ✗ ${name}`) } }

  // 零控：真实源码必须通过（否则判据在真实对象上就是假红）
  t('零控：真实 DiagPack 通过全部判据', audit(src).length === 0)

  // 正控：注入违规必须被抓到（每条判据都要能被证伪）
  t('正控①：注入读 sessions ⇒ 报红',
    audit(src + '\nval f = File(ctx.filesDir, "sessions/x/session.jsonl")').length > 0)
  t('正控②：注入读凭据 ⇒ 报红',
    audit(src + '\nval c = File(ctx.filesDir, ".credentials.yaml")').length > 0)
  // 正控③：把「命中即 return null」改成「返回替换后的行」⇒ 判据③必须报红
  t('正控③：去掉整行丢弃语义 ⇒ 报红',
    audit(src.replace('if (p.containsMatchIn(line)) return null', 'if (p.containsMatchIn(line)) return "***"')).length > 0)
  t('负控④：移除 droppedLines 计数 ⇒ 报红',
    audit(src.replace(/droppedLines/g, 'ignoredCount')).length > 0)

  // 负控：DROP_PATTERNS 里的**拒绝名单**（字符串字面量）不算「读取凭据」意图。
  // 这条是关键的**负控**：若把「出现 credentials 一词」当成违规，本判据会把
  // 正确实现（拒绝名单）误判为违规 ⇒ 判据自身不可用。
  t('负控：仅在拒绝名单里出现凭据词不报红',
    audit('private val DROP = listOf(Regex("""credentials\\.yaml"""), Regex("""dsht-token"""))\n' +
          'private fun sanitizeLine(line: String): String? { if (p.containsMatchIn(line)) return null }\n' +
          'val droppedLines = 0').length === 0)

  console.log(`[selftest] ${pass} pass / ${fail} fail`)
  if (fail > 0) process.exit(3)
}

if (process.argv.includes('--selftest')) {
  selftest()
  process.exit(0)
}

if (!existsSync(TARGET)) {
  console.error(`[diagpack-privacy] 锚点缺失：${TARGET}`)
  console.error('（DiagPack 是本判据的被判对象；文件不在 ⇒ fail-closed，不静默放过）')
  process.exit(1)
}

const src = readFileSync(TARGET, 'utf8')
const violations = audit(src)

// 判据 ④ 的第二半：UI 侧必须把 droppedLines 展示给用户
if (existsSync(MAIN)) {
  const main = readFileSync(MAIN, 'utf8')
  if (!/droppedLines/.test(main)) {
    violations.push('MainActivity 必须向用户展示 droppedLines（否则用户无法判断诊断包是否可信）')
  }
} else {
  console.error(`[diagpack-privacy] 锚点缺失：${MAIN}`)
  process.exit(1)
}

if (violations.length > 0) {
  console.error('[diagpack-privacy] 违反隐私不变量：')
  for (const v of violations) console.error(`  ✗ ${v}`)
  process.exit(2)
}

console.log('[diagpack-privacy] OK（4 条判据通过：不读会话/不读凭据/整行丢弃/过滤计数可见）')
