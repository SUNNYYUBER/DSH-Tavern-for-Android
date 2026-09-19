#!/usr/bin/env node
/**
 * w27-latency-v2.mjs —— W11：三个时延敏感路径的量化耗时（**修正版**）
 *
 * ## 为什么要出修正版（P-19/P-33：判据自身的缺陷必须自己先认）
 * 首版 `ef-latency-probe.mjs` 的「正则扫描」段用了 **我按印象手写的 10 条正则**
 * （含 `([\s\S]*)\[OS\]([\s\S]*)`）。它的输出是「28 分钟未完成」，看起来像**重大产品缺陷**。
 *
 * 但**取证后推翻了它**：
 *   · 全仓 grep `[OS]` ⇒ **0 命中**（我方代码不含）；
 *   · 扫设备**全部 29 个会话**找 `findRegex`/`regex` 等键 ⇒ 仅 1 个会话含 `"regex"`，
 *     且**提取不出任何正则原文**（是别处的字段名，不是卡正则）；
 *   ⇒ 那条「元凶正则」**是我自己编的输入**，不是产品的真实输入。
 *   用自编输入证明产品有缺陷 = **无效证据**（P-33：先说清这个数字代表什么）。
 *
 * ⇒ 修正版把「正则扫描」段改成 **对真实数据的真实操作**：
 *   用**我方产品代码里真实存在的显示处理**（`unwrapForeignTags` 等对正文的扫描）
 *   对最大会话正文计时 —— 这才是产品真实会跑的负载。
 *
 * ## 三条路径（口径全部可核对）
 *   ① 首启解压：把 `node_modules` 树完整复制（同阶写文件数 + I/O）；
 *   ② 会话迁移：最大会话**逐行 JSON.parse**（迁移链主开销）；
 *   ③ 正文处理：对最大会话的**全部 assistant 正文**做产品级扫描（标签解包 + 结构化切分）。
 *
 * 用法：node scripts/ef-latency-probe.mjs / --selftest
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const HERE = dirname(fileURLToPath(import.meta.url))
const ADB = process.env.DSHT_ADB ?? `${process.env.USERPROFILE}\\.android\\sdk\\platform-tools\\adb.exe`
const PKG = 'com.dshtavern.app'

export const THRESHOLDS_EMULATOR = {
  extractMs: 180000,      // 413MB / 24K 文件的落盘（模拟器共享磁盘）
  sessionParseMs: 60000,  // 单会话 13.4MB 逐行 JSON.parse
  bodyScanMs: 30000,      // 最大会话全部 assistant 正文的产品级扫描
}

/** 判定（抽出来便于不依赖设备自证）。★ 读数缺失必须报红。 */
export function judgeLatency ({ extractMs, sessionParseMs, bodyScanMs }, th = THRESHOLDS_EMULATOR) {
  const rows = [
    ['首启解压（413MB 树复制）', extractMs, th.extractMs],
    ['会话迁移（13.4MB 逐行解析）', sessionParseMs, th.sessionParseMs],
    ['正文处理（全部 assistant 正文扫描）', bodyScanMs, th.bodyScanMs],
  ]
  const bad = []
  for (const [label, v, lim] of rows) {
    if (typeof v !== 'number' || Number.isNaN(v) || v <= 0) { bad.push(`${label}：读数缺失（${v}）⇒ 无判据力`); continue }
    if (v > lim) bad.push(`${label}：${v}ms > 阈值 ${lim}ms`)
  }
  return { ok: bad.length === 0, rows, bad }
}

// ---------------------------------------------------------------------------
// 真实负载提取（**来自产品代码，不是我编的**）
// ---------------------------------------------------------------------------
/**
 * 从**我方产品源码**里抽出「对正文做的扫描」的真实正则。
 *
 * ## 为什么从源码抽而不是手写（P-33：判据输入必须可追溯）
 * 首版的教训就是「手写正则 ⇒ 自造缺陷」。本函数读真实产品文件，抓出其中的字面量正则。
 *
 * ## 【判据自身的坑（P-19）· 第二十一例：首版抓出一堆「注释/路径」误报】
 * 首版用的宽松正则 `/(…)/(flags)` 会把**注释里的斜杠对**也当正则：
 * 实测出现 `/ 剧情按钮 /`、`/ \`$N\` /`、`/../`、`/regex/` 这类**根本不是正则**的命中。
 * 若拿它们当"真实负荷"，等于**又一次自造输入**（与首版同错，只是换了形态）。
 * ⇒ 收紧三条：① 只取**行内不含中文字符**的候选（注释多为中文，正则不会）；
 *   ② 要求 body **至少含一个正则元字符**（`\d` `[]` `()` `+*?` `|` `^$` `\`）；
 *   ③ 剔除纯路径形态（`^\.?\.?/` 之类）。
 * 抓不到就**如实报 0 条**，设备侧**不得**退回自编负荷。
 */
