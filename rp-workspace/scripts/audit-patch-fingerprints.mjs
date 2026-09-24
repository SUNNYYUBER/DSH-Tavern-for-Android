#!/usr/bin/env node
/**
 * audit-patch-fingerprints.mjs — 守「补丁锚点未跨代漂移」（附录 E.7 判据 C.4）
 * ============================================================================
 * 【为什么需要它】
 * `apply-platform-patches.py` 已有的判据是「**命中数**落在期望区间」。
 * 但「命中数相同」**不等于**「改的是同一处」：官方完全可能
 *   · 把锚点那行的**语义改了**（换个变量名、调整参数顺序）；
 *   · 或把该形态**搬到另一个函数**（处数仍为 1，但改的东西完全不同）。
 * 这两类漂移**命中数判据一律报 ✓**（假绿），而后果是补丁打在了「形似而非同一」的地方。
 * ⇒ 唯一能抓它的办法：比对**命中的那段原文**（指纹）。
 *
 * 【与采集侧的分工】（P-40③：判据必须跑在它所判对象状态确定之后）
 *   · `apply-platform-patches.py`（**在构建现场**，apply 模式）——只负责**采集 + 落盘**
 *     基线 `.dsht-anchor-fingerprints.json`。它跑的时候没有「上一代基线」这个概念。
 *   · 本文件（**在比对现场**）——读当前基线 + 读上一代基线，比对。
 *   ⇒ 两者都在各自状态确定的时刻跑，谁也不替对方猜。
 *
 * 【判据】
 *   1. **键集一致**：两代基线的补丁标签集合必须相等（少 = 补丁被删；多 = 新增，
 *      后者需人工确认——**新增补丁没有上一代可比 ⇒ 不是漂移**，如实出声即可）
 *   2. **指纹一致**：同一标签的指纹元组必须**逐元素相等**。
 *      不等 ⇒ 报「锚点漂移」（含两边指纹，便于人眼定位是哪一处变了）
 *
 * 【诚实边界（R7）】
 *  · 本判据只能发现「**同一标签的锚点原文变了**」，**不能**发现
 *    「锚点原文没变但官方在别处改了语义」—— 那类要真机/契约测试。
 *  · 上一代基线若不存在 ⇒ 本判据**跳过并出声**（不冒充通过，也不误报）。
 *
 * 用法：node scripts/audit-patch-fingerprints.mjs [--selftest]
 *       node scripts/audit-patch-fingerprints.mjs --current <基线.json> --previous <基线.json>
 * 退出码：0 = 无漂移（含「缺一代基线 ⇒ 跳过」）；1 = 有漂移；3 = selftest 失败
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const WS = resolve(HERE, '..')

/** 基线文件名（由 apply-platform-patches.py 写在 runtime 目录下）。 */
const FP_NAME = '.dsht-anchor-fingerprints.json'

/**
 * 默认路径。
 * ★ 【为什么当前基线默认指向 `dsh-runtime-android` 而不是 `dsh-runtime-src`】
 *   两棵树都会在构建中被写基线，但**只有 `dsh-runtime-android` 是最终进 APK 的那棵**
 *   （Step 3 从 src 复制过来、之后才打补丁）。C.4 要判的是「**要发货的那份产物**
 *   的锚点有没有漂移」⇒ 指向它才是对的（P-45：扫描面必须与真目标对齐）。
 *   实测踩过：默认指向 src ⇒ 报「未提供当前基线」（因为基线写在 android 那棵）。
 * 上一代基线：约定放在仓库根 `rp-workspace/dsh-runtime-prev-fingerprints.json`
 *   （升级换版本时，把上一代的基线文件另存为此名）。
 */
const DEFAULT_CURRENT = join(WS, 'dsh-runtime-android', FP_NAME)
const DEFAULT_PREVIOUS = join(WS, 'dsh-runtime-prev-fingerprints.json')

/**
 * 比对两份基线。
 * @returns {{problems: string[], notes: string[], skipped: boolean}}
 */
