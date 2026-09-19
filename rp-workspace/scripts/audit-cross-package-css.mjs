#!/usr/bin/env node
/**
 * A15 —— 跨包 CSS 规则闸门（P-26 的机器化形态，2026-09-14 第二十轮新增）
 *
 * ## 守什么
 * **不允许一个包在 CSS 里写「另一个包自有组件的类名」规则。**
 *
 * ## 为什么（两个已实测的失效形态）
 * 包 A 写包 B 的自有类名规则时，胜负由**特异性 + 注入顺序**共同决定，而两者都不可控：
 *   ① **特异性形态**（第二十轮前）：mobile 写的 `.vb-arrow { 38px }`（0,1,0）被
 *      rp-ui 的 `.dsht-rp-variant-bar .vb-arrow { 20px }`（0,2,0）压死 ⇒ 实测 **20×20**。
 *   ② **注入顺序形态**（第二十轮）：mobile 写的约 27 条 `.dsht-rp-*` 规则与 rp-ui 的
 *      桌面基线**特异性相同**（都是 0,1,0），但 mobile 注入**先于** rp-ui ⇒
 *      **后写者胜** ⇒ 实测 `.dsht-rp-back` **32px**、`.dsht-rp-tab` **28px**、
 *      `.dsht-rp-card-gear` **26px**（三项均低于 38px 拇指底线，P1 级）。
 * 两次都满足「规则文本存在」的静态检查 —— 属 **P-11「规则存在 ≠ 规则生效」**。
 *
 * ## 判据
 * 对每个受检 CSS 源文件：
 *   ① **禁止**出现「对方包的前缀类名」（如 mobile 文件里不得有 `.dsht-rp-*`，
 *      rp-ui 文件里不得有 `.dsht-mobile-*`）—— 出现在**注释**里允许（历史说明需要），
 *      但**不得出现在规则选择器位置**。
 *   ② **允许**的跨包写法只有一种：**宿主锚点**（`[data-dsht-mobile="…"]` 之类，
 *      由 `anchors.ts` 单点维护的 data-* 属性选择器）。
 *
 * ## 白名单（必须写明理由，否则闸门不许过）
 * 见 `ALLOW`：每条都要说明「为什么这条跨包是安全的」。
 *
 * ## 正控/负控/零控（--selftest）
 *   正控：构造「mobile 文件里写 .dsht-rp-x 选择器」⇒ 必须报
 *   负控：构造「mobile 文件里注释提到 .dsht-rp-x」+「宿主锚点」⇒ 必须过
 *   零控：真实文件 ⇒ 必须过
 * 锚点缺失（找不到媒体查询段等结构）⇒ **fail-closed**（不许静默放行）。
 *
 * 用法：node scripts/audit-cross-package-css.mjs [--selftest] [-v]
 * 退出码：0 通过 / 1 违约 / 2 闸门自身不可信（selftest 失败）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// ★ W44：自证分数行的**单源输出契约**（P-1）—— 见 `selftest-summary.mjs` 头注
import { reportSelftest } from './selftest-summary.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WS = path.resolve(HERE, '..')

/** 受检的包与它们的「自有前缀」 */
const PACKAGES = [
  { name: 'dsht-rp-ui', file: 'packages/src/dsht-rp-ui/src/client/style.ts', own: 'dsht-rp' },
  { name: 'dsht-plugin-mobile', file: 'packages/src/dsht-plugin-mobile/client/style.ts', own: 'dsht-mobile' },
]

/**
 * 白名单：允许的跨包引用（必须逐条写明理由）。
 * 键 = `<写规则的包> -> <被引用的前缀>`，值 = 该引用的**其他**自有前缀列表。
 * 目前**为空** —— 即：任何跨包写对方自有类名都属违约。
 */
const ALLOW = {
  // 示例（当前无）：
  // 'dsht-plugin-mobile -> dsht-npc': ['dsht-npc 属通用插件卡（非 rp-ui 自有），且其样式不自带窄屏规则'],
}