function realBodyScanRegexes (wsRoot) {
  const files = [
    'packages/src/dsht-rp-ui/src/client/display-compiler.ts',
    'packages/src/dsht-plugin-shared/host-projection.ts',
    'packages/src/dsht-rp-ui/src/client/st-quotes.ts',
    'packages/src/dsht-rp-ui/src/client/style.ts',
  ]
  const out = new Set()
  for (const rel of files) {
    const p = join(wsRoot, rel)
    if (!existsSync(p)) continue
    const src = readFileSync(p, 'utf8')
    for (const line of src.split('\n')) {
      const s = line.trim()
      // ① 跳过整行注释
      if (s.startsWith('//') || s.startsWith('*') || s.startsWith('/*')) continue
      for (const m of line.matchAll(/(?<![\w)\]$])\/((?:[^/\\\n\[]|\\.|\[(?:[^\]\\]|\\.)*\])+)\/([gimsuy]*)/g)) {
        const body = m[1]
        if (body.length < 3 || body.length > 200) continue
        if (/\$\{/.test(body)) continue
        // ① 含中文 ⇒ 视为注释/文案，不是正则
        if (/[\u4e00-\u9fff]/.test(body)) continue
        // ② 必须含正则元字符
        if (!/[\\()[\]{}|+*?^$]/.test(body)) continue
        // ③ 剔除纯路径形态
        if (/^\.{0,2}\/$/.test(body) || /^[A-Za-z0-9_./-]+$/.test(body)) continue
        try { new RegExp(body, m[2]); out.add(`/${body}/${m[2]}`) } catch { /* 非正则，跳过 */ }
      }
    }
  }
  return [...out]
}

const SELFTEST_CASES = [
  ['正控：三项都在阈值内 ⇒ 通过', { extractMs: 1000, sessionParseMs: 500, bodyScanMs: 200 }, true],
  ['负控：解压超阈值 ⇒ 报红', { extractMs: 999999, sessionParseMs: 500, bodyScanMs: 200 }, false],
  ['负控：迁移超阈值 ⇒ 报红', { extractMs: 1000, sessionParseMs: 999999, bodyScanMs: 200 }, false],
  ['负控：正文处理超阈值 ⇒ 报红', { extractMs: 1000, sessionParseMs: 500, bodyScanMs: 999999 }, false],
  ['★ 负控：读数缺失（NaN）⇒ 必须报红', { extractMs: NaN, sessionParseMs: 500, bodyScanMs: 200 }, false],
  ['★ 负控：读数缺失（null）⇒ 必须报红', { extractMs: null, sessionParseMs: 500, bodyScanMs: 200 }, false],
  ['负控：读数为 0 ⇒ 必须报红（0ms 只可能是没测到）', { extractMs: 0, sessionParseMs: 500, bodyScanMs: 200 }, false],
]

if (process.argv.includes('--selftest')) {
  console.log('=== ef-latency-probe --selftest（判据自身正/负控；不依赖设备）===')
  let n = 0
  for (const [label, input, want] of SELFTEST_CASES) {
    const r = judgeLatency(input)
    const ok = r.ok === want
    if (ok) n++
    console.log(`  ${ok ? '[ok] ' : '[FAIL] '}${label} ⇒ ok=${r.ok} 期望=${want}`)
    if (!ok) console.log(`         ${r.bad.join('；')}`)
  }
  // 附：真实负载提取的自证（防「抓不到就静默退回自编输入」）
  const regs = realBodyScanRegexes(dirname(HERE))
  console.log(`\n[附] 从产品源码抽到字面量正则 ${regs.length} 条（真实负载来源）`)
  if (regs.length === 0) {
    console.log('  ⛔ 抓不到真实正则 ⇒ 设备侧**不得**退回自编负荷（首版教训）——本探针会如实报「无判据力」')
  } else {
    for (const r of regs.slice(0, 6)) console.log(`    ${r.length > 70 ? r.slice(0, 70) + '…' : r}`)
  }
  console.log(`\n[ef-latency-probe selftest] ${n}/${SELFTEST_CASES.length} PASS`)
  process.exit(n === SELFTEST_CASES.length ? 0 : 3)
}

