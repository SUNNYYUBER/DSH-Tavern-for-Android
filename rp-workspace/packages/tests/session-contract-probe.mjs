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

const { sessionFormatCatalog } = await import(pathToFileURL(`${RT}/dsh-session-format-catalog/lib/index.js`).href)
const { foldSurface } = await import(pathToFileURL(`${RT}/dsh-session/lib/types/surface.js`).href)

const lines = readFileSync(file, 'utf8').split('\n').filter(l => l.trim() !== '')
const header = JSON.parse(lines[0])

let restore
try {
  restore = sessionFormatCatalog.createRestore(header, { recovery: 'recoverable', validation: 'transformed' })
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
