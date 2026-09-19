#!/usr/bin/env node
/**
 * audit-official-contract.mjs —— 官方产物关键契约的**事前探针**（E3 / P-4）
 * ============================================================================
 * ## 为什么需要它（P-4：契约漂移应对必须事前，不许事后救火）
 * 本仓长期把「官方 beta 未定型 + 我方适配层叠在未定型之上」当作最大系统性风险。
 * 但截至 2026-09-14，全仓**没有任何**构建期/启动期校验官方关键契约的机制：
 *   · `build-dsht.ps1` 的 Step 0.5 七项门禁**全是我方源码的静态审计**（不碰官方包）；
 *   · `capture-contracts.mjs` 确实读官方契约面，但**明示「失败不阻塞」**、只存快照；
 *   · `diff-contracts.mjs` 是**手工 CLI**，全仓无自动触发点；
 *   · 于是历史代价都靠用户真机撞出来：
 *       - 官方 0.1.5 去掉 source 顶层扩展键 ⇒ 80 个真实会话中 **41 个迁移失败**；
 *       - `assistant/message` 新增 `stream` 必需字段 ⇒ 我方 6 处手写字面量全漏 ⇒
 *         **不报错、不打日志、HTTP 200**，直到下次冷启动整会话打不开（100%）；
 *       - `surfaceOp` 字段名换代 ⇒ 只能靠「写入被拒后 try/catch 退回」兜（首次必失败）。
 *
 * ## 本探针的定位（与既有机制的边界，避免造重复实现）
 *   · `capture-contracts.mjs` = **采集**（快照，供人 diff）—— 本探针**不重复采集**；
 *   · `diff-contracts.mjs`     = **事后比对**（升级后看差了什么）—— 本探针是**事前门禁**；
 *   · `session-contract-probe.mjs` = 用官方迁移器**回放我方产物**（证明写对了）——
 *     本探针反过来：**只看官方包自身形态**（证明我方读法仍然成立）。
 * 三者互补，不重叠。
 *
 * ## 判据分级（**不许一律 fail**——不同契约的破坏性不同，降级动作必须匹配）
 *   · `BLOCK`  —— 缺了就**必然**让核心路径失效（会话打不开 / 写不进去）⇒ 构建中止；
 *   · `WARN`   —— 缺了我方有**降级路径**能跑（如 surfaceOp 有 legacy 兜底）⇒ 出声；
 *   · `INFO`   —— 仅供记录（版本号等），不判失败。
 *
 * ## 出声要求（P-3 静默失败族）
 * 无论 BLOCK / WARN，**每一面都必须打印「探到了什么 / 期望什么 / 缺了什么 / 会怎么降级」**。
 * 探不到 ⇒ 打印 `UNKNOWN` 并计入统计，**绝不当成通过**（P-17：区分「事实是否定」与「我们测不出来」）。
 *
 * ## 正控 / 负控 / 零控（--selftest）
 *   正控：构造「官方包缺 stream 必需字段」的语料 → 必须判 BLOCK；
 *   正控：构造「surfaceOp 用旧字段名」的语料 → 必须判 WARN（有 legacy 兜底）；
 *   负控：构造完全合规的语料 → 必须 0 BLOCK / 0 WARN；
 *   零控：空语料 / 包目录不存在 → 必须 `UNKNOWN` 且**不得**判 PASS（防恒真）；
 *   锚点缺失（--root 给错）→ **fail-closed** 退出 1（不许静默放行）。
 *
 * ## 用法
 *   node scripts/audit-official-contract.mjs                 # 探当前 runtime（默认 dsh-runtime-android）
 *   node scripts/audit-official-contract.mjs --root <dir>    # 指定 @deepseek-ai 包目录
 *   node scripts/audit-official-contract.mjs -v              # 打印每一面的证据行
 *   node scripts/audit-official-contract.mjs --selftest      # 正控/负控/零控（退出码 3 = 失败）
 *
 * 退出码：0 = 无 BLOCK（WARN/UNKNOWN 出声但不阻塞）；1 = 锚点缺失（fail-closed）；
 *         2 = 有 BLOCK；3 = selftest 失败。
 * ============================================================================
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
// ★ W72：自证分数契约的**唯一产出点**（P-1；**不自己拼分数行**）
import { reportSelftest } from './selftest-summary.mjs'

const WS = resolve(import.meta.dirname, '..')

/**
 * 本仓文档记载的 `SESSION_FORMAT_VERSION` 口径（B12：历史会话格式不破坏）。
 * 【2026-09-14 实测修正】此前本仓多处文档写 **0**；真机 runtime 实测为 **3**
 * （`@deepseek-ai/dsh-session@0.1.5-rc.1`）。该常量就是官方迁移链的世代号，
 * 文档口径必须与之一致 —— 本探针把它做成**可对照的数字**，不一致就出声。
 */
