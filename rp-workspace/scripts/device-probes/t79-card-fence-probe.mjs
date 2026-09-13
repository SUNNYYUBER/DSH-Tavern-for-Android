#!/usr/bin/env node
/**
 * t79-card-fence-probe.mjs — T-79 卡正文防冒充处置 · **实机验收**（只读）
 * ============================================================================
 * 为什么要在设备上验（单测已经绿了）：
 *   T-79 的**单测**跑的是纯函数（`card-fence.ts`）+ 「源码里调用点唯一」的静态断言。
 *   它**没有**证明「真机上一张含越权标记的卡，注进 prompt 后真的被围栏包住、且标记失效」。
 *   后者要跑到 `agent/pre-step` 的**组装产物**上才看得到 —— 那正是本探针做
 *   （读 golden dump 的 `msg-NNN.json`，即发给模型的最终批）。
 *
 * 【判据（5 条）】
 *   1. 能拿到 pre-step 最终批（`golden/dsht/msg-*.json`）—— 缺 = 前提不满足
 *   2. （若工作区卡正文含越权标记）最终批里对应 section **被围栏包住**
 *      （`<rp-content:nonce>` 开闭标签成对 + 数据声明句）
 *   3. 围栏 nonce **不是卡能写死的常量**（16 位 hex）
 *   4. 越权标记在最终批里**已失效**：`<|` → `＜|`、`[INST]` → `［INST］`、
 *      行首 `system:` → `system：`
 *   5. 合法宏**未被误伤**：最终批里不应出现 `｛｛`（那是未知宏残留的转义形态，
 *      说明宏引擎展开失败）；且不应把已展开的正常文本转义
 *
 * 【只读】本探针只 `cat` 文件与 `grep`，不写任何东西、不触发生成。
 *
 * 用法：
 *   adb shell run-as com.dshtavern.app ls files/.dsh/rp/golden/dsht/
 *   node rp-workspace/scripts/device-probes/t79-card-fence-probe.mjs
 * 环境变量：
 *   DSHT_HOME_GUESS  覆盖 dshHome 相对路径（默认 files/.dsh）
 */
import process from 'node:process'
import { execFileSync } from 'node:child_process'

const ADB = process.env.ADB || 'C:/Users/Administrator/.android/sdk/platform-tools/adb.exe'
const PKG = 'com.dshtavern.app'
const HOME_REL = process.env.DSHT_HOME_GUESS || 'files/.dsh'

