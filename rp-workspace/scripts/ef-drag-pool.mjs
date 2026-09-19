#!/usr/bin/env node
/**
 * ef-drag-pool.mjs —— M7 抽样池「是否含 jQuery UI 拖拽卡」的前置判据（W18）
 * ============================================================================
 * ## 为什么需要它（goal §八 E-F 的硬口径）
 * E-F 要求「抽样卡全部走完『导入 → 开聊 → **脚本 UI 交互（含拖拽）** → 回退 → …」。
 * 而抽样池里**有没有**带拖拽的卡，此前只有一句推测（W13/W18「属抽样池限制」），
 * 没有任何机器判据 —— 于是「拖拽没测」这件事**无法与「池子里本来就没有」区分开**。
 * 本脚本把该前提变成可复跑、可自证的结论。
 *
 * ## 判据
 * 在**设备全部会话**里找「卡前端含 jQuery UI 拖拽特征」的卡：
 *   jQuery UI 命名空间 / `.draggable(` / `.sortable(` / `.resizable(` / `.slider(`
 * 命中即说明抽样池**可以**覆盖拖拽正控（应把该卡加进 M7 池）；0 命中则是
 * **有证据的**「池子限制」，而不是推测。
 *
 * ## 装置纪律（本脚本是踩了 5 个装置坑之后才成立的 —— 见文末「装置自身的坑」）
 *   ① 枚举**只读设备侧生成的清单文件**，不在 PC 侧拼 `adb shell … sh -c "…"`；
 *   ② 取回后对每个文件跑**正控**（必须含 `"role"`）；
 *   ③ 结论与**装置自证同屏**打印（取回数/正控通过数），自证不过则**声明结论不可信**并非零退出；
 *   ④ 逐模式计数**0 也打印**（防「判据词法收窄」被读成「没有」）。
 *
 * ## 前置（一次性；命令构造固定在设备侧脚本里 —— 见文末「装置自身的坑」⑤）
 *   adb push scripts/list-device-sessions.sh /data/local/tmp/
 *   adb shell "run-as com.dshtavern.app sh /data/local/tmp/list-device-sessions.sh"
 *
 * 用法：node scripts/ef-drag-pool.mjs [--quiet]
 *      node scripts/ef-drag-pool.mjs --selftest   # 判据自身正/负控（不依赖设备）
 */
import { spawnSync } from 'node:child_process'
import process from 'node:process'

const ADB = process.env.DSHT_ADB ?? `${process.env.USERPROFILE}\\.android\\sdk\\platform-tools\\adb.exe`
const PKG = 'com.dshtavern.app'
const LIST = `/data/data/${PKG}/files/dsht-session-list.txt`
const QUIET = process.argv.includes('--quiet')

/**
 * 跑 adb 并**容忍非零退出码**。
 * `find` 在 toybox 下会因悬空符号链接打 stderr 并非零退出；`execFileSync` 会因此抛异常
 * —— 那是**装置噪音**，不是判据结论（把它当失败会掩盖真实错误）。
 */
function adbRun (args) {
  const r = spawnSync(ADB, args, { maxBuffer: 512 * 1024 * 1024 })
  if (r.error) throw r.error
  return { out: r.stdout ?? Buffer.alloc(0), err: (r.stderr ?? Buffer.alloc(0)).toString('utf8'), status: r.status }
}

