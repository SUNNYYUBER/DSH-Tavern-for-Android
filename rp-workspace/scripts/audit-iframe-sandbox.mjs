#!/usr/bin/env node
/**
 * audit-iframe-sandbox.mjs —— iframe sandbox 允许项闸门（L5 / P-12）
 * ============================================================================
 * ## 为什么需要这条闸门
 * L5 穷举（2026-09-14）发现：「所有 iframe 都含 `allow-modals`」这条判据
 * **零机器化断言**（`packages/tests/` 与 `scripts/` 里 grep `allow-modals` 命中 0）。
 * 而这条判据的失效形态是**静默**的：
 *   sandbox 缺 `allow-modals` 时，iframe 内 `confirm()`/`alert()`/`prompt()` 被
 *   Chromium **静默丢弃**（到不了 `WebChromeClient.onJsConfirm`）——实测「飞讯点联系人
 *   openChat 无响应」的根因（脚本 confirm 分支从未到达、零报错）。属 P-3 静默失败族。
 *
 * ## 判据（两条，缺一不可）
 * 1. **每处构造点都含必需项**：全仓所有 `setAttribute('sandbox', …)` 与 JSX
 *    `sandbox="…"` 站点的允许项集合，必须含 `allow-scripts`（承载脚本）与
 *    `allow-modals`（防对话框静默丢弃）。
 * 2. **构造点数量不得变少**：按结构枚举全部出现处（A11 教训：只查一个文件 ⇒
 *    同类结构在别处漏掉时闸门不作声）。基线值写在 `EXPECTED_SITES` 里；
 *    新增构造点必须同批更新此处（强迫「新增 iframe 时想一遍 sandbox」）。
 *
 * ## 豁免（须写明理由，防白名单变掩盖工具）
 * `EXEMPT` 里的站点不要求 `allow-modals`：承载**我方自有页面**（无第三方卡脚本）的
 * iframe 若不需要弹窗，可豁免——但必须在表里登记理由。
 *
 * ## 正控 / 负控（--selftest）
 * 正控：构造语料含缺 allow-modals 的站点 → 必须被报；
 * 负控：构造语料全部合规 → 必须 0 报；
 * 零控：空语料 → 0 报（防恒真）；
 * 锚点缺失（找不到源码目录）→ **fail-closed** 退出 1。
 *
 * 用法：
 *   node scripts/audit-iframe-sandbox.mjs            # 审计（退出码 0 = 合规）
 *   node scripts/audit-iframe-sandbox.mjs -v         # 列出全部站点
 *   node scripts/audit-iframe-sandbox.mjs --selftest # 自检（退出码 3 = 失败）
 * 退出码：0 = 合规；1 = 有不合规（fail-closed）；3 = selftest 失败
 *   ★ W76 修：原只写「0 / 3」而实现是 `process.exit(1)`（源码目录缺失 / 有不合规站点）
 *     ⇒ 补 1（**P-75** 双向：实现的每个码都必须被声明）
 * ============================================================================
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import process from 'node:process'
// ★ W44：自证分数行的**单源输出契约**（P-1）—— 见 `selftest-summary.mjs` 头注
import { reportSelftest } from './selftest-summary.mjs'

const WS = join(import.meta.dirname, '..')
const SRC = join(WS, 'packages', 'src')

/** 必需允许项：`allow-scripts`（承载卡脚本）+ `allow-modals`（防 confirm/alert 静默丢弃） */
const REQUIRED = ['allow-scripts', 'allow-modals']

/**
 * 基线站点数（结构枚举，防「构造点变少」躲过检查）。
 * 依据 2026-09-14 L5 穷举：3 处真实构造点
 *   · RpScriptHost.tsx      —— TH 卡脚本帧
 *   · RpNativeChat.tsx      —— 消息帧（卡前端 HTML）
 *   · RpOverlay.tsx         —— 数据迁移页（我方自有页面）
 * 新增 iframe 时必须同批更新本值（这是有意的摩擦：强迫想一遍 sandbox）。
 */
const EXPECTED_SITES = 3

/**
 * 豁免表：站点（按相对路径子串匹配）→ 理由。
 * 豁免 = 该站点不要求 REQUIRED 全集。
 */
const EXEMPT = new Map([])

