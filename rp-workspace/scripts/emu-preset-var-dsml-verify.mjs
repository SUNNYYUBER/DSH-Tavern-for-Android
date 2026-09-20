#!/usr/bin/env node
/**
 * emu-preset-var-dsml-verify.mjs —— 验证④：变量划界 + DSML/MVU 捕获链兼容
 * ============================================================================
 * ④a 变量划界（T-88 §五：「预设宏 setvar 归其 store，MVU UpdateVariable 归 stat_data」）：
 *   - marker 预设内容加 {{setvar::emuVar::hello}} / {{getvar::emuVar}}
 *   - 请求方向：mock payload 里宏渲染出 var=hello（bychv 编译期求值）
 *   - 落点方向：emuVar 必须出现在 **bychv 的** preset-enhance/state.json（local store），
 *     且 **不得** 出现在 rp/state/<sid>.json（MVU store）
 * ④b DSML 工具转换兼容（响应方向）：
 *   - mock（31102）固定回复含 <UpdateVariable> JSONPatch（/emu_dsml_probe=dsml-ok）
 *   - bychv 绑定启用下，MVU 捕获链必须照常工作：rp/state/<sid>.json 出现 emu_dsml_probe
 *   - （bychv 不改响应流——本判据实证「绑定在场时捕获链零影响」）
 *
 * 安全：st-87rfra 测试卡会话 + rp/state/<sid>.json 双备份（guard 管会话目录，
 *   state 文件脚本自管），结束全量还原。
 *
 * 用法：node scripts/emu-preset-var-dsml-verify.mjs
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { makeEv } from './cdp-eval.mjs'
import { makeSessionGuard } from './session-guard.mjs'

const ADB = process.env.DSHT_ADB ?? `${process.env.USERPROFILE}/.android/sdk/platform-tools/adb.exe`
const DUMP_PREFIX = 'dsml-outbound'
const DUMP_DIR = fileURLToPath(new URL('../out/emu-verify', import.meta.url))
const MARKER = 'EMU_VERIFY_MARKER_7F3A'
const RP_SID = 'st-87rfra'
const STATE_REL = `files/.dsh/rp/state/${RP_SID}.json`

const ev = makeEv({ port: 9333 })
let fail = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? '：' + detail : ''}`)
  if (!ok) fail++
}
async function api(method, args) {
  return ev(`fetch('/api/${method}', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ type: 'client-request', rpcId: 'emu-${Date.now()}-${Math.random()}', method: ${JSON.stringify(method)}, payload: { args: ${JSON.stringify(args ?? {})} } }) }).then(r => r.json())`)
}
async function presetApi(method, qs = '', body = null) {
  const init = method === 'GET'
    ? ''
    : `, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(${JSON.stringify(body ?? {})}) }`
  return ev(`fetch('/preset-enhance/api${qs}'${init}).then(r => r.json())`)
}
const adb = (...args) => execFileSync(ADB, ['-s', 'emulator-5554', ...args], { encoding: 'utf8' })
const readDeviceJson = (rel) => JSON.parse(adb('shell', 'run-as', 'com.dshtavern.app', 'cat', rel))

// state 文件自管备份（guard 只管会话目录，不管 rp/state/）
adb('shell', 'run-as', 'com.dshtavern.app', 'cp', STATE_REL, `${STATE_REL}.emubak`)
const guard = makeSessionGuard({ adb: ADB, pkg: 'com.dshtavern.app', sid: RP_SID, yes: true })
guard.install()
if (!guard.backup()) { console.error('[守护][FATAL] 会话备份失败 ⇒ 拒绝执行'); process.exit(2) }
// qemu 崩溃会丢 guest 页缓存里未落盘的写入（本轮已实证：备份文件变空壳）——备份后立即 sync
try { adb('shell', 'sync') } catch { /* sync 失败不阻塞（崩溃风险不变，仅兜底概率下降） */ }