const DOC_SESSION_FORMAT_VERSION = 3

/** 候选 runtime 根（@deepseek-ai 包所在目录）；与 capture-contracts.mjs 同序 */
function detectRoot() {
  const cands = [
    process.env.DSHT_RUNTIME_DIR,
    join(WS, 'dsh-runtime-android', 'node_modules', '@deepseek-ai'),
    join(WS, 'dsh-runtime', 'node_modules', '@deepseek-ai'),
    join(WS, 'dsh-runtime-x64', 'node_modules', '@deepseek-ai'),
  ].filter(Boolean)
  for (const c of cands) if (existsSync(join(c, 'dsh-session', 'package.json'))) return c
  return cands[1] ?? null
}

/** 安全读文本（读不到返回 null —— 由调用方判 UNKNOWN，不许当通过） */
function readText(p) {
  try { return readFileSync(p, 'utf8') } catch { return null }
}

/**
 * 契约面定义。
 *
 * 每个面：
 *   id      —— 稳定标识（--selftest 与报告用）
 *   level   —— BLOCK / WARN / INFO
 *   file    —— 相对 @deepseek-ai 的文件路径（可多个候选，取第一个存在的）
 *   probe(text) —— 返回 { ok, evidence }：ok=false 表示**该面被破坏**
 *   expect  —— 人话描述「期望什么」
 *   degrade —— 被破坏时我方**实际会怎么降级**（必须与代码现状一致，不许写理想）
 *
 * 口径说明：本探针读的是**官方包的源码文本**（lib/*.js 是未压缩的可读 JS）。
 * 若官方改为打包/压缩产物导致正则失配 ⇒ 判 UNKNOWN（显式报「测不出来」），
 * **不得**因为「没匹配到坏形态」就判 OK——那正是 P-17 警告的假结论。
 */
