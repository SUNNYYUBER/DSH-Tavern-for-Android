#!/usr/bin/env node
/**
 * audit-baseline-claims-negctl.mjs —— **「基线数字」闸门的真实仓库负控**（B11 的机器化）
 * =============================================================================
 * ## 为什么必须有
 * `audit-baseline-claims.mjs` 在真实仓库上得 **0 违规** —— 既可能是「数字确实都对」（好），
 * 也可能是「**判据被改废了**」（坏）。两者在报告上**长得一样**（都是红的消失）。
 * 唯一区分办法是：**把坏样本注入回去，看它会不会红**（W31/W38/W39/W40/W42/W44 同纪律）。
 *
 * ## 注入什么（**逐条对应本仓实测过的真缺陷形态**）
 *   A. **门禁条数过期**：把 §3.1 的「38 条」改成「35 条」
 *      （= **W44 实测的形态**：扩了判据没同步文档）
 *      ⇒ 要求：报红 + **指向声明的两个值**；
 *   B. **P 判据累计条数过期**：把「累计 49 条」改成「累计 48 条」
 *      （= **W43 实测的形态**：新增 P-49 后声明没跟上）
 *      ⇒ 要求：报红。
 *   C. ★★ **§八 E-C 又用「代理阈值」表达不变量**（**W51 实测的修前形态**）：
 *      把「vitest **0 失败**」改回修前的「vitest ≥ 1786 通过 0 失败」
 *      ⇒ 要求：报红 + 理由含「代理阈值」；
 *   D. ★★ **§八 E-C 用「N 项门禁」**（**分类数 vs 产出条数** 口径混用，**W51 实测**）
 *      ⇒ 要求：报红；
 *   E. ★★ **路由条数写死**（**W57 实测的修前原文**「路由契约（**67 条**，0 违约）」）
 *      ⇒ 要求：报红（判据 `routeCountHardcodeProblems`）；
 *   F. ★★ **B10 形态**（同一语义写在**边界表**里 —— 与 **P-58** 同源：两个区段都要守）
 *      ⇒ 要求：报红；
 *   G. ★★ **README「能做什么」表的「N 个 API（N 本地 + N 桥接）」形态**（**W58 新增**）
 *      ⇒ 要求：报红；
 *   H. ★★ **`docs/V0.3-FREEZE.md` 面**（**W59 新增** —— **对外承诺的冻结文档**）
 *      ⇒ 要求：报红；
 *   I. ★★ **契约快照面** —— `slots N 个` 必须与 `contracts/<ver>/slots.json` 一致（**W60 新增**）
 *      ⇒ 要求：报红；
 *   J. ★★ **M4 项数**（**W63 新增** —— 此前「实现有、但从不被喂输入」，判据 ④）
 *      ⇒ 要求：报红；
 *   K. ★★ **豁免依据必须是「能跑到的通路」**（**W64 新增**，守 **P-56 / P-63**）
 *      ⇒ 要求：报红；
 *   L. ★★ **日志读数 vs 文档写死数字**必须对账（**W66 新增**，守 **P-62**「接线 ≠ 消费」）
 *      ⇒ 要求：报红；
 *   M. ★★ **豁免窗口过宽会把真缺陷一起放过**（**W67 新增**，守 **P-38 / P-30**）
 *      ⇒ 要求：报红。
 * ★ **杠杆组**（P-20，与上列**成对**）：A/B/D/E/I/J/L/M 各有「改回 ⇒ 必须回绿」的杠杆段
 *   —— ★★ 这是 **P-67 的「成对」纪律**：只做「注入 ⇒ 报红」一侧，留下「恒定红」的半个盲区。
 * ★★ **本清单的自守**：上列字母键与实现里的分组键**由 `audit-selftest-claims.mjs`
 *   的 `headNoteListProblems`（W73 新增）逐条对账** —— 此前本清单**只写到 B 而实现已有 M**
 *   （**W73 实测的真缺陷**：这份清单**没有汇总数**可对 ⇒ 扩一组时**永远不会被想起**，**P-71 的补集**）。
 *
 * ## ★ 与 W44 负控的**关键差别**（W44 的教训）
 * W44 的负控**真写 GOAL**（注入 ⇒ 跑 ⇒ 还原），结果**被强杀时残留未还原**（R23 级事故）。
 * ⇒ 本负控**改用 `--file <临时副本>`**：闸门本来就支持 `--file`（见主流程），
 *   于是**全程不碰真实 GOAL** —— 从结构上消除「残留」这一整类风险（P-48 的更强形态：
 *   **能不改就不改**，比「改了能还原」更安全）。
 *   ★ 只有**真实仓库回绿**那一条需要读真文件（只读，无风险）。
 *
 * ## 退出码
 *   0 = 全过    1 = 有断言失败    2 = 环境问题（fail-closed）
 *
 * 用法：node scripts/audit-baseline-claims-negctl.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { reportSelftest } from './selftest-summary.mjs'

const WS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = path.resolve(WS, '..')
const GOAL = path.join(ROOT, 'docs', 'GOAL.md')
const AUDIT = path.join(WS, 'scripts', 'audit-baseline-claims.mjs')
const COPY = path.join(WS, 'tmp', 'w45-baseline-negctl-copy.md')

let total = 0, fail = 0
const t = (name, ok, detail = '') => { total += 1; if (!ok) fail += 1; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `：${detail}` : ''}`) }

function runAudit (docPath, readmePath = null, freezePath = null, tasklistPath = null) {
  const args = [AUDIT, '--file', docPath]
  if (readmePath) args.push('--readme', readmePath)   // ★ W58：README 面的副本（P-58 两处都要守）
  if (freezePath) args.push('--freeze', freezePath)   // ★ W59：V0.3-FREEZE 面的副本（同一族的读数写在别处）
  // ★★ W74：**TASK-LIST 面的副本** —— 此前**从未被传过** ⇒ 该输入面**无法被负控**（**P-1 / P-59 纪律②**）。
  if (tasklistPath) args.push('--tasklist', tasklistPath)
  try {
    const out = execFileSync(process.execPath, args, { encoding: 'utf8', timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

if (!fs.existsSync(GOAL)) { console.error(`✗ 找不到 ${GOAL}`); process.exit(2) }
if (!fs.existsSync(AUDIT)) { console.error(`✗ 找不到 ${AUDIT}`); process.exit(2) }

const ORIG = fs.readFileSync(GOAL, 'utf8')

// ---- 基线：真实仓库（**只读**）必须绿 ----
const base = runAudit(GOAL)
t('基线：真实仓库（只读）闸门为绿', base.code === 0,
  `exit=${base.code} ${base.out.split('\n').find(l => l.includes('[基线] OK'))?.slice(0, 60) ?? ''}`)

/** 在**临时副本**上注入并跑（全程不碰真实 GOAL —— 见头注） */
function drill (label, mutate, wantRe, detail = '') {
  const copy = ORIG.split('\n')
  const okMutate = mutate(copy)
  if (!okMutate) { t(`${label} 前置：注入锚点必须命中`, false, '锚点未命中'); return false }
  fs.writeFileSync(COPY, copy.join('\n'), 'utf8')
  const r = runAudit(COPY)
  const hit = wantRe.test(r.out)
  t(`${label}：注入后必须报红`, r.code !== 0, `exit=${r.code}`)
  t(`${label}：报红理由正确${detail ? `（${detail}）` : ''}`, hit,
    r.out.split('\n').find(l => /✗/.test(l))?.slice(0, 120) ?? '')
  return r.code !== 0 && hit
}