export function audit({ current, previous, currentLabel = '当前', previousLabel = '上一代' }) {
  const problems = []
  const notes = []

  if (current === null || current === undefined) {
    return { problems: [`未提供${currentLabel}基线（${FP_NAME}）—— 无法判定漂移`], notes, skipped: true }
  }
  if (previous === null || previous === undefined) {
    notes.push(`⚠ 未提供${previousLabel}基线 ⇒ **跳过比对**（不冒充通过）——`
      + `首次建立基线时属正常；若要跨代比对，请把上一代的 ${FP_NAME} 存为`
      + ` rp-workspace/dsh-runtime-prev-fingerprints.json`)
    return { problems: [], notes, skipped: true }
  }

  // `_comment` 是元数据，不参与比对；其余键即补丁标签。
  const keysOf = (o) => Object.keys(o ?? {}).filter((k) => k !== '_comment').sort()
  const curKeys = keysOf(current)
  const prevKeys = keysOf(previous)

  if (curKeys.length === 0) {
    return { problems: [`${currentLabel}基线里**一个锚点都没有**（${FP_NAME} 是空的或格式不对）`], notes, skipped: false }
  }

  for (const k of prevKeys) {
    if (!curKeys.includes(k)) {
      problems.push(`补丁消失：'${k}' 在${previousLabel}基线里有、在${currentLabel}里没有`
        + ` ⇒ 该补丁可能被删了，或标签被改名（改名也要报 —— 否则漂移对不上号）`)
    }
  }
  for (const k of curKeys) {
    if (!prevKeys.includes(k)) {
      // 新增补丁**没有上一代可比** ⇒ 不是漂移，如实出声
      notes.push(`新增补丁：'${k}'（${currentLabel}独有）—— 无上一代可比，不判漂移`)
    }
  }

  let same = 0
  let emptyCur = 0
  for (const k of curKeys) {
    if (!prevKeys.includes(k)) continue
    const a = JSON.stringify(current[k])
    const b = JSON.stringify(previous[k])
    if (Array.isArray(current[k]) && current[k].length === 0) emptyCur++
    if (a === b) { same++; continue }
    problems.push(
      `锚点漂移：'${k}' —— 指纹变了（${currentLabel} ${a} vs ${previousLabel} ${b}）`
      + ` ⇒ 命中数可能没变，但**改的不是同一段原文**（官方改了这行语义，或把它搬到了别处）`,
    )
  }

  notes.push(`比对完成：${same} 项指纹一致${emptyCur ? `，其中 ${emptyCur} 项为空指纹（该代未命中）` : ''}`)
  return { problems, notes, skipped: false }
}

/** 读一份基线；不存在 / 解析失败 ⇒ 返回 undefined（由调用方决定是「跳过」还是「报错」）。 */
function loadBaseline(p) {
  if (!existsSync(p)) return undefined
  try {
    const j = JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''))
    return j.anchors ?? undefined
  } catch (e) {
    console.error(`  ! 基线解析失败 ${p}：${e.message}`)
    return undefined
  }
}

// ---------------------------------------------------------------------------
// selftest：正控 + 负控 + 零控
// ---------------------------------------------------------------------------