/** 递归收集 .ts/.tsx（跳过派生目录） */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'lib' || name === 'dist' || name === 'node_modules') continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(full)
  }
  return out
}

/**
 * 从语料提取全部 sandbox 站点。
 * 覆盖两种声明形态（本项目实测共 3+ 处）：
 *   ① `setAttribute('sandbox', '…')` / `setAttribute("sandbox", "…")`（命令式）
 *   ② JSX `sandbox="…"` / `sandbox={'…'}` 里的字面量（声明式）
 * 返回 [{ file, line, value, tokens }]。
 */
export function extractSandboxSites(files) {
  const sites = []
  for (const f of files) {
    const lines = f.text.split('\n')
    lines.forEach((line, idx) => {
      // ① 命令式：setAttribute('sandbox', '...')
      const cmd = line.match(/setAttribute\(\s*['"]sandbox['"]\s*,\s*['"]([^'"]*)['"]/i)
      if (cmd) {
        sites.push({ file: f.path, line: idx + 1, value: cmd[1], tokens: cmd[1].split(/\s+/).filter(Boolean) })
        return
      }
      // ② JSX 属性：sandbox="..."
      const jsx = line.match(/\bsandbox\s*=\s*["']([^"']*)["']/)
      if (jsx) {
        // 排除注释里提到 sandbox= 的情形（行首是注释标记）
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
        sites.push({ file: f.path, line: idx + 1, value: jsx[1], tokens: jsx[1].split(/\s+/).filter(Boolean) })
      }
    })
  }
  return sites
}

/** 审计：返回 { sites, missing, exemptCount } */
export function audit(files) {
  const sites = extractSandboxSites(files)
  const missing = []
  let exemptCount = 0
  for (const s of sites) {
    const rel = relative(SRC, s.file).split(sep).join('/')
    const exempt = [...EXEMPT.keys()].some(k => rel.includes(k))
    if (exempt) { exemptCount++; continue }
    const lack = REQUIRED.filter(r => !s.tokens.includes(r))
    if (lack.length > 0) missing.push({ ...s, rel, lack })
  }
  return { sites, missing, exemptCount }
}

// ---------------------------------------------------------------- selftest

function selftest() {
  const mk = (file, text) => ({ path: join(SRC, 'pkg', file), text })

  // 正控 1：命令式站点缺 allow-modals → 必须被报
  const badCmd = [mk('a.tsx', `iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin')\n`)]
  const r1 = audit(badCmd)
  const ok1 = r1.sites.length === 1 && r1.missing.length === 1
    && r1.missing[0].lack.includes('allow-modals')
  console.log(`${ok1 ? '[ok]' : '[FAIL]'} 正控1：命令式站点缺 allow-modals 被报（missing=${r1.missing.length}）`)

  // 正控 2：JSX 站点缺 allow-scripts → 必须被报
  const badJsx = [mk('b.tsx', `    <iframe sandbox="allow-modals allow-forms" src="/x" />\n`)]
  const r2 = audit(badJsx)
  const ok2 = r2.sites.length === 1 && r2.missing.length === 1
    && r2.missing[0].lack.includes('allow-scripts')
  console.log(`${ok2 ? '[ok]' : '[FAIL]'} 正控2：JSX 站点缺 allow-scripts 被报（missing=${r2.missing.length}）`)

  // 负控 1：全集合规 → 0 报
  const good = [
    mk('c.tsx', `iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-modals allow-forms allow-popups')\n`),
    mk('d.tsx', `    <iframe sandbox="allow-same-origin allow-scripts allow-forms allow-modals" />\n`),
  ]
  const r3 = audit(good)
  const ok3 = r3.sites.length === 2 && r3.missing.length === 0
  console.log(`${ok3 ? '[ok]' : '[FAIL]'} 负控1：合规站点 0 报（sites=${r3.sites.length}, missing=${r3.missing.length}）`)

  // 负控 2：注释里的 `sandbox="…"` 不算站点（防误报）
  const commentOnly = [mk('e.tsx', `// 说明：sandbox="allow-scripts"（不给 same-origin）\nconst x = 1\n`)]
  const r4 = audit(commentOnly)
  const ok4 = r4.sites.length === 0
  console.log(`${ok4 ? '[ok]' : '[FAIL]'} 负控2：注释提及不算站点（sites=${r4.sites.length}）`)

  // 零控：空语料 → 0 报（防恒真）
  const r5 = audit([])
  const ok5 = r5.sites.length === 0 && r5.missing.length === 0
  console.log(`${ok5 ? '[ok]' : '[FAIL]'} 零控：空语料 0 报`)

  // 正控 3：同一文件多处站点必须**都被**提取（防「只查第一处」）
  const multi = [mk('f.tsx', [
    `iframe.setAttribute('sandbox', 'allow-scripts allow-modals')`,
    `iframe2.setAttribute('sandbox', 'allow-scripts')`, // 第二处缺 allow-modals
    ``,
  ].join('\n'))]
  const r6 = audit(multi)
  const ok6 = r6.sites.length === 2 && r6.missing.length === 1
  console.log(`${ok6 ? '[ok]' : '[FAIL]'} 正控3：同文件多处站点都被提取（sites=${r6.sites.length}, missing=${r6.missing.length}）`)

  // ★ W44：返回值从「一个布尔」改为「**计数**」（真值）—— 收尾若写死 `6/6` 字面量，
  //   新增/删除一条判据时报告上的数字**不会跟着变**（**P-41** 的形态：代理量代替事实）。
  const checks = [
    ['ok1', ok1], ['ok2', ok2], ['ok3', ok3], ['ok4', ok4], ['ok5', ok5], ['ok6', ok6]
  ]
  return { all: checks.every(([, v]) => v), pass: checks.filter(([, v]) => v).length, total: checks.length }
}

// ---------------------------------------------------------------- main

if (!existsSync(SRC)) {
  console.error(`[iframe-sandbox] 源码目录不存在：${SRC}`)
  console.error('     ⇒ fail-closed：锚点缺失时报错退出，不许静默放行')
  process.exit(1)
}

const args = process.argv.slice(2)
if (args.includes('--selftest')) {
  const r = selftest()
  console.log(r.all ? `\n[iframe-sandbox selftest] ${r.pass}/${r.total} PASS` : `\n[iframe-sandbox selftest] ${r.pass}/${r.total} FAIL`)
  // ★ W44：统一自证输出契约（单源 `selftest-summary.mjs`）
  reportSelftest('iframe-sandbox', r.pass, r.total)
  process.exit(r.all ? 0 : 3)
}

const files = walk(SRC).map(p => ({ path: p, text: readFileSync(p, 'utf8') }))
const { sites, missing, exemptCount } = audit(files)

if (args.includes('-v')) {
  console.log(`--- 全部 iframe sandbox 站点（${sites.length}）---`)
  for (const s of sites) {
    const rel = relative(SRC, s.file).split(sep).join('/')
    console.log(`  ${rel}:${s.line}  [${s.tokens.join(' ')}]`)
  }
}

console.log(`[iframe-sandbox] 扫到 ${sites.length} 处站点（豁免 ${exemptCount}）；必需项 ${REQUIRED.join(' + ')}`)

let failed = false
if (missing.length > 0) {
  failed = true
  console.log(`\n[iframe-sandbox] ❌ ${missing.length} 处站点缺必需允许项：`)
  for (const m of missing) {
    console.log(`  ⚠ ${m.rel}:${m.line} 缺 ${m.lack.join(', ')}`)
    console.log(`      实际：sandbox="${m.value}"`)
  }
  console.log('  处置：补上缺失项（缺 allow-modals ⇒ iframe 内 confirm/alert 被静默丢弃）。')
}

// 结构枚举：站点数必须与基线一致（防「构造点变少」躲过检查）
if (sites.length !== EXPECTED_SITES) {
  failed = true
  console.log(`\n[iframe-sandbox] ❌ 站点数 ${sites.length} ≠ 基线 ${EXPECTED_SITES}`)
  console.log('  处置：若确为新增/删除 iframe，请同批更新 EXPECTED_SITES 并在此处写明理由；')
  console.log('        若是删除，确认没有把「唯一一处带 allow-modals 的站点」删掉了。')
} else {
  console.log(`[iframe-sandbox] ✓ 站点数与基线一致（${EXPECTED_SITES}）`)
}

if (failed) process.exit(1)
console.log('[iframe-sandbox] PASS —— 全部站点允许项齐备')
process.exit(0)