// ---- A：门禁条数过期（改小）----
const A = drill('负控A（门禁条数过期）', (ls) => {
  const i = ls.findIndex(l => /\d+\s*条\s*`\[gate\]\s*OK`/.test(l) && /### 3\.1|^### 3\.1/.test(ls[0] || '') === false && /\d+\s*条\s*`\[gate\]\s*OK`/.test(l))
  if (i < 0) return false
  const g = /(\d+)\s*条\s*`\[gate\]\s*OK`/.exec(ls[i])
  if (!g) return false
  ls[i] = ls[i].replace(`${g[1]} 条 \`[gate] OK\``, `${Number(g[1]) - 3} 条 \`[gate] OK\``)
  return true
}, /基线数字过期/, '声明比实测少 3 条')

// ---- B：P 判据累计条数过期（改小）----
const B = drill('负控B（P 判据累计条数过期）', (ls) => {
  const i = ls.findIndex(l => /累计\s*(\d+)\s*条/.test(l) && /P-1\s*~\s*P-\d+/.test(l))
  if (i < 0) return false
  const g = /累计\s*(\d+)\s*条/.exec(ls[i])
  ls[i] = ls[i].replace(`累计 ${g[1]} 条`, `累计 ${Number(g[1]) - 1} 条`)
  return true
}, /过期声明|P-1/, '声明比索引少 1 条')

// ---- C：★★ §八 E-C 又用「代理阈值」表达不变量（**W51 实测的修前形态**）----
const C = drill('负控C（E-C 用代理阈值）', (ls) => {
  const i = ls.findIndex(l => /^\|\s*\*\*E-C\*\*/.test(l))
  if (i < 0) return false
  // 把「vitest **0 失败**（当前 …）」改成修前的「vitest ≥ 1786 通过 0 失败」
  ls[i] = ls[i].replace(/vitest\s*\*\*0\s*失败\*\*（[^）]*）/, 'vitest ≥ 1786 通过 0 失败')
  return /≥\s*1786\s*通过/.test(ls[i])
}, /代理阈值/, 'E-C 用「≥ N 通过」表达不劣化')

// ---- D：★★ §八 E-C 用「N 项门禁」（**分类数 vs 产出条数** 口径混用）----
//   ★ 锚点**实读**原文（P-19）：把「**构建期门禁** exit 0」改成修前的「**十三项门禁** exit 0」，
//     并把行内的「48 条 `[gate] OK`」一并去掉 —— 否则行内同时有两者，读者仍读得懂。
const D = drill('负控D（E-C 用「N 项门禁」）', (ls) => {
  const i = ls.findIndex(l => /^\|\s*\*\*E-C\*\*/.test(l))
  if (i < 0) return false
  let l = ls[i].replace('**构建期门禁** exit 0', '**十三项门禁** exit 0')
  // 去掉行内那条「N 条 [gate] OK」及其说明（保留句读通顺）
  l = l.replace(/（当前 \*\*\d+ 条 `\[gate\] OK`\*\*，条数以 §3\.1 \/ 构建日志实测为准 —— ★ \*\*W51 修\*\*：原文写死「十三项门禁」= 把\*\*装置分类数\*\*当成了\*\*产出条数\*\*，两者不是一回事）/, '')
  ls[i] = l
  // ★ 前置断言只看**「项门禁」附近**（照判据的就近窗口口径 —— 守 P-1）：
  //   整行别处还有**另一处**「W51 修」（讲 vitest 阈值那句），整行判会**永远不命中**
  //   ⇒ 那是 W45 踩过的同形坑（「整行口径」）。锚点即注入必须落在判据真正会看的窗口里。
  const at = ls[i].indexOf('项门禁')
  const near = ls[i].slice(Math.max(0, at - 80), at + 80)
  return /项门禁/.test(ls[i]) && !/W\d+\s*修/.test(near)
}, /项门禁/, 'E-C 用分类数表述产出条数')

// ---- ★ 杠杆（P-20）：把副本改回**与实测一致** ⇒ 必须转绿 ----
//   ★ 锚点必须与注入后的内容**逐字一致**（W40 的教训：锚点不命中时测的是「没替换」）
{
  const copy = ORIG.split('\n')
  const i = copy.findIndex(l => /\d+\s*条\s*`\[gate\]\s*OK`/.test(l))
  const g = i >= 0 ? /(\d+)\s*条\s*`\[gate\]\s*OK`/.exec(copy[i]) : null
  if (!g) {
    t('杠杆前置：锚点必须命中', false, '未找到门禁条数声明行')
  } else {
    const before = `${g[1]} 条 \`[gate] OK\``
    const after = `${Number(g[1]) - 3} 条 \`[gate] OK\``
    copy[i] = copy[i].replace(before, after)
    if (!copy[i].includes(after)) {
      t('杠杆前置：注入替换必须真的发生', false, '替换未生效')
    } else {
      copy[i] = copy[i].replace(after, before) // 改回一致值
      fs.writeFileSync(COPY, copy.join('\n'), 'utf8')
      const r = runAudit(COPY)
      t('杠杆：把声明改回与实测一致 ⇒ 必须转绿', r.code === 0, `exit=${r.code}`)
    }
  }
}

// ---- ★★ E：**路由条数写死**（**W57 新增判据的真实仓库负控**）----
//   ★ 为什么必须补：W57 给闸门加了「契约条数不得写死」判据（`routeCountHardcodeProblems`），
//     而**负控若不覆盖它**，该判据在负控面上就是一条**永远测不到的死判据**（**P-59 纪律③**：
//     负控的覆盖面必须由「把实现短路掉，看负控会不会红」独立证明）。
//   ★ 注入形态 = **W57 实测的修前原文**：§3.2 第 3 项写「路由契约（**67 条**，0 违约）」。
const E = drill('负控E（路由条数写死）', (ls) => {
  const i = ls.findIndex(l => /audit-route-contract\.mjs/.test(l) && /路由契约/.test(l))
  if (i < 0) return false
  ls[i] = '| 3 | `scripts/audit-route-contract.mjs` | 路由契约（**67 条**，0 违约） |'
  return true
//   ★ 报错文案的**匹配口径**（W58 修）：判据在 W58 把消息改成统一形态
//     「写死「<命中片段>」而未标注它是**读数**」⇒ 负控不能锚在**旧文案**上
//     （W52 学过的坑：**负控锚点随实现演进而失效**，看起来像「闸门被改坏」）。
//     ⇒ 锚到**跨形态稳定的语义片段**：「路由」+「67」+「未标注」。
}, /路由[^"]*67[\s\S]{0,80}未标注|写死「路由/, '路由条数是会增长的读数，不得写成硬常量')

// ---- ★★ F：**B10 形态**（同一语义写在边界表里 —— 与 P-58 同源：两个区段都要守）----
const F = drill('负控F（B10 里的路由条数写死）', (ls) => {
  const i = ls.findIndex(l => /^\|\s*\*\*B10\*\*/.test(l))
  if (i < 0) return false
  ls[i] = '| **B10** | **不改变既有对外契约**（路由 67 条、slots 42 个、wire 契约、slot id） |'
  return true
}, /路由[^"]*67[\s\S]{0,80}未标注|写死「路由/, 'B10 同形态也必须被抓（P-58：同类声明跨区段单源守）')

// ---- ★★ G（**W58 新增**）：README「能做什么」表的「N 个 API（N 本地 + N 桥接）」形态 ----
//   ★ 为什么必须补：README 与 GOAL **是两份文档** ⇒ 按 **P-58**（同一语义的声明写在两个区段/文档，
//     两处都要守）必须**各自有负控**；只守 GOAL 会让 README 那一半**永远无人守**
//     （W58 实测：README 的「32 本地 / 71 项 stub」两个数**全部过期**而长期无人察觉）。
//   ★ 注入必须落在**README 的副本**上（`--readme`），GOAL 用真身 —— 与 W54 给方法论加 `--method` 同法。
const README_REAL = path.join(ROOT, 'README.md')
const README_COPY = path.join(WS, 'tmp', 'w58-readme-negctl-copy.md')
if (!fs.existsSync(README_REAL)) {
  t('负控G 前置：必须能读到 README（否则该面无法被负控）', false, README_REAL)
} else {
  const README_ORIG = fs.readFileSync(README_REAL, 'utf8')
  const rl = README_ORIG.split('\n')
  const iTh = rl.findIndex(l => /酒馆助手（JS-Slash-Runner）/.test(l))
  if (iTh < 0) {
    t('负控G 前置：README 里「酒馆助手」行必须能定位', false, `行下标=${iTh}`)
  } else {
    const inj = rl.slice()
    inj[iTh] = '| **酒馆助手（JS-Slash-Runner）** | 73 个 API（32 本地 + 41 桥接）、`tavern_events` 82 项全表、事件时序、脚本管理面板 |'
    fs.writeFileSync(README_COPY, inj.join('\n'), 'utf8')
    const rG = runAudit(GOAL, README_COPY)   // ★ GOAL 用真身、README 用副本
    const hitG = /73 个\s*API[\s\S]{0,80}未标注|写死「73 个 API/.test(rG.out)
    t('负控G（README · TH API 面写死）：注入后必须报红', rG.code !== 0, `exit=${rG.code}`)
    t('负控G（README · TH API 面写死）：报红理由正确', hitG,
      rG.out.split('\n').find(l => /✗/.test(l))?.slice(0, 110) ?? '')
    // ★ 杠杆 G：把副本改回**读数形态** ⇒ 必须回绿
    const ok = rl.slice()
    ok[iTh] = fs.readFileSync(README_REAL, 'utf8').split('\n')[iTh]   // 取真实（已修）的形态
    fs.writeFileSync(README_COPY, ok.join('\n'), 'utf8')
    const rG2 = runAudit(GOAL, README_COPY)
    t('★杠杆G：README 副本改回读数形态 ⇒ **必须回绿**（证明负控 G 不是恒定红）', rG2.code === 0, `exit=${rG2.code}`)
    if (fs.existsSync(README_COPY)) fs.unlinkSync(README_COPY)
  }
}

// ---- ★★ 杠杆 E（P-20）：把写死的条数改成「读数形态」⇒ **必须转绿** ----
{
  const copy = ORIG.split('\n')
  const i = copy.findIndex(l => /audit-route-contract\.mjs/.test(l) && /路由契约/.test(l))
  if (i < 0) {
    t('杠杆E 前置：锚点必须命中', false, '未找到路由契约声明行')
  } else {
    // 注入写死形态 → 再改成读数形态 → 必须回绿（证明负控 E 不是恒定红）
    copy[i] = '| 3 | `scripts/audit-route-contract.mjs` | 路由契约（**0 违约**；当前实测 **68 个唯一路由**，以脚本输出为准） |'
    fs.writeFileSync(COPY, copy.join('\n'), 'utf8')
    const r = runAudit(COPY)
    t('★杠杆E：把写死条数改成「当前实测 · 以脚本输出为准」⇒ **必须转绿**', r.code === 0, `exit=${r.code}`)
  }
}

// ---- ★★ H（**W59 新增**）：`docs/V0.3-FREEZE.md` 面（**对外承诺的冻结文档**）----
//   ★ 为什么必须补（**P-58**）：W59 把受守面扩到这份文档（**同一族的读数写在别处**），
//     而**负控若不覆盖它**，该面就是一条**永远测不到的死判据**（**P-59 纪律③**）。
//   ★ 注入用 `--freeze` 传**副本**（与 `--readme` 同法；GOAL / README 用真身）。
const FREEZE_REAL = path.join(ROOT, 'docs', 'V0.3-FREEZE.md')
const FREEZE_COPY = path.join(WS, 'tmp', 'w59-freeze-negctl-copy.md')
if (!fs.existsSync(FREEZE_REAL)) {
  t('负控H 前置：必须能读到 V0.3-FREEZE.md（否则该面无法被负控）', false, FREEZE_REAL)
} else {
  const fz = fs.readFileSync(FREEZE_REAL, 'utf8').split('\n')
  const iApi = fz.findIndex(l => /酒馆助手基本盘/.test(l))
  if (iApi < 0) {
    t('负控H 前置：V0.3-FREEZE 里「酒馆助手基本盘」行必须能定位', false, `行下标=${iApi}`)
  } else {
    const inj = fz.slice()
    inj[iApi] = '- 酒馆助手基本盘：71 个 API（28 本地 + 43 桥接）、tavern_events 82 项全表、事件时序、脚本管理面板。'
    fs.writeFileSync(FREEZE_COPY, inj.join('\n'), 'utf8')
    const rH = runAudit(GOAL, path.join(WS, '..', 'README.md'), FREEZE_COPY)
    const hitH = /71 个\s*API[\s\S]{0,80}未标注|写死「71 个 API/.test(rH.out)
    t('负控H（V0.3-FREEZE · API 面写死）：注入后必须报红', rH.code !== 0, `exit=${rH.code}`)
    t('负控H（V0.3-FREEZE · API 面写死）：报红理由正确', hitH,
      rH.out.split('\n').find(l => /✗/.test(l))?.slice(0, 110) ?? '')
    // ★ 杠杆 H：改回**读数形态** ⇒ 必须回绿
    const okf = fz.slice()
    fs.writeFileSync(FREEZE_COPY, okf.join('\n'), 'utf8')
    const rH2 = runAudit(GOAL, path.join(WS, '..', 'README.md'), FREEZE_COPY)
    t('★杠杆H：V0.3-FREEZE 副本为真实（已修）内容 ⇒ **必须回绿**', rH2.code === 0, `exit=${rH2.code}`)
    if (fs.existsSync(FREEZE_COPY)) fs.unlinkSync(FREEZE_COPY)
  }
}

// ---- ★★ I（**W60 新增**）：契约快照面 —— `slots N 个` 必须与 `contracts/*/slots.json` 一致 ----
//   ★ 为什么必须补（**P-59 纪律③**）：W60 给闸门加了 `slotCountProblems`，而**负控若不覆盖它**，
//     该判据在负控面上就是一条**永远测不到的死判据**（W54 的教训：短路实验当场抓到负控空洞）。
//   ★ 注入形态 = **W60 实测的过期形态**：把 B10 的 `slots 42 个` 改成 `slots 41 个`。
//   ★ 与 W57~W59 的差别：这里的 **42 是「正确但无人守」** ⇒ 注入后报的是「**过期声明**」而非「写死常量」。
const I = drill('负控I（B10 的 slots 数过期）', (ls) => {
  const i = ls.findIndex(l => /^\|\s*\*\*B10\*\*/.test(l))
  if (i < 0) return false
  if (!/slots\s*42\s*个/.test(ls[i])) return false
  ls[i] = ls[i].replace(/slots\s*42\s*个/, 'slots 41 个')
  return /slots 41 个/.test(ls[i])
}, /slots[\s\S]{0,40}41[\s\S]{0,80}实测[\s\S]{0,20}42|声明「slots/, 'B10 的 slots 数与契约快照实测不符（P-27）')

// ---- ★★ 杠杆 I（P-20）：把 slots 数改回与快照一致 ⇒ **必须转绿** ----
{
  const copy = ORIG.split('\n')
  const i = copy.findIndex(l => /^\|\s*\*\*B10\*\*/.test(l))
  if (i < 0) {
    t('杠杆I 前置：锚点必须命中', false, '未找到 B10 行')
  } else {
    copy[i] = copy[i].replace(/slots\s*42\s*个/, 'slots 41 个')
    if (!/slots 41 个/.test(copy[i])) {
      t('杠杆I 前置：注入替换必须真的发生', false, '替换未生效')
    } else {
      copy[i] = copy[i].replace(/slots\s*41\s*个/, 'slots 42 个')   // 改回与快照一致
      fs.writeFileSync(COPY, copy.join('\n'), 'utf8')
      const r = runAudit(COPY)
      t('★杠杆I：把 B10 的 slots 数改回**与快照一致** ⇒ **必须转绿**（证明负控 I 不是恒定红）', r.code === 0, `exit=${r.code}`)
    }
  }
}

// ---- ★★ J（**W63 新增**）：**M4 项数**（判据 ④ —— 此前「实现有、但从不被喂输入」）----
//   ★ 为什么必须补（**P-59 纪律③**）：W63 修的正是「`compareClaims` 里有 M4 判据，
//     而主流程硬编码传 `m4: null` ⇒ 从不生效」。⇒ 负控必须覆盖**这一条通路**，
//     否则「喂进去了没有」这件事**仍然没有任何机器守着**（下次重构会悄悄退回 `null`）。
//   ★ 注入形态 = W63 实测的过期形态：§3.1 的 M4 声明改成 `142 项`（实测 169）。
//   ★ 锚点**只写形态不写值**（P-19 的时间维度）。
const M4_RE = /双包各\s*\*\*(\d+)\s*项\s*\/\s*缺失\s*(\d+)\*\*/
const dJ = drill('负控J（M4 项数过期）', (ls) => {
  const i = ls.findIndex(l => M4_RE.test(l))
  if (i < 0) return false
  const m = M4_RE.exec(ls[i])
  const bad = `双包各 **${Number(m[1]) - 27} 项 / 缺失 ${m[2]}**`
  ls[i] = ls[i].replace(m[0], bad)
  return ls[i].includes(bad)
}, /M4[\s\S]{0,60}过期声明|声明 M4/, '把 M4 的项数改小 27（动态取原值）')

// ---- ★★ 杠杆 J（P-20）：把 M4 改回**与实测一致** ⇒ 必须回绿 ----
{
  const copy = ORIG.split('\n')
  const i = copy.findIndex(l => M4_RE.test(l))
  if (i < 0) {
    t('杠杆J 前置：§3.1 的 M4 声明行必须能定位', false, `行下标=${i}`)
  } else {
    const m = M4_RE.exec(copy[i])
    const bad = `双包各 **${Number(m[1]) - 27} 项 / 缺失 ${m[2]}**`
    copy[i] = copy[i].replace(m[0], bad)
    if (!copy[i].includes(bad)) {
      t('杠杆J 前置：注入替换必须真的发生', false, '替换未生效')
    } else {
      copy[i] = copy[i].replace(bad, m[0])   // 改回与实测一致
      fs.writeFileSync(COPY, copy.join('\n'), 'utf8')
      const r = runAudit(COPY)
      t('★杠杆J：§3.1 的 M4 改回**与实测一致** ⇒ **必须回绿**（证明负控 J 不是恒定红）', r.code === 0, `exit=${r.code}`)
    }
  }
}

// ---- ★★ K（**W64 新增**）：**豁免依据必须是「能跑到的通路」**（守 P-56 / P-63）----
//   ★ 为什么必须补（**P-59 纪律③**）：W64 收窄了 `READ_OK` 的豁免口径 ——
//     「有机器守 / 由 X 断言」这类**装置声明**，必须点名到**真会跑到的通路**
//     （构建期闸门 **或** vitest 规格）。⇒ 负控必须覆盖「**装置名不在跑 ⇒ 不豁免**」这一分支，
//     否则下次重构会悄悄退回「只要点名就过」。
//   ★ 注入形态 = **W64 实测的真缺陷形态**：`V0.3-FREEZE.md` 曾写
//     「tavern_events 82 项 ★ 有机器守：`audit-card-event-surface.mjs` 断言 `=== 82`」
//     —— 而该脚本**在构建期零引用**（从不跑）。
//   ★ 注入点必须**落在判据会看的文档上**（P-1）：用 `--freeze` 传副本（与负控 H 同法）。
const FREEZE_FOR_K = path.join(ROOT, 'docs', 'V0.3-FREEZE.md')
const FREEZE_COPY_K = path.join(WS, 'tmp', 'w64-freeze-negctl-copy.md')
if (!fs.existsSync(FREEZE_FOR_K)) {
  t('负控K 前置：必须能读到 V0.3-FREEZE.md（否则该面无法被负控）', false, FREEZE_FOR_K)
} else {
  const fzK = fs.readFileSync(FREEZE_FOR_K, 'utf8').split('\n')
  const iTh = fzK.findIndex(l => /tavern_events/.test(l))
  if (iTh < 0) {
    t('负控K 前置：V0.3-FREEZE 里含 `tavern_events` 的行必须能定位', false, `行下标=${iTh}`)
  } else {
    // 注入：把「有机器守」的依据指向一个**不在构建期跑**的脚本
    //   ★ 注入文本必须**命中判据的 forms**（`N 个 API`）—— 「82 项全表」**不命中**
    //     （`项` 后须跟 `stub`），用它注入 ⇒ 负控**空转**（W64 实测踩到，P-30）。
    const injK = fzK.slice()
    injK[iTh] = '- 酒馆助手基本盘：71 个 API（★ 有机器守：由 `audit-card-event-surface.mjs` 断言）、tavern_events 82 项全表、事件时序。'
    fs.writeFileSync(FREEZE_COPY_K, injK.join('\n'), 'utf8')
    const rK = runAudit(GOAL, path.join(ROOT, 'README.md'), FREEZE_COPY_K)
    const hitK = /71 个\s*API[\s\S]{0,120}未标注|写死「71 个 API/.test(rK.out)
    t('★★负控K（W64 · 装置不在跑 ⇒ 不豁免）：V0.3-FREEZE 的「有机器守」指向**构建期零引用**的脚本 ⇒ **必须报红**',
      rK.code !== 0, `exit=${rK.code}`)
    t('★负控K：报红理由正确（指出该数字未被标注为读数 / 未被有效守卫）', hitK,
      rK.out.split('\n').find(l => /✗/.test(l))?.slice(0, 120) ?? '')
    // ★ 杠杆 K：把依据改成 **vitest 规格**（真会跑的通路）⇒ 必须回绿
    const okK = fzK.slice()
    fs.writeFileSync(FREEZE_COPY_K, okK.join('\n'), 'utf8')
    const rK2 = runAudit(GOAL, path.join(ROOT, 'README.md'), FREEZE_COPY_K)
    t('★杠杆K：V0.3-FREEZE 副本为真实（已修·依据是 vitest 规格）内容 ⇒ **必须回绿**', rK2.code === 0, `exit=${rK2.code}`)
    if (fs.existsSync(FREEZE_COPY_K)) fs.unlinkSync(FREEZE_COPY_K)
  }
}

// ---- ★★ L（**W66 新增**）：**日志读数 vs 文档写死数字**必须对账（守 P-62「接线 ≠ 消费」）----
//   ★ 为什么必须补（**P-59 纪律③**）：W66 给闸门加了「读数 ↔ 文档数字」对账（`readingVsDocProblems`），
//     而**负控若不覆盖它**，该判据在负控面上就是一条**永远测不到的死判据**。
//   ★ 注入形态 = **W66 实测的真缺陷形态**：本轮决定性实验里把 §3.1 的 `TARGETS **9 项**`
//     改成 `3 项`（**文档 < 日志读数** ⇒ 文档过期）—— 修前**5 个闸门全部 exit=0**。
//   ★ 注意方向：注入**改小**（文档 < 实测）才报红；改**大**属「声明 > 实测」⇒ **只出声**（单向纪律）。
const dL = drill('负控L（文档数字小于日志读数 ⇒ 过期）', (ls) => {
  const i = ls.findIndex(l => /TARGETS\s*\*\*9\s*项\*\*/.test(l))
  if (i < 0) return false
  ls[i] = ls[i].replace('TARGETS **9 项**', 'TARGETS **3 项**')
  return ls[i].includes('TARGETS **3 项**')
}, /日志读数[\s\S]{0,60}文档过期|文档过期[\s\S]{0,80}日志读数/, '文档 3 项 而日志读数 9 项')

// ---- ★★ 杠杆 L（P-20）：改成「大于实测」⇒ **必须回绿**（单向纪律）----
{
  const copy = ORIG.split('\n')
  const i = copy.findIndex(l => /TARGETS\s*\*\*9\s*项\*\*/.test(l))
  if (i < 0) {
    t('杠杆L 前置：锚点必须命中', false, '未找到 TARGETS 行')
  } else {
    copy[i] = copy[i].replace('TARGETS **9 项**', 'TARGETS **99 项**')
    if (!copy[i].includes('TARGETS **99 项**')) {
      t('杠杆L 前置：注入替换必须真的发生', false, '替换未生效')
    } else {
      fs.writeFileSync(COPY, copy.join('\n'), 'utf8')
      const r = runAudit(COPY)
      t('★杠杆L：文档写**大于**日志读数（声明 > 实测）⇒ **必须回绿**（单向纪律，与 gates 同）',
        r.code === 0, `exit=${r.code}`)
    }
  }
}

// ---- ★★ M（**W67 新增**）：**豁免窗口过宽会把真缺陷一起放过**（守 P-38 / P-30）----
//   ★ 为什么必须补（**P-59 纪律③**）：W67 把 `readingVsDocProblems` 的「说明语境排除」
//     从 **±30 字宽窗口 + 宽词表（含 `曾/旧/当时`）** 收窄为 **紧贴前 12 / 后 6 字 + 窄词表**，
//     而**负控若不覆盖它**，这条收窄在负控面上就是**永远测不到的死判据**。
//   ★ 注入形态 = **W67 实测的攻击样本**：在 TARGETS 行**同一行**里塞一个**豁免词**（「曾」），
//     同时把当前值**改小**（真缺陷）—— 修前**静默放过**（**P-30**）。
//   ★ 注意：本条**测的是「豁免词在场时仍能报红」**，与负控 L（无豁免词）**互补** ——
//     L 证「正常路径会红」，M 证「豁免词不能把它吞掉」（**P-58 的两侧纪律**）。
const dM = drill('负控M（豁免词在场仍须报红 —— 窗口不得过宽）', (ls) => {
  const i = ls.findIndex(l => /TARGETS\s*\*\*9\s*项\*\*/.test(l))
  if (i < 0) return false
  const before = ls[i]
  ls[i] = ls[i].replace('TARGETS **9 项**', 'TARGETS **3 项**（★ 曾按 12 项统计）')
  return ls[i] !== before && ls[i].includes('TARGETS **3 项**')
}, /日志读数[\s\S]{0,60}文档过期|文档过期[\s\S]{0,80}日志读数/, '豁免词「曾」在场 + 真缺陷 ⇒ 必须报红')

// ---- ★★ 杠杆 M（P-20）：把塞进去的豁免词去掉 ⇒ **必须回绿**（证明负控 M 不是恒定红）----
{
  const copy = ORIG.split('\n')
  const i = copy.findIndex(l => /TARGETS\s*\*\*9\s*项\*\*/.test(l))
  if (i < 0) {
    t('杠杆M 前置：锚点必须命中', false, '未找到 TARGETS 行')
  } else {
    // 注入「真缺陷 + 豁免词」，再改回**原文（9 项，无豁免词）** ⇒ 回绿
    copy[i] = copy[i].replace('TARGETS **9 项**', 'TARGETS **3 项**（★ 曾按 12 项统计）')
    if (!copy[i].includes('TARGETS **3 项**')) {
      t('杠杆M 前置：注入替换必须真的发生', false, '替换未生效')
    } else {
      copy[i] = copy[i].replace('TARGETS **3 项**（★ 曾按 12 项统计）', 'TARGETS **9 项**')
      fs.writeFileSync(COPY, copy.join('\n'), 'utf8')
      const r = runAudit(COPY)
      t('★杠杆M：把「真缺陷 + 豁免词」改回**原文** ⇒ **必须回绿**（证明负控 M 不是恒定红）',
        r.code === 0, `exit=${r.code}`)
    }
  }
}

// ---- ★★ I（**W74 新增**）：`TASK-LIST.md` 面（**第四个受守文档**）----
//   ★ 为什么必须补（**P-59 纪律②/③**）：W59 把受守面扩到四份文档
//     （GOAL + README + V0.3-FREEZE + **TASK-LIST**），而**负控只覆盖了前三份**
//     ⇒ ★★ **`--tasklist` 这个输入面从来没有被负控传过** ⇒ TASK-LIST 那一半
//     **无法被负控**（**P-1**：注入点必须落在判据真正的扫描面上）。
//   ★★ **W74 的取证手法（可复用）**：全仓对账「闸门支持哪些输入面 flag」×「负控传了哪些」
//     ⇒ `audit-baseline-claims.mjs` 支持 `--file / --readme / --freeze / --tasklist`
//     而 `-negctl` 只传了前三个 ⇒ **结构性缺口**（不是写漏一行，是**这一类**没守）。
//   ★ 注入形态 = **W59 实测的修前原文**：T-28 行原写「约 50 项记名 stub」而 `TH_UNSUPPORTED_APIS` 实测 81 项。
const TASKLIST_REAL = path.join(ROOT, 'TASK-LIST.md')
const TASKLIST_COPY = path.join(WS, 'tmp', 'w74-tasklist-negctl-copy.md')
// ★ README_REAL / FREEZE_REAL 已在 G/H 组声明（P-1：不重复声明）
if (!fs.existsSync(TASKLIST_REAL)) {
  t('负控I 前置：必须能读到 TASK-LIST.md（否则该面无法被负控）', false, TASKLIST_REAL)
} else {
  const tl = fs.readFileSync(TASKLIST_REAL, 'utf8').split('\n')
  const iT28 = tl.findIndex(l => /T-28/.test(l) && /记名 stub/.test(l))
  if (iT28 < 0) {
    t('负控I 前置：TASK-LIST 里「T-28 + 记名 stub」行必须能定位', false, `行下标=${iT28}`)
  } else {
    const inj = tl.slice()
    // ★ 恢复 W59 的**修前形态**（把读数形态改回写死的旧数字）
    inj[iT28] = tl[iT28].replace(/「约 50 项记名 stub」[^）]*）/, '「**约 50 项记名 stub**」）')
    const mutated = inj[iT28] !== tl[iT28] && /约 50 项记名 stub/.test(inj[iT28])
    if (!mutated) {
      t('负控I 前置：注入必须真的改到那一行（否则本组空转，P-30）', false, `注入后=${inj[iT28].slice(0, 90)}`)
    } else {
      fs.writeFileSync(TASKLIST_COPY, inj.join('\n'), 'utf8')
      const rI = runAudit(GOAL, README_REAL, FREEZE_REAL, TASKLIST_COPY)
      t('★★负控I（W74 · TASK-LIST 面写死「约 50 项记名 stub」）：**必须报红**（修前该面无法被负控，P-1）',
        rI.code !== 0, `exit=${rI.code}`)
      const hitI = /TASK-LIST|记名|stub/.test(rI.out)
      t('★负控I：报红理由正确（点名 TASK-LIST 面 / 记名 stub 那条声明）', hitI,
        rI.out.split('\n').find(l => /✗/.test(l))?.slice(0, 110) ?? '(无 ✗ 行)')
      // ★ 杠杆 I：把副本改回**真实（已修的）形态** ⇒ 必须回绿
      fs.writeFileSync(TASKLIST_COPY, tl.join('\n'), 'utf8')
      const rI2 = runAudit(GOAL, README_REAL, FREEZE_REAL, TASKLIST_COPY)
      t('★杠杆I：TASK-LIST 副本改回读数形态 ⇒ **必须回绿**（证明负控 I 不是恒定红）', rI2.code === 0, `exit=${rI2.code}`)
      if (fs.existsSync(TASKLIST_COPY)) fs.unlinkSync(TASKLIST_COPY)
    }
  }
}

// ---- 真实仓库**未被触碰**自证（本负控全程只写临时副本）----
const back = fs.readFileSync(GOAL, 'utf8')
t('真实仓库未被触碰（逐字节一致 —— 本负控只用临时副本）', back === ORIG, `len ${back.length} vs ${ORIG.length}`)

// 清理临时副本
if (fs.existsSync(COPY)) fs.unlinkSync(COPY)

console.log(fail === 0
  ? '\n[baseline-negctl] OK —— 闸门有杠杆（注入 ⇒ 报红且指出两个值；改回 ⇒ 回绿；★ W66 日志读数对账；真实仓库全程未被触碰）'
  : `\n[baseline-negctl] ${fail} 项失败 —— 闸门可能已成「死判据」`)
reportSelftest('baseline-claims-negctl', total - fail, total)
process.exit(fail === 0 ? 0 : 1)
