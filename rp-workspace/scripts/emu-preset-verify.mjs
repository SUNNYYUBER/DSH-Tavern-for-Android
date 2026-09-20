#!/usr/bin/env node
/**
 * emu-preset-verify.mjs —— bychv 预设管线 模拟器实证（管线切换前置验证）
 * ============================================================================
 * 背景：RP 会话的预设注入要从我方 pre-step 快照管线（withPresetLayer）切换为
 * bychv/dsh-preset-enhance 统一承担。切换前必须在模拟器实证四件事（本脚本覆盖①②）：
 *   ① bychv 注入在普通（非 RP）会话真实生效 —— mock 落盘 payload 里
 *      EMU_VERIFY_MARKER 恰好出现一次，且 {{user}} 宏按 binding.values 渲染
 *   ② 注入确实由 bychv 绑定驱动 —— 解绑后再发一条，marker 0 次（对照组）
 *   （③ RP 会话双注 与 ④ 变量划界 由后续步骤覆盖）
 *
 * 观测点：golden-mock-llm 的 MOCK_DUMP 落盘（发给模型的真实 payload）。
 * 前置：
 *   - 模拟器已启动，DSHTavern 已运行（http://127.0.0.1:43080 可通）
 *   - adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>
 *   - MOCK_DUMP=<dump 前缀> node scripts/golden-mock-llm.mjs 已启动
 *
 * 安全：全部写操作发生在**新建的测试会话**与 bychv 预设 store（测试预设可删），
 *   不触碰模拟器里已有的 RP 会话；默认模型在结束时还原。
 *
 * 用法：node scripts/emu-preset-verify.mjs
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { makeEv } from './cdp-eval.mjs'

const ADB = process.env.DSHT_ADB ?? `${process.env.USERPROFILE}/.android/sdk/platform-tools/adb.exe`
const DUMP_DIR = fileURLToPath(new URL('../out/emu-verify', import.meta.url))
const MARKER = 'EMU_VERIFY_MARKER_7F3A'
const EMU_USER = 'EMU验证用户'
const CWD = '/data/data/com.dshtavern.app/files/.dsh/emu-verify'

const ev = makeEv({ port: 9333 })
let fail = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? '：' + detail : ''}`)
  if (!ok) fail++
}
/** 同源 /api RPC。注意：当前 DSH 端点是 `<ns>/<method>` 两段式（不是旧版点式），
 *  且 payload 必须包 `{ args: {...} }`（typert gateway 严格校参）。 */
async function api(method, args) {
  const j = await ev(`fetch('/api/${method}', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ type: 'client-request', rpcId: 'emu-${Date.now()}-${Math.random()}', method: ${JSON.stringify(method)}, payload: { args: ${JSON.stringify(args ?? {})} } }) }).then(r => r.json())`)
  return j
}
/** bychv 预设 API（webServer exact 路由，非 RPC 信封） */
async function presetApi(method, qs = '', body = null) {
  const init = method === 'GET'
    ? ''
    : `, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(${JSON.stringify(body ?? {})}) }`
  const j = await ev(`fetch('/preset-enhance/api${qs}'${init}).then(r => r.json())`)
  return j
}
const adb = (...args) => execFileSync(ADB, ['-s', 'emulator-5554', ...args], { encoding: 'utf8' })

// ---------------------------------------------------------------- Phase A：provider 指向 mock
console.log('=== A. 配置 emu-mock provider ===')
// 无 settings.get RPC（官方不设读面）；模拟器既有配置即 cdp-compat-api-test 还原口径
// deepseek-official / deepseek-v4-flash，收尾按此还原。
const prevDefault = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
console.log('原默认模型（结束还原）：', JSON.stringify(prevDefault))

await api('credentials/set', { ref: 'EMU_MOCK_API_KEY', value: 'sk-emu-mock' })
const prov = await api('settings/update', {
  ns: 'llm-pi-ai',
  patch: {
    providers: {
      'emu-mock': {
        displayName: 'EMU Mock', apiKeyEnv: 'EMU_MOCK_API_KEY', api: 'openai-completions',
        baseURL: 'http://10.0.2.2:31101/v1',
        compat: { supportsDeveloperRole: false, maxTokensField: 'max_tokens' },
        models: [{ id: 'golden-mock', name: 'golden-mock' }],
      },
    },
  },
})
check('settings/update 写入 emu-mock 路由', prov?.result?.ok === true, JSON.stringify(prov?.result?.error?.message ?? '').slice(0, 120))
const def = await api('settings/update', { ns: 'agent-default-model', patch: { provider: 'emu-mock', model: 'golden-mock' } })
check('默认模型指向 emu-mock/golden-mock', def?.result?.ok === true)

// ---------------------------------------------------------------- Phase B：保存测试预设
console.log('\n=== B. 保存 bychv 测试预设 ===')
const st0 = await presetApi('GET')
check('bychv API 可达（GET /preset-enhance/api）', typeof st0?.revision === 'number', `revision=${st0?.revision} presets=${st0?.presets?.length ?? '?'}`)
const testPreset = {
  prompts: [
    { identifier: 'emuMarker', name: 'EMU 验证标记', role: 'system', content: `${MARKER} user={{user}}`, enabled: true },
    { identifier: 'chatHistory', enabled: true },
  ],
  prompt_order: [{
    character_id: '100001',
    order: [
      { identifier: 'emuMarker', enabled: true },
      { identifier: 'chatHistory', enabled: true },
    ],
  }],
}
// 幂等：已有同名预设则复用（上轮跑到一半留下的），否则保存新的
let presetId = (st0?.presets ?? []).find(p => p?.name === 'EMU 验证预设')?.id ?? null
if (presetId) {
  console.log('复用既有测试预设：', presetId)
} else {
  const saved = await presetApi('POST', '', { action: 'save', name: 'EMU 验证预设', preset: testPreset, revision: st0.revision })
  check('测试预设保存成功', typeof saved?.id === 'string', saved?.id ?? JSON.stringify(saved).slice(0, 120))
  presetId = saved?.id
}