const CONTRACTS = [
  {
    id: 'assistant-stream-required',
    level: 'BLOCK',
    file: ['dsh-session/lib/index.js'],
    expect: '`assistant/message` 的 settlement 校验**要求** `data.stream` 存在（官方 0.1.5 起）',
    degrade: '**无降级**：缺 stream 时官方在写入前就抛 `invalid settlement fields`，' +
      '若我方手写字面量漏了它 ⇒ 会话 100% 打不开（历史事故：6 处漏写，冷启动整会话崩）。' +
      '我方对策 = `session-write.ts:assistantSettlement()` 单源产出（唯一入口）。',
    probe(text) {
      // 官方校验函数里出现 settlement 字段名清单，且清单含 stream
      const hasSettlementCheck = /invalid settlement fields/.test(text)
      if (!hasSettlementCheck) return { ok: null, evidence: '未找到 `invalid settlement fields` 文案（官方可能改了措辞或打包形态变了）' }
      // 官方检查 stream 的形态：`data.stream` 必须是数组
      const streamChecked = /stream/.test(text) && /Array\.isArray/.test(text)
      if (!streamChecked) return { ok: false, evidence: '找到 settlement 校验但**未见** Array.isArray(stream) 形态 ⇒ 官方可能改了字段名' }
      return { ok: true, evidence: 'settlement 校验存在且含 stream 数组检查' }
    },
  },
  {
    id: 'surfaceop-field-names',
    level: 'BLOCK',
    // 【2026-09-14 修正】原探测点错在**读错了文件**：
    //   · `dsh-session/lib/index.js:262` 的 `isReplaceOp()` 确实校验 `startSeq/endSeq`，
    //     但它是**运行时内联副本**，文本里字段名以 `op["startSeq"]` 形式出现（带方括号），
    //     我上一版的正则 `(\s|[{,("'])startSeq\s*:` 匹配不到 ⇒ 误报「仅见旧字段名」。
    //   · **权威校验点**是 `dsh-session-format-v2-to-v3/lib/index.js`：
    //     `requires exact replace fields op/startSeq/endSeq`（v3 硬性三键）。
    //   · 而 `op/start/end` 只在 v0→v1 读**存量旧代日志**时用（见
    //     `dsh-session-format-v0-to-v1/lib/index.js`），与 v3 写入无关。
    // ⇒ 上一版把「旧代读路径的字段名」当成「当前写入契约」，给出了**方向相反的结论**
    //   （误判「我方每次首写必失败」）。这正是 P-17 警告的形态：探测点选错 ⇒
    //   得到「看起来有依据」的错结论。修正后按**权威校验点**断言。
    file: ['dsh-session-format-v2-to-v3/lib/index.js', 'dsh-session/lib/index.js'],
    expect: 'v3 的 replace surfaceOp **必须**是 `op/startSeq/endSeq` 三键（`requires exact replace fields op/startSeq/endSeq`）',
    degrade: '有降级但**代价明确**：`session-write.ts:appendReplace()` 先试 `startSeq/endSeq`（v3 直接接受），' +
      '被拒（`invalid replace surfaceOp`）才退回 `start/end`（**在 v3 上会被拒**，仅对旧代运行时有效）。' +
      '若官方改成第三套字段名 ⇒ 两条路都失败 ⇒ 回退/编辑/重新生成**静默不生效**。',
    probe(text) {
      // 权威形态 1（v3 校验器）：精确断言三键
      if (/requires exact replace fields op\/startSeq\/endSeq/.test(text)) {
        return { ok: true, evidence: 'v3 校验器要求 `op/startSeq/endSeq` 三键（与我方首选字段名一致）' }
      }
      // 权威形态 2（运行时 isReplaceOp）：字段名可能以**三种写法**出现 ——
      //   `op["startSeq"]`（括号取键）/ `startSeq:`（对象字面量键）/ `hasOwn(op, "startSeq")`（成员检查）
      // 只看其中一种会导致「官方换写法 ⇒ 探针假 UNKNOWN」（我第一版就这么错过了真实代码）。
      const bracketKey = (n) => new RegExp(`\\[\\s*["']${n}["']\\s*\\]`).test(text)
      const objectKey = (n) => new RegExp(`(^|[\\s{,("'])${n}\\s*:`, 'm').test(text)
      const memberKey = (n) => new RegExp(`\\(\\s*[\\w.$]+\\s*,\\s*["']${n}["']\\s*\\)`).test(text)
      const hasKey = (n) => bracketKey(n) || objectKey(n) || memberKey(n)
      if (hasKey('startSeq') && hasKey('endSeq')) {
        return { ok: true, evidence: '运行时 replace 校验含 startSeq/endSeq（已覆盖括号键/对象键/成员检查三种写法）' }
      }
      if (/invalid replace surfaceOp/.test(text)) {
        return { ok: false, evidence: '找到 surfaceOp 校验文案，但**两处权威形态都未见** startSeq/endSeq ⇒ 官方可能换成第三套字段名（兜底也会失败）' }
      }
      return { ok: null, evidence: '未找到 surfaceOp 校验的任一权威形态（打包/重构）' }
    },
  },
  {
    id: 'source-whitelist-closed',
    level: 'BLOCK',
    // 【2026-09-14 修正】原探测点 `dsh-session-format-catalog/lib/index.js` **只含 62 行组装代码**
    // （`createSessionFormatCatalog({...})` + re-export），**没有任何校验逻辑** ⇒ 必然 UNKNOWN。
    // 真实校验点在迁移链：
    //   · `dsh-session-format-v0-to-v1/lib/index.js` 的 `assertReleasedV0Keys()`：
    //     抛 `${label} has unexpected member "xxx"`（注意：文案是**模板拼装**，
    //     `source` 只是 label 的一部分 ⇒ 按整串 `source has unexpected member` 搜必然搜不到）
    //   · 同文件 `messageSourceValue()` 的 `case "plugin": pluginSourceValue(...)`
    //     —— 这才是「plugin source 允许 form/sections/summary」的白名单定义点
    //   · v2→v3 迁移链会 import 它（`assertReleasedPayloadSemantics`），所以 v3 日志恢复时仍生效
    file: ['dsh-session-format-v0-to-v1/lib/index.js'],
    expect: '`source` 白名单校验存在（`has unexpected member` 模板 + plugin kind 的 form/sections 白名单）',
    degrade: '**无降级**：我方回退/编辑/重新生成的标记**必须**走 `form:"snapshot" + sections[{name:"dsht:surgical"}]`。' +
      '历史事故：0.1.5 收紧后 80 个真实会话 **41 个迁移失败**。若该校验消失/放宽，我方 sections 形态仍应可用（前向兼容），' +
      '但必须人工确认 —— 因为**去掉校验**也可能伴随**换白名单成员**。',
    probe(text) {
      const hasTemplate = /has unexpected member/.test(text)
      const hasPluginWhitelist = /pluginSourceValue/.test(text) && /sections/.test(text)
      if (hasTemplate && hasPluginWhitelist) {
        return { ok: true, evidence: 'source 白名单校验 + plugin 的 sections 白名单均存在 ⇒ 我方 sections 形态成立' }
      }
      if (hasTemplate && !hasPluginWhitelist) {
        return { ok: false, evidence: '有 `has unexpected member` 模板但**未见** plugin 的 sections 白名单 ⇒ 官方可能改了 plugin source 的允许成员（我方标记会被拒）' }
      }
      return { ok: null, evidence: '未见 `has unexpected member` 模板 ⇒ 校验机制已重构/改名，需人工确认我方 sections 形态是否仍被接受' }
    },
  },
  {
    id: 'format-version',
    level: 'INFO',
    file: ['dsh-session/lib/types/types.js', 'dsh-session/lib/index.js'],
    expect: '`SESSION_FORMAT_VERSION` 数值（我方历史会话格式兼容的基准；**B12：迁移只允许向前兼容**）',
    degrade: '仅记录：数值上调 ⇒ 存量会话需迁移（我方 `session-repair.ts` 已有迁移器，但需复核覆盖面）。',
    probe(text) {
      const m = /SESSION_FORMAT_VERSION\s*=\s*(\d+)/.exec(text)
      if (!m) return { ok: null, evidence: '未找到 SESSION_FORMAT_VERSION 常量（打包形态可能已变）' }
      // 【2026-09-14 实测】真机 runtime 为 3，而本仓多处文档仍写 0 —— 该不一致本身要被看见。
      const v = Number(m[1])
      const note = v === DOC_SESSION_FORMAT_VERSION
        ? `（与本仓文档记载一致，文档口径 = ${DOC_SESSION_FORMAT_VERSION}）`
        : `（⚠️ 与文档记载不一致：本仓文档口径 = ${DOC_SESSION_FORMAT_VERSION}，实测 = ${v} ⇒ **需同步文档**）`
      return { ok: true, evidence: `SESSION_FORMAT_VERSION = ${v} ${note}` }
    },
  },
  {
    id: 'claims-endpoint',
    level: 'BLOCK',
    // 【2026-09-14 修正】原探测点 `dsh-session/lib/index.js` **不含**端点声明机制
    // （该机制在网关包，不在 session 包）⇒ 必然 UNKNOWN。
    // 真实位置：`dsh-api-gateway/lib/index.js` 的 `claimsEndpoint(endpoint)`。
    // 其判据是 `segments.length !== 2 ⇒ return false`（**不抛错，静默不 claim**），
    // 这正是我方 rpc.ts 注释所称「点式 method 被拒绝」的真实形态 ——
    // 它不是「拒绝」，而是「网关不接管该 endpoint」，上层表现为 404。
    file: ['dsh-api-gateway/lib/index.js', 'dsh-api-gateway/lib/types/index.js'],
    expect: 'RPC 网关的 `claimsEndpoint` 仍按**斜杠式两段**判定（`namespace/method`）',
    degrade: '**无降级**：我方 `rpc.ts:dshRpc()` 已按斜杠式构造（`.replace(/\\./g, "/")`）。' +
      '若改成三段/点式/其它形态 ⇒ 所有 `/api/*` RPC 静默不 claim ⇒ 表现为「什么都点不动」（且无报错）。',
    probe(text) {
      if (!/claimsEndpoint/.test(text)) return { ok: null, evidence: '未找到 claimsEndpoint（网关包重构/改名）' }
      const twoSegments = /segments\.length\s*!==\s*2|segments\.length\s*===\s*2/.test(text)
      if (twoSegments) return { ok: true, evidence: 'claimsEndpoint 存在且按两段（namespace/method）判定 ⇒ 我方斜杠式 method 成立' }
      return { ok: false, evidence: '找到 claimsEndpoint 但**未见两段判定** ⇒ 端点形态可能已变（我方斜杠式 method 可能不再被 claim）' }
    },
  },
  {
    id: 'expand-assistant-stream',
    level: 'BLOCK',
    // 【2026-09-14 修正】原候选 `dsh-client-ui-chat/lib/client.js` **不含**该函数
    // （那里只有精简版 `lastAssistantStreamChunk`）⇒ 必然 UNKNOWN。
    // 权威实现（且是**公开 subpath 导出**）在 `dsh-llm`：
    //   `dsh-llm/lib/types/assistant-stream.js` 的 `expandAssistantStream(stream)`，
    //   实现是朴素 `for (const candidate of stream)` ⇒ **空数组是合法值**（我方写 `stream: []` 的依据）。
    //   `dsh-llm/package.json` 的 exports 里有 `"./assistant-stream"` 子路径。
    file: ['dsh-llm/lib/types/assistant-stream.js', 'dsh-llm/lib/index.js'],
    expect: '消费侧 `expandAssistantStream(stream)` 按 `for...of` 迭代（⇒ **空数组合法**）',
    degrade: '**无降级**：我方一律写 `stream: []`（官方自身也写空数组）。' +
      '若消费侧改成要求非空 / 改字段名 ⇒ 消息渲染异常（历史事故：缺 `stream` 时**整会话打不开**）。',
    probe(text) {
      if (!/expandAssistantStream/.test(text)) return { ok: null, evidence: '未找到 expandAssistantStream（可能已改名/搬包）' }
      const forOf = /for\s*\(\s*const\s+\w+\s+of\s+stream\s*\)/.test(text)
      if (forOf) return { ok: true, evidence: 'expandAssistantStream 按 for...of 迭代 ⇒ 空数组合法（我方 stream: [] 成立）' }
      return { ok: false, evidence: '找到 expandAssistantStream 但**未见 for...of 迭代** ⇒ 可能新增了「非空」约束（我方空数组会被拒）' }
    },
  },
]