// ---------------------------------------------------------------------------
// 设备侧
// ---------------------------------------------------------------------------
const TMP = '/data/local/tmp'
function pushText (name, text) {
  const local = join(process.env.TEMP ?? '/tmp', name)
  writeFileSync(local, text.replace(/\r\n/g, '\n'), 'utf8')
  const r = spawnSync(ADB, ['push', local, `${TMP}/${name}`], { encoding: 'utf8' })
  try { unlinkSync(local) } catch { /* 忽略 */ }
  if (r.status !== 0) { console.error(`push ${name} 失败：`, r.stderr || r.stdout); process.exit(2) }
}

const regs = realBodyScanRegexes(dirname(HERE))
console.log(`[ef-latency-probe] W11 时延敏感路径（设备实测 · 模拟器档）`)
console.log(`真实负载来源：产品源码里的字面量正则 ${regs.length} 条\n`)

const jsParse = `
const fs = require("node:fs");
const f = process.argv[2];
const t0 = Date.now();
const txt = fs.readFileSync(f, "utf8");
const t1 = Date.now();
const lines = txt.split("\\n");
const t2 = Date.now();
let n = 0, events = 0;
for (const ln of lines) { if (!ln) continue; n++; try { const o = JSON.parse(ln); if (o && o.surfaceOp) events++; } catch {} }
const t3 = Date.now();
console.log("TOTAL=" + (t3-t0) + " readMs=" + (t1-t0) + " parseMs=" + (t3-t2) + " lines=" + n + " surfaceOps=" + events);
`
const jsBody = `
const fs = require("node:fs");
const f = process.argv[2];
const txt = fs.readFileSync(f, "utf8");
// 【判据自身的坑（P-30）· 第二十二例：字段名猜错 ⇒ bodies=0 ⇒ 判据沉默】
// 首版按 o.role === "assistant" && o.content 取正文 ⇒ 实测 **bodies=0 / bytes=0**
// ⇒ 「正文处理 1ms」是**假绿**（什么都没扫）。
// 第二轮按 o.data.{role,content,text} 取 ⇒ 仍 **bodies=0**。
// ★ 实测（逐条打印真实结构）该会话 v3 的事件形态是：
//     {"type":"system/message","seq":2,"data":{"turn":1,"step":1,
//        "message":{"id":"…","role":"system","content":[…]},"surfaceOp":"append"}}
//   ⇒ 正文在 **data.message** 里，且 content 是**数组**（元素形如 {type,text}）。
// 本版：从 data.message 取，role 过滤 assistant，content 数组逐元素收 text；
// **并把取到的字节数打进输出**（bytes=0 ⇒ 上层必须视为「无判据力」，不得报通过）。
// 注意：本段是**模板串**，注释里不能出现反引号。
const bodies = [];
const push = (v) => { if (typeof v === "string" && v.length > 0) bodies.push(v) };
const collectContent = (c) => {
  if (typeof c === "string") { push(c); return }
  if (Array.isArray(c)) for (const part of c) {
    if (typeof part === "string") push(part)
    else if (part && typeof part === "object") { push(part.text); push(part.content) }
  }
};
for (const ln of txt.split("\\n")) {
  if (!ln) continue;
  let o; try { o = JSON.parse(ln) } catch { continue }
  if (!o || typeof o !== "object") continue;
  const msg = (o.data && typeof o.data === "object") ? o.data.message : undefined;
  if (msg && typeof msg === "object") {
    if (msg.role === "assistant") { collectContent(msg.content); push(msg.text) }
  }
  // 兼容：旧版直挂形态
  if (o.role === "assistant") { collectContent(o.content); push(o.text) }
}
const joined = bodies.join("\\n");
const RES = ${JSON.stringify(regs)}.map(s => {
  const i = s.lastIndexOf("/");
  try { return new RegExp(s.slice(1, i), s.slice(i + 1)) } catch { return null }
}).filter(Boolean);
const t0 = Date.now();
let hits = 0;
for (const re of RES) { const m = joined.match(re); hits += m ? m.length : 0; }
const t1 = Date.now();
console.log("TOTAL=" + (t1-t0) + " hits=" + hits + " rules=" + RES.length + " bodies=" + bodies.length + " bytes=" + joined.length);
`
pushText('ef-latency-device.sh', readFileSync(join(HERE, 'ef-latency-device.sh'), 'utf8'))
pushText('ef-latency-parse.js', jsParse)
pushText('ef-latency-regex.js', jsBody)

