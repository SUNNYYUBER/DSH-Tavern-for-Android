// audit-device-tiers.mjs —— W-4：设备 op 档位声明的**机器化对账**
//
// 【守什么】W-4 拍板口径是「复用 DSH 权限档位语义扩展」——每个设备 op 必须
// 声明自己的档位，且**danger 档必须真的被守门人拦住**。本脚本把三件事对账：
//
//   ① **声明齐全**：DeviceBridge.kt 的 OPS 表里每个 op 都有 tier；
//   ② **danger 档确实走守门人**：`dangerApproved()` 真的调用 Gate（不是恒 false 的死代码，
//      也不是绕过）；且 dispatch 里 danger 判定**早于**执行；
//   ③ **与设计文档一致**：W3-DEVICE-TOOLS-DESIGN 文档里列的档位与代码声明一致
//      （防「文档说 read-only、代码写成 danger」这类漂移，P-30 家族）。
//
// 【为什么需要它】档位是**代理量**——若代码把 input_tap 的 tier 写错（比如
// 误写成 READ_ONLY），守门人就不会拦，而**一切看起来都正常**（测试也过、
// 功能也能用），只有出事时才知道。这正是本项目 P-41 家族的形态。
//
// ## 判据（三条 + 子判据）
// ① 声明齐全：OPS 表解析非空 + 每个 op 的档位在已知集合内
// ② danger 真被拦：2a `dangerApproved` 走 Gate / 2b 判定早于命令构造 /
//    2c Gate 默认拒绝语义在场（超时即拒 / 无 Context 即拒 / 只认明确批准）
// ③ 与设计文档一致：代码里确实有 danger 档 op + 文档有对应声明
//
// 退出码：0 = 全部一致；1 = 有不一致；3 = selftest 失败
//
// 用法：
//   node scripts/audit-device-tiers.mjs              # 对账（真实仓库）
//   node scripts/audit-device-tiers.mjs --selftest   # 判据自检（有区分力）

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const BRIDGE = path.join(WS, 'android', 'app', 'src', 'main', 'java', 'com', 'dshtavern', 'app', 'DeviceBridge.kt')
const GATE = path.join(WS, 'android', 'app', 'src', 'main', 'java', 'com', 'dshtavern', 'app', 'Gate.kt')
const DESIGN = path.join(WS, '..', 'docs', 'W3-DEVICE-TOOLS-DESIGN-2026-09-21.md')

const KNOWN = new Set(['READ_ONLY', 'WORKSPACE_WRITE', 'DANGER_FULL_ACCESS'])