// ---------------------------------------------------------------- 审计核心

/**
 * 对一个「runtime 根」跑全部契约面。
 *
 * @param root  @deepseek-ai 包目录（可为 null ⇒ 全部面判 UNKNOWN）
 * @param readFn  读文件函数（selftest 注入用）——默认按 root 拼路径读盘
 * @returns { face:[{id,level,status,evidence,expect,degrade}], block:[], warn:[], unknown:[] }
 */
function audit(root, readFn = null) {
  const read = readFn ?? ((rel) => readText(join(root, rel)))
  const rows = []
  for (const c of CONTRACTS) {
    let text = null
    let usedFile = null
    for (const f of c.file) {
      text = read(f)
      if (text !== null) { usedFile = f; break }
    }
    if (text === null) {
      rows.push({ id: c.id, level: c.level, status: 'UNKNOWN', evidence: `候选文件都读不到：${c.file.join(' / ')}`, expect: c.expect, degrade: c.degrade })
      continue
    }
    let r
    try { r = c.probe(text) } catch (e) { r = { ok: null, evidence: `探测抛异常：${String(e?.message ?? e).slice(0, 120)}` } }
    // ok === null ⇒ 我们**测不出来**（P-17：绝不当成通过）
    const status = r.ok === true ? 'OK' : (r.ok === false ? 'BROKEN' : 'UNKNOWN')
    rows.push({ id: c.id, level: c.level, status, evidence: `[${usedFile}] ${r.evidence}`, expect: c.expect, degrade: c.degrade })
  }
  const block = rows.filter(r => r.status === 'BROKEN' && r.level === 'BLOCK')
  const warn = rows.filter(r => r.status === 'BROKEN' && r.level === 'WARN')
  const unknown = rows.filter(r => r.status === 'UNKNOWN')
  return { rows, block, warn, unknown }
}