/**
 * 从源码中提取「规则选择器位置」的文本（排除注释）。
 * 做法：逐行扫描，跳过注释行与注释块；对非注释行取 `{` 之前的部分。
 */
export function selectorsIn(src) {
  const out = []
  let inBlock = false
  src.split('\n').forEach((line, i) => {
    const t = line.trim()
    if (inBlock) { if (t.includes('*/')) inBlock = false; return }
    if (t.startsWith('/*')) { if (!t.includes('*/')) inBlock = true; return }
    if (t.startsWith('*') || t.startsWith('//')) return
    const idx = line.indexOf('{')
    if (idx < 0) return
    const sel = line.slice(0, idx).trim()
    if (!sel) return
    out.push({ n: i + 1, sel })
  })
  return out
}

/**
 * 检查一份源码。返回 { ok, violations?, detail? }
 * @param src        源码
 * @param ownPrefix  本包自有前缀（如 'dsht-rp'）
 * @param otherPrefixes 需要禁止的对方前缀列表
 * @param allowOthers  白名单（允许的对方前缀）
 */
export function auditSource(src, ownPrefix, otherPrefixes, allowOthers = []) {
  const sels = selectorsIn(src)
  if (sels.length === 0) {
    return { ok: false, reason: 'no-selectors', detail: '未解析到任何规则选择器（结构变了 ⇒ 闸门失效，不许静默放行）' }
  }
  const violations = []
  for (const other of otherPrefixes) {
    if (allowOthers.includes(other)) continue
    const re = new RegExp('\\.' + other + '(?![a-z0-9-])|\\.' + other + '-')
    for (const s of sels) {
      if (re.test(s.sel)) violations.push({ line: s.n, sel: s.sel.slice(0, 120), other })
    }
  }
  return violations.length === 0 ? { ok: true, count: sels.length } : { ok: false, violations }
}