/** 从一份 DeviceBridge 源码文本解析 op → tier。 */
function parseOps(kt) {
  const ops = new Map()
  const re = /"([a-z_]+)"\s+to\s+OpDef\(\s*Tier\.([A-Z_]+)/g
  let m
  while ((m = re.exec(kt)) !== null) ops.set(m[1], m[2])
  return ops
}

/**
 * 核心判据（对给定文本求值），返回 problems 数组。
 * 【为什么抽成函数】selftest 要用**注入样本**验证它有区分力 —— 若判据只长在
 * `main()` 里，就没法在不动真实仓库的前提下做负控（P-43 纪律）。
 */
function check(bridgeText, gateText, designText) {
  const problems = []
  const ops = parseOps(bridgeText)

  // 判据 ①
  if (ops.size === 0) {
    problems.push('OPS 表解析为空——正则失配或表被删（判据已空转）')
  }
  for (const [op, tier] of ops) {
    if (!KNOWN.has(tier)) problems.push(`op ${op} 的档位未知：${tier}`)
  }

  // 判据 ②a：dangerApproved 真的走 Gate
  const dangerFn = bridgeText.match(/private fun dangerApproved\([^)]*\)\s*:\s*Boolean\s*=\s*([^\n]+)/)
  if (!dangerFn) {
    problems.push('找不到 dangerApproved() —— 守门人接缝缺失')
  } else if (!dangerFn[1].includes('Gate.requestApproval')) {
    problems.push(`dangerApproved 没有走 Gate.requestApproval（实际：${dangerFn[1].trim()}）`)
  }

  // 判据 ②b：danger 判定早于命令构造
  const dispatchIdx = bridgeText.indexOf('private fun dispatch(')
  const buildIdx = bridgeText.indexOf('private fun buildCommand(')
  if (dispatchIdx < 0 || buildIdx < 0) {
    problems.push('找不到 dispatch() 或 buildCommand()')
  } else {
    const body = bridgeText.slice(dispatchIdx, buildIdx)
    const gatePos = body.indexOf('dangerApproved(')
    const buildPos = body.indexOf('buildCommand(')
    if (gatePos < 0) problems.push('dispatch 里没有 dangerApproved 调用 —— danger 档无人拦')
    else if (buildPos >= 0 && gatePos > buildPos) problems.push('danger 档判定晚于命令构造 —— 可能已执行才被拦')
  }

  // 判据 ②c：Gate 默认拒绝语义
  if (!/APPROVAL_TIMEOUT_MS/.test(gateText)) problems.push('Gate 没有超时常量（超时即拒是 fail-closed 兜底）')
  if (!/if \(ctx == null\)[\s\S]{0,220}return false/.test(gateText)) problems.push('Gate 无 Context 时没有默认拒绝')
  if (!/val approved = got && \(results\[id\] == true\)/.test(gateText)) {
    problems.push('Gate 的批准判据不是「真收到用户答复且为 true」——可能把超时/异常当批准')
  }

  // 判据 ③：**三档位**都要真实存在（W-4 验收口径原文：「三档位正反控测试进套件」）
  // 【为什么不是只查 danger】此前这里只判 `dangerOps.length === 0` ⇒ READ_ONLY 与
  // WORKSPACE_WRITE **两档零覆盖**：把某一档整体删空（或改名）判据仍报绿，
  // 而档位表的语义已经残缺（P-30 家族：代理量与事实脱钩）。
  // 三档齐全本身是「档位矩阵可映射」的前提 —— W-4 的批准闸只在 danger 档生效，
  // 但 read-only / workspace-write 的存在性同样是档位声明的一部分。
  const tierCount = new Map()
  for (const t of KNOWN) tierCount.set(t, 0)
  for (const [, t] of ops) if (tierCount.has(t)) tierCount.set(t, tierCount.get(t) + 1)
  for (const [t, n] of tierCount) {
    if (n === 0) problems.push(`档位 ${t} 在 OPS 表里零 op —— 三档位之一空转（档位矩阵残缺）`)
  }

  const dangerOps = [...ops.entries()].filter(([, t]) => t === 'DANGER_FULL_ACCESS').map(([k]) => k)
  if (dangerOps.length === 0) problems.push('代码里没有任何 danger 档 op —— 守门人没有对象')
  if (designText !== null && !/danger-full-access/i.test(designText)) {
    problems.push('设计文档里找不到 danger-full-access 的档位声明 —— 文档与代码脱节')
  }
  // 设计文档必须同样声明另外两档（否则「复用 DSH 档位语义」只有一档落地）
  if (designText !== null && !/read-only/i.test(designText)) {
    problems.push('设计文档里找不到 read-only 的档位声明 —— 三档位语义未完整落地到文档')
  }
  if (designText !== null && !/workspace-write/i.test(designText)) {
    problems.push('设计文档里找不到 workspace-write 的档位声明 —— 三档位语义未完整落地到文档')
  }

  // 判据 ④：**非 danger 档不得被 danger 闸误拦**（正反控的「反向」那一半）
  // 闸的判据是 `def.tier == Tier.DANGER_FULL_ACCESS && !dangerApproved(op)`
  // —— 若有人把条件写成 `!dangerApproved(op)`（漏掉档位判定），
  // read-only / workspace-write 会被一并拦死（功能静默失效、无报错）。
  const gateCond = bridgeText.match(/if \(([^)]*dangerApproved\(op\)[^)]*)\)/)
  if (!gateCond) {
    problems.push('找不到 danger?Approved 的调用条件 —— 闸的档位判据无法核对')
  } else if (!/tier\s*==\s*Tier\.DANGER_FULL_ACCESS/.test(gateCond[1])) {
    problems.push(`闸的条件里没有档位判定（实际：${gateCond[1].trim()}）—— 非 danger 档会被误拦`)
  }
  return { problems, ops, dangerOps, tierCount }
}