// ---------------------------------------------------------------- Phase C：普通会话 + 绑定 → 发消息
console.log('\n=== C. 普通会话：绑定 bychv 预设 → 发消息 ===')
adb('shell', 'run-as', 'com.dshtavern.app', 'mkdir', '-p', CWD.replace('/data/data/com.dshtavern.app/files/', 'files/'))
const knownBefore = new Set(existsSync(DUMP_DIR) ? readdirSync(DUMP_DIR) : [])

const created = await api('session/create', { request: { cwd: CWD } })
const sid = String(created?.result?.value?.sessionId ?? created?.result?.sessionId ?? '')
check('普通会话已创建', sid.length > 0, `sid=${sid} ${sid ? '' : JSON.stringify(created).slice(0, 200)}`)

if (sid && presetId) {
  const st1 = await presetApi('GET', `?sessionId=${encodeURIComponent(sid)}`)
  const bound = await presetApi('POST', '', {
    action: 'bind', sessionId: sid,
    binding: { enabled: true, presetId, characterId: null, values: { user: EMU_USER }, markers: {} },
    revision: st1.revision,
  })
  check('bychv 绑定已启用', bound?.ok === true, JSON.stringify(bound).slice(0, 120))

  const prompted = await api('session/prompt', {
    request: { requestId: crypto.randomUUID(), sessionId: sid, mode: 'queue', content: [{ type: 'text', text: '（EMU 验证）请用一句话打个招呼。' }] },
  })
  check('session/prompt 已受理', prompted?.result?.ok === true || prompted?.result?.value != null, JSON.stringify(prompted?.result).slice(0, 160))

  // 轮询 mock 落盘（生成 + SSE 走完最多 ~30s）
  let dumpFile = null
  for (let t = 0; t < 20 && !dumpFile; t++) {
    await sleep(3000)
    const now = readdirSync(DUMP_DIR).filter(f => !knownBefore.has(f) && f.endsWith('.json'))
    if (now.length) dumpFile = now.sort().at(-1)
  }
  check('mock 收到请求并落盘', !!dumpFile, dumpFile ?? '(60s 无落盘)')

  if (dumpFile) {
    const payload = JSON.parse(readFileSync(`${DUMP_DIR}/${dumpFile}`, 'utf8'))
    const msgs = payload.messages ?? []
    const hits = msgs.filter(m => JSON.stringify(m).includes(MARKER))
    check('① bychv 注入生效（marker 恰好一次）', hits.length === 1, `命中 ${hits.length} 条 / 共 ${msgs.length} 条 messages`)
    const hitText = hits.map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join(' ')
    check('① 宏按 binding.values 渲染（user=EMU验证用户）', hitText.includes(`user=${EMU_USER}`), hitText.slice(0, 100))
    check('① marker 以 system 角色注入', hits.every(m => m.role === 'system'), hits.map(m => m.role).join(','))
  }

  // -------------------------------------------------------------- Phase D：解绑对照
  console.log('\n=== D. 解绑对照：marker 应 0 次 ===')
  const st2 = await presetApi('GET', `?sessionId=${encodeURIComponent(sid)}`)
  const unbound = await presetApi('POST', '', {
    action: 'bind', sessionId: sid,
    binding: { enabled: false, presetId, characterId: null, values: {}, markers: {} },
    revision: st2.revision,
  })
  check('bychv 绑定已关闭', unbound?.ok === true)
  const known2 = new Set(readdirSync(DUMP_DIR))
  await api('session/prompt', {
    request: { requestId: crypto.randomUUID(), sessionId: sid, mode: 'queue', content: [{ type: 'text', text: '（EMU 验证·对照）再打个招呼。' }] },
  })
  let dump2 = null
  for (let t = 0; t < 20 && !dump2; t++) {
    await sleep(3000)
    const now = readdirSync(DUMP_DIR).filter(f => !known2.has(f) && f.endsWith('.json'))
    if (now.length) dump2 = now.sort().at(-1)
  }
  if (dump2) {
    const payload2 = JSON.parse(readFileSync(`${DUMP_DIR}/${dump2}`, 'utf8'))
    const hits2 = (payload2.messages ?? []).filter(m => JSON.stringify(m).includes(MARKER))
    check('② 解绑后 marker 0 次（注入由 bychv 绑定驱动）', hits2.length === 0, `命中 ${hits2.length} 条`)
  } else {
    check('② 对照请求落盘', false, '60s 无落盘')
  }
}

// ---------------------------------------------------------------- 收尾：还原默认模型
console.log('\n=== 收尾 ===')
await api('settings/update', { ns: 'agent-default-model', patch: prevDefault })
console.log('默认模型已还原（deepseek-official）')
console.log(fail ? `\n[EMU 验证①②] ${fail} 项未通过` : '\n[EMU 验证①②] 全部通过')
process.exit(fail ? 1 : 0)

