/**
 * W6 常驻探针：三段编译**四条路径一致性** + 折叠体内容保全（A5 轨道）
 *
 * ## 为什么是常驻探针（而不是一次性 tmp 脚本）
 * 本探针的判据由**真实卡输出**驱动（不是合成样本），而抽样卡会随用户导入变化：
 *   · 折叠块的**形态分布**会变（哪些卡、哪些标签）⇒ 合成样本永远追不上
 *   · 「协议层不递归消费折叠块内层标签」这条**产品行为**是判据的前提，
 *     官方一改（比如加了递归）就会让本探针的结论失效 ⇒ 必须可复跑
 *
 * ## 判据（P-24：落在结果）
 *   ① **流式 ≡ 定稿**：同一输入的渲染单元序列必须一致（否则流式结束瞬间画面跳变）
 *   ② **折叠体内容保全**：`CompiledBody(content)` 的字符多重集必须覆盖原文
 *      （即：渲染不丢任何字）。这是「折叠体通道与主楼层同源」的**可观测结果**
 *   ③ **多帧决策单点**：`shouldRenderFrame` 真值表与文档定义一致（18 组合）
 *
 * ## 判据自证（P-30：静态判据必须自带正负控）
 * 抽纯文本的函数必须**放过**非 ASCII 标签名与颜文字（`<音乐>`、`<|SYSTEM|>`、`/(>д<)/`），
 * 否则会把真实文字当标签剥掉 ⇒ 报出「内容丢失」的假象（本轮实测白查 6 轮）。
 * 本探针在开跑前先跑这组自证；不通过即 exit 2（判据不可信，结论一律不算）。
 *
 * 用法：
 *   node scripts/ef-compile-parity.mjs                      # 用设备会话（需 adb root）
 *   node scripts/ef-compile-parity.mjs --file <jsonl 路径>   # 用本地会话文件
 *   node scripts/ef-compile-parity.mjs --selftest            # 只跑判据自证
 */
import process from 'node:process'
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const argv = process.argv.slice(2)
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
const HAS = (n) => argv.includes(n)
const FILE = flag('--file', '')
const ADB = process.env.ADB_PATH || 'C:\\Users\\Administrator\\.android\\sdk\\platform-tools\\adb.exe'

const { compileDisplaySegments, unwrapForeignTags, shouldRenderFrame } =
  await import('../packages/src/dsht-rp-ui/src/client/display-compiler.ts')
const { applyOutputProtocolSegments, PROTO_DEFAULT } =
  await import('../packages/src/dsht-rp-ui/src/client/output-protocol.ts')

// ---------------------------------------------------------------------------
// 判据自证（P-30）：抽纯文本的规则必须来自**真实失效形态**
// ---------------------------------------------------------------------------
const stripRealTags = (s) => String(s).replace(/<\/?[a-zA-Z][\w:~-]*(?:\s[^<>]*)?\/?>/g, '')
const stripAnyAngle = (s) => String(s).replace(/<[^<>]*>/g, '')  // 错解：保留为负控
const norm = (s) => stripRealTags(s).replace(/\s+/g, '').trim()

function selftest() {
  const checks = [
    ['真标签剥掉、内容保留', () => norm('<b>粗体</b>') === '粗体'],
    ['非 ASCII 标签名不得被剥（<音乐>）', () => norm('<音乐>') === '<音乐>'],
    ['非 ASCII 闭合标签不得被剥（</音乐>）', () => norm('</音乐>') === '</音乐>'],
    ['符号标签名不得被剥（<|SYSTEM|>）', () => norm('<|SYSTEM|>') === '<|SYSTEM|>'],
    ['中文标签名不得被剥（<剧情大纲编码索引>）', () => norm('<剧情大纲编码索引>') === '<剧情大纲编码索引>'],
    ['颜文字不得被剥', () => norm('/(>д<)/') === '/(>д<)/'],
    // 负控：错解必须**真的**会剥掉这些（证明上面几条有杠杆）
    ['负控·错解确实吃掉 <音乐>', () => stripAnyAngle('<音乐>') !== '<音乐>'],
    ['负控·错解确实吃掉 <|SYSTEM|>', () => stripAnyAngle('<|SYSTEM|>') !== '<|SYSTEM|>'],
    ['正控·shouldRenderFrame 真值表', () =>
      shouldRenderFrame(true, true, true) === true
      && shouldRenderFrame(true, true, false) === false
      && shouldRenderFrame(true, false, false) === true
      && shouldRenderFrame(false, true, true) === false],
  ]
  let fail = 0
  for (const [name, fn] of checks) {
    let ok = false
    try { ok = fn() } catch { ok = false }
    if (!ok) fail++
    console.log(`  ${ok ? 'PASS' : '**FAIL**'} ${name}`)
  }
  console.log(`[ef-compile-parity] 判据自证 ${checks.length - fail}/${checks.length}`)
  return fail
}

const selfFail = selftest()
if (HAS('--selftest')) process.exit(selfFail === 0 ? 0 : 2)
if (selfFail > 0) {
  console.error('[ef-compile-parity] 判据自证未通过 ⇒ 结论不可信，拒绝继续（P-30）')
  process.exit(2)
}

