#!/usr/bin/env node
/**
 * audit-dsh-version.mjs —— DSH 运行时版本与**数据兼容形态**的一致性审计
 * ============================================================================
 * 【为什么需要它】（P-40 的机器化 · GOAL §七 R21 / §11.1 W25）
 *
 * 此前「当前锁定的版本」**没有任何机器可读的单源**：
 *   · `rp-workspace/package.json`        → `0.1.2-rc.1`（**过期**）
 *   · `dsh-runtime-src/package.json`     → `0.1.5-rc.1`
 *   · `dsh-runtime-android/package.json` → `0.1.5-rc.1`
 *   · README / TASK-LIST / MASTER_TODO   → `0.1.5-rc.1`
 * 而整棵 runtime 的代次**只由命令行那一个 `-DshVersion` 决定**，仓库里没有任何断言。
 *
 * 后果（第二十七轮 W24c 实测）：照抄上一轮的 `-DshVersion 0.1.2-rc.1` 重建，
 * `@deepseek-ai/dsh` 对子包只做 **caret** 依赖 ⇒ 整树落成 0.1.2 世代 ⇒
 * `dsh-session.isReplaceOp` 要求 `op` + **`start`** + **`end`**（**严格三键**），
 * 而设备上 **1747 处真实会话数据**是 `{"op":"replace","startSeq":N,"endSeq":N}`
 * ⇒ 官方 loader 直接拒绝既有日志 ⇒ **历史会话全部打不开**
 *（不是「功能不对」，是「数据读不出来」）。当时是 `audit-official-contract.mjs`
 *  的 `surfaceop-field-names` 面判 BLOCK 才拦下 —— 属侥幸，不该依赖。
 *
 * 【本脚本的判据（落在**产物**，不落在配置本身 —— 守 P-24）】
 *   ① **单源存在且格式合法**：`rp-workspace/dsh-version.json` 可读、含
 *      `dshVersion` 与 `sessionReplaceOpFields`；
 *   ② **声明与产物一致**：`dsh-runtime-android` 里**真实解析出来的** dsh 主包版本
 *      必须与单源的 `dshVersion` 一致（caret 漂移会在这里暴露）；
 *   ③ **数据兼容形态一致**（★ 最关键、最本质的一条）：从**构建产物**
 *      `dsh-session/lib/index.js` 的 `isReplaceOp` 里**抽出官方要求的字段名集合**，
 *      与单源声明的 `sessionReplaceOpFields` 逐字比对。
 *      ⇒ 这一条**不依赖版本号**：官方就算把版本号写错、或我们自己 pin 错版本，
 *        只要字段名形态变了就会被抓到（这正是「锚在决定数据形态的事实上」）。
 *   ④ **设备对照（可选）**：能连 adb 时，读设备上正在跑的 dsh 版本与**真实数据里的
 *      字段名**，与单源比对；降级（设备版本 > 单源版本）**出声报错**。
 *      设备不可达 ⇒ 记 SKIP 并出声（P-17：区分「事实是否定」与「我们测不出来」）。
 *
 * 【为什么 ③ 比 ② 更重要】
 *   版本号是**代理量**，字段名才是**决定数据能否被读出的那个事实**。
 *   上游可以在同一个 rc 号里改形态（F-2 类），也可以跨 rc 号保持形态不变。
 *   锚在版本号上的判据会在前者沉默、在后者误报；锚在字段名上的判据两个方向都对。
 *
 * 用法：
 *   node rp-workspace/scripts/audit-dsh-version.mjs            # 审计（含设备对照，尽力而为）
 *   node rp-workspace/scripts/audit-dsh-version.mjs --no-device # 跳过设备（CI / 无 adb）
 *   node rp-workspace/scripts/audit-dsh-version.mjs --selftest  # 判据自身正/负控（P-30）
 * 退出码：0=通过（或仅 SKIP）；1=不一致（fail-closed）；2=单源缺失/格式非法；3=selftest 失败
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { reportSelftest } from './selftest-summary.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WS = path.resolve(HERE, '..')            // rp-workspace
const SSOT = path.join(WS, 'dsh-version.json')
const RT = path.join(WS, 'dsh-runtime-android')
const ADB = process.env.DSHT_ADB ?? 'C:\\Users\\Administrator\\.android\\sdk\\platform-tools\\adb.exe'
const PKG = 'com.dshtavern.app'

// ---------------------------------------------------------------------------
// 纯函数区（可被 selftest 直接调用 —— 判据单源，P-1）
// ---------------------------------------------------------------------------

/**
 * 读一个 JSON 文件并解析，**容忍 UTF-8 BOM**。
 *
 * ## 为什么必须有这个函数（W28 实测的**决定性实验**，不是防御性编程）
 * 同一个 `dsh-version.json` 有两个读者，而它们对 BOM 的要求**相反**：
 *
 * | 读取方 | 无 BOM | 带 BOM |
 * |---|---|---|
 * | PowerShell 5.1 `Get-Content -Raw \| ConvertFrom-Json`（**默认编码**） | **失败**（按 GBK 解码 ⇒ 中文注释乱码 ⇒ JSON 非法） | OK |
 * | PowerShell 5.1 同上 + `-Encoding UTF8` | OK | OK |
 * | node `JSON.parse(fs.readFileSync(p,'utf8'))` | OK | **失败**（`Unexpected token '\uFEFF'`） |
 *
 * ⇒ 两侧不可能同时满足：「不加 BOM」会**中断构建**（Step 0.7 fail-closed，实测踩到），
 *   「加 BOM」会让 node 侧**解析失败**。
 * ⇒ 唯一解：**文件带 BOM**（保构建链）+ **node 侧剥 BOM**（本函数）。
 *
 * ⚠️ 该实验**必须用 `powershell.exe`（5.1）跑**（PS7 默认 UTF-8，两种都不会失败）。
 */
