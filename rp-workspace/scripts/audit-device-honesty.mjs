#!/usr/bin/env node
/**
 * 设备能力「诚实声明」对账（W-3 验收未达的防复发护栏）
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么需要这条判据（真实事故，不是假想）
 * ─────────────────────────────────────────────────────────────────────────
 * W-3 的验收口径是「每个工具**模拟器实证** + RP 插件侧至少一个真实调用样例」，
 * 但 `DeviceBridge.exec()` 首期**无条件返回 `NOT_IMPLEMENTED`**（执行层待接）。
 * 后果是一种极危险的形态：
 *
 *   · 编译过、18 条单测过、6 条门禁全过、真机 boot 正常、HTTP 桥在监听；
 *   · 而 agent 调 `device_screenshot` 得到的是一句「执行层待接入」——
 *     **从工具列表看它「有」这个能力，实际什么都不会发生**。
 *
 * 这正是本项目 P-30 家族（代理量与事实脱钩）的形态：一切绿灯，事实为零。
 * 更糟的是**文档与 UI 会顺手把它写成「可用」**——本轮审计就抓到 GOAL 文档把
 * W-3 标成 ✅，而代码里 `exec()` 恒返未实现。
 *
 * 故本判据把「执行层是否接线」变成一个**机器可读、且下游必须与之对账**的单源：
 *   源码常量 `DeviceBridge.EXEC_WIRED` = 唯一真相
 *   ↓ 三面必须与它一致（不一致即报红）
 *   ① 代码：未接线时 `exec()` 不得出现「假装成功」的返回（ok:true）；
 *   ② UI：看板必须**按它**区分展示（未接线时不得只说「可用」）；
 *   ③ 文档：设计/发布文档不得声称工具「已可用/已实测」，除非 EXEC_WIRED=true。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 判据
 * ─────────────────────────────────────────────────────────────────────────
 * ① `EXEC_WIRED` 常量在场且为**字面量** true/false（禁止用表达式绕过解析）；
 * ② `exec()` 的分支与常量同源：未接线时返回 NOT_IMPLEMENTED，接线时不得仍返回它；
 * ③ `capabilityReport()` 把 `exec_wired` 暴露出去（否则下游无从对账）；
 * ④ 看板（MainActivity）必须读 `capabilityReport` / `EXEC_WIRED` 并在未接线时
 *    给出「未接线」字样 —— 不允许未接线却显示成完全可用；
 * ⑤ 未接线时，验收文档（GOAL）不得把 W-3 标为 ✅ 全交付。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 退出码
 * ─────────────────────────────────────────────────────────────────────────
 *   0 = 通过
 *   2 = 有 BLOCK（不诚实声明 / 判据空转）
 *   1 = 锚点缺失（fail-closed：源码结构变了 ⇒ 判据不可信，宁可报错）
 *   3 = selftest 失败（闸门自己坏了）
 *
 * ─────────────────────────────────────────────────────────────────────────
 * selftest（10 例：正控 + 8 负控 + 1 零控）
 * ─────────────────────────────────────────────────────────────────────────
 *   见 `--selftest` 输出。每条判据都有**能触发它的注入样本**，且不动真实仓库。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP = path.join(WS, 'android', 'app', 'src', 'main', 'java', 'com', 'dshtavern', 'app')
const BRIDGE = path.join(APP, 'DeviceBridge.kt')
const MAIN = path.join(APP, 'MainActivity.kt')
const GOAL = path.join(WS, '..', 'docs', 'GOAL-DSH-ANDROID-COMPLETE-2026-09-21.md')

/** 从源码文本解析 `EXEC_WIRED` 的字面量值；解析不出返回 undefined。 */
function parseExecWired(kt) {
  const m = kt.match(/const\s+val\s+EXEC_WIRED\s*:\s*Boolean\s*=\s*(true|false)\b/)
  return m ? m[1] === 'true' : undefined
}

