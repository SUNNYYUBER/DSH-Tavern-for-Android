#!/usr/bin/env node
/**
 * session-contract-probe.mjs — 官方契约探针（T-02b 回归测试的外部执行体）
 * ============================================================================
 * 为什么独立成进程：vite（vitest 的打包器）会拦截磁盘上外部 ESM 包的动态 import
 * （`new Function('return import(u)')` 在 vite 的 VM 里没有 import callback）。
 * 本脚本用**真实 Node ESM** 加载官方迁移器，从 stdin 读会话文本、往 stdout 写判定。
 *
 * 用法：
 *   node tests/session-contract-probe.mjs migrate <session.jsonl 路径>
 *   node tests/session-contract-probe.mjs fold    <session.jsonl 路径>
 * 退出码：0 = 通过；1 = 失败（stdout 给出原因）
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const RT = process.env.DSHT_RUNTIME_DIR
  ?? 'D:/DSH RolePlay/rp-workspace/dsh-runtime-android/node_modules/@deepseek-ai'

const mode = process.argv[2]
const file = process.argv[3]
if (!mode || !file) { console.error('用法: node session-contract-probe.mjs <migrate|fold> <file>'); process.exit(2) }

const catalogMod = await import(pathToFileURL(`${RT}/dsh-session-format-catalog/lib/index.js`).href)
const { foldSurface } = await import(pathToFileURL(`${RT}/dsh-session/lib/types/surface.js`).href)

/**
 * ★★ **0.1.7 的 v3→v4 迁移要求「显式子级证据」**（**2026-09-23 DSH 升级轮 · 阶段 E 实测**）。
 *
 * ## 事实（读产物逐行确认，不是猜）
 * `dsh-session-format-v3-to-v4/lib/index.js:1414-1416`：
 * ```js
 * createStage() {
 *   throw new SessionFormatUnsupportedMigrationError(
 *     "V3 catalog migration requires explicit historical child facts, " +
 *     "including an empty array for a parent without children");
 * }
 * ```
 * ⇒ **`sessionFormatV3ToV4` 这个静态边**在 0.1.7 上**无条件拒绝**；
 *   它只是「**头部的声明**」，**身体恢复必须提供显式子级证据**（同文件 :1402 注释原文）。
 * 正确用法（同文件 :1424-1429 / catalog 的 `createSessionFormatCatalogWithChildren`）：
 * ```js
 * const catalog = createSessionFormatCatalogWithChildren([])  // 空数组 = 声明「确无子级」
 * ```
 * ★ 这与**附录 A.2 记录的「迁移硬约束①」逐字吻合**（「`createStage()` 在没有子级绑定时会拒绝；
 *   空数组才表示『确无子级』」）—— 只是当时是「读 README 推出来的」，本轮是**实跑撞上的**。
 *
 * ## 本探针的处置（**跨代兼容**：0.1.5 与 0.1.7 都要能跑）
 *   · 有 `createSessionFormatCatalogWithChildren`（0.1.7+）⇒ 用它 + `[]`（本探针的样本会话
 *     **确实没有 subagent 子会话** ⇒ 空数组是**如实声明**，不是绕过）；
 *   · 无它（0.1.5）⇒ 退回原 `sessionFormatCatalog`（那代不允许/不需要该证据）。
 *   ⚠️ **诚实边界（R7）**：本探针只覆盖「无子级」的样本。**带子级的迁移**是
 *     `NodeService` / 会话写入路径的职责，不在本探针面内（那边必须**收集真实直属子会话集合**）。
 */
const catalog = typeof catalogMod.createSessionFormatCatalogWithChildren === 'function'
  ? catalogMod.createSessionFormatCatalogWithChildren([]) // 空数组 = 如实声明「确无直属子级」
  : catalogMod.sessionFormatCatalog

const lines = readFileSync(file, 'utf8').split('\n').filter(l => l.trim() !== '')
const header = JSON.parse(lines[0])

let restore
try {
  restore = catalog.createRestore(header, { recovery: 'recoverable', validation: 'transformed' })
} catch (e) {
  console.log(`HEADER-REJECT: ${e.message}`)
  process.exit(1)
}
for (let i = 1; i < lines.length; i++) {
  let row
  try { row = JSON.parse(lines[i]) } catch { continue }
  try { restore.decodeRow(row) } catch (e) {
    console.log(`MIGRATE-REJECT seq=${row.seq} type=${row.type}: ${e.message}`)
    process.exit(1)
  }
}
let artifact
try { artifact = restore.finish() } catch (e) { console.log(`FINISH-REJECT: ${e.message}`); process.exit(1) }

if (mode === 'fold') {
  try {
    const r = foldSurface(artifact.events)
    console.log(`FOLD-OK nodes=${JSON.stringify(r.nodes)}`)
  } catch (e) { console.log(`FOLD-REJECT: ${e.message}`); process.exit(1) }
} else {
  console.log(`MIGRATE-OK version=${artifact.header.version} events=${artifact.events.length}`)
}
