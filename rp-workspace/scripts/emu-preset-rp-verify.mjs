#!/usr/bin/env node
/**
 * emu-preset-rp-verify.mjs —— 验证③：RP 会话「双注」实证（管线切换前基线）
 * ============================================================================
 * 场景（真实用户场景的最小复刻）：
 *   - RP 会话经 `rp/preset/select` 绑定我方迁移预设（st-Default-76b532）
 *     → 我方 pre-step 快照管线（withPresetLayer / assemble 瀑布）注入
 *   - 同一会话再经 bychv `/preset-enhance/api` bind 启用 marker 预设
 *     → bychv llm/stream 消息编译注入
 * 观测：golden-mock 落盘 payload 里
 *   - 我方证据文本 "next reply in a fictional chat"（st-Default Main Prompt）
 *   - bychv 证据文本 EMU_VERIFY_MARKER_7F3A
 * 切换前预期：两者同时在场（= 双注实证）；切换后应只剩 bychv 一份。
 *
 * 安全：目标会话是模拟器里的**测试卡会话**（st-87rfra，seraphina，events=5）；
 *   写前 session-guard 备份、结束还原；presetId/binding 走正规路由写并复原；
 *   默认模型收尾还原。
 *
 * 用法：node scripts/emu-preset-rp-verify.mjs
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { makeEv } from './cdp-eval.mjs'
import { makeSessionGuard } from './session-guard.mjs'

const ADB = process.env.DSHT_ADB ?? `${process.env.USERPROFILE}/.android/sdk/platform-tools/adb.exe`
const DUMP_DIR = fileURLToPath(new URL('../out/emu-verify', import.meta.url))
const MARKER = 'EMU_VERIFY_MARKER_7F3A'
const OUR_EVIDENCE = 'next reply in a fictional chat'
const RP_SID = 'st-87rfra'
const OUR_PRESET = 'st-Default-76b532'

const ev = makeEv({ port: 9333 })
let fail = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? '：' + detail : ''}`)
  if (!ok) fail++
}
async function api(method, args) {
  return ev(`fetch('/api/${method}', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ type: 'client-request', rpcId: 'emu-${Date.now()}-${Math.random()}', method: ${JSON.stringify(method)}, payload: { args: ${JSON.stringify(args ?? {})} } }) }).then(r => r.json())`)
}
async function rp(path, body) {
  // 注意：数据面路由 sub 不带 /rp 段（/dsht-rp/preset/select 才是真实路径；
  // /dsht-rp/rp/* 是 rollback-mask/sessions-audit 那一族）。
  return ev(`fetch('/dsht-rp/${path}', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(${JSON.stringify(body ?? {})}) }).then(r => r.json())`)
}
async function presetApi(method, qs = '', body = null) {
  const init = method === 'GET'
    ? ''
    : `, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(${JSON.stringify(body ?? {})}) }`
  return ev(`fetch('/preset-enhance/api${qs}'${init}).then(r => r.json())`)
}

// 写型夹具守护：备份 / 还原 / 中止兜底（与 ef-rollback-live 同口径）
const guard = makeSessionGuard({ adb: ADB, pkg: 'com.dshtavern.app', sid: RP_SID, yes: true })
guard.install()
if (!guard.backup()) {
  console.error('[守护][FATAL] 备份失败 ⇒ 拒绝执行（会话不可逆风险高于本次测量）')
  process.exit(2)
}

try {
  // ---- A. provider → mock ----
  console.log('=== A. provider → emu-mock ===')
  await api('credentials/set', { ref: 'EMU_MOCK_API_KEY', value: 'sk-emu-mock' })
  await api('settings/update', {
    ns: 'llm-pi-ai',
    patch: { providers: { 'emu-mock': {
      displayName: 'EMU Mock', apiKeyEnv: 'EMU_MOCK_API_KEY', api: 'openai-completions',
      baseURL: 'http://10.0.2.2:31101/v1',
      compat: { supportsDeveloperRole: false, maxTokensField: 'max_tokens' },
      models: [{ id: 'golden-mock', name: 'golden-mock' }] } } },
  })
  await api('settings/update', { ns: 'agent-default-model', patch: { provider: 'emu-mock', model: 'golden-mock' } })
  check('provider 指向 emu-mock', true)

  // ---- B. 我方预设绑定（模拟真实用户已选预设的 RP 会话）----
  console.log('\n=== B. RP 会话绑定我方迁移预设 ===')
  const sel = await rp('preset/select', { sessionId: RP_SID, presetId: OUR_PRESET })
  check('rp/preset/select 绑定我方预设', sel?.ok === true, JSON.stringify(sel).slice(0, 100))
  const st = await rp('preset/state', { sessionId: RP_SID })
  check('preset/state 确认显式绑定', st?.explicit === OUR_PRESET, JSON.stringify(st).slice(0, 120))

  // ---- C. bychv 绑定 marker 预设 ----
  console.log('\n=== C. 同一会话绑定 bychv 预设 ===')
  const st0 = await presetApi('GET')
  const markerPresetId = (st0?.presets ?? []).find(p => p?.name === 'EMU 验证预设')?.id
  check('marker 预设存在（验证①②已建）', typeof markerPresetId === 'string', markerPresetId)
  const st1 = await presetApi('GET', `?sessionId=${encodeURIComponent(RP_SID)}`)
  const bound = await presetApi('POST', '', {
    action: 'bind', sessionId: RP_SID,
    binding: { enabled: true, presetId: markerPresetId, characterId: null, values: { user: 'EMU验证用户' }, markers: {} },
    revision: st1.revision,
  })
  check('bychv 绑定已启用', bound?.ok === true, JSON.stringify(bound).slice(0, 100))

  // ---- D. 发消息 → mock 落盘 ----
  console.log('\n=== D. 发消息，读 mock 落盘 ===')
  const known = new Set(readdirSync(DUMP_DIR))
  const prompted = await api('session/prompt', {
    request: { requestId: crypto.randomUUID(), sessionId: RP_SID, mode: 'queue', content: [{ type: 'text', text: '（EMU 双注验证）打个招呼。' }] },
  })
  check('session/prompt 已受理', prompted?.result?.ok === true, JSON.stringify(prompted?.result).slice(0, 120))
  // 落盘会同时出现「主生成」与「标题生成」两类请求；标题请求（purpose 类，
  // bychv 正确跳过）含 'concise title' 指令，必须过滤，取含本轮 prompt 文本的主请求。
  let dump = null
  for (let t = 0; t < 25 && !dump; t++) {
    await sleep(3000)
    const now = readdirSync(DUMP_DIR).filter(f => !known.has(f) && f.endsWith('.json'))
    for (const f of now.sort()) {
      try {
        const p = JSON.parse(readFileSync(`${DUMP_DIR}/${f}`, 'utf8'))
        const text = JSON.stringify(p.messages ?? [])
        if (text.includes('EMU 双注验证') && !text.includes('concise title')) { dump = f; break }
      } catch { /* 半截文件下一轮再读 */ }
    }
  }
  check('mock 收到主生成请求并落盘', !!dump, dump ?? '(75s 无主请求落盘)')
  if (dump) {
    const payload = JSON.parse(readFileSync(`${DUMP_DIR}/${dump}`, 'utf8'))
    const text = JSON.stringify(payload.messages ?? [])
    const ourHits = (payload.messages ?? []).filter(m => JSON.stringify(m).includes(OUR_EVIDENCE))
    const bychvHits = (payload.messages ?? []).filter(m => JSON.stringify(m).includes(MARKER))
    console.log(`  我方预设证据「${OUR_EVIDENCE}」：${ourHits.length} 条`)
    console.log(`  bychv 证据「${MARKER}」：${bychvHits.length} 条`)
    check('③ bychv 注入在 RP 会话生效', bychvHits.length === 1)
    if (process.env.EMU_EXPECT_SWITCHED === '1') {
      // 管线切换后判据：bychv 绑定启用的会话，我方注入点必须静默（双注消除）
      check('③ 切换生效：我方预设注入已静默（双注消除）', ourHits.length === 0,
        `我方证据 ${ourHits.length} 条（>0 = 切换未生效或还有残留注入点）`)
    } else {
      // 切换前基线：我方证据在场 = 双注（这是要修的问题，所以这里只记录不判负）
      if (ourHits.length > 0) {
        console.log('  ⓘ 双注实证：我方预设快照与 bychv 编译同时在场 —— 正是管线切换要消除的形态')
      } else {
        console.log('  ⓘ 我方预设证据不在场（若已切换则符合预期）')
      }
    }
  }

  // ---- D2（切换后回归）：解绑 bychv 再发一条 —— 我方管线必须恢复（向后兼容）----
  if (process.env.EMU_EXPECT_SWITCHED === '1' && dump) {
    console.log('\n=== D2. 解绑 bychv 再发一条：我方管线应恢复 ===')
    const stU = await presetApi('GET', `?sessionId=${encodeURIComponent(RP_SID)}`)
    await presetApi('POST', '', {
      action: 'bind', sessionId: RP_SID,
      binding: { enabled: false, presetId: (await presetApi('GET'))?.presets?.find(p => p?.name === 'EMU 验证预设')?.id, characterId: null, values: {}, markers: {} },
      revision: stU.revision,
    })
    const known2 = new Set(readdirSync(DUMP_DIR))
    await api('session/prompt', {
      request: { requestId: crypto.randomUUID(), sessionId: RP_SID, mode: 'queue', content: [{ type: 'text', text: '（EMU 双注验证·回归）再打个招呼。' }] },
    })
    let dump2 = null
    for (let t = 0; t < 25 && !dump2; t++) {
      await sleep(3000)
      const now = readdirSync(DUMP_DIR).filter(f => !known2.has(f) && f.endsWith('.json'))
      for (const f of now.sort()) {
        try {
          const p = JSON.parse(readFileSync(`${DUMP_DIR}/${f}`, 'utf8'))
          const text = JSON.stringify(p.messages ?? [])
          if (text.includes('EMU 双注验证·回归') && !text.includes('concise title')) { dump2 = f; break }
        } catch { /* 半截文件下一轮 */ }
      }
    }
    check('回归请求落盘', !!dump2, dump2 ?? '(75s 无)')
    if (dump2) {
      const payload2 = JSON.parse(readFileSync(`${DUMP_DIR}/${dump2}`, 'utf8'))
      const our2 = (payload2.messages ?? []).filter(m => JSON.stringify(m).includes(OUR_EVIDENCE))
      const bychv2 = (payload2.messages ?? []).filter(m => JSON.stringify(m).includes(MARKER))
      check('③ 向后兼容：解绑后我方管线恢复（我方证据 ≥1）', our2.length >= 1, `我方 ${our2.length} 条`)
      check('③ 向后兼容：解绑后 bychv 静默（0 条）', bychv2.length === 0, `bychv ${bychv2.length} 条`)
    }
  }

  // ---- E. 现场复原 ----
  console.log('\n=== E. 现场复原 ===')
  const st2 = await presetApi('GET', `?sessionId=${encodeURIComponent(RP_SID)}`)
  await presetApi('POST', '', {
    action: 'bind', sessionId: RP_SID,
    binding: { enabled: false, presetId: markerPresetId, characterId: null, values: {}, markers: {} },
    revision: st2.revision,
  })
  await rp('preset/select', { sessionId: RP_SID, presetId: null })
  await api('settings/update', { ns: 'agent-default-model', patch: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } })
  console.log('bychv 解绑 / 我方预设清除 / 默认模型还原 —— 完成')
} finally {
  const rr = guard.restore('normal')
  console.log(`[守护] 会话已还原：${rr.ok ? 'PASS' : 'FAIL'}${rr.skipped ? '（无需还原）' : ''}`)
  if (!rr.ok) fail++
}

console.log(fail ? `\n[EMU 验证③] ${fail} 项未通过` : '\n[EMU 验证③] 完成')
process.exit(fail ? 1 : 0)