/** 取出 `exec(` 函数体（到下一个顶层 `private fun` / `fun` 或文件尾）。 */
function execBody(kt) {
  const i = kt.indexOf('private fun exec(')
  if (i < 0) return null
  const rest = kt.slice(i)
  const next = rest.slice(1).search(/\n    (?:private )?fun /)
  return next < 0 ? rest : rest.slice(0, next + 1)
}

/**
 * 取出 `exec(` 函数体里**接线后**的那一段（EXEC_WIRED 守卫之后）。
 *
 * 【为什么必须切分】`!EXEC_WIRED` 的分支里**本来就该**出现 `Err.NOT_IMPLEMENTED`
 * （那是诚实降级）。若拿整个函数体去判「有没有 NOT_IMPLEMENTED」，接线后必然假红 ——
 * 这是本判据第一版踩过的坑（真实仓库正控直接失败）。
 * 故先按 `!EXEC_WIRED` 的守卫切一刀：接线后的行为只看后半段。
 */
function wiredPathOf(body) {
  if (body === null) return ''
  // 守卫形态：`if (!EXEC_WIRED) { ... }` 或 `if (!EXEC_WIRED) return ...`
  const m = body.match(/if\s*\(\s*!EXEC_WIRED\s*\)\s*\{/)
  if (m) {
    let depth = 0
    for (let i = m.index + m[0].length - 1; i < body.length; i++) {
      if (body[i] === '{') depth++
      else if (body[i] === '}') {
        depth--
        if (depth === 0) return body.slice(i + 1)
      }
    }
    return body.slice(m.index + m[0].length)
  }
  // 无花括号的单行守卫
  const oneLine = body.match(/if\s*\(\s*!EXEC_WIRED\s*\)\s*return[^\n]*\n/)
  if (oneLine) return body.slice(oneLine.index + oneLine[0].length)
  return body
}

/**
 * 核心判据（对给定文本求值）。返回 problems 数组。
 * 【为什么抽成函数】selftest 要用注入样本验证区分力，且不许触碰真实仓库（P-43）。
 */
export function check({ bridgeText, mainText, goalText }) {
  const problems = []

  // ---- 判据 ①：EXEC_WIRED 必须是字面量（解析不出 ⇒ fail-closed，不能静默放过）----
  const wired = parseExecWired(bridgeText)
  if (wired === undefined) {
    problems.push('EXEC_WIRED 常量缺失或不是 true/false 字面量 —— 执行层接线状态无法被机器核对（fail-closed）')
    return { problems, wired: undefined }
  }

  // ---- 判据 ②：exec() 的分支必须与常量同源 ----
  const body = execBody(bridgeText)
  if (body === null) {
    problems.push('找不到 exec() —— 执行层入口缺失（判据不可信）')
  } else {
    const gatesOnConstant = /EXEC_WIRED/.test(body)
    if (!gatesOnConstant) {
      problems.push('exec() 的分支没有读 EXEC_WIRED —— 接线状态与实现可能脱钩')
    }
    const wiredPath = wiredPathOf(body)
    const wiredReturnsNotImpl = /Err\.NOT_IMPLEMENTED/.test(wiredPath)
    if (!wired) {
      // 未接线：必须如实返回 NOT_IMPLEMENTED，且不得假装成功
      if (!wiredReturnsNotImpl) {
        problems.push('EXEC_WIRED=false 时 exec() 不返回 NOT_IMPLEMENTED —— 未接线却可能被当成执行成功')
      }
      if (/put\(\s*"ok"\s*,\s*true\s*\)/.test(body)) {
        problems.push('EXEC_WIRED=false 时 exec() 里出现 ok:true —— 未接线却返回成功（假能力）')
      }
    } else {
      // 已接线 ⇒ 接线后的路径必须真的调执行通道，且不得仍返回 NOT_IMPLEMENTED
      if (wiredReturnsNotImpl) {
        problems.push('EXEC_WIRED=true 但接线后的 exec() 仍返回 NOT_IMPLEMENTED —— 声明与实现相反')
      }
      if (!/ShizukuExec\s*\.\s*exec\s*\(/.test(wiredPath)) {
        problems.push('EXEC_WIRED=true 但 exec() 没有调 ShizukuExec.exec —— 声称已接线却没有执行通道')
      }
    }
  }

  // ---- 判据 ③：capabilityReport 必须把 exec_wired 暴露给下游 ----
  if (!/fun\s+capabilityReport\s*\(/.test(bridgeText)) {
    problems.push('找不到 capabilityReport() —— 看板/下游无法核对执行层状态')
  } else if (!/put\(\s*"exec_wired"\s*,\s*EXEC_WIRED\s*\)/.test(bridgeText)) {
    problems.push('capabilityReport() 没有暴露 exec_wired —— 下游无从对账（登记值与事实脱钩）')
  }

  // ---- 判据 ④：看板必须按真实状态分档（而不是一律显示可用）----
  const boardReadsBridge = /capabilityReport|EXEC_WIRED|exec_wired/.test(mainText)
  if (!boardReadsBridge) {
    problems.push('看板（MainActivity）没有读 capabilityReport / EXEC_WIRED —— 无法按真实接线状态分档展示')
  }
  if (!wired && boardReadsBridge && !/未接线/.test(mainText)) {
    problems.push('EXEC_WIRED=false 但看板里没有「未接线」字样 —— 会把未接通的能力显示成可用')
  }
  if (wired && boardReadsBridge && !/exec_detail/.test(mainText)) {
    problems.push('EXEC_WIRED=true 但看板没展示 exec_detail（连接实况）—— 无法区分「已接线但未连上」')
  }

  // ---- 判据 ⑤：GOAL 的 W-3 交付标注必须与 EXEC_WIRED 一致 ----
  // 两个方向都要守：
  //   · 未接线却标 ✅ ⇒ 声称了一个实际不可用的能力（本轮审计抓到的真实形态）；
  //   · 已接线却仍标「验收未达 / 部分交付」⇒ 低估了自己（会让后续轮次重复排查）。
  if (goalText !== null) {
    const w3Line = goalText.split('\n').find((l) => l.startsWith('| W-3 设备能力工具集'))
    if (!w3Line) {
      problems.push('GOAL 文档里找不到 W-3 的交付记录行（判据空转）')
    } else {
      // 状态列形如 `| ✅ |` 或 `| ✅（说明） |` —— 故按「单元格以 ✅ 开头」判，
      // 而不是 `| ✅ |`（后者漏掉带括号说明的写法，会把已交付误报成滞后）。
      const statusCell = w3Line.split('|')[2] ?? ''
      const markedOk = /^\s*✅/.test(statusCell)
      if (!wired && markedOk) {
        problems.push('EXEC_WIRED=false 但 GOAL 把 W-3 标为 ✅ —— 声称了一个实际不可用的能力')
      }
      if (wired && !markedOk) {
        problems.push(`EXEC_WIRED=true 但 GOAL 的 W-3 未标 ✅（状态列实为「${statusCell.trim()}」）—— 交付记录滞后于实现`)
      }
    }
  }

  return { problems, wired }
}

// ---------------------------------------------------------------------------
// selftest
// ---------------------------------------------------------------------------
function selftest() {
  const realBridge = fs.readFileSync(BRIDGE, 'utf8')
  const realMain = fs.readFileSync(MAIN, 'utf8')
  const realGoal = fs.existsSync(GOAL) ? fs.readFileSync(GOAL, 'utf8') : null

  const cases = []
  const add = (name, expect, b, m, g) => cases.push({ name, expect, b, m, g })

  // 正控：真实仓库无问题
  add('真实仓库 ⇒ 无问题', null, realBridge, realMain, realGoal)
  // 负控①：删掉常量
  add('EXEC_WIRED 缺失 ⇒ 报红', 'EXEC_WIRED 常量缺失',
    realBridge.replace(/const\s+val\s+EXEC_WIRED\s*:\s*Boolean\s*=\s*(true|false)\n/, ''),
    realMain, realGoal)
  // 负控②：常量写成表达式（绕过字面量解析）
  add('EXEC_WIRED 非字面量 ⇒ 报红', '不是 true/false 字面量',
    realBridge.replace(/const\s+val\s+EXEC_WIRED\s*:\s*Boolean\s*=\s*(true|false)/,
      'const val EXEC_WIRED: Boolean = (1 + 1 == 2)'), realMain, realGoal)
  // 负控③：exec() 不读常量
  // 【为什么这样构造】此前用「删掉那一行」的办法，结果判据仍报绿 —— 因为 exec() 体里
  // 还有**注释**「// EXEC_WIRED 是唯一的真相源」含该串，正则 `EXEC_WIRED` 仍然命中
  // ⇒ 样本没有区分力（评审若只看 selftest 会以为这条判据受守）。
  // 正解：把 exec() 体里的 `EXEC_WIRED` **全部**替换掉（注释与代码一起），才真的模拟
  // 「接线状态与实现脱钩」这一形态。这也是本项目 P-43 的教训：负控必须真的改到事实。
  add('exec() 不读 EXEC_WIRED ⇒ 报红', '没有读 EXEC_WIRED',
    realBridge.replace(
      /(private fun exec\([\s\S]*?\n    \})/,
      (m) => m.replace(/EXEC_WIRED/g, 'SOMETHING_ELSE')),
    realMain, realGoal)
  // 负控④：exec() 假装成功（未接线却 ok:true）
  add('exec() 未接线却 ok:true ⇒ 报红', '假能力',
    realBridge.replace('const val EXEC_WIRED: Boolean = true', 'const val EXEC_WIRED: Boolean = false')
      .replace(/return err\(Err\.NOT_IMPLEMENTED,\n\s*"命令构造已就绪[^\n]*\)/,
        'return JSONObject().put("ok", true)'), realMain, realGoal)
  // 负控④b：声称已接线但 exec() 不调执行通道（空壳）
  add('EXEC_WIRED=true 却不调 ShizukuExec ⇒ 报红', '没有调 ShizukuExec.exec',
    realBridge.replace(/(private fun exec\([\s\S]*?\n    \})/,
      (m) => m.replace(/ShizukuExec\.exec\(/g, 'xNoExec(')), realMain, realGoal)
  // 负控④c：声称已接线却仍返回 NOT_IMPLEMENTED（把守卫改成恒真）
  add('EXEC_WIRED=true 却返回 NOT_IMPLEMENTED ⇒ 报红', '声明与实现相反',
    realBridge.replace('if (!EXEC_WIRED) {', 'if (true) {'), realMain, realGoal)
  // 负控⑤：capabilityReport 不暴露 exec_wired
  add('capabilityReport 不暴露 exec_wired ⇒ 报红', '没有暴露 exec_wired',
    realBridge.replace(/\.put\("exec_wired",\s*EXEC_WIRED\)\n/, ''), realMain, realGoal)
  // 负控⑥：看板不读接线状态
  add('看板不读接线状态 ⇒ 报红', '没有读 capabilityReport',
    realBridge, realMain.replace(/capabilityReport/g, 'xCapReport').replace(/EXEC_WIRED/g, 'xWired').replace(/exec_wired/g, 'xw'), realGoal)
  // 负控⑦：未接线时看板读状态但不说「未接线」
  // 【注意】必须把 EXEC_WIRED 改成 false 才能进入「未接线却不说明」这一形态 ——
  // 接线后看板本来就不该说「未接线」（那种情况下这句话是错的，判据不应要求它）。
  add('看板未接线却不说 ⇒ 报红', '没有「未接线」字样',
    realBridge.replace('const val EXEC_WIRED: Boolean = true', 'const val EXEC_WIRED: Boolean = false'),
    realMain.replace(/未接线/g, '可用'),
    realGoal.replace(/^\| W-3 设备能力工具集 \| [^|]+ \|/m, '| W-3 设备能力工具集 | ⚠️ 部分交付 |'))
  // 负控⑧：未接线却把 GOAL 标成 ✅ —— 即回到本轮审计抓到的真实形态。
  // （状态列保持真实仓库的 ✅，只把 `EXEC_WIRED` 改回 false 即可复现）
  add('GOAL 未接线标 ✅ ⇒ 报红', '声称了一个实际不可用的能力',
    realBridge.replace('const val EXEC_WIRED: Boolean = true', 'const val EXEC_WIRED: Boolean = false'),
    realMain, realGoal)
  // 负控⑧b：**反向** —— 已接线却把 GOAL 标成滞后（低估自己）
  add('EXEC_WIRED=true 但 GOAL 未标 ✅ ⇒ 报红', '交付记录滞后于实现',
    realBridge, realMain,
    realGoal === null ? null
      : realGoal.replace(/^\| W-3 设备能力工具集 \| [^|]+ \|/m, '| W-3 设备能力工具集 | ⚠️ 部分交付 |'))
  // 零控：全部为空文本（判据必须报错而不是静默通过）
  add('空输入 ⇒ 必须报红（零控）', 'EXEC_WIRED 常量缺失', '', '', null)

  let pass = 0
  for (const c of cases) {
    let problems
    try {
      problems = check({ bridgeText: c.b, mainText: c.m, goalText: c.g }).problems
    } catch (e) {
      problems = [`内部异常：${e.message}`]
    }
    const ok = c.expect === null
      ? problems.length === 0
      : problems.some((p) => p.includes(c.expect))
    if (ok) {
      pass++
      console.log(`  PASS  ${c.name}${problems.length ? `（${problems.length} 处）` : ''}`)
    } else {
      console.error(`  FAIL  ${c.name} —— 期望含「${c.expect ?? '无问题'}」，实得：${JSON.stringify(problems)}`)
    }
  }
  console.log(`\n[selftest-summary] device-honesty ${pass}/${cases.length} ${pass === cases.length ? 'PASS' : 'FAIL'}`)
  return pass === cases.length
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
if (process.argv.includes('--selftest')) {
  process.exit(selftest() ? 0 : 3)
}

const missing = [BRIDGE, MAIN].filter((p) => !fs.existsSync(p))
if (missing.length) {
  console.error(`锚点缺失（fail-closed）：${missing.join(', ')}`)
  process.exit(1)
}

const goalText = fs.existsSync(GOAL) ? fs.readFileSync(GOAL, 'utf8') : null
const { problems, wired } = check({
  bridgeText: fs.readFileSync(BRIDGE, 'utf8'),
  mainText: fs.readFileSync(MAIN, 'utf8'),
  goalText,
})

console.log('=== 设备能力「诚实声明」对账（W-3 未达防复发）===')
console.log(`  EXEC_WIRED = ${wired}（执行层${wired ? '已接线' : '未接线 —— 命令构造就绪、执行待接'}）`)
if (problems.length === 0) {
  console.log('  ✓ 判据①~⑤ 全部通过')
  console.log('    · 常量是字面量且 exec() 与它同源')
  console.log('    · capabilityReport 暴露 exec_wired')
  console.log('    · 看板按真实状态分档（未接线时含「未接线」字样）')
  console.log('    · GOAL 未把未接线的 W-3 标为 ✅')
  console.log('\n✓ 设备能力声明与实际一致（无夸大）')
  process.exit(0)
}
console.error('  ✗ 发现不诚实/空转声明：')
for (const p of problems) console.error(`    · ${p}`)
process.exit(2)