// ---------------------------------------------------------------- selftest

function selftest() {
  // 正控 1：官方**要求** settlement 但语料里没有 Array.isArray(stream) 形态 ⇒ BLOCK
  const badStream = () => ({
    'dsh-session/lib/index.js':
      'function validate(x){ if(!Number.isInteger(x.turn)) throw new Error("seed assistant/message at index 0 has invalid settlement fields"); }',
  })
  const r1 = audit('/fake', (rel) => badStream()[rel] ?? null)
  const ok1 = r1.block.some(b => b.id === 'assistant-stream-required')
  console.log(`${ok1 ? '[ok]' : '[FAIL]'} 正控1：settlement 校验存在但无 stream 数组检查 → BLOCK（block=${r1.block.length}）`)

  // 正控 2：surfaceOp 权威校验点命中 **v3 精确三键文案** ⇒ 判 OK（我方首选字段名成立）
  const newSurfaceOp = () => ({
    'dsh-session-format-v2-to-v3/lib/index.js':
      'throw new SessionFormatError(`${subject} requires exact replace fields op/startSeq/endSeq`);',
  })
  const r2 = audit('/fake', (rel) => newSurfaceOp()[rel] ?? null)
  const s2 = r2.rows.find(r => r.id === 'surfaceop-field-names')
  const ok2 = r2.warn.length === 0 && r2.block.length === 0 && s2.status === 'OK'
  console.log(`${ok2 ? '[ok]' : '[FAIL]'} 正控2：v3 精确三键文案命中 → OK（status=${s2.status}）`)

  // 正控 3：surfaceOp 字段名换代成第三套 ⇒ BROKEN 且 BLOCK 级（**无降级**）
  // 注意：语料里**不能**出现 start/end/startSeq/endSeq（否则会命中权威形态而判 OK）
  const thirdNaming = () => ({
    'dsh-session-format-v2-to-v3/lib/index.js':
      'throw new Error("invalid replace surfaceOp"); // 只接受 fromSeq/toSeq（第三套命名）',
  })
  const r3 = audit('/fake', (rel) => thirdNaming()[rel] ?? null)
  const s3 = r3.rows.find(r => r.id === 'surfaceop-field-names')
  const ok3 = s3.status === 'BROKEN' && r3.block.some(b => b.id === 'surfaceop-field-names')
  console.log(`${ok3 ? '[ok]' : '[FAIL]'} 正控3：第三套字段名 → BROKEN 且 BLOCK（无降级）（status=${s3.status}/${s3.level}）`)

  // 正控 4：运行时括号取键写法 `op["startSeq"]` 也必须被认出（防「只认一种写法」）
  const bracketForm = () => ({
    'dsh-session/lib/index.js':
      'function isReplaceOp(op){ return Object.hasOwn(op, "op") && Object.hasOwn(op, "startSeq") && Object.hasOwn(op, "endSeq"); }',
  })
  const r4 = audit('/fake', (rel) => bracketForm()[rel] ?? null)
  const s4 = r4.rows.find(r => r.id === 'surfaceop-field-names')
  const ok4 = s4.status === 'OK'
  console.log(`${ok4 ? '[ok]' : '[FAIL]'} 正控4：运行时 isReplaceOp 写法（无精确三键文案）也被认出（status=${s4.status}）`)

  // 正控 5：source 白名单两面（模板 + plugin sections 白名单）都命中 ⇒ OK
  const srcOk = { 'dsh-session-format-v0-to-v1/lib/index.js': 'throw new SessionFormatError(`${label} has unexpected member ${JSON.stringify(unexpected)}`);\nfunction pluginSourceValue(source, label) { /* sections */ }' }
  const r5 = audit('/fake', (rel) => srcOk[rel] ?? null)
  const s5 = r5.rows.find(r => r.id === 'source-whitelist-closed')
  const ok5 = s5.status === 'OK'
  console.log(`${ok5 ? '[ok]' : '[FAIL]'} 正控5：source 白名单（模板 + plugin sections）→ OK（status=${s5.status}）`)

  // 正控 6：有 `has unexpected member` 模板但**缺** plugin sections 白名单 ⇒ BROKEN(BLOCK)
  const srcHalf = { 'dsh-session-format-v0-to-v1/lib/index.js': 'throw new Error(`${label} has unexpected member "x"`)' }
  const r6 = audit('/fake', (rel) => srcHalf[rel] ?? null)
  const s6 = r6.rows.find(r => r.id === 'source-whitelist-closed')
  const ok6 = s6.status === 'BROKEN' && r6.block.some(b => b.id === 'source-whitelist-closed')
  console.log(`${ok6 ? '[ok]' : '[FAIL]'} 正控6：白名单模板在但 plugin sections 白名单缺失 → BROKEN（status=${s6.status}）`)

  // 负控 1：完全合规语料 → 0 BLOCK / 0 WARN
  const good = () => ({
    'dsh-session-format-v2-to-v3/lib/index.js': 'throw new SessionFormatError(`${subject} requires exact replace fields op/startSeq/endSeq`);',
    'dsh-session-format-v0-to-v1/lib/index.js': 'throw new SessionFormatError(`${label} has unexpected member ${JSON.stringify(u)}`);\nfunction pluginSourceValue(s, l) { /* form/sections/summary */ }',
    'dsh-llm/lib/types/assistant-stream.js': 'export function expandAssistantStream(stream) {\n  const chunks = [];\n  for (const candidate of stream) {\n    chunks.push(candidate);\n  }\n}',
    'dsh-api-gateway/lib/index.js': 'claimsEndpoint(endpoint) {\n  const segments = endpoint.split("/");\n  if (segments.length !== 2) return false;\n  return true;\n}',
    'dsh-session/lib/index.js': 'const SESSION_FORMAT_VERSION = 3;\nfunction v(x){ if(!Array.isArray(x.stream)) throw new Error("invalid settlement fields"); }',
  })
  const r7 = audit('/fake', (rel) => good()[rel] ?? null)
  const ok7 = r7.block.length === 0 && r7.warn.length === 0 && r7.unknown.length === 0
  console.log(`${ok7 ? '[ok]' : '[FAIL]'} 负控1：全合规语料 0 BLOCK / 0 WARN / 0 UNKNOWN（block=${r7.block.length}, warn=${r7.warn.length}, unknown=${r7.unknown.length}）`)
  if (!ok7) for (const r of r7.rows) if (r.status !== 'OK') console.log(`        ↳ ${r.status}/${r.level} ${r.id}：${r.evidence}`)

  // 零控：全部读不到 ⇒ 全 UNKNOWN 且**不得**判 OK（防恒真）
  const r8 = audit('/nonexistent-root', () => null)
  const ok8 = r8.block.length === 0 && r8.warn.length === 0
    && r8.unknown.length === r8.rows.length
    && r8.rows.every(r => r.status === 'UNKNOWN')
  console.log(`${ok8 ? '[ok]' : '[FAIL]'} 零控：读不到 ⇒ 全 UNKNOWN（unknown=${r8.unknown.length}/${r8.rows.length}）且不判 OK`)

  return ok1 && ok2 && ok3 && ok4 && ok5 && ok6 && ok7 && ok8
}
// ---------------------------------------------------------------- main

