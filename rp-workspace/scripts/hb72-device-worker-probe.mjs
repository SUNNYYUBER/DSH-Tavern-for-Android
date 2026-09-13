// T-78 前置实测：**在设备（安卓 node）上**验证 `worker_threads` 可用性
//
// 【为什么要设备实测】goal 原文要求「先实测安卓 node 的 worker_threads 可用性，再定选型」。
// 子代理只在本机 node v24 上验了 API 正确性 —— 那**不能代表安卓 node**（不同构建/无完整 ICU/
// 可能被裁掉 worker 支持）。本探针把一段最小脚本推到设备跑，直接看结果。
// 只读：临时文件落在 /data/local/tmp，跑完删除；不碰产品数据。
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const ADB = process.env.ADB_PATH ?? `${process.env.USERPROFILE ?? ''}/.android/sdk/platform-tools/adb.exe`
const sh = (cmd, opts = {}) => execFileSync(ADB, ['-s', 'emulator-5554', 'shell', cmd], { encoding: 'utf8', ...opts })

// 1) 找到设备上 node 可执行文件（DSH runtime 自带）
const candidates = [
  'files/dsh-runtime/bin/node',
  'files/dsh-runtime/node',
  'files/node/bin/node',
]
let nodePath = null
for (const c of candidates) {
  const r = sh(`run-as com.dshtavern.app ls ${c} 2>/dev/null || true`).trim()
  if (r) { nodePath = c; break }
}
if (!nodePath) {
  // 兜底：列举 runtime 顶层，找像 node 的条目
  const top = sh(`run-as com.dshtavern.app ls files/dsh-runtime 2>/dev/null || true`).trim()
  console.log('[info] dsh-runtime 顶层：', top.split('\n').slice(0, 20).join(' '))
}
console.log(`[node] 候选路径 = ${nodePath ?? '(未找到，尝试PATH)'}`)

// 2) 最小探针脚本（同时测 worker_threads 与 process.version）
const PROBE = `
const out = { version: process.version, platform: process.platform, arch: process.arch };
try {
  const wt = require('worker_threads');
  out.workerThreadsAvailable = typeof wt.Worker === 'function';
  if (out.workerThreadsAvailable) {
    const code = "const {parentPort}=require('worker_threads');parentPort.postMessage('pong')";
    const w = new wt.Worker(code, { eval: true });
    const t0 = Date.now();
    let done = false;
    w.once('message', m => { done = true; out.workerMessage = m; out.workerMs = Date.now() - t0; w.terminate(); });
    w.once('error', e => { out.workerError = String(e && e.message); w.terminate(); });
    setTimeout(() => { if (!done) { out.workerTimeout = true; try { w.terminate() } catch (e) {} } }, 3000);
  }
} catch (e) {
  out.workerThreadsAvailable = false;
  out.workerThreadsError = String(e && e.message);
}
setTimeout(() => { process.stdout.write('RESULT:' + JSON.stringify(out) + '\\n'); process.exit(0) }, 4000);
`
writeFileSync('D:/DSH RolePlay/tmp/hb72-wt-probe.js', PROBE, 'utf8')
execFileSync(ADB, ['-s', 'emulator-5554', 'push', 'D:/DSH RolePlay/tmp/hb72-wt-probe.js', '/data/local/tmp/hb72-wt-probe.js'], { encoding: 'utf8' })
// 让 run-as 用户可读
sh('chmod 644 /data/local/tmp/hb72-wt-probe.js')

// 3) 跑（先试 run-as 直接跑 node）
const N = nodePath ? `/data/data/com.dshtavern.app/${nodePath}` : 'node'
let runOut = ''
try {
  runOut = sh(`run-as com.dshtavern.app ${N} /data/local/tmp/hb72-wt-probe.js 2>&1 || true`)
} catch (e) { runOut = 'ERR: ' + e.message }
if (!/RESULT:/.test(runOut)) {
  // 兜底：拷进 app 私有目录再跑
  try {
    sh('run-as com.dshtavern.app cp /data/local/tmp/hb72-wt-probe.js files/hb72-wt-probe.js')
    runOut = sh(`run-as com.dshtavern.app ${N} files/hb72-wt-probe.js 2>&1 || true`)
    sh('run-as com.dshtavern.app rm -f files/hb72-wt-probe.js')
  } catch (e) { runOut += '\nFALLBACK ERR: ' + e.message }
}
console.log('\n=== 设备侧 worker_threads 实测输出 ===')
console.log(runOut.trim().slice(0, 1500))

sh('rm -f /data/local/tmp/hb72-wt-probe.js')
console.log('\n[cleanup] 设备临时文件已删')