/**
 * 判据词表。**逐条打印计数（0 也打印）** —— 防「词法收窄」被读成「设备上没有」。
 *
 * ## 为什么判据必须落在「**可执行用法**」上，而不是「字样」
 * 真机实测（29 个会话、34.9MB）：`jquery` 字样命中 12 处、`jQuery UI` 字样命中 2 处，
 * 逐条取证后**全部**是「**提及**」而非「用法」：
 *   · 12 处 `jquery` 里 8 处来自一段脚本的**事件名探测数组**
 *     （`[\"eventOn\",\"tavern_events\",…,\"jQuery\",\"$(document).ready\",…]`）
 *     —— 那是检查代码里有没有 jQuery 特征串的逻辑，不是 jQuery 调用；
 *     另 4 处来自**我方项目文档被导入成会话正文**（`references/…` 的 README 文本）
 *     与一段**对话**里讨论 jQuery 的措辞。
 *   · 2 处 `jQuery UI` 同样来自上述被导入的文档文本。
 * 而 `.draggable(` / `.sortable(` / `.resizable(` / `.slider(` / `$.ui` **全部 0 命中**。
 * ⇒ 若把「字样」当判据，本脚本会给出**错误建议**（把那张卡当拖拽正控加进 M7 池），
 *   而它的卡前端**根本没有拖拽** ⇒ 判据方向错成「假绿建议」（P-19 家族：
 *   词法正确但语义收窄不足）。
 * ⇒ 收窄为：**只有可执行用法与 jQuery UI 内部命名空间算数**。
 */