// ---------------------------------------------------------------------------
function selftest() {
  let fail = 0
  let total = 0
  const check = (name, cond, detail) => {
    total++
    if (!cond) fail++
    console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`)
    if (!cond && detail) console.log(`        ${detail}`)
  }

  // 正控：mobile 文件里写 .dsht-rp-x 选择器 ⇒ 必须报
  const bad = `
@keyframes x {}
.dsht-rp-back { width: 44px; }
.dsht-mobile-hamburger { width: 44px; }
`
  const r1 = auditSource(bad, 'dsht-mobile', ['dsht-rp'])
  check('正控：mobile 里写 .dsht-rp-back 选择器 ⇒ 必须报', r1.ok === false && (r1.violations || []).some(v => v.sel.includes('.dsht-rp-back')), JSON.stringify(r1))

  // 负控1：只在**注释**里提到对方类名 ⇒ 必须过
  const okCom = `
/* 这里说明 .dsht-rp-back 已迁走，属注释 */
.dsht-mobile-hamburger { width: 44px; }
/* 多行注释开始
 * 仍然提到 .dsht-rp-tab 也应放行
 */
.dsht-mobile-attach { height: 44px; }
`
  const r2 = auditSource(okCom, 'dsht-mobile', ['dsht-rp'])
  check('负控1：仅在注释里提到对方类名 ⇒ 必须过', r2.ok === true, JSON.stringify(r2))

  // 负控2：宿主锚点跨包写法 ⇒ 必须过（锚点由 anchors.ts 单点维护）
  // 注意：这里 own 必须是**写规则的那个包**（dsht-mobile），锚点是它选中的宿主元素。
  const okAnchor = `
[data-dsht-mobile="chat-header"] { padding: 4px 8px; }
body:has([data-dsht-mobile="app-frame"]:not([data-sidebar-collapsed])) .dsht-mobile-scrim { display: block; }
.dsht-mobile-hamburger { top: max(8px, env(safe-area-inset-top)); }
`
  const r3 = auditSource(okAnchor, 'dsht-mobile', ['dsht-rp'])
  check('负控2：宿主锚点 + 本包自有类 ⇒ 必须过', r3.ok === true, JSON.stringify(r3))

  // 正控2：rp-ui 里写 .dsht-mobile-x ⇒ 必须报（对称）
  const bad2 = `.dsht-mobile-hamburger { width: 44px; }\n.dsht-rp-back { height: 44px; }`
  const r4 = auditSource(bad2, 'dsht-rp', ['dsht-mobile'])
  check('正控2：rp-ui 里写 .dsht-mobile-hamburger ⇒ 必须报', r4.ok === false, JSON.stringify(r4))

  // 零控3：解析不到选择器 ⇒ fail-closed
  const r5 = auditSource('/* 只有注释 */', 'dsht-rp', ['dsht-mobile'])
  check('零控：解析不到选择器 ⇒ 必须 fail-closed', r5.ok === false && r5.reason === 'no-selectors', JSON.stringify(r5))

  // 零控：真实文件（逐个受检包）
  for (const p of PACKAGES) {
    const file = path.join(WS, p.file)
    if (!fs.existsSync(file)) { check(`零控：受检文件存在 ${p.file}`, false); continue }
    const src = fs.readFileSync(file, 'utf8')
    const others = PACKAGES.filter(x => x !== p).map(x => x.own)
    const allowed = Object.entries(ALLOW).filter(([k]) => k.startsWith(p.name + ' ->')).flatMap(([, v]) => v)
    const r = auditSource(src, p.own, others, allowed)
    check(`零控：${p.name} 真实文件必须通过（已排除注释）`, r.ok === true, JSON.stringify(r.violations || r).slice(0, 400))
  }

  console.log(fail === 0 ? `\n[A15 selftest] ${total}/${total} PASS` : `\n[A15 selftest] ${fail} FAIL / ${total}`)
  // ★ W44：统一自证输出契约（单源 `selftest-summary.mjs`）
  //   ★ 必须放在**本函数内**（`--selftest` 分支会 `process.exit(selftest())` 早退，
  //     插到主流程收尾**永远不可达** —— 首版注入即踩此坑，被真跑当场证伪）
  reportSelftest('a15', total - fail, total)
  return fail === 0 ? 0 : 1
}

const args = process.argv.slice(2)
if (args.includes('--selftest')) process.exit(selftest())

// 闸门本体：跑 selftest 自证可信，再检真实文件
const selfCode = selftest()
if (selfCode !== 0) {
  console.error('\n[A15] 闸门自身不可信（selftest 未过）⇒ fail-closed，构建不应继续')
  process.exit(2)
}
console.log('')

let bad = 0
for (const p of PACKAGES) {
  const file = path.join(WS, p.file)
  if (!fs.existsSync(file)) { console.error(`[A15] MISS 受检文件不存在：${p.file}`); bad++; continue }
  const src = fs.readFileSync(file, 'utf8')
  const others = PACKAGES.filter(x => x !== p).map(x => x.own)
  const allowed = Object.entries(ALLOW).filter(([k]) => k.startsWith(p.name + ' ->')).flatMap(([, v]) => v)
  const r = auditSource(src, p.own, others, allowed)
  if (r.ok) {
    console.log(`[A15] OK —— ${p.name} 无跨包类名规则（已解析 ${r.count} 条选择器；注释不计）`)
  } else {
    bad++
    console.error(`[A15] 违约：${p.name} 写了对方自有组件的类名规则（P-26：跨包层叠胜负不可控）`)
    for (const v of (r.violations || []).slice(0, 20)) {
      console.error(`        ${p.file}:${v.line}  .${v.other}-*  选择器: ${v.sel}`)
    }
    console.error('        ⇒ 修法：把该规则**迁到组件所属的包**；跨包只允许写宿主锚点（[data-dsht-*]）')
  }
}
process.exit(bad === 0 ? 0 : 1)