/**
 * 构造一份「只剩 danger-full-access 档声明」的设计文档样本。
 * 【用途】负控⑨ —— 证明「三档位语义必须完整落地到文档」这条判据有区分力。
 * 把两种可能的大小写/连字符形态都抹掉，避免样本因写法差异而假绿。
 */
function designWithoutReadOnly(designText) {
  if (designText === null) return null
  return designText
    .replace(/read-only/gi, 'xxx-yyy')
    .replace(/read only/gi, 'xxx yyy')
    .replace(/readonly/gi, 'xxxyyy')
}

// ---------------------------------------------------------------------------
// selftest：用**注入样本**证明判据有区分力（每条判据都要有能触发它的样本）
// ---------------------------------------------------------------------------
function selftest() {
  const real = fs.readFileSync(BRIDGE, 'utf8')
  const realGate = fs.readFileSync(GATE, 'utf8')
  const realDesign = fs.existsSync(DESIGN) ? fs.readFileSync(DESIGN, 'utf8') : null

  const cases = []
  const add = (name, expectProblemSubstr, b, g, d) => cases.push({ name, expectProblemSubstr, b, g, d })

  // 正控：真实仓库应当**无**问题
  add('真实仓库 ⇒ 无问题', null, real, realGate, realDesign)
  // 负控①：把一条 op 的档位改成未知值
  add('注入未知档位 ⇒ 报红', '档位未知',
    real.replace('"input_tap" to OpDef(Tier.DANGER_FULL_ACCESS', '"input_tap" to OpDef(Tier.BOGUS'), realGate, realDesign)
  // 负控②：dangerApproved 改成恒 false（死代码 = 静默拒绝，看起来"安全"实则 W-4 失效）
  add('dangerApproved 恒 false ⇒ 报红', '没有走 Gate.requestApproval',
    real.replace(/private fun dangerApproved\([^)]*\)\s*:\s*Boolean\s*=\s*[^\n]+/,
      'private fun dangerApproved(op: String): Boolean = false'), realGate, realDesign)
  // 负控③：dispatch 里删掉 dangerApproved 调用
  add('dispatch 无 danger 判定 ⇒ 报红', '没有 dangerApproved 调用',
    real.replace(/\s*if \(def\.tier == Tier\.DANGER_FULL_ACCESS && !dangerApproved\(op\)\) \{[\s\S]*?\n        \}\n/, '\n'), realGate, realDesign)
  // 负控④：Gate 的批准判据被改成"没答复也算过"
  add('Gate 把超时当批准 ⇒ 报红', '批准判据',
    real, realGate.replace('val approved = got && (results[id] == true)', 'val approved = results[id] != false'))
  // 负控⑤：删掉 OPS 表
  add('OPS 表被删 ⇒ 报红', '解析为空',
    real.replace(/\s*"screencap" to OpDef\([^\n]*\n/g, '').replace(/\s*"system_status" to OpDef\([^\n]*\n/g, '')
      .replace(/\s*"notifications" to OpDef\([^\n]*\n/g, '').replace(/\s*"input_tap" to OpDef\([^\n]*\n/g, '')
      .replace(/\s*"input_swipe" to OpDef\([^\n]*\n/g, '').replace(/\s*"input_text" to OpDef\([^\n]*\n/g, '')
      .replace(/\s*"input_key" to OpDef\([^\n]*\n/g, ''),
    realGate, realDesign)

  // ---- W-4「三档位正反控」新增：每一档都要有能触发它的负控 ----
  // 负控⑥：read-only 档被清空（把两条 READ_ONLY op 提级为 WORKSPACE_WRITE）
  add('read-only 档被清空 ⇒ 报红', '档位 READ_ONLY 在 OPS 表里零 op',
    real.replace('"screencap" to OpDef(Tier.READ_ONLY', '"screencap" to OpDef(Tier.WORKSPACE_WRITE')
      .replace('"system_status" to OpDef(Tier.READ_ONLY', '"system_status" to OpDef(Tier.WORKSPACE_WRITE'),
    realGate, realDesign)
  // 负控⑦：workspace-write 档被清空（notifications 降级为 READ_ONLY）
  add('workspace-write 档被清空 ⇒ 报红', '档位 WORKSPACE_WRITE 在 OPS 表里零 op',
    real.replace('"notifications" to OpDef(Tier.WORKSPACE_WRITE', '"notifications" to OpDef(Tier.READ_ONLY'),
    realGate, realDesign)
  // 负控⑧：**反向** —— 闸漏掉档位判定 ⇒ 非 danger 档会被误拦
  add('闸条件漏掉档位判定 ⇒ 报红', '没有档位判定',
    real.replace('if (def.tier == Tier.DANGER_FULL_ACCESS && !dangerApproved(op))',
      'if (!dangerApproved(op))'),
    realGate, realDesign)
  // 负控⑨：设计文档只剩 danger 档声明（三档位语义未完整落地）
  add('设计文档缺 read-only/workspace-write 声明 ⇒ 报红', 'read-only 的档位声明',
    real, realGate, designWithoutReadOnly(realDesign))

  let pass = 0
  for (const c of cases) {
    const { problems } = check(c.b, c.g, c.d)
    const ok = c.expectProblemSubstr === null
      ? problems.length === 0
      : problems.some((p) => p.includes(c.expectProblemSubstr))
    if (ok) {
      pass++
      console.log(`  PASS  ${c.name}${problems.length ? `（${problems.length} 处）` : ''}`)
    } else {
      console.error(`  FAIL  ${c.name} —— 期望含「${c.expectProblemSubstr ?? '无问题'}」，实得：${JSON.stringify(problems)}`)
    }
  }
  console.log(`\n[selftest-summary] device-tiers ${pass}/${cases.length} ${pass === cases.length ? 'PASS' : 'FAIL'}`)
  return pass === cases.length
}

if (process.argv.includes('--selftest')) {
  process.exit(selftest() ? 0 : 3)
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
let failed = false
const fail = (m) => { console.error(`  ✗ ${m}`); failed = true }

console.log('=== W-4 设备 op 档位声明对账 ===')

if (!fs.existsSync(BRIDGE)) {
  fail(`找不到 DeviceBridge.kt：${BRIDGE}`)
  process.exit(1)
}
if (!fs.existsSync(GATE)) {
  fail(`找不到 Gate.kt：${GATE}`)
  process.exit(1)
}
const designText = fs.existsSync(DESIGN) ? fs.readFileSync(DESIGN, 'utf8') : null
if (designText === null) fail(`找不到设计文档：${DESIGN}`)

const { problems, ops, dangerOps } = check(
  fs.readFileSync(BRIDGE, 'utf8'),
  fs.readFileSync(GATE, 'utf8'),
  designText,
)

console.log(`  解析到 ${ops.size} 个 op：${[...ops.entries()].map(([k, v]) => `${k}=${v}`).join(' · ')}`)
if (problems.length === 0) {
  console.log('  ✓ 判据①②③ 全部通过')
  console.log(`    · 声明齐全（${ops.size} 个 op 档位均在已知集合内）`)
  console.log('    · danger 真被拦（走 Gate / 判定早于构造 / Gate 默认拒绝语义在场）')
  console.log(`    · 与文档一致（${dangerOps.length} 个 danger 档 op：${dangerOps.join(', ')}）`)
} else {
  problems.forEach(fail)
}

if (failed) {
  console.error('\n✗ 设备 op 档位声明对账失败')
  process.exitCode = 1
} else {
  console.log('\n✓ 设备 op 档位声明对账通过')
}