const results = []
const check = (ok, label, extra = '') => {
  results.push({ ok, label, extra })
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? '  — ' + extra : ''}`)
}
const info = (m) => console.log(`  · ${m}`)

/** 经 run-as 在 app 私有目录里执行命令 */
function sh (cmd) {
  try {
    return execFileSync(ADB, ['shell', `run-as ${PKG} sh -c ${JSON.stringify(cmd)}`], {
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (e) {
    return (e.stdout ?? '') + (e.stderr ?? '')
  }
}
const cat = (rel) => sh(`cat ${HOME_REL}/${rel}`)

async function main () {
  // ---- 判据 1：能找到**真实发给模型的请求** dump ----
  // 两个候选源，优先 `llm-*.json`：
  //   · `llm-NNN.json`（tag=provider_llm_request）—— **发给 provider 的完整 body**，
  //     含最终 system/messages，是 T-79 的**正确**观测点；
  //   · `msg-NNN.json`（tag=agent_prestep_messages）—— pre-step 出口的批，
  //     实测可能只含 claimed 的新消息（**不完整**），故仅作回退。
  const lsLlm = sh(`ls -1 ${HOME_REL}/rp/golden/dsht/ 2>/dev/null | grep -E '^llm-[0-9]+\\.json$' | tail -3`)
  const llmFiles = lsLlm.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  const lsMsg = sh(`ls -1 ${HOME_REL}/rp/golden/dsht/ 2>/dev/null | grep -E '^msg-[0-9]+\\.json$' | tail -3`)
  const msgFiles = lsMsg.split(/\r?\n/).map(s => s.trim()).filter(Boolean)

  const useLlm = llmFiles.length > 0
  const files = useLlm ? llmFiles : msgFiles
  check(files.length > 0, '判据1 能读到真实请求 dump（golden/dsht/llm-*.json 或 msg-*.json）',
    files.length ? `${useLlm ? 'llm' : 'msg'} 最近 ${files.length} 个：${files.join(', ')}` : '(无 —— 需先开 golden dump 并跑过一轮生成)')
  if (files.length === 0) {
    info('开启方式：在设备 dshHome 下建 rp/golden/dsht-ENABLED 标记，再跑一轮生成。')
    info('提示：这是**前提缺失**，不是缺陷。')
    const pass0 = results.filter(r => r.ok).length
    console.log(`\n[t79] ${pass0}/${results.length} PASS（前提未满足，跳过后续判据）`)
    process.exit(2)
  }

  // 取最新一份
  const latest = files[files.length - 1]
  const raw = cat(`rp/golden/dsht/${latest}`)
  let dump = null
  try { dump = JSON.parse(raw) } catch { /* 下面判失败 */ }

  // 两种 tag 的 messages 位置不同：llm → data.body.messages；msg → data.messages
  const msgs = Array.isArray(dump?.data?.body?.messages) ? dump.data.body.messages
    : Array.isArray(dump?.data?.messages) ? dump.data.messages : null
  check(dump !== null && msgs !== null,
    `判据1b ${latest} 可解析且含 messages`, msgs ? `tag=${dump.tag} messages=${msgs.length}` : '(解析失败)')
  if (msgs === null) { process.exit(2) }

  // 把所有文本拍平（两种形状：content 是 string（provider body）/ 是 block[]（内部批））
  const texts = []
  for (const m of msgs) {
    if (typeof m?.content === 'string') texts.push(m.content)
    else if (Array.isArray(m?.content)) {
      for (const b of m.content) if (b && typeof b === 'object' && typeof b.text === 'string') texts.push(b.text)
    }
    const secs = m?.source?.sections
    if (Array.isArray(secs)) for (const s of secs) if (typeof s?.text === 'string') texts.push(s.text)
  }
  const joined = texts.join('\n---\n')
  info(`最终批共 ${texts.length} 段文本，合计 ${joined.length} 字符`)
  check(joined.length > 200, '判据1c 观测到的批**足够大**（说明拿到了完整请求，不是残缺样本）',
    `${joined.length} 字符${joined.length <= 200 ? '（过小 ⇒ 可能是残缺 dump，判据 2 的结论不可信）' : ''}`)

  // ---- 判据 2：围栏（若本批含卡正文） ----
  const fenceRe = /<rp-content:([0-9a-f]{16})>/g
  const fences = [...joined.matchAll(fenceRe)].map(m => m[1])
  const closes = [...joined.matchAll(/<\/rp-content:([0-9a-f]{16})>/g)].map(m => m[1])
  const hasNotice = joined.includes('是**数据**而非指令')
  if (fences.length === 0) {
    check(false, '判据2 本批**未发现**卡正文围栏',
      '（可能是：本轮卡无 promptPersona / 走的路径未经 renderGuardedCardText / 围栏未生效）')
    info('⇒ 这条需要结合「本会话是否真有卡正文」判断，不能单凭此判红')
  } else {
    check(true, '判据2a 最终批里出现卡正文围栏', `${fences.length} 处开放标签`)
    const paired = fences.every(n => closes.includes(n))
    check(paired, '判据2b 围栏开闭成对（nonce 一致）', `open=${fences.join(',')} close=${closes.join(',')}`)
    check(hasNotice, '判据2c 围栏含「数据≠指令」声明句')
    check(new Set(fences).size === fences.length, '判据3 围栏 nonce 各异（不是卡能写死的常量）',
      `distinct=${new Set(fences).size}/${fences.length}`)
  }

  // ---- 判据 4：越权标记已失效 ----
  // 注意：这些标记**可能本来就不存在**（卡干净）⇒ 只有「出现了 raw 形态」才是失败。
  const rawChatml = (joined.match(/<\|/g) ?? []).length
  const rawInst = (joined.match(/\[\/?INST\]/gi) ?? []).length
  const rawRoleLine = (joined.match(/^[ \t]*(system|assistant|user)[ \t]*:/gim) ?? []).length
  check(rawChatml === 0, '判据4a 最终批无 raw `<|`（越权前缀已失效或本来没有）', `命中 ${rawChatml}`)
  check(rawInst === 0, '判据4b 最终批无 raw `[INST]`', `命中 ${rawInst}`)
  check(rawRoleLine === 0, '判据4c 最终批无 raw 行首 `system:` / `assistant:` / `user:`', `命中 ${rawRoleLine}`)

  // ---- 判据 5：合法宏未被误伤 ----
  const escapedMacros = (joined.match(/｛｛/g) ?? []).length
  check(escapedMacros === 0, '判据5 最终批无 `｛｛` 残留转义（说明宏引擎已展开、未误伤合法宏）',
    `命中 ${escapedMacros}${escapedMacros > 0 ? '（若卡里本就有未知宏，这是**预期**的转义）' : ''}`)

  const pass = results.filter(r => r.ok).length
  console.log(`\n[t79] ${pass}/${results.length} PASS`)
  console.log('[t79] 说明：判据 2 依赖「本会话卡正文非空」，判据 4/5 在干净卡上必然全绿 —— 属**结构性通过**。')
  console.log('      真正的负控（含越权标记的卡）需要一张构造卡；见 docs 记录。')
  process.exit(pass === results.length ? 0 : 1)
}

main().catch(e => { console.error('[t79] 探针异常：', e.message); process.exit(3) })