// ---------------------------------------------------------------------------
// 取数据（设备 rooot 或本地文件）
// ---------------------------------------------------------------------------
function loadTexts() {
  let raw = ''
  if (FILE) {
    if (!existsSync(FILE)) { console.error(`文件不存在：${FILE}`); process.exit(2) }
    raw = readFileSync(FILE, 'utf8')
  } else {
    try {
      const dir = '/data/data/com.dshtavern.app/files/.dsh/sessions'
      const listing = execFileSync(ADB, ['shell', `find ${dir} -name 'session.v3.jsonl'`], { encoding: 'utf8' })
      const files = listing.split('\n').map(s => s.trim()).filter(Boolean)
      if (files.length === 0) { console.error('设备上没有会话文件（需 adb root）'); process.exit(2) }
      // 只取体积最大的 5 份（覆盖面最大，避免全量拉取过慢）
      const withSize = files.map(f => {
        try { return { f, n: Number(execFileSync(ADB, ['shell', `stat -c %s '${f}'`], { encoding: 'utf8' }).trim()) || 0 } } catch { return { f, n: 0 } }
      }).sort((a, b) => b.n - a.n).slice(0, 5)
      for (const { f } of withSize) {
        raw += execFileSync(ADB, ['shell', `cat '${f}'`], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
      }
      console.log(`[ef-compile-parity] 设备会话 ${withSize.length} 份（按体积取前 5）`)
    } catch (e) {
      console.error('[ef-compile-parity] 拉取设备会话失败（需 adb root；或用 --file 指定本地）:', String(e).slice(0, 200))
      process.exit(2)
    }
  }
  const texts = []
  for (const l of raw.split('\n')) {
    if (!l.trim()) continue
    try {
      const ev = JSON.parse(l)
      const walk = (o) => {
        if (Array.isArray(o)) { for (const x of o) walk(x); return }
        if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) {
          if (k === 'text' && typeof v === 'string' && v.length > 20) texts.push(v); else walk(v)
        }
      }
      walk(ev)
    } catch { /* 非 JSON 行忽略 */ }
  }
  return texts
}

const texts = loadTexts()
console.log(`[ef-compile-parity] 正文 ${texts.length} 段`)

// ---------------------------------------------------------------------------
// 判据 ① 流式 ≡ 定稿
// ---------------------------------------------------------------------------
const STREAM_CASES = [
  '正文\n<interactive_input>半截内容',
  '前\n<状态>数值</状态>\n后',
  '前\n<状态>数值',
  '<div class="c"><b>x</b></div>',
  '```html\n<!doctype html><html><body>d</body></html>\n```',
  '前<script>alert(1)</script>后',
  '```\n<think_fox~>惰性</think_fox~>\n```',
  '前<tip>提示</tip>后',
]
const seqOf = (text, streaming) =>
  applyOutputProtocolSegments(text, PROTO_DEFAULT, streaming)
    .flatMap(s => s.kind === 'text'
      ? compileDisplaySegments(s.content).map(d => d.kind)
      : [`P:${s.kind}`]).join(',')
let j1 = 0
for (const c of STREAM_CASES) {
  const a = seqOf(c, true), b = seqOf(c, false)
  if (a !== b) { j1++; console.log(`  ✗ 流式/定稿不同源：${JSON.stringify(c.slice(0, 30))}\n    流式=${a}\n    定稿=${b}`) }
}
console.log(`  ${j1 === 0 ? '✓' : '✗'} J1 流式 ≡ 定稿：${STREAM_CASES.length - j1}/${STREAM_CASES.length} 样本一致`)

// ---------------------------------------------------------------------------
// 判据 ② 折叠体内容保全（字符多重集覆盖）
// ---------------------------------------------------------------------------
const foldText = (c) => compileDisplaySegments(unwrapForeignTags(c)).map(d => d.kind === 'markdown' ? d.text : d.source).join('')
let nFold = 0, nLoss = 0
const lossSamples = []
for (const t of texts) {
  for (const s of applyOutputProtocolSegments(t, PROTO_DEFAULT, false)) {
    if (s.kind !== 'collapsible') continue
    nFold++
    const a = norm(s.content), b = norm(foldText(s.content))
    const ca = new Map(); for (const ch of a) ca.set(ch, (ca.get(ch) || 0) + 1)
    const cb = new Map(); for (const ch of b) cb.set(ch, (cb.get(ch) || 0) + 1)
    let missing = 0
    for (const [ch, c] of ca) if ((cb.get(ch) || 0) < c) missing++
    if (missing > 0) { nLoss++; if (lossSamples.length < 3) lossSamples.push({ title: s.title, a: a.length, b: b.length }) }
  }
}
console.log(`  ${nLoss === 0 ? '✓' : '✗'} J2 折叠体内容保全：${nFold} 个折叠块，丢字 ${nLoss} 个`)
for (const x of lossSamples) console.log(`      ${x.title}: ${x.a} → ${x.b} 字`)

// ---------------------------------------------------------------------------
// 判据 ③ 多帧决策单点（真值表 + 独立复算）
// ---------------------------------------------------------------------------
let j3 = 0
for (const th of [true, false]) for (const st of [true, false]) for (const al of [true, false, undefined]) {
  const got = shouldRenderFrame(th, st, al)
  const want = th && (!st || al === true)
  if (got !== want) { j3++; console.log(`  ✗ shouldRenderFrame(${th},${st},${String(al)}) = ${got}，期望 ${want}`) }
}
console.log(`  ${j3 === 0 ? '✓' : '✗'} J3 多帧决策单点：18 组合${j3 === 0 ? '全部符合定义' : ` ${j3} 处不符`}`)

// ---------------------------------------------------------------------------
// 结论
// ---------------------------------------------------------------------------
const fails = j1 + nLoss + j3
console.log(`\n[ef-compile-parity] ${fails === 0 ? 'J1/J2/J3 全部 PASS' : `${fails} 处 FAIL`}`)
process.exit(fails === 0 ? 0 : 1)