const argv = process.argv.slice(2)
const flagIdx = argv.indexOf('--root')
const rootArg = flagIdx >= 0 ? argv[flagIdx + 1] : null

if (argv.includes('--selftest')) {
  const ok = selftest()
  // ★★ **W72：接入单源自证分数契约**（**P-50**）——
  //   此前收尾是自造形态 `[official-contract selftest] 8/8 PASS` ⇒
  //   **机器读不出分数**（`audit-selftest-claims.mjs` 判它「未接入契约」）⇒
  //   文档里「selftest 8/8」这句声明**无法被证伪**（**P-11 元级**）。
  //   ⇒ 按 **P-1** 复用唯一产出点 `reportSelftest`（分数行格式**只许一处实现**）。
  reportSelftest('official-contract', ok ? 8 : 0, 8)
  process.exit(ok ? 0 : 3)
}

const root = rootArg ?? detectRoot()
if (root === null || !existsSync(root)) {
  console.error(`[official-contract] 找不到官方包根目录：${root}`)
  console.error('    ⇒ fail-closed：锚点缺失时报错退出，不许静默放行（否则本闸门会长期空转）')
  process.exit(1)
}

const { rows, block, warn, unknown } = audit(root)
const verbose = argv.includes('-v')

console.log(`[official-contract] 官方契约事前探针 · root=${root}`)
console.log(`[official-contract] ${CONTRACTS.length} 个契约面：` +
  `BLOCK 破坏 ${block.length} · WARN 破坏 ${warn.length} · 测不出 ${unknown.length}`)