export function readJsonTolerant (file) {
  const raw = fs.readFileSync(file, 'utf8')
  return JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw)
}

/**
 * 从 dsh-session 的产物源码里抽出 `isReplaceOp` 要求的**字段名集合**。
 *
 * 为什么不用正则直接匹配 `startSeq`：实测官方有两种写法（`Object.hasOwn(op, "startSeq")`
 * 与 `op["startSeq"]`），且未来可能再变。⇒ 判据应**先定位 isReplaceOp 函数体**，
 * 再在体内抽**键名**。
 *
 * ## 【判据自身的缺陷 · 自证当场抓到（P-19/P-30 又一活例）】
 * 首版把体内的**所有字符串字面量**都当键名 ⇒ 把 `op["op"] === "replace"` 里的
 * **值** `"replace"` 也当成了键 ⇒ 抽出 4 个键 `op,startSeq,endSeq,replace`
 * ⇒ 正控 1/2/杠杆/负控 1 全部误报 FAIL（**证据串与结论矛盾**：实得 4 键里明显有一个是值）。
 * ⇒ 修法：只抽**键位置**上的字面量 —— 即 `hasOwn(x, "k")` 的第二参、`x["k"]` 的下标。
 *   不再用「体内全部字面量」这种宽口径（宽口径 = 把值、报错文案、比较字面量都吸进来）。
 *
 * @param {string} src dsh-session/lib/index.js 全文
 * @returns {{ fields: string[]|null, evidence: string }}
 */
