#!/usr/bin/env node
/**
 * seed-rollback-fixture.mjs —— 在设备上造一张**专用于回退实测**的会话
 * ============================================================================
 * ## 为什么需要它（E-F 真回退的前提）
 * goal §七 E-F 要「真回退」，但**不能拿用户的真实卡会话做实验**（会破坏数据）。
 * 故本脚本按 `scripts/setup-pc-verify.mjs` 的同款手法（官方 projectKey/事件形态），
 * 在设备上生成一张**合成会话**：3 个 turn、每 turn 一条 user + 一条 assistant，
 * 含卡前端 HTML 与 MVU 变量更新块 —— 覆盖回退要验的全部形态。
 *
 * ## 与真实卡的区别（诚实标注）
 * 合成会话只验「宿主机制」（回退的手术语义 / 掩码集合 / 不开新分支），
 * **不验**「具体某张卡的行为」。后者由 ef-card-sampling.mjs 的既有会话结果态覆盖。
 *
 * ## 安全
 * sessionId 固定前缀 `rollback-probe-`，只写这一个会话目录；不碰任何既有会话。
 *
 * 用法：node scripts/seed-rollback-fixture.mjs [--push]
 */
import { execFileSync } from 'node:child_process'
import process from 'node:process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const ADB = process.env.DSHT_ADB ?? 'adb'
const PKG = 'com.dshtavern.app'
const WS = 'files/.dsh'
/**
 * 合成会话的 cwd：**复用已有工作区**（wuwa-solaris-3），这样可经 `rp/open-chat`
 * 把它 attach 成 **live** session —— 从而实测 **live 路径**的回退（F2 用户实测失败
 * 路径就在这条上；非 live 的文件截断路径不产掩码，证明不了 F2 的修复）。
 * 用已有工作区也避免新建工作区目录（少一处副作用）。
 */
const CWD = '/data/data/com.dshtavern.app/files/.dsh/rp/rp-wuwa-solaris-3-mvu-editi-b7s7x3'
const SID = 'rollback-probe-live-001'
/** open-chat 用的工作区 slug（与 CWD 末段一致） */
const SLUG = 'rp-wuwa-solaris-3-mvu-editi-b7s7x3'

/** 官方 projectKey 算法（session-persistence-jsonl/format.ts 同款） */
function projectKey(cwd) {
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') { if (!separatorRun) readable += '-'; separatorRun = true }
    else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) { readable += ch; separatorRun = false }
    else { readable += '~' + code.toString(16).toUpperCase().padStart(4, '0'); separatorRun = false }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}

// ---- 合成会话：3 turn × (user + assistant)，含卡前端 HTML 与 MVU 更新块 ----
const lines = []
let seq = 0
const t0 = Date.now() - 3600_000
const emit = (type, data, surfaceOp, sourceEventSeqs) => {
  const ev = { type, seq, time: t0 + seq * 1000, data }
  if (surfaceOp !== undefined) {
    ev.surfaceOp = surfaceOp
    if (sourceEventSeqs !== undefined) ev.sourceEventSeqs = sourceEventSeqs
  }
  lines.push(JSON.stringify(ev)); seq++
}
lines.push(JSON.stringify({ type: 'session', version: 0, id: SID, createdAt: t0, cwd: CWD, delegationDepth: 0 }))

const cardHtml = (n) => '```html\n<!doctype html><html><body>'
  + '<div class="probe-ball" style="position:fixed;right:8px;bottom:8px">探测浮球 ' + n + '</div>'
  + '<script>parent && parent.postMessage && 0</script>'
  + '</body></html>\n```'
for (let turn = 1; turn <= 3; turn++) {
  emit('turn/start', { turn })
  emit('user/message', {
    id: `u-${SID}-${turn}`, role: 'user',
    content: [{ type: 'text', text: `第 ${turn} 轮：我推门走进房间。` }], source: { kind: 'user' },
  }, 'append')
  emit('step/start', { turn, step: 1 })
  const body = `<content>第 ${turn} 轮回应。</content>\n`
    + `<UpdateVariable><JSONPatch>[{"op":"delta","path":"/探测/计数","value":${turn}}]</JSONPatch></UpdateVariable>\n`
    + `<details><summary>实时总结</summary>- 第 ${turn} 轮小结。</details>\n`
    + cardHtml(turn)
  emit('assistant/message', {
    turn, step: 1,
    message: { id: `a-${SID}-${turn}`, role: 'assistant', content: [{ type: 'text', text: body }],
      source: { kind: 'model', provider: 'dsht-probe', model: 'rollback-fixture' } },
  }, 'append')
  emit('step/end', { turn, step: 1 })
  emit('turn/end', { turn, reason: { kind: 'completed' } })
}

const content = lines.join('\n') + '\n'
const tmp = mkdtempSync(join(tmpdir(), 'rb-fixture-'))
const local = join(tmp, 'session.jsonl')
writeFileSync(local, content, 'utf8')

if (!process.argv.includes('--push')) {
  console.log(`[fixture] 已生成（未推设备）：${local}`)
  console.log(`  sessionId=${SID}  projectKey=${projectKey(CWD)}  events=${seq}`)
  process.exit(0)
}

// ---- 推送到设备（run-as 私有目录） ----
const appPid = execFileSync(ADB, ['shell', 'pidof', PKG], { encoding: 'utf8' }).trim()
if (!appPid) { console.error('应用未运行（先启动 DSHTavern）'); process.exit(1) }
const dir = `${WS}/sessions/${projectKey(CWD)}/${SID}`
execFileSync(ADB, ['push', local, '/data/local/tmp/rb-fixture.jsonl'], { stdio: 'inherit' })
execFileSync(ADB, ['shell', `run-as ${PKG} sh -c 'mkdir -p ${dir} && cp /data/local/tmp/rb-fixture.jsonl ${dir}/session.jsonl && echo SEEDED && wc -c < ${dir}/session.jsonl'`], { stdio: 'inherit' })
console.log(`[fixture] 已推送：${dir}/session.jsonl（sessionId=${SID}）`)
console.log('提示：会话目录建好后，需在 App 内让其进入「可加载」状态（重启 App 或重开工作区）。')