const PATTERNS = [
  ['jQuery 本体（仅参考，不单独作为判据）', /jquery/i],
  ['jQuery UI 字样（仅参考，不单独作为判据）', /jquery[-_.\s]?ui/i],
  ['★ .draggable(', /\.draggable\s*\(/],
  ['★ .sortable(', /\.sortable\s*\(/],
  ['★ .resizable(', /\.resizable\s*\(/],
  ['▲ 未打包：.slider(', /\.slider\s*\(/],
  ['★ $.ui 内部', /\$\.ui\.|jQuery\.ui\./],
  ['我方 touch→mouse 桥（参考）', /dshtTouchBridge|ui[-.]?mouse/i],
  // ---- 第三十轮 W29 新增：**未打包组件**的真实使用（收口 L1「拖拽/排序/缩放」格的残余）----
  // 背景：该格残余写着「`slider`/`selectable` 等另 13 个组件**未打包** ⇒ 卡脚本调
  // `$.fn.slider` 会 undefined 报 TypeError（**属能力缺口，需运行时确认哪张卡用到**）」。
  // ⇒ 那句话是一个**未收敛的待办**（「需运行时确认」）。本探针正好在扫**设备全部会话**，
  //   故顺带把「未打包组件有没有被真实调用」变成可复跑的结论。
  // 判据口径：与上面一致 —— 只认**可执行用法**（`.xxx(`），不认字样提及。
  ['▲ 未打包：.selectable(', /\.selectable\s*\(/],
  ['▲ 未打包：.accordion(', /\.accordion\s*\(/],
  ['▲ 未打包：.autocomplete(', /\.autocomplete\s*\(/],
  ['▲ 未打包：.datepicker(', /\.datepicker\s*\(/],
  ['▲ 未打包：.dialog(', /\.dialog\s*\(/],
  ['▲ 未打包：.menu(', /\.menu\s*\(/],
  ['▲ 未打包：.progressbar(', /\.progressbar\s*\(/],
  ['▲ 未打包：.spinner(', /\.spinner\s*\(/],
  ['▲ 未打包：.tabs(', /\.tabs\s*\(/],
  ['▲ 未打包：.tooltip(', /\.tooltip\s*\(/],
  ['▲ 未打包：.button(', /\.button\s*\(/],
  ['▲ 未打包：.controlgroup(', /\.controlgroup\s*\(/],
  ['▲ 未打包：.checkboxradio(', /\.checkboxradio\s*\(/],
]
/** 参与「可作拖拽正控」判定的下标：**只收已打包且可执行的用法**。
 *  ⚠️ 下标 5（`.slider(`）**故意排除** —— 取证：我方只打包 5 个 widget
 *  （`th-vendor.gen.txt`：data / widget / mouse / draggable / droppable / sortable / resizable，
 *  **不含 slider**）⇒ `.slider(` 命中属**未打包**（能力缺口），不能算「可作正控」。
 *  这正是自证第 7 例当场抓到的错误（首版把 5 留在 JUDGE 里、又忘了并入 UNPACKED ⇒ 两边都漏）。 */
const JUDGE = [2, 3, 4, 6]
/** 「已打包」判据集（= th-vendor.gen.txt 里的 5 个 widgets） */
const PACKED = [2, 3, 4, 6]
/** 「未打包」判据集（W29 新增）—— 命中即说明**存在真实能力缺口**（不是抽样池限制）。
 *  含下标 5（slider）—— 它虽在 PATTERNS 里排在「已打包」之前，但取证后归入未打包。 */
const UNPACKED = [5, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]

// ---------------------------------------------------------------------------
// 判据自证（--selftest）—— 与设备无关，纯构造样本
// ---------------------------------------------------------------------------
// ## 为什么必须内置（不能只放在 tmp/ 的探针里）
// 本判据的输出形态是「**0 张命中**」，而**判据自己坏掉**时的输出**完全相同**（P-30）。
// 故必须能在**不依赖设备**的前提下证明「判据有区分力」：
//   · 正控 3 组：真有 `.draggable(` / `.sortable(` / `$.ui` 用法 ⇒ 必须命中；
//   · 负控 3 组：只是「**提及**」（事件名探测数组 / 文档文本里的 jQuery UI 字样 / 干净文本）
//     ⇒ 必须**不**命中（否则会给出「假绿建议」：把没有拖拽的卡当拖拽正控加进 M7 池）。
function judgeHit (t) {
  const per = PATTERNS.map(([, re]) => (t.match(re) || []).length)
  return { hit: JUDGE.some(i => per[i] > 0), per, unpacked: UNPACKED.some(i => per[i] > 0) }
}

const SELFTEST_CASES = [
  ['正控：真有 .draggable( 调用', `$('#hud').draggable({ containment:'parent' });`, true],
  ['正控：.sortable( 调用', `$('#list').sortable({ items:'li' });`, true],
  ['正控：$.ui 内部命名空间', `if ($.ui && $.ui.mouse) { setup(); }`, true],
  ['负控：事件名探测数组里提到 jQuery', `for(const ev of ["eventOn","jQuery","$(document).ready"]){ scan(ev) }`, false],
  ['负控：文档文本里写 jQuery UI 字样', `宿主注入 $/_/z/YAML/jQuery UI/FontAwesome + TavernHelper shim`, false],
  ['负控：干净文本', `{"role":"assistant","content":"你好，这是纯文本回复。"}`, false],
]

// W29：未打包组件的判据也要自证（否则「0 命中」与「判据坏了」输出相同 —— P-30）
const UNPACKED_CASES = [
  ['正控：真有 .slider( 调用（未打包组件）⇒ 必须被识别为「未打包命中」', `$('#vol').slider({ max: 100 });`, true],
  ['正控：.selectable( 调用', `$('#grid').selectable();`, true],
  ['负控：只是提到 slider 字样（无调用）⇒ 不算', `// 卡作者注释：这里本来想用 slider`, false],
  ['负控：已打包的 .draggable( ⇒ **不算**未打包命中（两个判据集必须分离）', `$('#hud').draggable();`, false],
]

if (process.argv.includes('--selftest')) {
  console.log('=== ef-drag-pool --selftest（判据自身正/负控；不依赖设备）===')
  let n = 0
  let total = 0
  for (const [label, text, want] of SELFTEST_CASES) {
    const r = judgeHit(text)
    const ok = r.hit === want
    total++
    if (ok) n++
    console.log(`  ${ok ? '[ok] ' : '[FAIL] '}${label} ⇒ 命中=${r.hit} 期望=${want}`)
    if (!ok) console.log(`         逐模式计数：[${r.per.join(', ')}]`)
  }
  // W29：未打包组件判据的自证（与上一组**独立**：两个判据集必须分离）
  for (const [label, text, want] of UNPACKED_CASES) {
    const r = judgeHit(text)
    const ok = r.unpacked === want
    total++
    if (ok) n++
    console.log(`  ${ok ? '[ok] ' : '[FAIL] '}${label} ⇒ unpacked=${r.unpacked} 期望=${want}`)
    if (!ok) console.log(`         逐模式计数：[${r.per.join(', ')}]`)
  }
  console.log(`\n[ef-drag-pool selftest] ${n}/${total} PASS`)
  console.log(n === total
    ? '⇒ 判据有区分力（正控命中、提及类不命中）⇒ 设备侧「0 张」的结论可信'
    : '⇒ 判据不可信：设备侧结论作废')
  process.exit(n === total ? 0 : 3)
}

// ---- 装置①：只读设备侧清单（不在 PC 侧拼多层转发的命令）----
const listRaw = adbRun(['exec-out', 'run-as', PKG, 'cat', LIST])
if (listRaw.status !== 0 || listRaw.out.length === 0) {
  console.error(`FATAL 读不到清单 ${LIST}`)
  console.error('  ⇒ 先跑一次性前置（把命令构造固定在设备侧 —— 禁在 PC 侧拼多层转发命令）：')
  console.error('     adb push scripts/list-device-sessions.sh /data/local/tmp/')
  console.error('     adb shell "run-as com.dshtavern.app sh /data/local/tmp/list-device-sessions.sh"')
  process.exit(2)
}
const lines = listRaw.out.toString('utf8').split('\n').map(s => s.trim()).filter(Boolean)
const declared = Number((lines.find(l => l.startsWith('COUNT=')) || 'COUNT=0').slice(6))
const listed = lines.filter(l => l.endsWith('.jsonl'))
if (!QUIET) console.log(`SELFCHECK 清单自报 COUNT=${declared} · 实得 ${listed.length} 条路径`)
if (declared !== listed.length) {
  console.error(`FATAL 清单自报 ${declared} ≠ 实得 ${listed.length} —— 装置不可信（清单可能被截断）`)
  process.exit(2)
}
if (listed.length === 0) { console.error('FATAL 枚举为空 —— 装置不成立'); process.exit(1) }

const tally = PATTERNS.map(() => 0)
const hits = []
let fetched = 0, ctrlOk = 0, bytes = 0

for (const abs of listed) {
  const r = adbRun(['exec-out', 'run-as', PKG, 'cat', abs])
  if (r.status !== 0 || r.out.length === 0) {
    if (!QUIET) console.log(`  ⚠ 取回失败（status=${r.status}，${r.out.length}B）：${abs}`)
    continue
  }
  fetched++; bytes += r.out.length
  const t = r.out.toString('utf8')
  // 装置②：正控 —— 取回的内容必须真的是会话文件
  if (!/"role"|'role'/.test(t)) { if (!QUIET) console.log(`  ⚠ 正控未命中：${abs}`); continue }
  ctrlOk++
  const per = PATTERNS.map(([, re]) => (t.match(re) || []).length)
  per.forEach((n, i) => { tally[i] += n })
  if (JUDGE.some(i => per[i] > 0)) hits.push({ rel: abs.replace(`/data/data/${PKG}/files/.dsh/sessions/`, ''), per })
}

if (!QUIET) {
  console.log(`\n取回 ${fetched}/${listed.length} 个文件（正控通过 ${ctrlOk}）· 共 ${(bytes / 1048576).toFixed(1)} MB`)
  console.log('逐模式计数（0 也打印 —— 防判据词法收窄被读成「没有」）：')
  PATTERNS.forEach(([name], i) => console.log(`  ${String(tally[i]).padStart(6)}  ${name}${JUDGE.includes(i) ? '' : '   [参考项，不参与判定]'}`))
}

console.log(`\n=== 含 jQuery UI 拖拽特征的卡：${hits.length} 张 ===`)
for (const h of hits) {
  console.log(`  · ${h.rel}`)
  const packedStr = PACKED.map(i => `${PATTERNS[i][0].replace(/^★\s*/, '').replace(/\($/, '')}=${h.per[i]}`).join(' ')
  console.log(`      ${packedStr} $.ui=${h.per[6]}`)
}

// ---- W29 新增结论：**未打包组件**是否被真实使用（收口 L1 那格的「需运行时确认」）----
const unpackedUsed = []
UNPACKED.forEach(i => { if (tally[i] > 0) unpackedUsed.push(`${PATTERNS[i][0]}=${tally[i]}`) })
console.log('\n[未打包组件] 设备全部会话中的**真实调用**计数（口径：可执行用法 `.xxx(`）：')
if (unpackedUsed.length === 0) {
  console.log('  · 13 个未打包组件 **全部 0 命中**')
  console.log('  ⇒ L1「拖拽/排序/缩放」格的残余（「需运行时确认哪张卡用到未打包组件」）**已收口**：')
  console.log('     设备全部会话里**没有任何卡**调用未打包的 jQuery UI 组件')
  console.log('     ⇒ 该「能力缺口」**当前无实际后果**（属潜力缺口，非现存缺陷）。')
} else {
  console.log('  · ⚠️ 命中：' + unpackedUsed.join(' · '))
  console.log('  ⇒ **存在真实能力缺口**：有卡调用了未打包的组件 ⇒ `$.fn.xxx` 为 undefined')
  console.log('     ⇒ 处置：把对应 widget 加进 `th-vendor.gen.txt` 的打包清单，或明确登记为不支持。')
}

// 装置③：自证与结论**同屏**，自证不过则声明结论不可信
const trustworthy = fetched === listed.length && ctrlOk === fetched
console.log('\n装置自证：')
console.log(`  取回数 == 枚举数：${fetched === listed.length} · 正控全过：${ctrlOk === fetched}`)
console.log(`  ⇒ 本结论${trustworthy ? '可信' : '**不可信**（装置未覆盖全部文件）'}`)

if (!trustworthy) process.exit(1)

// E-F 前提结论
if (hits.length === 0) {
  console.log('\n[E-F 前提] 设备全部会话中**无**「卡前端含 jQuery UI 拖拽」的卡')
  console.log('  ⇒ 「M7 未覆盖拖拽正控」属**有证据的抽样池限制**（非产品缺口）。')
  console.log('  ⇒ 若要覆盖拖拽正控：需先导入一张使用 jQuery UI 拖拽的卡，再重跑 M7。')
} else {
  console.log(`\n[E-F 前提] 抽样池**可以**覆盖拖拽正控 —— 建议把下列卡加入 M7 池：`)
  for (const h of hits) console.log(`  · ${h.rel}`)
}
process.exit(0)

/* ============================================================================
 * 装置自身的坑（本脚本的成立过程 —— P-30/P-19 家族，共 5 例，全部**表现为「命中 0」**）
 * ----------------------------------------------------------------------------
 * 1) shell 里写 `for d in <星号><斜杠>` 时，toybox sh 下 **glob 不展开** ⇒ 循环零次 ⇒ 打印「命中 0」。
 * 2) 会话目录名以 **`--`** 开头 ⇒ `ls "$d"` 被 toybox 当成**未知选项** ⇒ 取值失败 ⇒ 每轮 continue。
 * 3) **层级猜错**：真结构是 `<workspace>/<sessionId>/session*.jsonl`（两层），
 *    而早期版本在**工作区根层**找 `session*.jsonl`。
 * 4) `data_mirror/data_ce/null/0/<pkg>/…`（CE 存储**镜像** bind mount）被无深度限制的
 *    `find` 递归进去 ⇒ 枚举 87 个（真实 29），镜像路径 `cat` 失败 ⇒ 正控通过 0，
 *    而汇总**照样**打印「命中 0 张」——**看起来完全正常**。
 * 5) ★ 最隐蔽的一条：**同一命令在「设备脚本内执行」得 29 条（正确），
 *    经 `PowerShell → adb → 设备 sh → run-as → sh -c` 转发后得 87 条且混入镜像路径**
 *    （`-maxdepth` 也会在转发后整体失效、静默返回 0 条）。
 *    ⇒ 结论：**判据不得自己构造被转发多层的命令**；把命令构造固定在**一层解析**的
 *      载体里（设备侧脚本文件），判据只读结果。
 *
 * 共同教训：这 5 种失效与「设备上确实没有拖拽卡」**输出完全相同**。
 * 故本脚本强制三件事：装置自证同屏、逐模式 0 也打印、自证不过则声明结论不可信。
 * ========================================================================== */
