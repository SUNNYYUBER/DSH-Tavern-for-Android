// hb71-pinpoint.mjs — 精确定位 RegexBinding 在 :3540 之后从哪一行退出
//
// 【已确认】RegexBinding 走到 `:3539 got-presetRegexes` 之后**不再前进**，且**不抛错**
// （四段留痕里是 `SEG:RegexBinding:ok`，非 THROW）。
// ⇒ 只能是「被某个提前 return 退出」或「某行静默失败但流程继续到 return」。
// 本探针在 3540→3877 之间**均匀布点**（每 20 行一个），一次跑出断点位置。
// 零写入。
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const ADB = process.env.ADB_PATH ?? `${process.env.USERPROFILE ?? ''}/.android/sdk/platform-tools/adb.exe`
const sh = (cmd) => execFileSync(ADB, ['-s', 'emulator-5554', 'shell', cmd], { encoding: 'utf8' })

let SRC = readFileSync('D:/DSH RolePlay/tmp/t37-inject.js', 'utf8')
const lines = SRC.split('\n')

// 布点规则：在 3540..3886 范围内，找**缩进为 2 空格且以语句开头**的行（RegexBinding 本体的顶层语句），
// 在这些行**前面**插入打点。避免插进回调内部造成误判。
const probes = []
for (let i = 3540; i <= 3886; i++) {
  const raw = lines[i - 1]
  if (raw === undefined) continue
  // 本体顶层语句：恰好 2 空格缩进，且不是 `}`/注释/空行；跳过 `function`/回调参数行
  if (/^ {2}\S/.test(raw) && !/^ {2}[})\]]/.test(raw) && !/^\s*\/\//.test(raw)) {
    probes.push(i)
  }
}
console.log(`[probe] 候选打点行 ${probes.length} 个：${probes.slice(0, 40).join(',')}${probes.length > 40 ? ' …' : ''}`)

// 从后往前插，避免行号漂移
for (let k = probes.length - 1; k >= 0; k--) {
  const i = probes[k]
  const raw = lines[i - 1]
  const esc = raw.trim().slice(0, 60).replace(/'/g, "\\'")
  lines.splice(i - 1, 0, `  try { (window.__hb71 = window.__hb71 || []).push(${i}: '${esc}') } catch (e) {}`)
}
const SRC2 = lines.join('\n')
console.log(`[src] 已插 ${probes.length} 个打点（${SRC2.length} 字节）`)

const m = sh('cat /proc/net/unix').match(/@webview_devtools_remote_(\d+)/)
execFileSync(ADB, ['-s', 'emulator-5554', 'forward', 'tcp:9333', `localabstract:webview_devtools_remote_${m[1]}`], { encoding: 'utf8' })
const list = await fetch('http://127.0.0.1:9333/json/list').then(r => r.json())
const page = list.find(t => t.type === 'page')
const { WebSocket } = globalThis
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, { res }); ws.send(JSON.stringify({ id, method, params })) })
ws.addEventListener('message', e => {
  const x = JSON.parse(e.data)
  if (x.id && pending.has(x.id)) { const { res } = pending.get(x.id); pending.delete(x.id); res(x.result) }
})
await new Promise(r => ws.addEventListener('open', r))
await send('Runtime.enable')
const ev = async (expr, awaitPromise = true) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise })
  if (r.exceptionDetails) return { __err: JSON.stringify(r.exceptionDetails).slice(0, 300) }
  return r.result.value
}
for (let i = 0; i < 30; i++) {
  if (await ev(`typeof window.SillyTavern === 'object'`) === true) break
  await new Promise(r => setTimeout(r, 2000))
}
await ev(`(() => { window.__hb71 = []; return true })()`)
console.log('[inject]', JSON.stringify(await ev(`(() => {
  const s = document.createElement('script'); s.id = '__hb71__'
  s.textContent = ${JSON.stringify(SRC2)}
  document.body.appendChild(s); return { ok: true }
})()`, false)))
await new Promise(r => setTimeout(r, 6000))

const out = await ev(`(() => {
  const t = window.__hb71 || []
  const nums = t.map(x => Number(String(x).split(':')[0]))
  return {
    命中点数: t.length,
    命中行号: nums,
    最大命中行: nums.length ? Math.max(...nums) : null,
    最后一个: t.length ? t[t.length - 1] : null,
  }
})()`)
console.log('\n=== 断点定位 ===')
console.log(JSON.stringify(out, null, 2))
console.log('\n（对照：若最大命中行 ≈ 3566，说明它卡在 :3567 的 11305 早退；若 ≈ 3602，卡在 :3604 附近）')
await ev(`(() => { const s = document.getElementById('__hb71__'); if (s) s.remove(); return true })()`)
ws.close()
