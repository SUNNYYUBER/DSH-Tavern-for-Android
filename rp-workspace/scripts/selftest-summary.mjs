#!/usr/bin/env node
/**
 * selftest-summary.mjs —— **判据装置自证分数的「单源输出契约」**（P-1 / W44）
 * =============================================================================
 * ## 守什么（一句话）
 * 所有带 `--selftest` 的判据装置，其**收尾输出**必须能被机器读出**两个数**：
 * 「通过项数」与「总项数」。本模块是这两个数的**唯一产出点**（P-1：同一语义一处读法）。
 *
 * ## 为什么必须统一（W43 分诊出的第三处「无机器守着」区 · W44 收口）
 * W42/W43 给「文档结构」装了闸门，但机器**读不出闸门自己的分数** —— 因为收尾输出
 * 历史上长成了**三种形态**（实测）：
 *   ① `[goalsections selftest] 24/24 PASS`      ← `N/M` 在前
 *   ② `[selftest] PASS（14/14）`                 ← `N/M` 在后
 *   ③ `[openitems-negctl] OK —— 闸门有杠杆（…）` ← **根本不含分数**
 * ⇒ 后果：文档里写的「selftest 8/8」与实现**可以静默脱钩**（W44 实测抓到
 *   `audit-p48-negctl.mjs` 文档声明 8/8、实际输出无分数；`audit-goal-sections.mjs`
 *   文档写 16/16、实际已 24/24）。**这类不一致人眼极难发现**（数字散落在多处）。
 * ⇒ 本模块把「分数行格式」变成**单源**，于是「文档声明 vs 实际」可以被机器逐条对照。
 *
 * ## 契约（**机器可读**，且**人可读**）
 * 收尾**必须**打印恰好一行：
 *     [selftest-summary] <name> <pass>/<total> PASS
 * 失败时：
 *     [selftest-summary] <name> <pass>/<total> FAIL
 * ★ 正则（供闸门与探针共用）：`/\[selftest-summary\]\s+(\S+)\s+(\d+)\/(\d+)\s+(PASS|FAIL)/`
 * ★ **`pass === total` ⟺ `PASS`**（不许出现「N/M 但 FAIL」或「全过却 FAIL」的错位）。
 *
 * ## 诚实边界（R7）
 *   ① 本模块只管**输出格式**，不管「判据内容是否有效」—— 后者靠正负控与杠杆（P-30）。
 *   ② 它**不改变退出码**（退出码仍由各脚本自己决定）—— 避免「装了报告器就以为安全了」。
 *
 * 用法（在脚本收尾处调用，随后自行 `process.exit`）：
 *   import { reportSelftest } from './selftest-summary.mjs'
 *   reportSelftest('goalsections', pass, total)
 */
import process from 'node:process'

/** 机器可读的分数行正则（**单源** —— 闸门与探针都从这里 import，守 P-1） */
export const SELFTEST_LINE_RE = /\[selftest-summary\]\s+(\S+)\s+(\d+)\/(\d+)\s+(PASS|FAIL)/

/**
 * 打印统一的自证收尾行。
 * @param {string} name  装置短名（如 `goalsections` / `openitems-negctl`）
 * @param {number} pass  通过项数
 * @param {number} total 总项数
 * @param {{ extra?: string }} [opt] `extra` 会**另起一行**打印（人读的补充说明，
 *        绝不能塞进分数行 —— 否则机器正则要跟着长，那是 P-1 违例）
 * @returns {boolean} `pass === total`（调用方据此定退出码）
 */
export function reportSelftest (name, pass, total, opt = {}) {
  const ok = Number(pass) === Number(total)
  // ★ 先打人读的补充（若有），再打机器可读行 —— 保证分数行是**最后一行**，
  //   让「取最后一行」这种朴素读法也能用（降低后续装置的门槛）。
  if (opt.extra) console.log(opt.extra)
  console.log(`\n[selftest-summary] ${name} ${pass}/${total} ${ok ? 'PASS' : 'FAIL'}`)
  return ok
}

export default reportSelftest