let markerPresetId = null
try {
  // ---- A. 更新 marker 预设（加 setvar/getvar 宏）----
  console.log('=== A. marker 预设加变量宏 ===')
  const st0 = await presetApi('GET')
  const rec = (st0?.presets ?? []).find(p => p?.name === 'EMU 验证预设')
  markerPresetId = rec?.id
  check('marker 预设存在', typeof markerPresetId === 'string', markerPresetId)
  const newPreset = {
    prompts: [
      { identifier: 'emuMarker', name: 'EMU 验证标记', role: 'system',
        content: `${MARKER} user={{user}}{{setvar::emuVar::hello}} var={{getvar::emuVar}}`, enabled: true },
      { identifier: 'chatHistory', enabled: true },
    ],
    prompt_order: [{ character_id: '100001', order: [
      { identifier: 'emuMarker', enabled: true },
      { identifier: 'chatHistory', enabled: true },
    ] }],
  }
  const saved = await presetApi('POST', '', { action: 'save', id: markerPresetId, name: 'EMU 验证预设', preset: newPreset, revision: st0.revision })
  check('预设更新成功（setvar/getvar 宏）', saved?.id === markerPresetId, JSON.stringify(saved).slice(0, 100))

  // ---- B. provider → 31102（DSML 回复 mock）----
  console.log('\n=== B. provider → dsml-mock(31102) ===')
  await api('credentials/set', { ref: 'EMU_MOCK_API_KEY', value: 'sk-emu-mock' })
  await api('settings/update', {
    ns: 'llm-pi-ai',
    patch: { providers: { 'emu-mock': {
      displayName: 'EMU Mock', apiKeyEnv: 'EMU_MOCK_API_KEY', api: 'openai-completions',
      baseURL: 'http://10.0.2.2:31102/v1',
      compat: { supportsDeveloperRole: false, maxTokensField: 'max_tokens' },
      models: [{ id: 'golden-mock', name: 'golden-mock' }] } } },
  })
  await api('settings/update', { ns: 'agent-default-model', patch: { provider: 'emu-mock', model: 'golden-mock' } })
  check('provider 指向 dsml-mock', true)

  // ---- C. bychv 绑定 RP 会话（不绑我方预设——隔离变量）----
  // EMU_NO_BIND=1：④b 对照组——不启用绑定（其余全同）。两轮结果一致（都不提取/
  // 都提取）即证明 MVU 提取行为与 bychv 无关；不一致才是 bychv 干扰。
  const noBind = process.env.EMU_NO_BIND === '1'
  console.log(`\n=== C. bychv ${noBind ? '绑定【关闭】（④b 对照组）' : '绑定 RP 会话'} ===`)
  const st1 = await presetApi('GET', `?sessionId=${encodeURIComponent(RP_SID)}`)
  const bound = await presetApi('POST', '', {
    action: 'bind', sessionId: RP_SID,
    binding: { enabled: !noBind, presetId: markerPresetId, characterId: null, values: { user: 'EMU验证用户' }, markers: {} },
    revision: st1.revision,
  })
  check(`bychv 绑定${noBind ? '保持关闭' : '已启用'}`, bound?.ok === true)

  // ---- D. 发消息 → 等生成 → 读双 store ----
  console.log('\n=== D. 发消息，等 MVU 捕获落盘 ===')
  const known = new Set(readdirSync(DUMP_DIR))
  const prompted = await api('session/prompt', {
    request: { requestId: crypto.randomUUID(), sessionId: RP_SID, mode: 'queue', content: [{ type: 'text', text: '（EMU 划界验证）打个招呼。' }] },
  })
  check('session/prompt 已受理', prompted?.result?.ok === true)

  // 等 mock 主请求落盘（请求方向判据）
  let dump = null
  for (let t = 0; t < 20 && !dump; t++) {
    await sleep(3000)
    const now = readdirSync(DUMP_DIR).filter(f => !known.has(f) && f.startsWith(DUMP_PREFIX) && f.endsWith('.json'))
    for (const f of now.sort()) {
      try {
        const p = JSON.parse(readFileSync(`${DUMP_DIR}/${f}`, 'utf8'))
        const text = JSON.stringify(p.messages ?? [])
        if (text.includes('EMU 划界验证') && !text.includes('concise title')) { dump = f; break }
      } catch { /* 半截文件下一轮 */ }
    }
  }
  check('mock 主请求落盘', !!dump, dump ?? '(60s 无)')
  if (dump) {
    const payload = JSON.parse(readFileSync(`${DUMP_DIR}/${dump}`, 'utf8'))
    const hits = (payload.messages ?? []).filter(m => JSON.stringify(m).includes(MARKER))
    const hitText = hits.map(m => String(m.content ?? '')).join(' ')
    if (noBind) {
      check('④a-对照 marker 0 次（绑定关闭则不注入）', hits.length === 0, `命中 ${hits.length} 条`)
    } else {
      check('④a bychv 注入且宏渲染（var=hello）', hits.length === 1 && hitText.includes('var=hello'), hitText.slice(0, 120))
    }
  }

  // MVU 提取在 **下一轮** pre-step（batch 只含生成前消息——本轮 assistant 回复
  // 要下一轮才被扫到，既有架构行为，与 bychv 无关）。故再发一条触发提取轮。
  console.log('\n=== D2. 再发一条（触发下一轮 pre-step 的 MVU 提取）===')
  await api('session/prompt', {
    request: { requestId: crypto.randomUUID(), sessionId: RP_SID, mode: 'queue', content: [{ type: 'text', text: '（EMU 划界验证·第二轮）继续。' }] },
  })
  // 等 MVU 捕获落盘（响应方向判据）：轮询 rp state 出现 emu_dsml_probe
  let rpState = null
  for (let t = 0; t < 30; t++) {
    await sleep(3000)
    try {
      rpState = readDeviceJson(STATE_REL)
      if (rpState?.state?.emu_dsml_probe === 'dsml-ok') break
    } catch { /* state 文件暂不可读 */ }
  }
  if (noBind) {
    // 对照组判据：与绑定组行为一致（不提取）= bychv 无干扰；对照组若提取成功，
    // 绑定组的不提取就成了 bychv 干扰实锤（FAIL 报警）。
    check('④b-对照 MVU 提取行为与绑定组一致（均不提取=既有行为，非 bychv 干扰）',
      rpState?.state?.emu_dsml_probe === undefined,
      `emu_dsml_probe=${JSON.stringify(rpState?.state?.emu_dsml_probe)}（若出现值 = bychv 干扰实锤，需回查绑定组）`)
  } else {
    check('④b MVU 捕获链工作（state.emu_dsml_probe=dsml-ok）', rpState?.state?.emu_dsml_probe === 'dsml-ok',
      `emu_dsml_probe=${JSON.stringify(rpState?.state?.emu_dsml_probe)}`)
  }

  // 划界判据（双 store 对账）
  const bychvState = readDeviceJson('files/.dsh/preset-enhance/state.json')
  const localVars = bychvState?.sessions?.[RP_SID]?.result?.local ?? {}
  if (noBind) {
    check('④a-对照 bychv store 无变量（绑定关闭则 setvar 不发生）', localVars.emuVar === undefined, JSON.stringify(localVars).slice(0, 100))
  } else {
    check('④a setvar 落 bychv store（local.emuVar=hello）', localVars.emuVar === 'hello', JSON.stringify(localVars).slice(0, 100))
  }
  const rpText = JSON.stringify(rpState ?? {})
  check('④a MVU store 无 bychv 变量（无 emuVar）', !rpText.includes('emuVar'), rpText.includes('emuVar') ? '污染！' : '干净')
} finally {
  // ---- E. 现场复原 ----
  console.log('\n=== E. 现场复原 ===')
  try {
    if (markerPresetId) {
      const st2 = await presetApi('GET', `?sessionId=${encodeURIComponent(RP_SID)}`)
      await presetApi('POST', '', {
        action: 'bind', sessionId: RP_SID,
        binding: { enabled: false, presetId: markerPresetId, characterId: null, values: {}, markers: {} },
        revision: st2.revision,
      })
    }
    await api('settings/update', { ns: 'agent-default-model', patch: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } })
  } catch (e) { console.error('复原警告：', e.message) }
  // 先 guard.restore（内部 force-stop 应用——停了 node 才不会再写 state），
  // 再还原 rp state 文件（emu_dsml_probe 等一切改动回滚）。
  const rr = guard.restore('normal')
  console.log(`[守护] 会话已还原：${rr.ok ? 'PASS' : 'FAIL'}`)
  if (!rr.ok) fail++
  try {
    adb('shell', 'run-as', 'com.dshtavern.app', 'cp', `${STATE_REL}.emubak`, STATE_REL)
    adb('shell', 'run-as', 'com.dshtavern.app', 'rm', `${STATE_REL}.emubak`)
    console.log('rp state 已还原')
  } catch (e) { console.error('state 还原失败（备份保留 .emubak）：', e.message); fail++ }
}

console.log(fail ? `\n[EMU 验证④] ${fail} 项未通过` : '\n[EMU 验证④] 全部通过')
process.exit(fail ? 1 : 0)