for (const r of rows) {
  const mark = r.status === 'OK' ? '✓' : (r.status === 'BROKEN' ? '✗' : '?')
  const lvl = r.level === 'BLOCK' ? '⛔' : (r.level === 'WARN' ? '⚠️' : 'ℹ️')
  console.log(`  ${mark} ${lvl} ${r.id} —— ${r.status}`)
  if (verbose || r.status !== 'OK') {
    console.log(`        期望：${r.expect}`)
    console.log(`        实测：${r.evidence}`)
    if (r.status !== 'OK') console.log(`        降级：${r.degrade}`)
  }
}

if (unknown.length > 0) {
  console.log(`\n[official-contract] ⚠️ ${unknown.length} 面**测不出**（官方包形态变化/打包差异）——`)
  console.log('    这些面**不算通过**（P-17：区分「事实是否定」与「我们测不出来」），请人工确认后更新本探针的探测方式。')
}
if (warn.length > 0) {
  console.log(`\n[official-contract] ⚠️ ${warn.length} 面被破坏但**我方有降级路径**（出声，不阻塞构建）：`)
  for (const w of warn) console.log(`    · ${w.id}`)
}
if (block.length > 0) {
  console.log(`\n[official-contract] ⛔ ${block.length} 面被破坏且**无降级**（必须中止构建）：`)
  for (const b of block) console.log(`    · ${b.id} —— ${b.evidence}`)
  process.exit(2)
}

console.log('\n[official-contract] 无 BLOCK 级破坏（WARN/UNKNOWN 已如上出声）')
process.exit(0)