export function parseReplaceOpFields (src) {
  // 定位函数体：`function isReplaceOp(value) {` … 到下一个顶层 `}` 行
  const m = /function isReplaceOp\s*\([^)]*\)\s*\{([\s\S]{0,2000}?)\n\}/.exec(src)
  if (m === null) return { fields: null, evidence: '未找到 isReplaceOp 函数（官方可能改名/重构）' }
  const body = m[1]
  // 只抽**键位置**的字面量（两种官方写法）：
  //   ① Object.hasOwn(op, "startSeq") / Object.prototype.hasOwnProperty.call(op, "x")
  //   ② op["startSeq"]
  const keys = []
  for (const mm of body.matchAll(/(?:hasOwn|hasOwnProperty\s*\.\s*call)\s*\(\s*[^,)]+,\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g)) keys.push(mm[1])
  for (const mm of body.matchAll(/\[["']([A-Za-z_][A-Za-z0-9_]*)["']\]/g)) keys.push(mm[1])
  const uniq = [...new Set(keys)]
  if (uniq.length === 0) return { fields: null, evidence: `isReplaceOp 体内未抽到任何键位置字面量（写法可能已变）：${body.replace(/\s+/g, ' ').slice(0, 160)}` }
  if (!uniq.includes('op')) return { fields: null, evidence: `抽到的键里没有 'op'（实得：${uniq.join(',')}）—— 形态与预期不符` }
  const rest = uniq.filter(x => x !== 'op')
  if (rest.length !== 2) return { fields: null, evidence: `isReplaceOp 应为三键（op + 两端），实得 ${uniq.length} 个键：${uniq.join(',')}` }
  return { fields: ['op', ...rest], evidence: `isReplaceOp 要求 ${['op', ...rest].join(' / ')}` }
}

/**
 * 比对两个字段名集合（**顺序无关** —— 官方源码里键的出现序不是契约）。
 * @returns {{ ok: boolean, note: string }}
 */
export function compareFields (declared, actual) {
  if (!Array.isArray(declared) || declared.length === 0) return { ok: false, note: '单源未声明 sessionReplaceOpFields' }
  if (!Array.isArray(actual) || actual.length === 0) return { ok: false, note: '产物里未解析出字段名' }
  const a = [...declared].sort().join(',')
  const b = [...actual].sort().join(',')
  if (a === b) return { ok: true, note: `一致（${a}）` }
  return { ok: false, note: `**不一致**：单源声明 [${a}] vs 产物实测 [${b}]` }
}

/**
 * 从真实会话数据里统计 `surfaceOp` 的字段形态（**结果层证据**）。
 * @param {string} jsonl session.v3.jsonl 全文
 * @returns {{ tally: Map<string,number>, withStartSeq: number, withStartEnd: number, total: number }}
 */
export function tallySurfaceOpFields (jsonl) {
  const tally = new Map()
  let withStartSeq = 0
  let withStartEnd = 0
  let total = 0
  const re = /"surfaceOp":(\{[^}]*\}|"[a-z]+")/g
  for (const ln of String(jsonl).split('\n')) {
    if (!ln.includes('"surfaceOp"')) continue
    re.lastIndex = 0
    let m
    while ((m = re.exec(ln)) !== null) {
      const v = m[1]
      total += 1
      tally.set(v, (tally.get(v) ?? 0) + 1)
      if (v.includes('startSeq') && v.includes('endSeq')) withStartSeq += 1
      else if (/"start"/.test(v) && /"end"/.test(v)) withStartEnd += 1
    }
  }
  return { tally, withStartSeq, withStartEnd, total }
}

/**
 * ★ 汇总子包版本分布 —— **判据②的补盲**（2026-09-23 DSH 升级轮新增）。
 *
 * ## 为什么必须有它（P-11 元级：判据的覆盖面本身就是缺陷）
 * 判据② 只比对**顶层** `@deepseek-ai/dsh` 的版本。而顶层对子包用的是 **caret**
 * （`"…dsh-session": "^0.1.5-rc.1"`）⇒ **子包实际解析到哪一代，判据②看不见**。
 * 2026-09-23 实测的形态：顶层 pin `0.1.5-rc.1`，而 **230 个子包已解析到 `0.1.5-rc.3`**
 * ——「顶层旧、子包新」的**版本分裂**，覆盖几乎整个运行时，而全仓判据零感知。
 *
 * ## 判据设计（为什么是「同代」而不是「等于顶层」）
 * 官方允许 rc 内迭代：顶层 `0.1.5-rc.1` 的子包依赖写 caret，解析到 `rc.3` 是**合法**的。
 * 真正要拦的是**跨代**（如顶层 0.1.5 而子包落到 0.1.2）——那正是 W24c 事故的形态。
 * ⇒ 判据：**所有 `dsh*` 子包的主版本线（major.minor）必须与单源声明一致**；
 *    caret 在**同一 rc 线内**漂移只出声（ⓘ），**跨 major.minor 即 FAIL**。
 *
 * @param {string} nmDir node_modules/@deepseek-ai 目录
 * @param {(p:string)=>string} readPkg 读 package.json 文本的函数（selftest 注入）
 * @returns {{ total:number, dist:Map<string,number>, offLine:string[], evidence:string }}
 */
export function tallySubpackageVersions (nmDir, readPkg) {
  const out = { total: 0, dist: new Map(), offLine: [], evidence: '' }
  let names = []
  try { names = fs.readdirSync(nmDir) } catch { out.evidence = '读不到 node_modules/@deepseek-ai'; return out }
  const lineOf = (v) => String(v).split('-')[0]          // 0.1.5-rc.3 → 0.1.5
  for (const n of names) {
    if (!n.startsWith('dsh')) continue
    let txt = null
    try { txt = readPkg(path.join(nmDir, n, 'package.json')) } catch { txt = null }
    if (txt === null) continue
    let v = null
    try { v = JSON.parse(txt).version } catch { continue }
    if (typeof v !== 'string') continue
    out.total += 1
    out.dist.set(v, (out.dist.get(v) ?? 0) + 1)
    out.offLine.push(`${n}@${v}`)
  }
  out.evidence = [...out.dist.entries()].map(([v, c]) => `${v}×${c}`).join(' · ')
  return { ...out, lineOf }
}

/**
 * 判据：子包版本是否**全部落在单源声明的主版本线内**。
 * @returns {{ ok:boolean, note:string, offLine:string[] }}
 */
export function checkSubpackageLine (declaredVersion, dist, total) {
  if (total === 0) return { ok: false, note: '未扫到任何 dsh* 子包（runtime 未就绪？）', offLine: [] }
  const want = String(declaredVersion).split('-')[0]
  const off = []
  for (const v of dist.keys()) {
    if (String(v).split('-')[0] !== want) off.push(v)
  }
  if (off.length === 0) {
    const distinct = [...dist.keys()]
    if (distinct.length === 1 && distinct[0] === declaredVersion) {
      return { ok: true, note: `全部 ${total} 个子包 == 单源 ${declaredVersion}（无漂移）`, offLine: [] }
    }
    return {
      ok: true,
      note: `全部 ${total} 个子包落在 ${want} 线内，但存在 rc 级漂移（${distinct.join(' / ')}）；` +
        `单源顶层 ${declaredVersion} —— caret 同线漂移属合法，但**应显式记录**`,
      offLine: [],
    }
  }
  return {
    ok: false,
    note: `**跨代分裂**：单源声明主版本线 ${want}，而有子包落在 ${off.join(' / ')} ⇒ ` +
      `装出去可能与既有会话数据不兼容（W24c 事故形态）`,
    offLine: off,
  }
}

// ---------------------------------------------------------------------------
// selftest（P-30：静态/结构判据必须自带合成正负控 ——「真实仓库 0 命中」不是证据）
// ---------------------------------------------------------------------------
if (process.argv.includes('--selftest')) {
  let pass = 0
  const fail = []
  const ok = (cond, label) => { if (cond) { pass += 1; console.log(`[ok] ${label}`) } else { fail.push(label); console.log(`[FAIL] ${label}`) } }

  console.log('=== audit-dsh-version --selftest（判据自身正/负控）===')

  // 正控 1：当前世代形态（hasOwn 写法）
  const srcCurrent = 'function isReplaceOp(value) {\n\tconst op = value;\n\treturn Object.keys(op).length === 3 && Object.hasOwn(op, "op") && Object.hasOwn(op, "startSeq") && Object.hasOwn(op, "endSeq") && op["op"] === "replace";\n}'
  const r1 = parseReplaceOpFields(srcCurrent)
  ok(r1.fields !== null && r1.fields.join(',') === 'op,startSeq,endSeq', `正控1 抽出 0.1.5 形态 ${JSON.stringify(r1.fields || r1.evidence)}`)

  // 正控 2：旧世代形态（start/end）—— 必须抽得出来，且**与上面不同**
  const srcOld = 'function isReplaceOp(value) {\n\tconst op = value;\n\treturn Object.keys(op).length === 3 && Object.hasOwn(op, "op") && Object.hasOwn(op, "start") && Object.hasOwn(op, "end") && op["op"] === "replace";\n}'
  const r2 = parseReplaceOpFields(srcOld)
  ok(r2.fields !== null && r2.fields.join(',') === 'op,start,end', `正控2 抽出 0.1.2 形态 ${JSON.stringify(r2.fields || r2.evidence)}`)

  // ★ 杠杆断言（P-20）：两种形态必须被判为**不同**，否则判据无区分力
  ok(r1.fields !== null && r2.fields !== null && compareFields(r1.fields, r2.fields).ok === false,
    '★杠杆 0.1.5 形态 vs 0.1.2 形态 ⇒ 判为不一致（判据真的能区分换代）')

  // 负控 1：括号取键写法（官方另一种合法写法）
  const srcBracket = 'function isReplaceOp(value) {\n\tconst op = value;\n\treturn Object.keys(op).length === 3 && op["op"] === "replace" && op["startSeq"] !== void 0 && op["endSeq"] !== void 0;\n}'
  const r3 = parseReplaceOpFields(srcBracket)
  ok(r3.fields !== null && r3.fields.join(',') === 'op,startSeq,endSeq', `负控1 括号取键写法也认出 ${JSON.stringify(r3.fields || r3.evidence)}`)

  // 负控 2：函数被改名/删除 ⇒ 必须报「测不出」而不是「通过」（P-17）
  const r4 = parseReplaceOpFields('function isReplacementOp(value) { return true }')
  ok(r4.fields === null, `负控2 函数缺失 ⇒ fields=null（测不出，非通过）：${r4.evidence}`)

  // 负控 3：键数不是 3（官方若改四键）⇒ 必须报「测不出」而不是猜
  const srcFour = 'function isReplaceOp(value) {\n\tconst op = value;\n\treturn Object.hasOwn(op, "op") && Object.hasOwn(op, "startSeq") && Object.hasOwn(op, "endSeq") && Object.hasOwn(op, "extra");\n}'
  const r5 = parseReplaceOpFields(srcFour)
  ok(r5.fields === null, `负控3 四键 ⇒ fields=null（不硬猜）：${r5.evidence}`)

  // 正控 3：真实数据统计（0.1.5 形态）
  const dataCurrent = '{"a":1,"surfaceOp":{"op":"replace","startSeq":3,"endSeq":3}}\n{"surfaceOp":"append"}\n{"surfaceOp":{"op":"replace","startSeq":8,"endSeq":8}}'
  const t1 = tallySurfaceOpFields(dataCurrent)
  ok(t1.withStartSeq === 2 && t1.withStartEnd === 0 && t1.total === 3, `正控3 真实数据统计：startSeq=${t1.withStartSeq} startEnd=${t1.withStartEnd} total=${t1.total}`)

  // 负控 4：旧形态数据必须被统计到另一侧（不得混为一谈）
  const dataOld = '{"surfaceOp":{"op":"replace","start":3,"end":3}}'
  const t2 = tallySurfaceOpFields(dataOld)
  ok(t2.withStartEnd === 1 && t2.withStartSeq === 0, `负控4 旧形态归到 startEnd=${t2.withStartEnd}`)

  // 负控 5：空/无 surfaceOp ⇒ 全 0（不得把「没有」当成「有」）
  const t3 = tallySurfaceOpFields('{"x":1}\n')
  ok(t3.total === 0, `负控5 无 surfaceOp ⇒ total=0（实得 ${t3.total}）`)

  // ★ 判据⑤ 子包版本漂移（2026-09-23 新增）：这是判据② 的**覆盖面补盲**，
  //   必须自带正负控 —— 否则「真实仓库全绿」可能只是因为它恒返 ok（P-30）。
  //   正控 1：跨代分裂（顶层 0.1.5 线，子包落 0.1.2 线）⇒ 必须 FAIL
  const distCross = new Map([['0.1.2-rc.1', 5], ['0.1.5-rc.3', 226]])
  const rCross = checkSubpackageLine('0.1.5-rc.3', distCross, 231)
  ok(rCross.ok === false, `正控6 跨代分裂（0.1.5 线 vs 0.1.2 线）⇒ FAIL：${rCross.note.slice(0, 60)}`)

  //   正控 2（★ 真实事故形态）：顶层 0.1.5-rc.1 + 子包全 0.1.5-rc.3 ⇒ **同线，放行**
  //   —— 这正是 2026-09-23 实测到的形态（判据② 完全看不见，判据⑤ 必须看见但**不误报**）
  const distSameLine = new Map([['0.1.5-rc.3', 230], ['0.1.5-rc.1', 1]])
  const rSame = checkSubpackageLine('0.1.5-rc.1', distSameLine, 231)
  ok(rSame.ok === true && /漂移/.test(rSame.note),
    `正控7 同线 rc 漂移（顶层 rc.1 / 子包 rc.3）⇒ 放行但**出声**：${rSame.note.slice(0, 50)}`)

  //   负控 6：完全一致 ⇒ 必须 ok 且 note 明确说「无漂移」
  const distClean = new Map([['0.1.5-rc.3', 231]])
  const rClean = checkSubpackageLine('0.1.5-rc.3', distClean, 231)
  ok(rClean.ok === true && /无漂移/.test(rClean.note), `负控6 全都一致 ⇒ ok 且报「无漂移」`)

  //   负控 7：扫不到子包 ⇒ 必须 FAIL（不得因「读不到」而放行 —— P-17）
  const rEmpty = checkSubpackageLine('0.1.5-rc.3', new Map(), 0)
  ok(rEmpty.ok === false, `负控7 扫不到子包 ⇒ FAIL（不得把「测不出」当通过）`)

  //   杠杆：同一份 dist，换一个单源主版本线 ⇒ 结论必须翻转（证明判据真的有区分力）
  const rLever = checkSubpackageLine('0.1.2-rc.1', distCross, 231)
  ok(rLever.ok === false && rCross.ok === false && rClean.ok === true,
    '★杠杆 同一 dist 换单源版本线 ⇒ 跨代 FAIL / 同代 PASS（判据能区分世代）')

  // ★ 单源输出契约（W44 建立）：W45 第二轮实测发现本闸门**未接入**（收尾是旧形态
  //   `[audit-dsh-version selftest] 9/9 PASS`）⇒ 而文档声明着它的分数 ⇒ **无法被证伪**（P-50 纪律①）。
  reportSelftest('dsh-version', pass, pass + fail.length)
  if (fail.length) { console.log('失败项：' + fail.join('；')); process.exit(3) }
  process.exit(0)
}

// ---------------------------------------------------------------------------
// 主审计
// ---------------------------------------------------------------------------
const NO_DEVICE = process.argv.includes('--no-device')
const rows = []
const rec = (name, status, note) => { rows.push({ name, status, note }); const mark = status === 'OK' ? '✓' : status === 'SKIP' ? 'ⓘ' : '✗'; console.log(`${mark} ${name}\n    ${note}`) }

console.log('[audit-dsh-version] DSH 版本与数据兼容形态审计\n')

// ---- ① 单源存在且格式合法 ----
if (!fs.existsSync(SSOT)) {
  console.error(`✗ 单一事实来源缺失：${SSOT}（见 docs/GOAL.md §七 R21）`)
  process.exit(2)
}
let ssot
try {
  ssot = readJsonTolerant(SSOT)
} catch (e) {
  console.error(`✗ 单一事实来源不是合法 JSON：${e.message}`)
  process.exit(2)
}
if (typeof ssot.dshVersion !== 'string' || !Array.isArray(ssot.sessionReplaceOpFields)) {
  console.error('✗ 单一事实来源缺字段：需要 dshVersion(string) 与 sessionReplaceOpFields(array)')
  process.exit(2)
}
rec('① 单源合法', 'OK', `${path.relative(WS, SSOT)}：dshVersion=${ssot.dshVersion} · 期望字段=[${ssot.sessionReplaceOpFields.join(', ')}]`)

// ---- ② 声明与产物一致（dsh 主包版本） ----
const dshPkgPath = path.join(RT, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
if (fs.existsSync(dshPkgPath)) {
  const ver = JSON.parse(fs.readFileSync(dshPkgPath, 'utf8')).version
  if (ver === ssot.dshVersion) rec('② 产物 dsh 主包版本', 'OK', `实得 ${ver}（与单源一致）`)
  else rec('② 产物 dsh 主包版本', 'FAIL', `**不一致**：单源 ${ssot.dshVersion} vs 产物 ${ver}`)
} else {
  rec('② 产物 dsh 主包版本', 'SKIP', `runtime 未就绪（${dshPkgPath} 不存在）——SkipInstall 首次构建属正常，**不冒充通过**`)
}

// ---- ③ ★ 数据兼容形态（从产物抽 isReplaceOp 的字段名） ----
const sessIdx = path.join(RT, 'node_modules', '@deepseek-ai', 'dsh-session', 'lib', 'index.js')
let parsed = { fields: null, evidence: 'runtime 未就绪' }
if (fs.existsSync(sessIdx)) {
  parsed = parseReplaceOpFields(fs.readFileSync(sessIdx, 'utf8'))
}
if (parsed.fields === null) {
  if (fs.existsSync(sessIdx)) rec('③ 数据兼容形态（isReplaceOp 字段名）', 'FAIL', `**测不出**：${parsed.evidence} ⇒ 必须人工确认（不许静默放过）`)
  else rec('③ 数据兼容形态（isReplaceOp 字段名）', 'SKIP', 'runtime 未就绪（同上）')
} else {
  const cmp = compareFields(ssot.sessionReplaceOpFields, parsed.fields)
  rec('③ 数据兼容形态（isReplaceOp 字段名）', cmp.ok ? 'OK' : 'FAIL',
    cmp.ok ? `${parsed.evidence} —— 与单源一致` : `${cmp.note}　⇒ **装出去会让既有会话打不开**（官方 loader 严格三键校验）`)
}

// ---- ⑤ ★ 子包版本一致性（2026-09-23 新增：判据② 的覆盖面补盲） ----
//
// 【为什么单列一条而不是并进判据②】② 的语义是「产物**顶层**主包版本 == 单源」；
// 本条的语义是「**全部 dsh\* 子包**都落在单源的主版本线内」。两者**失败动作不同**：
// ② 失败 = 顶层装错了版本；⑤ 失败 = 顶层对了但**子树落到别的代次**（caret 漂移/registry 变了）。
// 合在一起会让「哪一种错了」变得不可分辨（P-1：诊断信息必须可分辨）。
{
  const nm = path.join(RT, 'node_modules', '@deepseek-ai')
  const tb = tallySubpackageVersions(nm, (p) => fs.readFileSync(p, 'utf8'))
  if (tb.total === 0) {
    rec('⑤ 子包版本一致性', 'SKIP', `runtime 未就绪（${nm} 下无 dsh* 子包）—— SkipInstall 首次构建属正常，**不冒充通过**`)
  } else {
    const r5 = checkSubpackageLine(ssot.dshVersion, tb.dist, tb.total)
    rec('⑤ 子包版本一致性', r5.ok ? 'OK' : 'FAIL',
      `${tb.total} 个子包：${tb.evidence}　⇒ ${r5.note}`)
  }
}

// ---- ④ 设备对照 ----
if (NO_DEVICE) {
  rec('④ 设备对照', 'SKIP', '本次传了 --no-device（按用户要求跳过）')
} else {
  // 设备侧读文件的**唯一入口**（P-1：不许两处各写一份 run-as 转发 —— 上一条注释里的
  // 「find 必须多 argv」正是同一个坑，两处写法必须一致才不会再犯）。
  const sh = (args) => {
    try { return execFileSync(ADB, ['shell', 'run-as', PKG, ...args], { encoding: 'utf8', timeout: 120000, maxBuffer: 256 * 1024 * 1024 }) } catch { return null }
  }
  const devPkg = sh(['cat', '/data/data/com.dshtavern.app/files/dsh-runtime/node_modules/@deepseek-ai/dsh/package.json'])
  if (devPkg === null || !devPkg.trim().startsWith('{')) {
    rec('④ 设备对照', 'SKIP', '设备不可达 / 应用未启动 / runtime 未解压 —— **测不出 ≠ 事实否定**（P-17），不冒充通过')
  } else {
    let devVer = null
    try { devVer = JSON.parse(devPkg).version } catch { /* 忽略 */ }
    // 降级判定：版本号比较（只比 MAJOR.MINOR.PATCH 数字段；rc 序号不参与，可能误报，故仅作提示）
    const num = (v) => String(v).split('-')[0].split('.').map(x => Number(x) || 0)
    const [a1, a2, a3] = num(devVer)
    const [b1, b2, b3] = num(ssot.dshVersion)
    const devNewer = (a1 > b1) || (a1 === b1 && (a2 > b2 || (a2 === b2 && a3 > b3)))

    // 设备真实数据的字段形态（结果层证据）
    //
    // 【判据自身的坑（P-19）· 第三形态】find 必须走**多 argv 形态**，不能用
    // `sh -c "find … | head"`：经 `execFileSync(ADB, ['shell','run-as',PKG,'sh','-c',cmd])`
    // 三层转发后**管道/重定向被吞**（或整串被当作单个词）⇒ find 返回空且**不报错**
    // ⇒ 判据静默退化成「未取到会话文件」。实测对照：直接 `adb shell run-as PKG find <绝对路径> -name X`
    // 正常返回。（上一轮的 `diag-surfaceop-fields.mjs` 同款坑，见方法论 §6.21c。）
    const findArgv = sh
    const devSessRaw = findArgv(['find', '/data/data/com.dshtavern.app/files/.dsh/sessions', '-name', 'session.v3.jsonl'])
    let dataNote = '（未取到会话文件，跳过数据形态统计）'
    if (typeof devSessRaw === 'string') {
      const files = String(devSessRaw).split('\n').map(s => s.trim()).filter(s => s.startsWith('/data/'))
      if (files.length === 0) {
        dataNote = '（find 有返回但无绝对路径行 —— 设备侧会话目录为空？）'
      } else {
        // 【判据自身的坑（P-19）· 第四形态：抽样偏置】首版取 `files.slice(0, 4)`。
        // 而 find 的输出顺序里**排在最前的是 `import/_adapter` 目录**（导入适配器的元数据会话），
        // 它们几乎全是 `"surfaceOp":"append"` ⇒ 抽到的 207 处里 `startSeq/endSeq=0 · start/end=0`
        // ⇒ 判据「看起来跑了」，实际**没验证到任何 replace 形态**（等价于零杠杆）。
        // ⇒ 修法：**优先抽含 replace surfaceOp 的会话** —— 先按目录名排序让 `rp-` 会话优先，
        //   再逐个读、累计到「已见到 replace」为止（上限放宽到 8 个文件）。
        //   并在结论里如实报「命中 replace 的会话数」，让「有没有杠杆」在证据里可见。
        const pref = (p) => (p.includes('/.dsh-rp-rp-') ? 0 : p.includes('/rp-') ? 1 : 2)
        const ordered = [...files].sort((a, b) => pref(a) - pref(b))
        const sample = ordered.slice(0, 8)
        let withStartSeq = 0
        let withStartEnd = 0
        let total = 0
        let filesWithReplace = 0
        for (const f of sample) {
          try {
            const body = execFileSync(ADB, ['shell', 'run-as', PKG, 'cat', f], { encoding: 'utf8', timeout: 120000, maxBuffer: 256 * 1024 * 1024 })
            const t = tallySurfaceOpFields(body)
            withStartSeq += t.withStartSeq
            withStartEnd += t.withStartEnd
            total += t.total
            if (t.withStartSeq + t.withStartEnd > 0) filesWithReplace += 1
          } catch { /* 单个文件读失败不致命，继续 */ }
        }
        dataNote = `设备真实数据（抽样 ${sample.length}/${files.length} 个会话，其中 ${filesWithReplace} 个含 replace）surfaceOp 计数 ${total} 处：startSeq/endSeq=${withStartSeq} · start/end=${withStartEnd}`
        if (withStartSeq > 0 && withStartEnd > 0) dataNote += '　⇒ **混形**（设备上存在两种世代的数据，需人工确认迁移策略）'
        else if (filesWithReplace === 0) dataNote += '　⇒ ⓘ 本次抽样**未覆盖任何 replace 形态**（该判据力前提不成立，不能据此宣称「数据形态兼容」）'
        else if (withStartSeq === 0 && withStartEnd > 0) dataNote += '　⇒ ⚠️ 设备数据是 **start/end 形态**，而单源声明的是 startSeq/endSeq ⇒ 需人工确认'
        else if (withStartSeq > 0) dataNote += '　⇒ ✓ 与单源声明的形态一致（真实数据层验证）'
      }
    }

    if (devVer === null) rec('④ 设备对照', 'SKIP', `设备 package.json 解析不出 version：${dataNote}`)
    else if (devNewer) rec('④ 设备对照', 'FAIL', `设备跑的 ${devVer} **比单源 ${ssot.dshVersion} 更新** ⇒ 本仓 runtime 相对设备是**降级**，构建前必须显式确认（R21）。${dataNote}`)
    else rec('④ 设备对照', 'OK', `设备 ${devVer} · 单源 ${ssot.dshVersion}（升或同级，放行）。${dataNote}`)
  }
}

// ---- 汇总 ----
const bad = rows.filter(r => r.status === 'FAIL')
const skip = rows.filter(r => r.status === 'SKIP')
console.log(`\n[audit-dsh-version] ${rows.length - bad.length - skip.length} OK / ${bad.length} FAIL / ${skip.length} SKIP`)
if (bad.length) {
  console.log('\n⛔ 失败项（fail-closed）：')
  for (const r of bad) console.log(`  · ${r.name} —— ${r.note}`)
  process.exit(1)
}
console.log('✅ 版本与数据兼容形态一致（无 FAIL）')
process.exit(0)