const r = spawnSync(ADB, ['shell', 'run-as', PKG, 'sh', `${TMP}/ef-latency-device.sh`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60 * 1000 })
const out = (r.stdout ?? '') + (r.stderr ?? '')
if (!out.includes('### SECTION:meta')) { console.error('设备侧脚本未正常执行：\n' + out.slice(0, 600)); process.exit(2) }

const sec = {}
let cur = null
for (const line of out.split('\n')) {
  const m = /^### SECTION:(\w+)$/.exec(line.trim())
  if (m) { cur = m[1]; sec[cur] = []; continue }
  if (cur && line.trim() !== '### END') sec[cur].push(line)
}
const txtOf = (k) => (sec[k] ?? []).join('\n').trim()

console.log('① 装置前提：')
for (const l of txtOf('meta').split('\n').filter(Boolean)) console.log(`   ${l}`)
console.log('')

const ex = txtOf('extract')
const extractMs = (/copy_ms=(\d+)/.exec(ex) ?? [])[1]
console.log('② 首启解压等价工作量（runtime 树完整复制）：')
for (const l of ex.split('\n').filter(Boolean)) console.log(`   ${l}`)
console.log('')

const sp = txtOf('sessionparse')
const sessionParseMs = (/TOTAL=(\d+)/.exec(sp) ?? [])[1]
console.log('③ 会话迁移主开销面（最大会话逐行 JSON.parse）：')
for (const l of sp.split('\n').filter(Boolean)) console.log(`   ${l}`)
console.log('')

const rg = txtOf('regexscan')
const bodyScanMs = (/TOTAL=(\d+)/.exec(rg) ?? [])[1]
const bodyBytes = (/bytes=(\d+)/.exec(rg) ?? [])[1]
const bodyBodies = (/bodies=(\d+)/.exec(rg) ?? [])[1]
console.log('④ 正文处理（真实产品正则 × 全部 assistant 正文）：')
for (const l of rg.split('\n').filter(Boolean)) console.log(`   ${l}`)
// ★ 同「空样本」纪律：bytes=0 ⇒ 什么都没扫到 ⇒ 该读数**无判据力**，不得报通过
const bodyHasSample = Number(bodyBytes) > 0
if (!bodyHasSample) console.log(`   ⛔ bytes=0（bodies=${bodyBodies}）⇒ **无判据力**：正文没取到，该段的读数不可采信`)
console.log('')

const v = judgeLatency({
  extractMs: extractMs ? Number(extractMs) : NaN,
  sessionParseMs: sessionParseMs ? Number(sessionParseMs) : NaN,
  bodyScanMs: bodyHasSample && bodyScanMs ? Number(bodyScanMs) : NaN,
})
console.log('⑤ 判定（模拟器档阈值）：')
for (const [label, val, lim] of v.rows) {
  const ok = typeof val === 'number' && val > 0 && val <= lim
  console.log(`   ${ok ? '✓' : '✗'} ${label}：${val}ms（阈值 ${lim}ms）`)
}
for (const b of v.bad) console.log(`   ⛔ ${b}`)
console.log('')
console.log(`[ef-latency-probe] ${v.ok ? 'PASS' : 'FAIL'}`)
if (v.ok) console.log('  ⇒ W11 三个时延敏感路径在**本模拟器**（Android 15 / SDK 35）有量化读数且在阈值内')
console.log('  ⇒ 诚实边界（R7）：模拟器 I/O 与真机存储特性不同 ⇒ 真机复核仍留在 GOAL §11.2')
process.exit(v.ok ? 0 : 1)