function selftest() {
  const results = []
  const ok = (name, cond) => results.push([name, !!cond])

  const prev = { 'P0-1': ['aaaaaaaa'], 'F2': ['bbbbbbbb'], 'P2-1': ['cccccccc', 'dddddddd'] }

  // 1) 正控：完全一致 ⇒ 无问题
  {
    const r = audit({ current: structuredClone(prev), previous: prev })
    ok('正控：两代指纹一致 ⇒ 无问题', r.problems.length === 0)
  }
  // 2) 负控 A：同一标签指纹变了（命中数不变）⇒ 必须报「漂移」
  {
    const cur = structuredClone(prev)
    cur['F2'] = ['eeeeeeee'] // 仍 1 处，但内容不同
    const r = audit({ current: cur, previous: prev })
    ok('负控A：指纹变了（处数不变）被抓为漂移',
      r.problems.some((p) => p.startsWith('锚点漂移') && p.includes("'F2'")))
  }
  // 3) 负控 B：指纹数组长度变了（1 处 → 2 处）
  {
    const cur = structuredClone(prev)
    cur['P0-1'] = ['aaaaaaaa', 'zzzzzzzz']
    const r = audit({ current: cur, previous: prev })
    ok('负控B：处数变多（指纹项数变）被抓为漂移',
      r.problems.some((p) => p.startsWith('锚点漂移') && p.includes("'P0-1'")))
  }
  // 4) 负控 C：补丁被删
  {
    const cur = structuredClone(prev)
    delete cur['F2']
    const r = audit({ current: cur, previous: prev })
    ok('负控C：补丁消失被抓', r.problems.some((p) => p.startsWith('补丁消失') && p.includes("'F2'")))
  }
  // 5) 负控 D：补丁改名（旧名消失 + 新名出现）⇒ 报「消失」，新名只出声
  {
    const cur = structuredClone(prev)
    delete cur['F2']
    cur['F2-renamed'] = ['bbbbbbbb']
    const r = audit({ current: cur, previous: prev })
    ok('负控D：改名被抓（旧名消失）', r.problems.some((p) => p.startsWith('补丁消失') && p.includes("'F2'")))
  }
  // 6) 零控 A：无上一代基线 ⇒ 跳过且**不报红**
  {
    const r = audit({ current: structuredClone(prev), previous: undefined })
    ok('零控A：无上一代 ⇒ 跳过且不报红', r.problems.length === 0 && r.skipped === true)
  }
  // 7) 零控 B：新增补丁 ⇒ 只出声，不报红
  {
    const cur = structuredClone(prev)
    cur['NEW'] = ['12345678']
    const r = audit({ current: cur, previous: prev })
    ok('零控B：新增补丁只出声不报红',
      r.problems.length === 0 && r.notes.some((n) => n.startsWith('新增补丁') && n.includes("'NEW'")))
  }
  // 8) 负控 E：当前基线为空对象 ⇒ 报「一个锚点都没有」
  {
    const r = audit({ current: {}, previous: prev })
    ok('负控E：当前基线为空被抓', r.problems.some((p) => p.includes('一个锚点都没有')))
  }
  // 9) 负控 F：当前基线缺失 ⇒ 报错并 skipped
  {
    const r = audit({ current: undefined, previous: prev })
    ok('负控F：当前基线缺失被抓', r.problems.length > 0 && r.skipped === true)
  }

  let pass = 0
  for (const [name, good] of results) {
    console.log(`${good ? '  PASS' : '  FAIL'}  ${name}`)
    if (good) pass++
  }
  console.log(`selftest: ${pass}/${results.length}`)
  process.exit(pass === results.length ? 0 : 3)
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

if (process.argv.includes('--selftest')) selftest()

// ★【为什么每个 flag 都显式写一遍，而不是用一个 `argOf(flag)` 通用 helper 收口】
//   本仓的 `audit-selftest-claims.mjs`（W77 判据）要求「**头注用法行声明的 flag，
//   实现里必须真的读它**」，而它的实现面口径是「逐行扫 `process.argv.indexOf('--x')`
//   这类**字面量**读取」。传参形态 `argOf('--current')` 里的 `'--current'` 是**实参**、
//   不是 `indexOf` 的直接参数 ⇒ 判据认不出（实测报 `bad=audit-patch-fingerprints.mjs(1)`）。
//   ⇒ 逐个 flag 写成字面量读取（可读性略降，但让判据**看得见** —— P-45：口径要与真目标对齐）。
const curIdx = process.argv.indexOf('--current')
const prevIdx = process.argv.indexOf('--previous')
const curPath = curIdx >= 0 && process.argv[curIdx + 1]
  ? resolve(process.argv[curIdx + 1])
  : DEFAULT_CURRENT
const prevPath = prevIdx >= 0 && process.argv[prevIdx + 1]
  ? resolve(process.argv[prevIdx + 1])
  : DEFAULT_PREVIOUS

console.log(`[锚点指纹] 当前基线：${curPath}`)
console.log(`[锚点指纹] 上一代基线：${prevPath}`)

const r = audit({
  current: loadBaseline(curPath),
  previous: loadBaseline(prevPath),
  currentLabel: '当前',
  previousLabel: '上一代',
})
for (const n of r.notes) console.log(`  · ${n}`)

if (r.problems.length === 0) {
  console.log(r.skipped
    ? 'SKIP  锚点指纹比对（缺一代基线 ⇒ 不冒充通过）'
    : 'PASS  锚点指纹无漂移（C.4）')
  process.exit(0)
}
for (const p of r.problems) console.error(`  ✗ ${p}`)
console.error(`\n锚点漂移 ${r.problems.length} 处 —— 补丁可能打在了"形似而非同一"的地方，勿发货`)
process.exit(1)
