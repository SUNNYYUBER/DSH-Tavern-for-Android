/**
 * DSHTavern RP 插件（Cordis 插件，挂 DSH web profile 全局层）
 *
 * 职责（M2 最小闭环，计划文档 §4.2 被动检索 + §4.14 工作区模型）：
 * - 识别 RP 会话：session cwd 位于 $DSH_HOME/rp/<slug> 且该目录有 rp.json
 * - 每轮 pre-step：从 surface 重建最近历史 → 加载工作区关联世界书 →
 *   M1 触发引擎扫描（constant/关键词/递归/预算）→ 激活条目以 runtime-context
 *   快照消息注入请求批次（官方 RuntimeContextProjection 同款模式：
 *   durable user 消息 + form:'snapshot' + 内容不变不重复注入）
 * - HTTP 数据面（T2.5f 下发链）：ctx.webServer 前缀路由 /dsht-rp/*——
 *   同源、零端口冲突（旧 3081 独立端口方案在端口被占时会以未处理 error
 *   击穿整个 DSH 进程，已废弃）
 *
 * 零 DSH 源码改动：仅消费 agent/pre-step waterfall 事件与 rp.json 数据约定。
 * 打包：esbuild bundle（trigger.ts 内联，@deepseek-ai/* 仅类型导入被擦除）。
 */

import { spawn } from 'node:child_process'
import { access, mkdir, open, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { atomicWriteText } from '../dsht-plugin-shared/atomic-fs.ts'
// 【W8 单源收口】`sendJson` 是「JSON 响应」的**唯一实现**
//（本文件原有一份逐字相同的就地闭包，已改为委托）
import { sendJson } from '../dsht-plugin-shared/http.ts'
// 【F5 2026-09-14】路径工具单源：cwd↔rp 工作区 slug 判定（曾有两份复制，见 rp-workspace.ts 头注）
import { normalizeAndroidPath, rpSlugFromCwd } from '../dsht-plugin-shared/rp-workspace.ts'
// 【F5 2026-09-14】稳定短哈希单源（曾散落四处实现，含改名复制；见 hash.ts 头注）
import { hash36 } from '../dsht-plugin-shared/hash.ts'
// 【管线切换 2026-09-20】bychv 绑定启用集合解析（纯函数单源；消费点见 bychvPresetOwned）
import { enabledPresetBindings } from '../dsht-plugin-shared/preset-ownership.ts'
// 【W4 2026-09-14】官方投影读取单源（cwd / sessionId / header.agentPreset / surface.nodes
// —— 此前本文件 12 处裸读，都在 agent/pre-step 的 try 内 ⇒ 官方改形状即整轮 RP 注入静默失效）
import {
  readHeaderAgentPreset, readHostSessionId, readSessionCwd,
  readSurfaceNodes, readSurfaceNodesOrNull,
} from '../dsht-plugin-shared/host-projection.ts'
import z from '@deepseek-ai/schemastery'
import JSZip from 'jszip'
import { triggerWorldInfo, visibleMessageCursor } from '../lore/trigger.ts'
import type { TimedEffect } from '../lore/trigger.ts'
import type { LoreEntry } from '../lore/entry.ts'
import { importCharacterJson } from '../import/character-card.ts'
import { convertChatFile, exportSingleCardFiles, projectKey, chatSessionId, encodeSegment } from '../import/dsh-export.ts'
import { writeCardTextChunks, bytesToBase64, makePlaceholderPng } from '../import/card-export.ts'
import { runRegexScripts, PLACEMENT, sanitizeRegexMacro, type RegexScript, type RegexContext } from '../regex/engine.ts'
import { MacroEngine, type MacroContext } from '../macros/engine.ts'
import { compileSlots, type CompiledSlot, type RPPreset } from '../preset/schema.ts'
import { AGENT_COMPACT_PERSONA_MARKER, compilePreset, isDshtRpAgentComposition } from '../preset/compiler.ts'
import { demoDirectPreset, demoLightAgentPreset } from '../preset/demo.ts'
import { importStPreset, pendingSkillDir, renderPendingSkillMd, renderPresetSkillMd } from '../preset/st-import.ts'
import { installManagedPreset, markPresetUserOwned, type PresetContentFile } from '../preset/managed.ts'
import { parseUpdateVariable, parseJsonPatches, applyStatePatches, renderStateSummary, deepMergeInitVars } from '../state/mvu.ts'
// 【心跳 47 修复】原第 43 行从 ejs.ts 导入 `renderMessagesSandbox`——**该模块从未导出此名**
// （真身在 sandbox.ts，见下一行 `...SandboxVm`）。该导入全程未被使用，esbuild 摇树后静默丢弃
// → 构建零报错。留着它就是一个陷阱：将来谁一用就炸在构建期。已删除。
import { renderMessages as ejsRenderMessages, renderEjsSubset, type LikeStMessage } from '../dsht-plugin-prompt-template/ejs.ts'
import { renderMessagesSandbox as ejsRenderMessagesSandboxVm, asSandboxMessagesResult, type SandboxMessagesResult } from '../dsht-plugin-prompt-template/sandbox.ts'
// 【心跳 47 修复】表格记忆（E1–E12）在 `dsht-plugin-memory/tables.ts` 里实现，本文件曾**只调用不导入**
// → `loadSheets`/`renderTablePrompt`/`expandTableMacros` 全是自由变量 → 运行时 ReferenceError，
// 而三处调用点分别被空 catch 与"不阻塞"catch 吞掉 → **整个表格记忆功能从上线起从未生效**（详见 LEARNINGS L26）。
import { loadSheets, renderTablePrompt, expandTableMacros } from '../dsht-plugin-memory/tables.ts'
import { expandTavernMacros, readVarPath, writeVarPath, registerMacro, unregisterMacro, listCustomMacros, hydrateCustomMacros } from '../dsht-plugin-shared/macros.ts'
import { appendUndoEntries, makeUndoEntry, replayUndoLog } from '../dsht-plugin-shared/undo.ts'
import { restoreSnapshotsAfter, snapshotBeforeWrite, snapshotRestoreBoundary, snapshotRestoreBoundaryFromEvents } from '../dsht-plugin-shared/file-snapshots.ts'
import { scanSessionHeaders as scanSessionHeadersShared, normalizeSnapshotMessageRoles, repairDuplicateTurnStarts, currentSessionLogPath, canSurgicallyTruncate, relocatedSessionLogPath } from '../dsht-plugin-shared/session-surgery.ts'
// 【阶段3 2026-09-10】会话写入合法形态层：surfaceOp 字段名自适应 + 合法标记载体
// （0.1.5 把 start/end 改成 startSeq/endSeq，且禁止 assistant/message 做 replace 节点）
import {
  appendReplace, replaceRange, isReplaceOp, markerSource, readMarker, readLegacySourceKeys, readSurgical, readSurgicalAnchor,
  sanitizeEnvelope, planAssistantRewrite, assistantSettlement, boundAppend, type AppendableSession, type SurgicalMarkerPayload,
} from '../dsht-plugin-shared/session-write.ts'
// 【阶段3 2026-09-10】存量 v0 会话 → 0.1.5 可迁移形态（8 类不合规的纯函数重写器）
import { repairSessionForV3 } from '../dsht-plugin-shared/session-repair.ts'
// 【阶段3 2026-09-10】TH 楼层元数据 sidecar：0.1.5 白名单不许挂 source，迁到 rp/th-floors/
import { mergeSalvagedThFloors, upsertThFloors, readThFloors, lookupThFloor, type ThFloorRecord } from '../dsht-plugin-shared/th-floors.ts'
// D-3：system 槽位路由（TT 对齐投影；合法通道 = system-prompt/assemble 的 assembly.sections）
import { planSlotSections, SLOT_ORDERS, type SlotBatch, type SlotSection } from '../dsht-plugin-shared/tt-projection.ts'
// T-27：更新检查的版本判定内核（纯函数；服务端与前端共用同一份实现，避免两份漂移）
import { relateVersions, parseVersion } from '../dsht-plugin-shared/version-compare.ts'
// T-79：卡正文「防冒充系统指令」处置（唯一处置漏斗 renderGuardedCardText 消费）
import { guardCardContent, newCardNonce, totalHits, escapeResidualMacros, type CardGuardResult } from '../dsht-plugin-shared/card-fence.ts'
// T-48 / T-63：ST 扩展模板的文件路由内核（`/scripts/extensions/**`、`/scripts/templates/**`）
import { handleScriptAssetRequest, SCRIPT_ASSET_PREFIXES } from './ext-asset.ts'
// 【心跳 63D · T-70】有界并发映射（/rp/sessions-audit 的串行读→并行读；语义契约见该文件头）
import { mapBounded, DEFAULT_MAP_CONCURRENCY } from '../dsht-plugin-shared/concurrency.ts'
// 【心跳 63D · T-70】会话审计的读取原语：字节扫描取「行数 + 首/末行」，
// 替代原本把全部字节逐行字符串化的 `readline` 读法（实测 CPU 降一个数量级）。
import { scanJsonlEdges } from '../dsht-plugin-shared/jsonl-scan.ts'
// T-27：更新源响应归一化 + 下载资产挑选（形状适配层单独成模块，配单测钉死两种字段形态）
import { guessUpdateKind, normalizeUpdateFeed, pickDownloadAsset } from '../dsht-plugin-shared/update-feed.ts'
// 【心跳 57】ST 兼容版本声明（单源）—— 宿主页 `/version` 端点。卡的宿主脚本用它做版本分叉
//（`fetch('/version')` → `window.versionNumber` → `>= 11305` 走新版路径），缺该端点会被
// **静默**降级到旧版路径（`.catch(() => 10000)`）→ 去找 ST 旧版 DOM，在 DSH 宿主页必然失败。
import { stVersionPayload, SILLYTAVERN_COMPAT_VERSION } from '../dsht-plugin-shared/st-compat.ts'
// T3.2：会话长期记忆（rp-memory 最小闭环）——核心逻辑纯函数化便于单测，这里只做接线
import {
  appendMemory, deleteMemoryEntry, formatMemoryTime, isValidMemorySessionId, loadMemory,
  memoryRelPath, normalizeMemorySource, queryMemory, renderMemorySnapshot, saveMemory,
  MEMORY_TEXT_MAX,
} from './memory.ts'
// §4.16.1/§4.6 导入 diff 预览 + 断点续跑 checkpoint（纯逻辑层；findStDataRoot 移入该文件）
import {
  buildBatchProgress, CHECKPOINT_STAGES, collectPreviewClaims, findStDataRoot,
  normalizeCheckpointWrite, parseCheckpointFile, scanImportPreview, summarizeCheckpoint,
  type CheckpointFile, type CheckpointStage, type ImportPreview,
} from './import-preview.ts'
// 兼容既有导入面（测试/外部经 index.ts 取 findStDataRoot）
export { findStDataRoot } from './import-preview.ts'
import { resolveIdentity, loadActivePersona } from '../dsht-plugin-tavern-helper/macros.ts'

// 会话手术刀抽至 dsht-plugin-shared/session-surgery.ts（dsht-plugin-undo 共用）；
// 此处 re-export 保持本模块公开面不变（既有测试/调用方零改动）。
export { truncateSessionJsonl, findLastUserMessage } from '../dsht-plugin-shared/session-surgery.ts'
import { truncateSessionJsonl, findLastUserMessage } from '../dsht-plugin-shared/session-surgery.ts'

/** I8-7：当前插件实例的 logLine（stdout 转发器是全局单例，重载后指向新实例的环）。 */
let currentRuntimeLogLine: ((line: string) => void) | null = null

/** B 系：rp/ejs-settings.json 读取（与 dsht-plugin-prompt-template /settings 同文件同默认值）。
 * 进程级缓存 5s——设置面改后最多 5s 生效，避免每轮 pre-step 读盘。 */
let ejsSettingsCache: { at: number; value: Record<string, unknown> } | null = null
export async function loadEjsSettings(dshHomeDir: string): Promise<Record<string, unknown>> {
  if (ejsSettingsCache && Date.now() - ejsSettingsCache.at < 5_000) return ejsSettingsCache.value
  const defaults: Record<string, unknown> = {
    enabled: true, generateEnabled: true, generateLoaderEnabled: false, injectLoaderEnabled: false,
    renderEnabled: true, renderLoaderEnabled: false, codeBlocks: false, permanentEvaluation: false,
    filterChatMessage: false, chatDepth: -1, autosaveEnabled: false, preloadWorldinfo: false,
    withContextDisabled: false, debugEnabled: false, invertEnabled: false, compileWorkers: false,
    sandbox: false, codeEditor: false, cacheEnabled: 0, cacheSize: 0, cacheHasher: 'h32ToString',
  }
  const stored = await readFile(join(dshHomeDir, 'rp', 'ejs-settings.json'), 'utf8')
    .then(t => JSON.parse(t) as Record<string, unknown>).catch(() => ({}) as Record<string, unknown>)
  const out = { ...defaults }
  for (const k of Object.keys(defaults)) if (stored[k] !== undefined) out[k] = stored[k]
  ejsSettingsCache = { at: Date.now(), value: out }
  return out
}

// ---------------------------------------------------------------------------
// 类型（最小面——不 import @deepseek-ai 运行时值，插件自包含）
// ---------------------------------------------------------------------------

interface LikeMessage {
  role: string
  content: Array<{ type: string; text?: string }>
  /** 官方 assistant 消息可能带 id（可选；T2.3b 无 id 时按内容 hash 去重） */
  id?: string
  /**
   * 【心跳 47 扩声明】source 是官方**闭集白名单**（`assertReleasedV0Keys`，多一键即拒整会话）。
   * plugin 源唯一能带结构化文本的形态是 `form:'snapshot'` + `sections`——本文件多处注入
   * 快照都用了它，但接口此前没声明 `sections`，于是调用点只能写 `as LikeMessage & { sections: unknown }`
   * 硬转（而那个目标类型要求的是**顶层** sections，与实际形状不符 → TS2352）。
   */
  source?: { kind?: string; plugin?: string; form?: string; sections?: Array<{ name: string; text: string }> }
}
interface LikeEvent { type: string; seq: number; data: unknown }
interface LikeSession {
  header: { cwd?: string; agentPreset?: string }
  surface: { nodes: readonly number[] }
  events: readonly LikeEvent[]
  append: (type: string, data: unknown, opts?: { surfaceOp?: unknown; sourceEventSeqs?: number[] }) => unknown
  /** 【心跳 47 补声明】官方基准消息派生（`dsh-agent-loop/src/invariant.ts:38`：
   *  `options.messages` 必须恒等 `session.deriveMessages()`）。此前接口漏了它，
   *  导致 `agent.session.deriveMessages()` 报 TS2339（运行时存在，纯声明缺口）。 */
  deriveMessages: () => unknown[]
}
interface LikeAgent { session: LikeSession }
interface LikePreStepEvent { agent: LikeAgent; messages: LikeMessage[]; turn: number; step: number; signal: AbortSignal }
interface LikeDecision { kind: string; messages: LikeMessage[] }
/** 工具执行上下文（对照 dsh-tools ToolExecution 最小面） */
interface LikeToolExec { signal: AbortSignal; agent?: LikeAgent }
/** AgentRegistry 最小面（结论 4/5：agents.get + inject） */
interface LikeAgentFull extends LikeAgent {
  inject: (message: unknown) => unknown
  /** 内核 driver phase（R49 同步面：idle 时 lastTurn 可安全推进——构造时缓存，
   *  外部直写 turn/start 事件不会刷新它，见 open-chat 物化处） */
  phase?: { kind?: string; lastTurn?: number } | undefined
}
interface LikeAgentRegistry { get: (id: string) => LikeAgentFull | undefined }
interface LikeToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: { schema: Record<string, unknown>; render: (args: unknown, value: unknown) => Array<{ type: string; text: string }> }
  isConcurrencySafe?: () => boolean
  execute: (args: Record<string, unknown>, exec: LikeToolExec) => Promise<unknown>
}
interface LikeContext {
  /**
   * 【心跳 47 补声明】cordis 事件钩子注册。宿主按事件名传**不同个数**的参数：
   *   · `agent/pre-step` / `agent/request` → (payload, next)
   *   · `system-prompt/assemble`          → (assembly, context, next)
   * 且 `next` 的返回类型随事件而异（`agent/request` 是 Promise，`llm/stream` 是同步值）。
   * 写成固定的「2 参 + `() => Promise<unknown>`」会把真实存在的 3 参监听器判成 TS2345
   * （"Target signature provides too few arguments"）。故用两条重载忠实描述宿主契约。
   */
  on: {
    (event: string, listener: (event: unknown, next: () => any) => unknown): void
    (event: string, listener: (event: unknown, context: unknown, next: () => any) => unknown): void
  }
  /**
   * 【心跳 47 补声明】cordis 瀑布钩子 `waterfall(signal, name, value, fn)` —— 本项目**唯一**
   * 的对话消息改写通道（`agent/pre-step` 的 `decision.messages`）。`fn` 收到上一环的值并返回
   * 改写值；调用方对结果需自行断言目标类型。
   * 签名有意宽松：各钩子承载的值/返回类型互不相同（LikeMessage[] / 整批 decision / unknown），
   * 强行统一泛型会把真实调用判成错误；此处保留边界宽度，由调用点的显式断言承担类型责任。
   */
  waterfall: (signal: unknown, name: string, value: any, fn: (value: any) => any) => Promise<any>
  /** 【心跳 47 补声明】cordis 事件广播（只读、无返回值）：`emit(signal, name, payload?)` */
  emit: (signal: unknown, name: string, payload?: unknown) => void
  tools?: { register: (tool: LikeToolDef) => unknown }
  systemPrompt?: { section: (section: { name: string; order: number; text: string }) => unknown }
  /** llm 最小面（dsh-llm GenerateOptions/StreamChunk；导入管线 AI 语义分类用） */
  llm?: { stream: (options: { provider: string; model: string; system?: string; messages: Array<{ role: string; content: Array<{ type: string; text?: string }> }> }) => AsyncIterable<{ type: string; text?: string }> }
  /** 默认模型选择（dsh-agent-default-model；settings 层实时读；saveSelection 写用户层） */
  agentDefaultModel?: { currentSelection: () => { provider: string; model: string }; saveSelection?: (sel: { provider: string; model: string }) => Promise<void> }
  /** webServer 路由注册面（host-webserver；web profile 必备；port = 实际监听端口） */
  webServer?: { register: (route: { kind: 'exact' | 'prefix'; path: string; handler: (req: unknown, res: unknown) => void | Promise<void> }) => () => void; host?: '127.0.0.1' | '0.0.0.0'; port?: number }
  /** settings seam（dsh-settings-file；R4 API 配置导入直写 llm-pi-ai 用户层，live 生效）。get = 读命名空间解析值（R15 模型补齐合并 models 用；可能不可用）。register = 注册命名空间 Schema（§2.3 ③ 聊天偏好；真实服务形态见 dsht-plugin-memory LikeSettingsSvc） */
  settings?: { update: (ns: string, patch: Record<string, unknown>) => Promise<unknown>; get?: (ns: string) => unknown; register?: (ns: string, schema: unknown, options?: { base?: unknown }) => unknown }
  /** credentials seam（dsh-credentials-local；写 $DSH_HOME/.credentials.yaml，mode 0600） */
  credentials?: { set: (ref: string, value: string) => Promise<unknown> }
  effect?: (fn: () => () => void, label?: string) => unknown
  /** cordis reflect.get：免 inject 读可选服务（P1#6 读 agentPresets 做能力轴探测；缺席返回 undefined） */
  get?: (name: string, strict?: boolean) => unknown
}

/** 工作区 rp.json（迁移器生成，见 dsh-export.ts） */
interface RpWorkspace {
  schemaVersion: number
  characterName: string
  books: Array<{ name: string; lorePath: string }>
  trigger: { scanDepth?: number; matchWholeWords?: boolean; budgetPercent?: number; budgetCap?: number }
  macros: { char: string; user: string }
  firstMes?: string
  /** 正则脚本（T1.2 落盘；组装层三时机消费） */
  regex?: RegexScript[]
  /**
   * 第四轮：卡设定快照文本（取代 .agent-presets/rp-* agent preset）。
   * pre-step 检测 RP 会话时作为快照注入（过宏引擎），agent 预设界面只留真预设。
   */
  promptPersona?: string
}

export const name = 'dsht-rp-plugin'
/** /rp/rollback-mask 结果缓存（键 = session.jsonl 绝对路径；mtime 失效；逻辑回退/
 *  编辑/重新生成成功后 clear——前端 refreshRollbackMask 立即拿到最新锚）
 *  seqs = 精确的被移出 seq 集合（集合语义的权威判据；hide 仅降级/兼容用）
 *  ranges = 【2026-09-19】连带范围（含非 surface 事件；harness 运行过程节点靠它隐藏） */
const rollbackMaskCache = new Map<string, { size: number; mtimeMs: number; hide: number; seqs: number[]; ranges: Array<{ start: number; end: number }> }>()
// services 声明（Cordis 访问保护：未 inject 的服务属性读取直接 throw "cannot get property without inject"）
// - tools/systemPrompt：lore_query 注册
// - sessions：变体操作读取 session（events/append）
// - llm/agentDefaultModel：/llm/classify 端点（导入管线 AI 语义分类，走已配置凭据）
// - webServer：/dsht-rp/* 同源数据面（T2.5f；web profile 必备）
// - agents：open-chat 物化后同步内核 agent 的 turn 计数（R49——直写 turn/start 事件
//   不刷新 agent 构造时缓存的 phase.lastTurn，内核下一条 prompt 重开同一 turn →
//   前端 assembler「more than one start Match」崩溃，折叠行/会话流停摆）
// @adapt contract:loader.services
export const inject = ['tools', 'systemPrompt', 'sessions', 'llm', 'agentDefaultModel', 'webServer', 'settings', 'credentials', 'connection', 'agents']

// 无配置插件：不导出 Config（Cordis loader 期待 Config 是 Schema——裸 {} 会炸 validate）

// ---------------------------------------------------------------------------
// 纯逻辑（可单测）
// ---------------------------------------------------------------------------

/** 事件数据里的消息文本（单 text 块取 text，多块拼接） */
function messageText(msg: LikeMessage): string {
  return msg.content
    .filter(b => b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text!)
    .join('\n')
}

/**
 * 从 session surface 重建最近消息文本（旧→新）。
 * 排除快照类消息（我们自己注入的与官方 runtime-context 的）——避免旧快照
 * 内容参与关键词扫描造成自我强化/递归漂移。
 */
export function scanSurfaceHistory(session: LikeSession, claimed: LikeMessage[], limit: number, regexScripts: RegexScript[] = []): string[] {
  const texts: string[] = []
  const pushMsg = (msg: LikeMessage | undefined | null) => {
    if (!msg || !Array.isArray(msg.content)) return
    if (msg.source?.form === 'snapshot') return
    if (msg.source?.plugin === name) return
    let t = messageText(msg).trim()
    if (t && regexScripts.length > 0) {
      // ST 语义：WI 扫描看到的是 prompt 正则后的文本（claimed 批已处理过，surface 旧消息在此补跑）
      const placement = msg.role === 'user' ? PLACEMENT.USER_INPUT : PLACEMENT.AI_OUTPUT
      t = runRegexScripts(regexScripts, t, 'prompt', placement, { depth: null }).text.trim()
    }
    if (t) texts.push(t)
  }
  for (const seq of readSurfaceNodes(session)) {
    // @adapt contract:session-api.eventAt
    // 0.1.2 坑 #22：Session 事件读取 API 变更——.events[seq] 直索引移除，改 eventAt(seq)
    const ev = typeof (session as unknown as { eventAt?: unknown }).eventAt === 'function'
      ? (session as unknown as { eventAt: (q: number) => { type?: string; data?: unknown } | undefined }).eventAt(seq)
      : (session as unknown as { events?: Record<number, { type?: string; data?: unknown }> }).events?.[seq]
    if (!ev) continue
    // 事件 data 形状：user/message = Message 本体；assistant/message = {turn, step, message}
    if (ev.type === 'user/message') pushMsg(ev.data as LikeMessage)
    else if (ev.type === 'assistant/message') pushMsg((ev.data as { message?: LikeMessage }).message)
  }
  // 本批 claimed（新用户消息）也进扫描文本（已过正则，不再重复）
  for (const m of claimed) {
    if (!m || !Array.isArray(m.content)) continue
    if (m.source?.form === 'snapshot' || m.source?.plugin === name) continue
    const t = messageText(m).trim()
    if (t) texts.push(t)
  }
  return texts.slice(-Math.max(1, limit * 2))
}

// @adapt contract:session-api.flush
/** I8-1（移动端鲁棒性）：live session 的立即耐久 barrier——append 后必须 await，
 * 200ms 批窗口内进程被杀（Android LMK SIGKILL）即丢标记（回退成功但重启后消失）。
 * 失败必须上抛（调用方 500），禁止静默假成功。 */
export async function flushLiveSession(sessions: unknown, session: unknown): Promise<boolean> {
  // 【心跳 56】原写作 `const flush = (sessions as {...}).flush` + `flush.call(sessions, session)`：
  // 行为本正确（手动绑定了接收者），但**提取形态本身正是心跳 47 缺陷的同形写法**——
  // 一旦后续有人把 `.call(sessions, …)` 改成 `flush(…)`，`this` 立刻丢、功能静默死。
  // 改为在访问点直接调用（不把方法存进变量），从形态上消除风险。
  const sessionsObj = sessions as { flush?: (s: unknown) => Promise<boolean> | undefined }
  if (typeof sessionsObj.flush !== 'function') return false
  const ok = await sessionsObj.flush.call(sessionsObj, session)
  if (ok === false) throw new Error('session flush 失败（写盘未耐久）——数据仍在内存，请重试或反馈')
  return true
}

// @adapt contract:session-api.eventAt
/** 坑 #22 共享适配：读一个 seq 的事件（0.1.2 Session 无公开 events，改 eventAt；
 * agent 内部旧对象回落 .events）。 */
export function sessionEventAt(session: unknown, seq: number): { type?: string; data?: unknown; time?: unknown } | undefined {
  const s = session as { eventAt?: (q: number) => { type?: string; data?: unknown; time?: unknown } | undefined; events?: Record<string | number, { type?: string; data?: unknown; time?: unknown } | undefined> }
  if (typeof s.eventAt === 'function') return s.eventAt(seq)
  return s.events?.[seq]
}

// @adapt contract:session-api.events-snapshot
/** 坑 #22 共享适配：全量事件快照（0.1.2 用 snapshotEvents()，旧对象回落 .events）。 */
export function sessionEventsSnapshot(session: unknown): Array<{ type?: string; data?: unknown; time?: unknown; seq?: number }> {
  const s = session as { snapshotEvents?: () => readonly unknown[]; events?: unknown }
  if (typeof s.snapshotEvents === 'function') return s.snapshotEvents() as Array<{ type?: string; data?: unknown; time?: unknown; seq?: number }>
  if (Array.isArray(s.events)) return s.events as Array<{ type?: string; data?: unknown; time?: unknown; seq?: number }>
  if (s.events && typeof s.events === 'object') return Object.values(s.events) as Array<{ type?: string; data?: unknown; time?: unknown; seq?: number }>
  return []
}

/**
 * 【2026-09-19 回退连带面修复】anchorSeq 所属 turn 的 **turn/start seq**（连带范围起点）。
 *
 * 为什么要单独算这个：回退/编辑/重生成写入的 `shadowedSeqs` 只含 **surface 事件**
 * （user/message、assistant/message、tool/result），而 harness 的运行过程节点
 * （system-prompt 系统提示词 / context 上下文注入 / turn-error 本轮运行失败）的锚
 * 分别落在 `request/header`、注入 user/message、`turn/end` 上——**且 system-prompt 的
 * 锚是 `turn/start` 的 seq，比用户消息还早**（真实会话实证：turn/start=6 → step/start=8
 * → user/message=9 → request/header=11 → turn/end=124）。因此以用户消息为起点的任何
 * 判据都拦不住它，必须从**该轮的 turn/start** 起算。
 *
 * 算法：按 seq 升序扫到 anchorSeq 为止，维护「当前打开中的 turn 起点」
 * （turn/start 打开、turn/end 关闭）；锚所在的那个打开中的 turn 即目标。
 * 无 turn 配对信息（存量/异常日志）→ 退回 anchorSeq 自身（行为与修复前一致）。
 */
export function turnStartSeqFor(events: ReadonlyArray<{ type?: unknown; seq?: unknown }>, anchorSeq: number): number {
  const rows: Array<{ type: string; seq: number }> = []
  for (const e of events) {
    if (typeof e.seq !== 'number' || typeof e.type !== 'string') continue
    rows.push({ type: e.type, seq: e.seq })
  }
  rows.sort((a, b) => a.seq - b.seq)
  let openStart: number | null = null
  let hit: number | null = null
  for (const r of rows) {
    if (r.seq > anchorSeq) break
    if (r.type === 'turn/start') openStart = r.seq
    else if (r.type === 'turn/end') openStart = null
    if (openStart !== null) hit = openStart
  }
  return hit ?? anchorSeq
}

/**
 * 【2026-09-19 回退连带面修复】回退那一刻日志的**最大事件 seq**（连带范围终点）。
 *
 * 为什么必须有界：无界阈值（"seq 大于锚就隐藏"）会把回退之后用户新发的内容一起隐掉
 * —— 这正是 `hideAfter` 阈值语义的固有缺陷（F2 已用集合语义修掉）。区间取"回退那一刻
 * 的日志末尾"，则：被移除的那一轮（含其 harness 过程事件）全部落在区间内；回退之后
 * 新产生的事件 seq 必然更大，天然在区间外。
 */
export function maxEventSeq(events: ReadonlyArray<{ seq?: unknown }>): number {
  let max = 0
  for (const e of events) if (typeof e.seq === 'number' && e.seq > max) max = e.seq
  return max
}

// ---------------------------------------------------------------------------
// B 系（提示词模板）/ D 系（MVU）/ I7（性能）纯函数补全（2026-09-05 全量整改轮）
// ---------------------------------------------------------------------------

/** B18（旧特性兼容）：条目「参与」判定——invertEnabled 时禁用条目视为启用（ST invert_enabled 同语义）。 */
export function entryActive(entry: { disable?: unknown; enabled?: unknown; constant?: boolean }, invert: boolean): boolean {
  const disabled = entry.disable === true || entry.enabled === false
  return invert ? true : !disabled
}

/** 剥条目内容里的 loader 标记（[GENERATE:BEFORE] / [RENDER:AFTER] 等），返回正文。 */
function stripLoaderMarker(content: string): string {
  return content.replace(/\[\s*(?:GENERATE|RENDER)\s*[:：]?[^\]]*\]/gi, '').trim()
}

export interface LoaderSplit { before: LoreEntry[]; after: LoreEntry[] }

/** B3：[GENERATE:BEFORE/AFTER] 条目扫描（ST handleGenerateBefore/After 同语义——
 * 不看关键词激活，生成期整体求值注入；BEFORE=主提示词带区前，AFTER=后）。 */
export function scanGenerateEntries(entries: LoreEntry[]): LoaderSplit {
  const split: LoaderSplit = { before: [], after: [] }
  for (const e of entries) {
    const m = e.content.match(/\[\s*GENERATE\s*[:：]\s*(BEFORE|AFTER)\s*\]/i)
      ?? e.content.match(/\[\s*GENERATE\s*\]/i)
    if (!m) continue
    const kind = (m[1] ?? 'BEFORE').toUpperCase()
    const stripped: LoreEntry = { ...e, content: stripLoaderMarker(e.content) }
    if (kind === 'AFTER') split.after.push(stripped)
    else split.before.push(stripped)
  }
  return split
}

/** B6：[RENDER:BEFORE/AFTER] 条目扫描（ST handleMessageRender 的 RENDER 注入——
 * 显示期把条目求值结果包裹在楼层正文前/后；数据面给 /dsht-ejs/render-entries 消费）。 */
export function scanRenderEntries(entries: LoreEntry[]): LoaderSplit {
  const split: LoaderSplit = { before: [], after: [] }
  for (const e of entries) {
    const m = e.content.match(/\[\s*RENDER\s*[:：]\s*(BEFORE|AFTER)\s*\]/i)
      ?? e.content.match(/\[\s*RENDER\s*\]/i)
    if (!m) continue
    const kind = (m[1] ?? 'BEFORE').toUpperCase()
    const stripped: LoreEntry = { ...e, content: stripLoaderMarker(e.content) }
    if (kind === 'AFTER') split.after.push(stripped)
    else split.before.push(stripped)
  }
  return split
}

export interface InjectDirective { entry: LoreEntry; depth: number; role: 'system' | 'user' | 'assistant'; order: number }

/** B4：@Inject 指令条目扫描（ST inject-prompt 同语义——首行 `@Inject: depth=4 role=system
 * order=100`，正文为注入内容；不看关键词激活，恒按 depth 定位注入）。 */
export function scanInjectEntries(entries: LoreEntry[]): InjectDirective[] {
  const out: InjectDirective[] = []
  for (const e of entries) {
    const m = e.content.match(/^\s*@\s*Inject\s*:\s*([^\n]*)\n?/i)
    if (!m) continue
    const params = m[1] ?? ''
    const num = (k: string, dflt: number): number => {
      const mm = params.match(new RegExp(`${k}\\s*=\\s*(-?\\d+)`, 'i'))
      return mm ? Number(mm[1]) : dflt
    }
    const roleRaw = params.match(/role\s*=\s*(system|user|assistant)/i)?.[1]?.toLowerCase()
    out.push({
      entry: { ...e, content: e.content.replace(/^\s*@\s*Inject\s*:[^\n]*\n?/i, '').trim() },
      depth: num('depth', 4),
      role: (roleRaw === 'user' || roleRaw === 'assistant') ? roleRaw : 'system',
      order: num('order', 100),
    })
  }
  return out
}

/** D1/B12：世界书变量初始化扫描——`<initvar>` / `[initvar]` / `[InitialVariables]` /
 * `<defineEJSVariable>` 块提取（JSON 优先，YAML-lite `key: value` 缩进树兜底），
 * 返回合并变量树（后条目覆盖同路径叶值）。 */
export function parseInitVariables(entries: LoreEntry[]): Record<string, unknown> {
  const blocks: string[] = []
  for (const e of entries) {
    for (const re of [
      /<initvar[^>]*>([\s\S]*?)<\/initvar>/gi,
      /\[\s*initvar\s*\]([\s\S]*?)\[\s*\/\s*initvar\s*\]/gi,
      /\[\s*InitialVariables\s*\]([\s\S]*?)(?:\[\s*\/\s*InitialVariables\s*\]|$)/gi,
      /<defineEJSVariable>([\s\S]*?)<\/defineEJSVariable>/gi,
    ]) {
      for (const m of e.content.matchAll(re)) blocks.push(m[1] ?? '')
    }
  }
  const merged: Record<string, unknown> = {}
  /** YAML-lite：缩进树（`key: value`；value 能 JSON.parse 就解析） */
  const parseYamlLite = (src: string): Record<string, unknown> => {
    const root: Record<string, unknown> = {}
    const stack: Array<{ indent: number; obj: Record<string, unknown> }> = [{ indent: -1, obj: root }]
    for (const raw of src.split('\n')) {
      if (!raw.trim() || raw.trim().startsWith('#')) continue
      const indent = raw.match(/^ */)?.[0].length ?? 0
      const m = raw.trim().match(/^([^:]+):\s*(.*)$/)
      if (!m) continue
      while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop()
      const parent = stack[stack.length - 1].obj
      const key = m[1].trim().replace(/^["']|["']$/g, '')
      const valRaw = m[2].trim()
      let val: unknown = valRaw
      if (valRaw === '' ) { val = {}; stack.push({ indent, obj: val as Record<string, unknown> }) }
      else {
        try { val = JSON.parse(valRaw) } catch { /* 原样字符串 */ }
        parent[key] = val
      }
    }
    return root
  }
  const deepMergeInto = (target: Record<string, unknown>, src: Record<string, unknown>): void => {
    for (const [k, v] of Object.entries(src)) {
      if (v !== null && typeof v === 'object' && !Array.isArray(v)
        && target[k] !== null && typeof target[k] === 'object' && !Array.isArray(target[k])) {
        deepMergeInto(target[k] as Record<string, unknown>, v as Record<string, unknown>)
      } else target[k] = v
    }
  }
  for (const b of blocks) {
    const trimmed = b.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) deepMergeInto(merged, parsed as Record<string, unknown>)
      continue
    } catch { /* 落 YAML-lite */ }
    try { deepMergeInto(merged, parseYamlLite(trimmed)) } catch { /* 坏块跳过 */ }
  }
  return merged
}

/** I7（性能）：重载荷截断——工具调用/结果块里的大字符串（10MB+ base64 图等）在进
 * prompt 前替换为占位符（0.1.2 spill 只截结果不截参数，参数侧在此补齐）。非变异。 */
export function truncateHeavyToolPayloads<T extends object>(messages: T[], maxLen = 100_000): { messages: T[]; truncated: number } {
  const isBase64Like = (s: string): boolean => /^[A-Za-z0-9+/=\r\n]+$/.test(s.slice(0, 256))
  let truncated = 0
  const cut = (v: string): string => `[dsht truncated: ${v.length} chars${isBase64Like(v) ? ', base64-like' : ''}]`
  const messagesOut = messages.map(m => {
    const content = (m as { content?: unknown }).content
    if (!Array.isArray(content)) return m
    let changed = false
    const contentOut = content.map(b => {
      const blk = b as Record<string, unknown> | null
      if (!blk || typeof blk !== 'object' || !/tool|function/i.test(String(blk.type ?? ''))) return b
      const blkOut: Record<string, unknown> = { ...blk }
      let blockChanged = false
      for (const field of ['input', 'arguments', 'content', 'output', 'text'] as const) {
        const v = blkOut[field]
        if (typeof v === 'string' && v.length > maxLen) {
          blkOut[field] = cut(v); blockChanged = true
        } else if (v && typeof v === 'object' && !Array.isArray(v)) {
          const obj = v as Record<string, unknown>
          const objOut: Record<string, unknown> = { ...obj }
          let objChanged = false
          for (const [k, sv] of Object.entries(obj)) {
            if (typeof sv === 'string' && sv.length > maxLen) { objOut[k] = cut(sv); objChanged = true }
          }
          if (objChanged) { blkOut[field] = objOut; blockChanged = true }
        }
      }
      if (blockChanged) { changed = true; truncated++; return blkOut }
      return b
    })
    return changed ? { ...(m as object), content: contentOut } as T : m
  })
  return { messages: truncated > 0 ? messagesOut : messages, truncated }
}

/** B9：楼层模板语句过滤——生成期把 `<% ... %>` 从消息文本剥离（ST filter_chat_message
 * 同语义：楼层模板只渲染显示，不进模型上下文）。非变异。 */
export function filterTemplateStatements<T extends object>(messages: T[]): { messages: T[]; filtered: number } {
  const RE = /<%[\s\S]*?%>/g
  let filtered = 0
  const messagesOut = messages.map(m => {
    const content = (m as { content?: unknown }).content
    if (!Array.isArray(content)) return m
    let changed = false
    const contentOut = content.map(b => {
      const blk = b as { type?: unknown; text?: unknown } | null
      if (!blk || blk.type !== 'text' || typeof blk.text !== 'string' || !blk.text.includes('<%')) return b
      const next = blk.text.replace(RE, '')
      if (next === blk.text) return b
      filtered++
      changed = true
      return { ...blk, text: next }
    })
    return changed ? { ...(m as object), content: contentOut } as T : m
  })
  return { messages: filtered > 0 ? messagesOut : messages, filtered }
}

/** /macros/register|unregister 读改写串行链（并发注册防丢更新；catch 兜底保证链永不拒绝） */
let macroWriteChain: Promise<{ status: number; body: Record<string, unknown> }> = Promise.resolve({ status: 200, body: {} })

/** 【鲁棒轮 2026-09-09】live 会话手术（rollback/edit/regenerate）per-session 串行链——
 *  三个路由的 live 路径都要「捕获视图 → await replayUndoLog（文件 IO 让出事件循环）→
 *  append replace」；并发请求 B 在 A 的 await 窗口里捕获同一视图 → B 的 replace 指向已被
 *  A 顶替的旧 seq 区间（错位 marker + meter 双记）。非 live 路径有 withSessionLock +
 *  内容比对，live 路径此前完全裸奔。链兜底 catch 保证永拒绝。 */
const liveSurgeryChains = new Map<string, Promise<unknown>>()
function withLiveSurgery<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const prev = liveSurgeryChains.get(sessionId) ?? Promise.resolve()
  const next = prev.then(fn, fn) // 前序失败不阻塞后续手术
  liveSurgeryChains.set(sessionId, next.then(() => undefined, () => undefined))
  void liveSurgeryChains.get(sessionId) // 触发 catch 规避 unhandledrejection
  return next
}
/** I8-2（移动端鲁棒性）：原子写文件——temp 独占创建 + fsync + rename 发布 + 父目录 fsync。
 * 0.1.2 的 dsh-atomic-write rename 前不 fsync（官方 TODO），我们自己补齐：
 * 手机端进程被杀在任意时刻都不能留下半写文件（torn tail 可修复，但覆盖型半写=静默丢尾部）。
 *
 * 【F5 2026-09-14 单源化·补漏】此处原为**逐字函数体**，与
 * `dsht-plugin-shared/atomic-fs.ts` 的 `atomicWriteText` 完全相同（审计脚本判据 4
 * 「不同名但函数体逐字相同」抓到）——改名复制 ⇒ 判据 2 永远不报 ⇒ 改一处漏一处不可见。
 * 现委托共享层；导出名保留（本文件 30+ 处调用点与既有外部 import 都用 `atomicWriteFile`）。
 * 注意：tmp 名去重序号 `atomicWriteSeq` 也随之由共享层**统一持有**——这是必需的，
 * 两侧各有独立序号时「同毫秒同路径并发写」仍可能撞名（EEXIST）。 */
export const atomicWriteFile = atomicWriteText

/**
 * 【2026-09-14 F4-C1 真根因 · 设备实测】读 pi-ai 内建模型目录的能力字段。
 *
 * ## 为什么单独抽成函数（P-12 能力契约集中在入口 + 可单测）
 * 原实现内联在路由里，且用 `createRequire(import.meta.url).resolve(<子路径>)`
 * 定位目录 JSON —— **在真机上恒失败**：
 *   `ERR_PACKAGE_PATH_NOT_EXPORTED: Package subpath
 *    './dist/providers/data/deepseek.json' is not defined by "exports"`
 * pi-ai 的 `package.json#exports` 只声明了 `.` / `./compat` / `./providers/*` /
 * `./api/*` / `./oauth` / `./bedrock-provider` / `./bun-oauth`，**不含 `./dist/*`**。
 * 于是 `/rp/model-capability` 恒返回 `contextWindow: null` ⇒ 前端只好落到
 * 「预算未知」占位值 ⇒ **F4-C1「优先取模型真实上下文能力」从未生效**
 *（设备实测：`{"contextWindow":null,...,"origin":null}`，而模型真实值是 1000000）。
 * 这类缺陷的形态是「静默降级」：路由不报错、HTTP 200、字段合法（null 是合法值），
 * 只有对账「该有值却拿到 null」才照得出来（P-11 产物即事实 / P-3 静默失败）。
 *
 * ## 修法
 * 不用「CJS resolve 子路径」（被 exports 白名单拒绝），改**两步**：
 *  1. 定位 pi-ai 包根目录。优先 `import.meta.resolve('@earendil-works/pi-ai')`
 *     （解析**包名**本身——`exports` 里有 `.` ⇒ 合法）；该 API 在 vite/vitest 的
 *     转换环境里可能是 `undefined`，故备一条**向上遍历 node_modules** 的路径
 *     （`<dir>/node_modules/<pkg>/package.json` 存在即命中，逐级上行）。
 *     两条路都不依赖 exports 白名单。
 *  2. 按 pi-ai 自己的**磁盘布局**拼数据文件：
 *     `<pkgRoot>/dist/providers/data/<provider>.json`（`files` 字段含 `dist`，
 *     目录 JSON 是它的运行时数据资产，随包发布）。
 *
 * ## 为什么不用 `createRequire(...).resolve('@earendil-works/pi-ai')` 兜底
 * 实测同样失败：该包 ESM-only，`exports` 只有 `import` 条件，CJS 侧报
 * `ERR_PACKAGE_PATH_NOT_EXPORTED: No "exports" main defined`。
 *
 * ## 失败语义
 * 解析不到 / 文件不存在 / 该 provider 无目录文件 / 该 model 不在目录里 → **返回 null**
 * （不是 0、不是抛错）：调用方据 null 走「预算未知」降级并在 UI 标注。二者**不同**的是
 * 「真的没有」vs「读取出错」——后者由调用方 catch 后 `console.warn` 出声（R8）。
 *
 * @param provider pi-ai 的 provider 路由名（目录文件名，如 `deepseek`）
 * @param model    pi-ai 的 model id（如 `deepseek-v4-flash`）
 * @param field    要读的字段（`contextWindow` | `maxTokens`）
 * @returns 正数值，或 null（未找到/非法）
 */
export async function readPiAiCatalogCapability(
  provider: string,
  model: string,
  field: 'contextWindow' | 'maxTokens',
): Promise<number | null> {
  if (!provider || !model) return null
  // provider 名直接拼路径 ⇒ 必须先做路径穿越防御（外部传入，不可信）
  if (!/^[A-Za-z0-9._-]+$/.test(provider)) return null
  const pkgRoot = findUpPackageDir(dirname(fileURLToPath(import.meta.url)), PI_AI_PKG_NAME)
  if (pkgRoot === null) return null // pi-ai 不在本进程模块树上（裁剪部署）→ 调用方降级
  const dataFile = join(pkgRoot, 'dist', 'providers', 'data', `${provider}.json`)
  if (!existsSync(dataFile)) return null
  const raw = JSON.parse(await readFile(dataFile, 'utf8')) as Record<string, Record<string, Record<string, unknown>> | undefined>
  // 目录形状：{ <api 名>: { <model id>: {contextWindow, maxTokens, …}, … }, … }
  // 同一个 model 可能挂在多个 api 下（如 openai-completions / anthropic-messages）；
  // 取**第一个命中的**即可——能力字段与 api 线路无关（pi-ai 自身也这么用）。
  for (const models of Object.values(raw)) {
    const entry = models?.[model]
    if (entry === undefined) continue
    const v = entry[field]
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v
  }
  return null
}

/** pi-ai 包名（读取其内建模型目录用；单源，避免多处各写一遍字符串） */
const PI_AI_PKG_NAME = '@earendil-works/pi-ai'

/**
 * 定位某包在磁盘上的根目录（含 `package.json` 的那一层）。
 *
 * ## 为什么需要它（而不是直接 resolve 子路径）
 * 见 `readPiAiCatalogCapability` 头注：pi-ai 的 `exports` 不含 `./dist/*`，
 * 任何「resolve 到数据文件」的写法都会被 `ERR_PACKAGE_PATH_NOT_EXPORTED` 拒绝。
 * 而 resolve **包名**在 vite/vitest 转换环境下又不可用（`import.meta.resolve`
 * 是 `undefined`）。向上遍历是唯一在「真 node」与「vite 转换环境」下都成立的方式，
 * 且行为完全可预测（node 自己的解析算法也是逐级向上）。
 *
 * 设备实测路径（两份布局都能命中）：
 *   · 插件产物 `…/profiles/web/node_modules/dsht-rp-plugin/lib/` → 上一级
 *     `…/profiles/node_modules/@earendil-works/pi-ai` ✓
 *   · PC 工作区 `…/rp-workspace/packages/src/dsh-plugin/lib/` →
 *     `…/rp-workspace/node_modules/@earendil-works/pi-ai` ✓
 *
 * @param startDir 起始目录（通常是本模块所在目录）
 * @param pkgName  包名（可含 scope，如 `@earendil-works/pi-ai`）
 * @returns 包根目录绝对路径；找不到返回 null（不抛——调用方降级）
 */
export function findUpPackageDir(startDir: string, pkgName: string): string | null {
  let dir = startDir
  // 上限保护：Windows 最长路径 + 防万一的循环（dirname 到根会稳定返回自身）
  for (let i = 0; i < 40; i += 1) {
    const candidate = join(dir, 'node_modules', pkgName)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    const parent = dirname(dir)
    if (parent === dir) break // 已到盘根
    dir = parent
  }
  return null
}

/** I8-3（移动端鲁棒性）：会话文件手术锁——0.1.2 无 lease，多写者（残留 runtime /
 * 第二进程）是 seq gap 的主因。手术期间持独占 .lock（wx 独占创建 = 进程级互斥），
 * 拿不到锁立即失败（不等待——手术是低频运维操作，排队无意义）。 */
export async function withSessionLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = `${file}.lock`
  let handle: import('node:fs/promises').FileHandle
  try {
    handle = await open(lockPath, 'wx')
  } catch {
    throw new Error('会话被其他写者持有（.lock 已存在）——确认没有第二个 DSH 实例/残留进程后删除 .lock 重试')
  }
  try {
    await handle.writeFile(String(process.pid), 'utf8')
    await handle.sync()
  } catch { /* 锁内容写失败不阻塞（锁的存在性即互斥语义） */ }
  try {
    return await fn()
  } finally {
    try { await rm(lockPath, { force: true }) } catch { /* 锁清理失败不影响结果 */ }
  }
}

/** I4/I5：全局用户档案（{{user}} 宏的值来源；ST「用户设置」等价物）。
 * 存 rp/user-profile.json {name, description}；进程级缓存，PUT 时失效。 */
export interface RpUserProfile { name: string; description: string }
let userProfileCache: RpUserProfile | null = null
/** 【实机测试修复 2026-09-05】pre-step withPresetLayer 每轮刷新的当前档案
 * （声明在并行编辑竞态中丢失 → "globalUserProfile is not defined" pre-step 崩溃降级） */
let globalUserProfile: RpUserProfile | null = null
export async function loadUserProfileCached(dshHome: string): Promise<RpUserProfile> {
  if (userProfileCache !== null) return userProfileCache
  try {
    const raw = JSON.parse(await readFile(join(dshHome, 'rp', 'user-profile.json'), 'utf8')) as { name?: string; description?: string }
    userProfileCache = {
      name: typeof raw?.name === 'string' ? raw.name.trim() : '',
      description: typeof raw?.description === 'string' ? raw.description : '',
    }
  } catch { userProfileCache = { name: '', description: '' } }
  return userProfileCache!
}

/** I4（ST 宏系统）：核心宏展开器（生成期 + 显示期共用语义）。
 * 覆盖 ST MacrosParser 高频基础宏：{{user}}/{{char}}/{{time}}/{{date}}/{{weekday}}/
 * {{random:a,b,c}}/{{pick:a,b,c}}/{{roll:X}}/{{roll:X,N}}；未知宏原样保留（ST 同款）。 */
export function expandCoreMacros(
  text: string,
  ctx: { user?: string; char?: string },
): string {
  if (!text || !text.includes('{{')) return text
  const user = ctx.user || '用户'
  const char = ctx.char || '角色'
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const weekdayStr = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()]
  let out = text
  out = out.replaceAll('{{user}}', user).replaceAll('{{char}}', char)
  out = out.replaceAll('{{time}}', timeStr).replaceAll('{{date}}', dateStr).replaceAll('{{weekday}}', weekdayStr)
  // {{random:a,b,c}} / {{pick:a,b,c}}：每次求值随机取一（pick 在 ST 语义里= random 单次）
  out = out.replace(/\{\{(random|pick):([^}]+)\}\}/g, (_m, _kind, list: string) => {
    const opts = list.split(',').map(s => s.trim()).filter(s => s !== '')
    if (opts.length === 0) return _m
    return opts[Math.floor(Math.random() * opts.length)] ?? _m
  })
  // {{roll:X}} / {{roll:X,N}}：X 面骰掷 N 次（N 缺省 1），多次返回总和
  out = out.replace(/\{\{roll:(\d+)(?:\s*,\s*(\d+))?\}\}/g, (_m, d: string, n?: string) => {
    const sides = Math.max(2, Math.min(1000, Number(d) || 6))
    const times = Math.max(1, Math.min(100, Number(n) || 1))
    let sum = 0
    for (let i = 0; i < times; i++) sum += 1 + Math.floor(Math.random() * sides)
    return String(sum)
  })
  return out
}

/** rp.json 快照文本渲染：激活条目 → 注入块（宏替换 {{char}}/{{user}}） */
export function renderWorldInfoSnapshot(
  activated: Array<{ entry: LoreEntry; reason: string }>,
  macros: { char: string; user: string },
): string {
  if (activated.length === 0) return ''
  const sub = (s: string) => s
    .replaceAll('{{char}}', macros.char || '角色')
    .replaceAll('{{user}}', macros.user || '用户')
  const lines = activated.map(a => {
    const tag = a.reason === 'constant' ? '常驻' : '关键词'
    const head = a.entry.comment ? `[${tag}] ${sub(a.entry.comment)}` : `[${tag}]`
    return `${head}\n${sub(a.entry.content)}`
  })
  return [
    'Current active worldbook entries for this roleplay scene. This snapshot supersedes earlier ones.',
    'Use these as established scene facts; do not repeat them verbatim.',
    ...lines,
  ].join('\n\n')
}

/** Android 路径归一：/data/user/0/<pkg> 与 /data/data/<pkg> 是同一目录的两种形态。
 *  【F5 2026-09-14 单源化】实现已下沉到 dsht-plugin-shared/rp-workspace.ts
 *  （与该模块的 rpSlugFromCwd 同源，避免两侧规范化口径漂移）。此处保留本地别名
 *  以减少本文件内 7 处调用点的改动面；新代码请直接用共享模块。 */
const normAndroidPath = normalizeAndroidPath

// ---------------------------------------------------------------------------
// 存量 session cwd 修复（纯逻辑，可单测）
// 背景：Android 上 $DSH_HOME 常取 /data/user/0/<pkg> 形态（/data/data 的 symlink），
// 而 DSH WorkspaceRegistry 一律 realpath 规范化（/data/data 形态）。迁移写盘的
// session.jsonl header cwd 若为 symlink 形态：
// - session.create(workspaceId, sessionId) 认领时 ensureSession 用字符串等值比对
//   cwd（inspected.meta.cwd !== workspace.path → session-conflict）；
// - jsonl 持久层 assertStoredIdentity 要求物理路径 == logPath(root, header.cwd, id)，
//   所以修复必须同时改 header 并把会话目录搬到 projectKey(规范 cwd) 下。
// ---------------------------------------------------------------------------

/**
 * header cwd 是否需要规范化（两种形态）：
 *  ① Android symlink 形态 `/data/user/0/…`（与 WorkspaceRegistry 的 realpath 规范形态不一致）
 *  ② **非绝对路径**（v0 迁移器硬要求 `header cwd must be absolute`；历史引导会话
 *     写的是 `rp/_start` 这种相对形态）——【阶段3 2026-09-10 新增】
 * 绝对且已规范的路径不动。
 */
export function sessionCwdNeedsRepair(cwd: unknown): cwd is string {
  if (typeof cwd !== 'string') return false
  return cwd.startsWith('/data/user/0/') || !isAbsolute(cwd)
}

/**
 * 改写 session.jsonl 首行 header 的 cwd（只动首行；事件行不碰）。
 * 返回 null = 不是 session header / 无需改。
 */
export function rewriteSessionHeaderCwd(line: string, canonicalCwd: string): string | null {
  let obj: { type?: unknown; cwd?: unknown }
  try { obj = JSON.parse(line) as { type?: unknown; cwd?: unknown } } catch { return null }
  if (obj?.type !== 'session' || typeof obj.cwd !== 'string') return null
  if (obj.cwd === canonicalCwd) return null
  obj.cwd = canonicalCwd
  return JSON.stringify(obj)
}

/** 读一段会话文本首行的 header.cwd（非 session header / 非法 JSON → null）。 */
export function sessionHeaderCwd(content: string): string | null {
  const nl = content.indexOf('\n')
  const line = nl === -1 ? content : content.slice(0, nl)
  let obj: { type?: unknown; cwd?: unknown }
  try { obj = JSON.parse(line) as { type?: unknown; cwd?: unknown } } catch { return null }
  return obj?.type === 'session' && typeof obj.cwd === 'string' ? obj.cwd : null
}

/**
 * 三步修复链是否需要落盘（= 是否有真实改动）。
 *
 * 【为什么单独抽出来】历史事故：守卫写成 `... && v3.changed === 0`，
 * 而 `v3.changed` 是 **boolean**（`repairSessionForV3` 返回布尔），`false === 0` 恒为 false
 * → 守卫永不成立 → **每次启动重写全部 79 个会话**（实测每轮 ~200MB 无效写入，
 * 并堆积 79 个 `.bak` / 136MB，显著抬高 torn-write 概率）。
 *
 * 抽成**带类型的谓词**后，这类「字段类型与比较运算符不匹配」的缺陷在编译期即被 tsc 拦下
 * （`boolean === 0` 报 TS2367），不再依赖人眼审阅。参数类型即契约，勿改宽。
 */
export function sessionRepairNeedsWrite(
  normChanged: number,
  v3Changed: boolean,
  seqRepaired: boolean,
): boolean {
  void normChanged
  return seqRepaired || v3Changed || normChanged !== 0
}

// ---------------------------------------------------------------------------
// seq 断号修复 / 会话回退（真机实测：agent 手写 session.jsonl seq 跳号 →
// DSH 拒绝打开 "corrupt session log: seq gap in committed region"）
// ---------------------------------------------------------------------------

export interface SessionSeqRepair {
  /** 是否发生了修复（false = seq 本就连续，幂等短路） */
  repaired: boolean
  /** 修复后的完整文件内容（repaired=false 时 = 原文） */
  content: string
  /** 参与判定的事件行数 */
  events: number
  /** 无法修复的原因（header 缺失/事件行坏 JSON/seq 非数值） */
  error?: string
  /** I8-4：回绕截尾时截掉的事件数（0 = 走重编号路径） */
  truncated?: number
  /** 截尾原因描述（诊断/日志用） */
  note?: string
}

/**
 * session.jsonl committed 区 seq 连续性校验 + 修复（纯函数，R18 按 decodeStorageRecord 语义重写）。
 *
 * 宿主网关（dsh-session-persistence-jsonl）的加载语义：每行先 JSON.parse → decodeStorageRecord——
 * 只认 `text-chunks`/`reasoning-chunks`/`tool-call-chunks` 三种聚合 tag 展开（子事件
 * `seq = seq0 + k`、type 统一 `assistant/chunk`、data 仅 `{turn, step, chunk}`），其余行原样单事件。
 * 之后严格 `event.seq === 期望序号`，gap 且无 turn/end 截尾、有 turn/end 硬拒。
 *
 * 本函数与网关同语义：逐行 decodeStorageRecord（同款三 tag 展开）→ 全事件流严格校验 →
 * 修复策略（I8-4 不变）：
 * - 回绕型 gap（seq < 期望）→ 截到最后连续前缀 + 合成 interrupted turn/end；
 * - 单调缺号且引用可映射（surfaceOp/sourceEventSeqs 无悬空）→ 全事件流重编号；
 * - 修复产物按宿主打包语义 repack：连续 ≥3 个同 turn/step/index 的 assistant/chunk
 *   delta 聚合成 `text-chunks`/`reasoning-chunks`/`tool-call-chunks` 行（seq0=首事件 seq，
 *   dt=相邻 time 差分），其余事件逐行——产物再被网关 decode 时逐字节等价。
 */
const CHUNK_TAGS = ['text-chunks', 'reasoning-chunks', 'tool-call-chunks'] as const

interface DecodedChunkRow { tag: typeof CHUNK_TAGS[number]; seq0: number; time0: number; data: Record<string, unknown> }

/** decodeStorageRecord 同款：一行 → 事件数组（聚合行展开，其余原样单事件）。 */
function decodeStorageLine(ev: Record<string, unknown>): Array<Record<string, unknown>> {
  const tag = ev.type
  if (tag !== 'text-chunks' && tag !== 'reasoning-chunks' && tag !== 'tool-call-chunks') return [ev]
  const row = ev as unknown as DecodedChunkRow
  const data = row.data ?? {}
  const payload = (tag === 'tool-call-chunks' ? data.args : data.texts) as unknown
  if (typeof row.seq0 !== 'number' || typeof row.time0 !== 'number' || !Array.isArray(payload) || payload.length === 0) return [ev]
  const dt = (data.dt as unknown) ?? []
  const out: Array<Record<string, unknown>> = []
  let t = row.time0
  for (let k = 0; k < payload.length; k++) {
    const chunk = tag === 'tool-call-chunks'
      ? { type: 'tool-call-delta', index: data.index, id: data.id, name: data.name, argumentsDelta: payload[k] }
      : { type: tag === 'reasoning-chunks' ? 'reasoning-delta' : 'text-delta', index: data.index, text: payload[k] }
    out.push({ type: 'assistant/chunk', seq: row.seq0 + k, time: t, data: { turn: data.turn, step: data.step, chunk } })
    if (k < (dt as unknown[]).length) t += Number((dt as unknown[])[k]) || 0
  }
  return out
}

/** 事件流 → 宿主打包布局（连续 ≥3 同 turn/step/index 的 assistant/chunk delta 聚合）。 */
function packEventRows(events: Array<Record<string, unknown>>): string[] {
  const out: string[] = []
  let run: Array<Record<string, unknown>> = []
  let runTag: typeof CHUNK_TAGS[number] | null = null
  const classify = (ev: Record<string, unknown>): typeof CHUNK_TAGS[number] | null => {
    if (ev.type !== 'assistant/chunk') return null
    const c = (ev.data as { chunk?: { type?: string } } | undefined)?.chunk
    if (c?.type === 'text-delta') return 'text-chunks'
    if (c?.type === 'reasoning-delta') return 'reasoning-chunks'
    if (c?.type === 'tool-call-delta') return 'tool-call-chunks'
    return null
  }
  const continues = (prev: Record<string, unknown>, next: Record<string, unknown>): boolean => {
    const pd = prev.data as { turn?: unknown; step?: unknown; chunk?: { index?: unknown; id?: unknown; name?: unknown } }
    const nd = next.data as { turn?: unknown; step?: unknown; chunk?: { index?: unknown; id?: unknown; name?: unknown } }
    if ((next.seq as number) !== (prev.seq as number) + 1) return false
    if (nd.turn !== pd.turn || nd.step !== pd.step) return false
    if (nd.chunk?.index !== pd.chunk?.index) return false
    if (nd.chunk?.id !== pd.chunk?.id || nd.chunk?.name !== pd.chunk?.name) return false
    return true
  }
  const flush = (): void => {
    if (runTag !== null && run.length >= 3) {
      const first = run[0]
      const d0 = first.data as { turn?: unknown; step?: unknown; chunk?: { index?: unknown; id?: unknown; name?: unknown } }
      const payloads: string[] = []
      const dts: number[] = []
      for (let i = 0; i < run.length; i++) {
        const c = (run[i].data as { chunk?: { text?: unknown; argumentsDelta?: unknown } }).chunk ?? {}
        payloads.push(String(runTag === 'tool-call-chunks' ? (c.argumentsDelta ?? '') : (c.text ?? '')))
        if (i > 0) dts.push(Math.max(0, (run[i].time as number) - (run[i - 1].time as number)))
      }
      const data: Record<string, unknown> = { turn: d0.turn, step: d0.step, index: d0.chunk?.index }
      if (runTag === 'tool-call-chunks') { data.id = d0.chunk?.id; if (d0.chunk?.name !== undefined) data.name = d0.chunk.name; data.args = payloads }
      else data.texts = payloads
      data.dt = dts
      out.push(JSON.stringify({ type: runTag, seq0: first.seq, time0: first.time, data }))
    } else {
      for (const ev of run) out.push(JSON.stringify(ev))
    }
    run = []
    runTag = null
  }
  for (const ev of events) {
    const tag = classify(ev)
    if (tag !== null && runTag !== null && tag === runTag && run.length > 0 && continues(run[run.length - 1], ev)) {
      run.push(ev)
      continue
    }
    flush()
    if (tag !== null) { runTag = tag; run = [ev] }
    else { run = [ev] } // 非 chunk 事件也要进 run（单独落行）
  }
  flush()
  return out
}

export function repairSessionSeqs(content: string): SessionSeqRepair {
  const lines = content.split('\n')
  // 末尾空行（trailing newline）不参与事件流
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
  if (lines.length === 0) return { repaired: false, content, events: 0, error: '空文件' }
  let header: Record<string, unknown>
  try { header = JSON.parse(lines[0]) as Record<string, unknown> } catch {
    return { repaired: false, content, events: 0, error: 'header 不是合法 JSON' }
  }
  if (header?.type !== 'session') return { repaired: false, content, events: 0, error: '首行不是 session header' }

  // ---- R18：逐行 decodeStorageRecord（同款三 tag 展开）→ 全事件流严格校验 ----
  // 聚合行（text-chunks/reasoning-chunks/tool-call-chunks）展开成 assistant/chunk 子事件；
  // 其余行单事件。事件数组下标 = 全局事件序号（与网关 this.events.length 一致）。
  const events: Array<Record<string, unknown>> = []
  const layout: Array<{ kind: 'event'; idx: number } | { kind: 'raw'; line: string }> = []
  let hasChunkRows = false
  for (let i = 1; i < lines.length; i++) {
    let ev: Record<string, unknown>
    try { ev = JSON.parse(lines[i]) as Record<string, unknown> } catch {
      return { repaired: false, content, events: events.length, error: `第 ${i + 1} 行不是合法 JSON` }
    }
    // 聚合行只有 seq0 无 seq——先判 CHUNK_TAGS（修复 R18 致命 bug：seq 守卫在 tag 判定前
    // 导致聚合行全进 raw 分支，decodeStorageLine/hasChunkRows/packEventRows 成死代码）
    if (CHUNK_TAGS.includes(ev.type as typeof CHUNK_TAGS[number])) {
      hasChunkRows = true
      for (const sub of decodeStorageLine(ev)) {
        layout.push({ kind: 'event', idx: events.length })
        events.push(sub)
      }
      continue
    }
    // 无 seq/seq 非整数的行（checkpoint/边界等宿主写入的非事件行）原样保留、不参与判定
    if (typeof ev?.seq !== 'number' || !Number.isInteger(ev.seq) || ev.seq < 0) {
      layout.push({ kind: 'raw', line: lines[i] })
      continue
    }
    for (const sub of decodeStorageLine(ev)) {
      layout.push({ kind: 'event', idx: events.length })
      events.push(sub)
    }
  }
  const contiguous = events.every((ev, i) => ev.seq === i)
  if (contiguous) return { repaired: false, content, events: events.length }
  /** 输出按宿主布局：有聚合行时按 packEventRows 重打包，无聚合行时按 layout 原样保留 */
  const emitRows = (evs: Array<Record<string, unknown>>, limit?: number): string[] => {
    if (hasChunkRows) return packEventRows(evs)
    const out: string[] = []
    for (const slot of layout) {
      if (slot.kind === 'raw') { out.push(slot.line); continue }
      if (limit !== undefined && slot.idx >= limit) continue
      out.push(JSON.stringify(evs[slot.idx]))
    }
    return out
  }

  // I8-4：回绕检测——第一次出现 ev.seq < i（期望值）的位置 = 重复段起点。
  // 截到最后连续前缀 + 合成 interrupted turn/end（不重编号、不 remap——保留语义）。
  let wrapAt = -1
  for (let i = 0; i < events.length; i++) {
    if ((events[i].seq as number) < i) { wrapAt = i; break }
  }
  // 【实机复现修复 2026-09-05】重编号可映射性守卫：surfaceOp replace 范围与
  // sourceEventSeqs 引用必须落在当前事件集内（≤ 最大 seq）。悬空引用（如逻辑回退
  // 标记 replace [23,127] 的 end=127 超出重编号后事件集）会让重编号产物被 gateway
  // committed-region 校验以 "expected <悬空值>" 拒载——此时一律改走截断路径。
  const maxSeq = events.length > 0 ? (events[events.length - 1].seq as number) : -1
  const refsRemappable = events.every(ev => {
    const op = ev.surfaceOp
    if (op !== null && typeof op === 'object' && (op as { op?: unknown }).op === 'replace') {
      const o = op as { start?: unknown; end?: unknown }
      if (typeof o.start === 'number' && (o.start < 0 || o.start > maxSeq)) return false
      if (typeof o.end === 'number' && (o.end < 0 || o.end > maxSeq)) return false
    }
    if (Array.isArray(ev.sourceEventSeqs)) {
      return (ev.sourceEventSeqs as unknown[]).every(s => typeof s !== 'number' || (s >= 0 && s <= maxSeq))
    }
    return true
  })
  // 单调缺号但有悬空引用 = 同样按回绕截断处理（gap 起点改为第一处 seq !== i）
  if (wrapAt < 0 && !refsRemappable) {
    for (let i = 0; i < events.length; i++) {
      if ((events[i].seq as number) !== i) { wrapAt = i; break }
    }
  }
  // 【审查修复 2026-09-05】kept 必须是首个 seq !== i 之前的最长连续前缀
  //（不能是 events.slice(0, wrapAt)——若 wrapAt 前已有缺号，kept 仍不连续）
  let kept: Array<Record<string, unknown>> = []
  if (wrapAt > 0) {
    for (let i = 0; i < wrapAt; i++) {
      if ((events[i].seq as number) !== i) break
      kept.push(events[i])
    }
  }
  if (kept.length > 0) {
    const truncated = events.length - kept.length
    // 合成 interrupted turn/end（0.1.2 torn-tail 修复同款语义：让 loader 认可截尾点）
    const lastKept = kept[kept.length - 1]
    const lastTurn = (() => {
      for (let i = kept.length - 1; i >= 0; i--) {
        const d = kept[i].data as { turn?: number } | undefined
        if (kept[i].type === 'turn/start' && typeof d?.turn === 'number') return d.turn
      }
      return undefined
    })()
    const needsCloser = lastKept?.type !== 'turn/end' && lastTurn !== undefined
    const out = [JSON.stringify(header), ...emitRows(kept, kept.length)]
    if (needsCloser) {
      out.push(JSON.stringify({
        type: 'turn/end',
        seq: kept.length,
        time: Date.now(),
        data: { turn: lastTurn, reason: { kind: 'interrupted' } },
        source: { kind: 'plugin', plugin: 'dsht-rp', seqRepair: 'truncate-wraparound' },
      }))
    }
    return {
      repaired: true,
      content: out.join('\n') + '\n',
      events: kept.length + (needsCloser ? 1 : 0),
      truncated,
      note: `回绕型 seq gap（重复段）——截到最后连续前缀 ${kept.length} 事件${needsCloser ? ' + 合成 interrupted turn/end' : ''}，丢弃 ${truncated} 个重复/损坏事件`,
    }
  }

  // 单调缺号（ev.seq > i）且引用全部可映射：重编号修复（旧行为；守卫见上）
  // old→new 映射（重号时后出现的覆盖——seq 唯一化以行序为准）
  if (!refsRemappable) {
    return { repaired: false, content, events: events.length, error: '悬空引用且无连续前缀可截（首个事件即异常）——需人工处理' }
  }
  const seqMap = new Map<number, number>()
  events.forEach((ev, i) => seqMap.set(ev.seq as number, i))
  const remap = (v: unknown): unknown =>
    typeof v === 'number' && seqMap.has(v) ? seqMap.get(v) : v

  events.forEach((ev, i) => {
    ev.seq = i
    const op = ev.surfaceOp
    if (op !== null && typeof op === 'object') {
      const o = op as { start?: unknown; end?: unknown }
      if (typeof o.start === 'number') o.start = remap(o.start) as number
      if (typeof o.end === 'number') o.end = remap(o.end) as number
    }
    if (Array.isArray(ev.sourceEventSeqs)) {
      ev.sourceEventSeqs = (ev.sourceEventSeqs as unknown[]).map(remap)
    }
  })
  // R18：按宿主打包语义 repack（聚合行重打包），产物再被网关 decode 时逐字节等价
  const out = [JSON.stringify(header), ...emitRows(events)]
  return { repaired: true, content: out.join('\n') + '\n', events: events.length, note: '单调缺号——重编号修复' }
}

/**
 * 从 agent.cordis.yml 文本抽取 persona text（`text: |-` 块；第四轮存量迁移用：
 * .agent-presets/rp-* 的 persona 正文抽进 rp.json.promptPersona）。解析失败返回 null。
 */
export function extractPersonaTextFromAgentYml(yml: string): string | null {
  const lines = yml.split('\n')
  const start = lines.findIndex(l => /^\s+text:\s*\|-/.test(l))
  if (start < 0) return null
  // 块内容 = 后续比 `text:` 行缩进更深的行（或空行）
  const baseIndent = lines[start].match(/^\s*/)![0].length
  const out: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]
    if (l.trim() === '') { out.push(''); continue }
    const indent = l.match(/^\s*/)![0].length
    if (indent <= baseIndent) break
    out.push(l.slice(baseIndent + 2)) // 剥块缩进（YAML |- 块内容 = baseIndent+2 起）
  }
  const text = out.join('\n').replace(/\n+$/, '')
  return text.trim() ? text : null
}

/**
 * 任务 2：卡设定快照消息构造（纯函数，取代 .agent-presets/rp-* 的 persona 插件注入）。
 * pre-step 对 RP 会话把 rp.json.promptPersona（过宏引擎后）作为首条 system 快照注入——
 * 与 agent preset 完全解耦：会话 header 无 agentPreset 时照常工作。
 */
/**
 * 快照残留宏中性化（turn 38 真机实测）：组装层宏引擎只展开已知宏，未知宏
 * （ST 系 {{trim}}/{{lastUserMessage}} 等）原样透传 → ASCII {{…}} 进消息后
 * DSH 插值器扫 persona 段即炸 "malformed prompt variable reference"。
 * 快照是静态上下文，残留宏对模型本就不可展开——全角化让 DSH 插值器不再碰。
 *
 * 【T-79 2026-09-13】**单源**：实现已挪到 `dsht-plugin-shared/card-fence.ts` 的
 * `escapeResidualMacros`（与卡正文处置共用同一份转义口径），此处只做委托。
 * 本仓铁律：同一语义不得有第二份实现（否则"改一处漏一处"）。
 */
function neutralizeResidualMacros(text: string): string {
  return escapeResidualMacros(text)
}

// ---------------------------------------------------------------------------
// T-79：卡正文处置的唯一漏斗
// ---------------------------------------------------------------------------

/** nonce 复用缓存（key = slug|kind|内容指纹 → nonce）——同内容复用避免逐步 system 抖动 */
const cardFenceNonces = new Map<string, string>()

/** 已出声的降级 key（slug|kind|hits 摘要）——防每条每轮刷屏（L42：降级可观测但不刷屏） */
const cardFenceReported = new Set<string>()

export function buildPersonaSnapshotMessage(text: string): LikeMessage {
  const m: LikeMessage = {
    // role 必须 'user'（rc.8 冷启动校验 assertMessageEventShape：user/message 事件
    // 的 data.role === 'user'，'system' 会让会话打不开——真机实测）。对模型语义
    // 不变：快照注入本就是深度注入的 user 席等效形态；source.form='snapshot' 保留
    // （导出/渲染链按此识别快照）。
    role: 'user',
    content: [{ type: 'text', text: neutralizeResidualMacros(text) }],
    source: { kind: 'plugin', plugin: name, form: 'snapshot', sections: [{ name: 'dsht-rp:persona', text: neutralizeResidualMacros(text) }] },
  }  ;(m as { id?: string }).id = `dsht-rp-persona-${randomUUID()}`
  return m
}

/** 截断后会话内容的最后事件时间（undo 回放截断点：ts 晚于它的变量写全部回滚） */
export function sessionContentMaxTime(content: string): number {
  let max = 0
  for (const line of content.split('\n')) {
    if (!line.trim()) continue
    try {
      const ev = JSON.parse(line) as { time?: unknown }
      if (typeof ev?.time === 'number' && ev.time > max) max = ev.time
    } catch { /* 坏行跳过 */ }
  }
  return max
}

/** DSH WorkspaceRegistry 最小面（host 进程内 ctx.get 直调；注册/命名/会话归组零 RPC 往返） */
interface LikeWorkspaceEntity {
  id: string
  path: string
  title: string
  attachSession: (sessionId: string) => Promise<void>
  setTitle: (title: string) => Promise<void>
}
interface LikeWorkspaceRegistry {
  list: () => LikeWorkspaceEntity[]
  resolveByPath: (path: string) => Promise<LikeWorkspaceEntity | undefined>
  create: (path: string) => Promise<LikeWorkspaceEntity>
}

// ---------------------------------------------------------------------------
// 组装管线（§4.1 五步在 pre-step 的运行时接线；纯函数，可单测）
// 1. 正则 prompt 时机 → 本批消息（WI 扫描看到的是正则后的文本，ST 语义）
// 2. WI 触发（triggerWorldInfo，既有）
// 3. 槽位落位 → persona/system 由 DSH preset 承担；AT_DEPTH 条目 splice 进批
// 4. 宏引擎 → WI 条目内容组装期求值（§4.1.1）
// 5. token 预算 → triggerWorldInfo budget + DSH compaction（消息级预算由内核管）
// ---------------------------------------------------------------------------

/** 组装 trace（T1.5：前端"这条消息怎么被生成的"数据源，/dsht-rp/trace 暴露） */
export interface AssemblyTraceRuntime {
  sessionId: string
  turn: number
  ts: number
  regexHits: Array<{ scriptName: string; count: number }>
  activatedEntries: Array<{ comment: string; reason: string; position: string }>
  depthInjections: Array<{ depth: number; chars: number }>
  snapshotChars: number
  droppedByBudget: number
}

/** P0-5 per-turn 闸门判定（dsh-worldbook inject.ts L39-42 同款）：本 step inbox 含 source.kind==='user' 的真实用户消息 */
export function hasDirectUserInput(messages: LikeMessage[] | undefined): boolean {
  return (messages ?? []).some(m => m?.source?.kind === 'user')
}

/**
 * 【TT 对照修复 2026-09-10】消息深度计算（对照 TT `script.js:5285`
 * `depth: coreChat.length - index - (isContinue ? 2 : 1)` 的语义简化版）。
 *
 * TT 公式里 `-1` 是为「最新一条是待生成的 assistant 占位」预留的偏移；DSH 的
 * decision.messages 不含占位，故此处直接用「距末尾的距离」：末尾一条 depth=0，
 * 倒数第二条 depth=1……。ST 的 minDepth/maxDepth 语义即建立在这个尺度上
 * （engine.js:368-378：depth < minDepth 跳过、depth > maxDepth 跳过）。
 */
export function messageDepth(total: number, index: number): number {
  return Math.max(0, total - index - 1)
}

/**
 * 步骤 1：正则 prompt 时机跑本批消息（user→USER_INPUT、assistant→AI_OUTPUT placement）。
 *
 * 【两种模式（2026-09-10 重写，TT 语义对齐）】
 * - `'persist'`：只跑 `markdownOnly === false && promptOnly === false` 的「通用」脚本
 *   （ST engine.js:357 的第三分支）。其结果会随 `decision.messages` 落 `user/message`
 *   耐久事件 —— 对应 ST 里写入 chat 数组的那类脚本，可以改变聊天记录本体。
 * - `'prompt'`：跑 `!markdownOnly` 的全部脚本（含 `promptOnly`）。**结果绝不落盘**，
 *   只在发往 LLM 的最终投影上生效（`llm/stream` 钩子内调用）—— 对应 ST
 *   `script.js:5282-5312` 的 `getRegexedStringBatchAsync(..., { isPrompt: true })`：
 *   TT 把结果写进**局部变量 `coreChat`**，从不回写 `chat`。
 *
 * 修复前：`promptOnly: true` 的脚本（如 Kemini 预设的「aether opus正则一」把用户输入
 * 包成 `<interactive_input>$1</interactive_input>`）在 pre-step 阶段就跑，结果经
 * `{...decision, messages: batch}` 被宿主落成 `user/message` 事件 → **聊天记录被污染**，
 * UI 气泡显示出 `<interactive_input>` 包装、且 `$1` 残留会永久写死。
 */
export function applyPromptRegexes(
  messages: LikeMessage[],
  scripts: RegexScript[],
  traceRegexHits: Array<{ scriptName: string; count: number }>,
  mode: 'persist' | 'prompt' = 'persist',
  macroCtx?: { user?: string; char?: string },
): LikeMessage[] {
  if (scripts.length === 0) return messages
  // persist 模式排除 promptOnly（其结果不该改变聊天记录本体）；prompt 模式全收。
  const pool = mode === 'persist' ? scripts.filter(s => s.promptOnly !== true) : scripts
  if (pool.length === 0) return messages
  // 【T-16 2026-09-11】substituteRegex 模式下 findRegex 要先做宏替换。此前**没有任何
  // 调用方注入该回调** → `substituteRegex: 1/2` 的分支是死代码（真实数据里全 0，
  // 故长期未被发现）。这里按 TT `resolveRegexString`（extensions/regex/engine.js:331-343）接上：
  //   RAW(1)     → substituteParams(findRegex)
  //   ESCAPED(2) → substituteParams(findRegex, {}, sanitizeRegexMacro)
  // 即 ESCAPED 的转义作用在**每个已解析宏的值**上（TT 的 postProcessFn 语义），
  // 不是对整串 findRegex 转义——后者会把用户的字面正则也一并毁掉。
  const regexCtx: RegexContext = {
    depth: null,
    ...(macroCtx === undefined ? {} : {
      substituteRegex: (raw: string, escaped: boolean): string =>
        expandTavernMacros(raw, {
          user: macroCtx.user ?? '用户',
          char: macroCtx.char ?? '角色',
          stableSeed: mode,
          postProcess: escaped ? sanitizeRegexMacro : undefined,
        }).text,
    }),
  }
  const total = messages.length
  return messages.map((m, idx) => {
    if (!Array.isArray(m.content)) return m
    const role = m.role === 'user' ? 'user' : m.role === 'assistant' ? 'assistant' : null
    if (role === null) return m // system/其他角色不经正则（ST 语义：正则作用于对话消息）
    const placement = role === 'user' ? PLACEMENT.USER_INPUT : PLACEMENT.AI_OUTPUT
    // TT 对照：depth 必须真实传入，否则 minDepth/maxDepth 过滤全失效（engine.appliesTo
    // 里 `depth === null` 直接 return true）。wuwa 预设「aether opus正则一」声明
    // maxDepth: 1（只作用于最新一条），此前因 depth 恒为 null 而作用于全部历史楼层。
    const depth = messageDepth(total, idx)
    let changed = false
    const content = m.content.map(block => {
      if (block.type !== 'text' || typeof block.text !== 'string') return block
      const r = runRegexScripts(pool, block.text, 'prompt', placement, { ...regexCtx, depth })
      if (r.hits.length > 0) {
        changed = true
        for (const h of r.hits) traceRegexHits.push({ scriptName: h.scriptName, count: h.count })
      }
      return { ...block, text: r.text }
    })
    return changed ? { ...m, content } : m
  })
}

/** 步骤 2+4：WI 激活条目 → 正则（WORLD_INFO placement）+ 宏求值 + 位置分桶 */
export function processActivatedEntries(
  activated: Array<{ entry: LoreEntry; reason: string }>,
  scripts: RegexScript[],
  macroCtx: MacroContext,
  traceRegexHits: Array<{ scriptName: string; count: number }>,
): {
  before: Array<{ comment: string; content: string; reason: string }>
  after: Array<{ comment: string; content: string; reason: string }>
  atDepth: Array<{ depth: number; role: string; content: string; comment: string }>
} {
  const macros = new MacroEngine()
  const before: Array<{ comment: string; content: string; reason: string }> = []
  const after: Array<{ comment: string; content: string; reason: string }> = []
  const atDepth: Array<{ depth: number; role: string; content: string; comment: string }> = []
  for (const a of activated) {
    // 正则（prompt 时机，WORLD_INFO placement——ST：WI 内容也过正则）
    const rr = runRegexScripts(scripts, a.entry.content, 'prompt', PLACEMENT.WORLD_INFO, { depth: null })
    for (const h of rr.hits) traceRegexHits.push({ scriptName: h.scriptName, count: h.count })
    // 宏（组装期求值，§4.1.1：WI 注入时 substituteParams）
    const mr = macros.evaluate(rr.text, macroCtx)
    const content = mr.text
    if (a.entry.position === 4) {
      atDepth.push({ depth: a.entry.depth, role: a.entry.role, content, comment: a.entry.comment })
    } else if (a.entry.position === 1) {
      after.push({ comment: a.entry.comment, content, reason: a.reason })
    } else {
      // position 0（顶部）与其余兜底进 BEFORE
      before.push({ comment: a.entry.comment, content, reason: a.reason })
    }
  }
  return { before, after, atDepth }
}

/** 步骤 3：深度注入 splice（depth N = 从批末尾往前数第 N 位之前插入；同深度 system→user→assistant 合并）。
 * 多深度必须从深到浅处理——浅的先插会让深度的锚点漂移。
 * 消息契约（DSH Message）：id + source 必填——缺 source 会在 turn 建立时读 source.kind 崩溃。 */
export function spliceDepthInjections(
  messages: LikeMessage[],
  atDepth: Array<{ depth: number; role: string; content: string }>,
): LikeMessage[] {
  if (atDepth.length === 0) return messages
  const out = [...messages]
  const roleRank: Record<string, number> = { system: 0, user: 1, assistant: 2 }
  const byDepth = new Map<number, typeof atDepth>()
  for (const inj of atDepth) {
    const list = byDepth.get(inj.depth) ?? []
    list.push(inj)
    byDepth.set(inj.depth, list)
  }
  for (const [depth, list] of [...byDepth.entries()].sort((a, b) => b[0] - a[0])) {
    list.sort((a, b) => (roleRank[a.role] ?? 0) - (roleRank[b.role] ?? 0))
    const merged = list.map(l => l.content).join('\n')
    const insertAt = Math.max(0, out.length - depth)
    const clean = neutralizeResidualMacros(merged)
    const injected = {
      role: 'user', // 同快照注入：rc.8 校验 user/message 的 role 必须 'user'
      content: [{ type: 'text', text: clean }],
      // 【⑧审查修复 2026-09-06】form:'snapshot' + 签名节：同签名旧副本被 planShadowOps
      // 影子化（原实现无 form，常驻条目每轮一份副本逐轮堆积在历史里）
      source: { kind: 'plugin', plugin: name, form: 'snapshot', sections: [{ name: `dsht-rp:wi-depth:${depth}`, text: clean }] },
      id: `dsht-rp-depth-${randomUUID()}`,
    } as unknown as LikeMessage
    out.splice(insertAt, 0, injected)
  }
  return out
}

// ---------------------------------------------------------------------------
// 变体组（§4.15）：replace 链分析与写入载荷构造（纯函数，可单测）
// ---------------------------------------------------------------------------

/** 一个 surface 位置上的变体组（历史 swipe 或运行时重 roll 的组） */
export interface VariantGroup {
  /** 组内全部变体事件（按生成序）：成员 i replace 成员 i-1（首个 append） */
  members: Array<{ seq: number; text: string }>
  /** 当前 active 的 seq */
  activeSeq: number
}

/**
 * 从 session 事件流重建变体组图：assistant/message 的 replace 链。
 * sourceEventSeqs[0] 即被替换的前驱——链式回溯成组；被替换下 surface 的是旧变体。
 *
 * 原始计数语义（T7b 结论，前端归一化方案的后端不变量）：append-only 日志里
 * 每次变体切换都是一条新 replace 事件并作为新成员入组——members 随滑动增长，
 * 是读模型的如实映射（sourceEventSeqs 始终单元素指向直接前驱，不重复累积）。
 * 前端 ‹n/m› 计数需按文本归一化（normalizeVariantGroups，dsht-rp-ui 侧）。
 */
export function collectVariantGroups(events: Array<{ type: string; seq: number; data?: unknown; surfaceOp?: unknown; sourceEventSeqs?: number[] }>): Map<number, VariantGroup> {
  const groups = new Map<number, VariantGroup>()
  const eventBySeq = new Map(events.map(e => [e.seq, e]))

  const textOf = (ev: { type: string; data?: unknown }): string => {
    if (ev.type === 'assistant/message') {
      const d = ev.data as { message?: { content?: Array<{ type: string; text?: string }> } }
      return (d?.message?.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('\n')
    }
    return ''
  }
  /** 加入成员（组内去重——新形态的 marker+append 会被多遍扫描看到） */
  const addMember = (anchor: number, memberSeq: number, active: number): void => {
    const prevGroup = groups.get(anchor)
    const text = textOf(eventBySeq.get(memberSeq) ?? { type: '', seq: memberSeq })
    if (prevGroup) {
      if (prevGroup.members.some(m => m.seq === memberSeq)) {
        // 同签名重复扫描：只前进 active（变体来回滑动时以最后一次切换为准）
        prevGroup.activeSeq = active
        return
      }
      prevGroup.members.push({ seq: memberSeq, text })
      prevGroup.activeSeq = active
      groups.set(memberSeq, prevGroup)
      return
    }
    const g: VariantGroup = {
      members: [
        { seq: anchor, text: textOf(eventBySeq.get(anchor) ?? { type: '', seq: anchor }) },
        { seq: memberSeq, text },
      ],
      activeSeq: active,
    }
    groups.set(anchor, g)
    groups.set(memberSeq, g)
  }
  /**
   * 把一组 **assistant 回复** 登记为变体组（阶段4 2026-09-11 新增）。
   *
   * 与 `addMember` 的区别：不假设「锚点本身就是一个成员」——回退/重生成标记的锚点
   * 通常是 **user** seq（甚至插件注入 seq），`textOf` 对非 assistant 恒返回 ''，
   * 于是 `addMember(hideAnchor, q, hideAnchor)` 会造出「首成员 text='' 且 active 就是它」
   * 的假变体组：前端 `variantOverride` 取到该 active 后把整层正文渲染成空白
   * （实机 floor #12 空白实证）。本函数只收 assistant seq，active 亦必为 assistant seq。
   */
  const addReplyGroup = (replySeqs: number[], active: number): void => {
    const seqs = [...new Set([...replySeqs, active])].sort((a, b) => a - b)
    if (seqs.length === 0) return
    const first = seqs[0]
    let g = groups.get(first)
    if (g === undefined) {
      g = { members: [{ seq: first, text: textOf(eventBySeq.get(first) ?? { type: '', seq: first }) }], activeSeq: active }
      groups.set(first, g)
    }
    for (const q of seqs) {
      if (!g.members.some(m => m.seq === q)) g.members.push({ seq: q, text: textOf(eventBySeq.get(q) ?? { type: '', seq: q }) })
      groups.set(q, g)
    }
    g.activeSeq = active
  }

  // ---- 形态 1（存量 0.1.2 会话）：assistant/message 自己做 replace 节点 + sourceEventSeqs 血缘 ----
  // 注：该形态在 0.1.5 已被官方禁止（见 session-write.ts），仅用于读旧会话。
  for (const ev of events) {
    if (ev.type !== 'assistant/message') continue
    const range = replaceRange(ev.surfaceOp)
    if (range === null) continue
    const prevSeq = ev.sourceEventSeqs?.[0] ?? range.start
    const prevGroup = groups.get(prevSeq)
    if (prevGroup) {
      prevGroup.members.push({ seq: ev.seq, text: textOf(ev) })
      prevGroup.activeSeq = ev.seq
      groups.set(ev.seq, prevGroup)
    } else {
      const g: VariantGroup = {
        members: [
          { seq: prevSeq, text: textOf(eventBySeq.get(prevSeq) ?? { type: '', seq: prevSeq }) },
          { seq: ev.seq, text: textOf(ev) },
        ],
        activeSeq: ev.seq,
      }
      groups.set(prevSeq, g)
      groups.set(ev.seq, g)
    }
  }

  // ---- 形态 2（0.1.5 起的新写法）：user/message 标记 replace 掉旧成员，紧随其后 append 新成员 ----
  // 标记载荷（sections 里的 dsht:surgical）给出 variantOf/scaledBackTo 等锚点。
  const assistantSeqs = events.filter(e => e.type === 'assistant/message').map(e => e.seq).sort((a, b) => a - b)
  for (const ev of events) {
    if (ev.type !== 'user/message') continue
    const range = replaceRange(ev.surfaceOp)
    if (range === null) continue
    const src = (ev.data as { source?: unknown } | undefined)?.source
    const marker = readMarker<{ variantOf?: number; shadowedSeqs?: number[]; rolledBackTo?: number; regeneratedFrom?: number }>(src, 'surgical')
    // 变体切换：下一个 assistant 即新 active；锚点 = 被移出的旧成员
    const anchor = marker?.variantOf ?? range.start
    const next = assistantSeqs.find(q => q > ev.seq)
    if (marker?.variantOf !== undefined && next !== undefined) {
      addMember(anchor, next, next)
    }
    // 回退/重生成标记遮蔽的旧回复也纳入组（否则切回旧回复报 "target not in any variant group"）
    // 【阶段4 2026-09-11 修复】原实现用 `addMember(hideAnchor, q, hideAnchor)`：hideAnchor
    // 是回退**锚点**，通常是 user seq（乃至插件注入 seq），不是 assistant 楼层 →
    // 首成员 text 恒 ''、active 也指向它 → 前端 variantOverride 把该层正文渲染成空白。
    // 改为：成员只收 assistant 楼层；active = 标记之后的下一条 assistant（有 = 用户已
    // 重新生成过，即新回复 = 新 active），没有则退回最后一条被遮蔽回复（此时组只剩 1 个
    // 有效成员，前端归一化会整组丢弃——没有可切换的语义就不该渲染变体条）。
    const legacy = readLegacySourceKeys(src)
    const hideAnchor = marker?.regeneratedFrom ?? legacy.regeneratedFrom
      ?? marker?.rolledBackTo ?? legacy.rolledBackTo
    if (hideAnchor === undefined) continue
    const shadowedReplies: number[] = []
    for (let q = range.start; q <= range.end; q++) {
      if (eventBySeq.get(q)?.type === 'assistant/message') shadowedReplies.push(q)
    }
    if (shadowedReplies.length === 0) continue
    addReplyGroup(shadowedReplies, next ?? shadowedReplies[shadowedReplies.length - 1])
  }
  return groups
}

/**
 * 助手楼层改写的落点规划——实现在 dsht-plugin-shared/session-write.ts
 * （三处消费：回退/编辑、TH 编辑、EJS 写回；在此 re-export 保持本模块公开面）。
 */
export { planAssistantRewrite } from '../dsht-plugin-shared/session-write.ts'

/**
 * 变体切换的 assistant 消息载荷（纯函数）。
 *
 * 【阶段3 2026-09-10 重写】原实现让 assistant/message 自己做 replace 节点 + 带
 * sourceEventSeqs 血缘——0.1.2 合法，**0.1.5 被官方双重禁止**（assistant/message
 * 不能带 sourceEventSeqs，且 replace 必须列全被遮蔽节点 → 带也错、不带也错）。
 * 新形态：变体切换 = user/message 标记（把旧变体移出上下文）+ 本 assistant 消息追加。
 */
export function buildVariantSwitchEvent(
  sessionId: string,
  nextSeq: number,
  activeSeq: number,
  targetText: string,
): {
  type: 'assistant/message'
  seq: number
  time: number
  data: { turn: number; step: number; stream: never[]; message: { id: string; role: 'assistant'; content: Array<{ type: 'text'; text: string }>; source: { kind: 'model'; provider: string; model: string } } }
  /** 追加到 surface 尾部（不再是 replace） */
  surfaceOp: 'append'
  /** 被移出上下文的旧变体 seq（写入标记用，不再进本事件信封） */
  shadowedActiveSeq: number
} | null {
  if (!targetText.trim()) return null
  return {
    type: 'assistant/message',
    seq: nextSeq,
    time: Date.now(),
    data: {
      // settlement 三件套（turn/step 由调用点按 planAssistantRewrite 覆写；
      // stream 必须为数组——缺它 = 会话冷启动直接打不开，详见 session-write.ts）
      ...assistantSettlement(1, 1),
      message: {
        id: `dsht-variant-${sessionId}-${nextSeq}`,
        role: 'assistant',
        content: [{ type: 'text', text: targetText }],
        source: { kind: 'model', provider: 'dsht-variant', model: 'user-switch' },
      },
    },
    surfaceOp: 'append',
    shadowedActiveSeq: activeSeq,
  }
}

/**
 * lore_query 搜索（T1.8 轻 agent 世界书深查）：条目名/关键词/内容全文匹配，
 * 返回前 maxEntries 条（内容截断）。纯函数可单测。
 */
export function searchLoreEntries(
  entries: LoreEntry[],
  query: string,
  opts: { maxEntries?: number; maxContentChars?: number } = {},
): string {
  const max = opts.maxEntries ?? 6
  const cut = opts.maxContentChars ?? 1200
  const q = query.trim().toLowerCase()
  if (!q) return 'Empty query.'
  const hits: Array<{ entry: LoreEntry; score: number }> = []
  for (const entry of entries) {
    const comment = (entry.comment ?? '').toLowerCase()
    const keys = entry.keys.map(k => k.toLowerCase()).join(' ')
    const content = entry.content.toLowerCase()
    let score = 0
    if (comment.includes(q)) score += 3
    if (keys.includes(q)) score += 5
    if (content.includes(q)) score += 1
    if (score > 0) hits.push({ entry, score })
  }
  if (hits.length === 0) {
    return `No worldbook entry matches "${query}". The lore may use different wording — try the exact name or term from the story.`
  }
  hits.sort((a, b) => b.score - a.score)
  const parts = hits.slice(0, max).map(({ entry }) => {
    const head = entry.comment ? `## ${entry.comment}` : `## (unnamed entry)`
    const keys = entry.keys.length > 0 ? `\nKeys: ${entry.keys.slice(0, 8).join(', ')}` : ''
    const body = entry.content.length > cut
      ? `${entry.content.slice(0, cut)}\n…(truncated, ${entry.content.length} chars total)`
      : entry.content
    return `${head}${keys}\n\n${body}`
  })
  return [
    `Worldbook query "${query}" — ${hits.length} match(es), showing ${Math.min(max, hits.length)}:`,
    '',
    ...parts,
  ].join('\n')
}

/** 从 cwd 提取 RP 工作区段（$DSH_HOME/rp/<slug> → slug；非 RP 返回 null）
 *  【F5 2026-09-14 单源化】实现已下沉到 dsht-plugin-shared/rp-workspace.ts——
 *  dsht-plugin-tavern-helper 也曾有一份本地复制（参数顺序不同），现已统一。
 *  此处重新导出以保持既有 import 面（本文件内 7 处调用 + 外部 1 处）。 */
export { rpSlugFromCwd }

// ---------------------------------------------------------------------------
// D-6（T-08 / T-12）：RP 会话的 agent 层工具修剪
// ---------------------------------------------------------------------------

/**
 * 该预设路径是否应**保留**工具。`false` = 修剪掉。
 *
 * 背景（D-7 抓包实证）：基准 TT 发给 LLM 的请求体**完全没有 `tools` 字段**，
 * 而 DSHT 带 **32 个**工具定义 + agent 说明书 —— 这是与基准的**唯一真差异**（D-6）。
 * RP 是纯对话场景，工具说明会与剧情描写抢注意力（历史样本里模型去查 worldbook 工具
 * 而不是直接推进剧情）。
 *
 * ⚠️ **不是一刀切**：`lightAgent`/`heavyAgent`/`agent` 三条路径的**设计前提就是有工具**
 * （见 `preset/demo.ts` 的 lightAgent 预设正文「先用 lore_query 工具查询世界书，再作答」）。
 * 把这三种也关掉，会让预设正文**指向不存在的工具** = 造出新的静默不一致（L42 家族）。
 * 故：默认（含无预设）与 `direct` 路径修剪；显式选了 agent 路径则尊重其设计。
 */
export function shouldStripRpTools(presetPath: string | null | undefined): boolean {
  return presetPath !== 'lightAgent' && presetPath !== 'heavyAgent' && presetPath !== 'agent'
}

/**
 * 从 assembly 摘除全部工具**及其使用说明 section**。
 *
 * 为什么必须成对摘（而不是只清 `tools`）：官方每个工具插件都注册了一段 `tool:<name>`
 * 使用说明（`dsh-tool-bash/lib/index.js:254-258`、`dsh-tool-fs`、`dsh-tool-goal` …）。
 * 只清 tools 会留下「查看 bash 结果的 [exit code: N]」这类**指向不存在工具**的系统指令
 * —— 那是把「多出来的污染」换成「自相矛盾的残留」，不比原来好（T-56 的「一组三件」同理）。
 *
 * 匹配规则：section 名 `tool:<name>` 且 `<name>` 确在被移除的工具里。**只删对得上的**
 * （自研 section 若保留工具则一并保留，不误伤同名前缀）。
 *
 * 返回**新对象**（不改入参，与 assemble 钩子里其它不可变重建同风格）。
 */
export function stripAssemblyTools(
  assembly: { tools?: unknown; sections?: unknown; [k: string]: unknown },
): { assembly: typeof assembly; removed: string[] } {
  const tools = Array.isArray(assembly.tools) ? assembly.tools : []
  const removed = tools
    .map(t => (t !== null && typeof t === 'object' ? String((t as { name?: unknown }).name ?? '') : ''))
    .filter(n => n.length > 0)
  if (removed.length === 0) return { assembly, removed }
  const removedSet = new Set(removed)
  const sections = Array.isArray(assembly.sections)
    ? assembly.sections.filter(s => {
        const name = s !== null && typeof s === 'object' ? String((s as { name?: unknown }).name ?? '') : ''
        return !(name.startsWith('tool:') && removedSet.has(name.slice('tool:'.length)))
      })
    : assembly.sections
  return { assembly: { ...assembly, tools: [], sections }, removed }
}

/** T3.1b 兜底：从 rp.json 可得的字段重建 ST V2 JSON（仅旧工作区无 card.json 时用） */
export function buildStV2FromRp(rp: RpWorkspace): string {
  const data: Record<string, unknown> = {
    name: rp.characterName,
    description: '',
    personality: '',
    scenario: '',
    first_mes: rp.firstMes ?? '',
    mes_example: '',
    creator_notes: '',
    system_prompt: '',
    post_history_instructions: '',
    alternate_greetings: [],
    tags: [],
    creator: '',
    character_version: '',
    extensions: {
      regex_scripts: Array.isArray(rp.regex) ? rp.regex : undefined,
    },
  }
  const root: Record<string, unknown> = { spec: 'chara_card_v2', spec_version: '2.0', data }
  return JSON.stringify(root, null, 1)
}

/** T3.1b：从 ST 卡 JSON 提取卡名（导出文件名用） */
export function rpNameFrom(json: string): string {
  try {
    const root = JSON.parse(json) as { data?: { name?: unknown }; name?: unknown }
    const name = root.data?.name ?? root.name
    if (typeof name === 'string' && name.trim()) return name.trim()
  } catch { /* 坏 JSON */ }
  return 'character'
}

// ---------------------------------------------------------------------------
// R0/R4：导入批次暂存 + API 配置导入（纯逻辑，可单测）
// ---------------------------------------------------------------------------

/** FNV-1a → base36 短哈希（批次 id 用）。
 *  【F5 2026-09-14 单源化】实现下沉到 dsht-plugin-shared/hash.ts。
 *  此前本仓有 **四处** 同算法实现（本处的 fnv36、import/dsh-export.ts 与
 *  preset/st-import.ts 各一份 hash36）——**改名复制**是复制里最恶劣的一类：
 *  同名判据抓不到它，而它正是「导入/导出对同一张卡算出不同 id」的土壤。
 *  现统一为 hash36（原名 fnv36 是历史叫法，语义相同，此处保留别名避免改动面）。 */
const fnv36 = hash36

/** 批次 id：时间戳 base36 + 文件名短哈希（rp-import/<batchId>/） */
export function makeBatchId(name: string, now: number = Date.now()): string {
  return `${now.toString(36)}-${fnv36(name)}`
}

/** batchId 合法性（防路径逃逸） */
export function isValidBatchId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,60}$/.test(id)
}

/**
 * rp 预设 id → DSH agent preset 目录名。
 * DSH discovery 只认 PRESET_ID（/^[a-z0-9][a-z0-9-]*$/）命名的目录；rp 预设 id
 * 允许 CJK/emoji/空格（UI 识别面，如「st-V1.4 [轻量] 狐狐~ 🦊-pqmfsq」）——
 * 不净化直同步的目录 discovery 直接跳过（R5 实测坑：st-* 永不入 agent preset 列表）。
 * fnv 短哈希后缀保证净化后唯一且稳定（幂等覆盖）。
 */
export function agentPresetDirId(presetId: string): string {
  const safe = presetId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/^-+|-+$/g, '')
  const base = safe === '' ? 'preset' : safe
  const head = /^[a-z0-9]/.test(base) ? base : `p-${base}`
  return `${head}-${fnv36(presetId).slice(0, 6)}`
}

/**
 * 解压 zip 到目标目录。返回解压文件数。
 * 性能路径（2026-09-04）：Android 上优先 busybox unzip 流式解压（子进程直接读
 * source.zip 文件，node 进程零大内存占用）——JSZip.loadAsync 要整包持有 + 逐
 * entry 在 V8 堆里解，505MB 级数据包在 4GB 手机/模拟器上 swap 抖动卡死（实测
 * 11087/14460 停滞 15 分钟）。PC/无 busybox 环境回退 JSZip（PC 内存充裕）。
 * 安全：busybox unzip 自带 zip-slip 防护（-d 目标约束）；回退路径跳过目录项、
 * 绝对路径与 .. 逃逸段；canonical 越界二次防御。
 */
export async function unpackZipTo(sourceZip: string, destDir: string): Promise<number> {
  const nativeLib = process.env.DSHT_NATIVE_LIB_DIR ?? ''
  if (nativeLib) {
    const busybox = join(nativeLib, 'libbusybox.so')
    try {
      await access(busybox)
      await mkdir(destDir, { recursive: true })
      await new Promise<void>((resolve, reject) => {
        const child = spawn(busybox, ['unzip', '-o', '-q', sourceZip, '-d', destDir],
          { stdio: ['ignore', 'ignore', 'pipe'] })
        let errTail = ''
        child.stderr?.on('data', (d: Buffer) => { errTail = (errTail + d.toString()).slice(-300) })
        child.on('error', reject)
        child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`busybox unzip exit ${code}: ${errTail}`)))
      })
      let count = 0
      const walk = async (dir: string): Promise<void> => {
        for (const d of await readdir(dir, { withFileTypes: true })) {
          const abs = join(dir, d.name)
          if (d.isDirectory()) await walk(abs)
          else count++
        }
      }
      await walk(destDir)
      console.log(`[dsht-rp] unpack: busybox unzip 流式完成（${count} 文件，node 零大内存占用）`)
      return count
    } catch (e) {
      console.warn(`[dsht-rp] busybox unzip 失败，回退 JSZip：${(e as Error).message}`)
    }
  }
  const zip = await JSZip.loadAsync(await readFile(sourceZip))
  const destRoot = resolve(destDir)
  let count = 0
  for (const [rel, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue
    const segs = rel.split('/').filter(s => s.length > 0)
    if (segs.length === 0 || segs.some(s => s === '.' || s === '..')) continue
    const abs = join(destDir, ...segs)
    if (!resolve(abs).startsWith(destRoot + sep)) continue
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, await entry.async('nodebuffer'))
    count++
  }
  return count
}

// findStDataRoot 移至 ./import-preview.ts（§4.16.1 预览/续跑纯逻辑层共用）——
// 上方 re-export 保持既有导入面（dsh-plugin.spec 等测试零改动）。

/**
 * R0：批次资源快速统计（import-stage 的 manifest；只看目录结构与轻量 JSON 头，不做完整解析——
 * 完整解析是适配 agent 的活）。st-data 批次按 ST 目录约定计数；raw 单文件批次按扩展名+JSON 头判型。
 */
export interface ImportManifest {
  kind: 'st-data' | 'single-card' | 'single-book' | 'unknown'
  cards: number
  books: number
  chats: number
  presets: number
  /** ST 数据根（相对 unpacked/ 的路径；raw 批次为 null） */
  stRoot: string | null
  /** raw 批次的单文件相对路径（inbox/<name>） */
  singleFile?: string
}

const countDirFiles = async (dir: string, match: (name: string) => boolean, depth = 2): Promise<number> => {
  let n = 0
  const walk = async (d: string, lv: number): Promise<void> => {
    if (lv > depth) return
    let entries: Array<{ name: string; isDirectory: () => boolean }>
    try { entries = await readdir(d, { withFileTypes: true }) as never } catch { return }
    for (const e of entries) {
      if (e.isDirectory()) { await walk(join(d, e.name), lv + 1); continue }
      if (match(e.name)) n++
    }
  }
  await walk(dir, 0)
  return n
}

export async function scanImportManifest(unpackedDir: string): Promise<ImportManifest> {
  const stRoot = await findStDataRoot(unpackedDir)
  if (stRoot) {
    const [cards, books, chats, presets] = await Promise.all([
      // 角色卡只计顶层文件（characters/<角色>/ 子目录是表情差分图，不是卡）
      countDirFiles(join(stRoot, 'characters'), n => /\.(png|json)$/i.test(n), 0),
      countDirFiles(join(stRoot, 'worlds'), n => /\.json$/i.test(n), 0),
      countDirFiles(join(stRoot, 'chats'), n => /\.jsonl$/i.test(n), 2),
      countDirFiles(join(stRoot, 'OpenAI Settings'), n => /\.json$/i.test(n) && !/\.luker-state\./i.test(n), 0),
    ])
    return { kind: 'st-data', cards, books, chats, presets, stRoot: relative(unpackedDir, stRoot).replaceAll(sep, '/') || '.' }
  }
  // raw 单文件批次（单卡/单书）：unpacked/inbox/<name>
  const inbox = join(unpackedDir, 'inbox')
  let names: string[] = []
  try { names = await readdir(inbox) } catch { /* 无 inbox */ }
  const file = names.find(n => /\.(png|json)$/i.test(n))
  if (!file) return { kind: 'unknown', cards: 0, books: 0, chats: 0, presets: 0, stRoot: null }
  let kind: ImportManifest['kind'] = 'unknown'
  if (/\.png$/i.test(file)) {
    kind = 'single-card'
  } else {
    // JSON 头判型：chara_card spec / data.name → 卡；entries → 世界书
    try {
      const head = (await readFile(join(inbox, file), 'utf8')).slice(0, 4096)
      if (/"spec"\s*:\s*"chara_card|"mes_example"\s*:|"first_mes"\s*:/.test(head)) kind = 'single-card'
      else if (/"entries"\s*:/.test(head)) kind = 'single-book'
    } catch { /* 读不了按 unknown */ }
  }
  return {
    kind,
    cards: kind === 'single-card' ? 1 : 0,
    books: kind === 'single-book' ? 1 : 0,
    chats: 0, presets: 0, stRoot: null,
    singleFile: `inbox/${file}`,
  }
}

/** ST secrets.json 条目取值：新版是 [{value, active}] 数组（active 优先），旧版是裸字符串 */
export function pickSecret(secrets: Record<string, unknown>, key: string): string | null {
  const raw = secrets[key]
  if (typeof raw === 'string') return raw.trim() || null
  if (Array.isArray(raw)) {
    const entries = raw.filter(e => e && typeof e === 'object') as Array<{ value?: unknown; active?: unknown }>
    const active = entries.find(e => e.active === true) ?? entries[0]
    const v = active?.value
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

/** R4：ST settings.json + secrets.json → DSH provider 配置（不依赖任何运行时，可单测） */
export interface StApiImport {
  /** DSH provider 路由名（llm-pi-ai providers 键） */
  provider: string
  /** 端点（custom/reverse proxy 时带） */
  baseURL?: string
  /** 模型 id */
  model: string
  /** 凭据引用名（POSIX shell 标识符） */
  keyRef: string
  /** 凭据值（日志一律不打印） */
  keyValue: string | null
  /** llm-pi-ai provider profile */
  profile: Record<string, unknown>
  /** 识别到的 ST 来源（chat_completion_source/main_api） */
  source: string
}

export function parseStApiConfig(settings: Record<string, unknown>, secrets: Record<string, unknown>): StApiImport | null {
  const oai = (settings.oai_settings && typeof settings.oai_settings === 'object'
    ? settings.oai_settings : {}) as Record<string, unknown>
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  // 主来源：chat_completion_source；缺失时 main_api=openai → openai chat completions
  const source = str(oai.chat_completion_source)
    || (str(settings.main_api) === 'openai' ? 'openai' : str(settings.main_api))
    || 'custom'

  let provider = 'st-custom'
  let baseURL: string | undefined
  let model = ''
  let keyName = 'api_key_custom'
  if (source === 'custom') {
    baseURL = str(oai.custom_url) || undefined
    model = str(oai.custom_model)
    keyName = 'api_key_custom'
  } else if (source === 'openai') {
    provider = 'openai'
    baseURL = str(oai.reverse_proxy) || undefined
    model = str(oai.openai_model)
    keyName = 'api_key_openai'
  } else if (source === 'deepseek') {
    provider = 'deepseek'
    model = str(oai.deepseek_model)
    keyName = 'api_key_deepseek'
  } else if (source === 'claude') {
    provider = 'anthropic'
    model = str(oai.claude_model)
    keyName = 'api_key_claude'
  } else {
    // 未识别来源：有 custom_url 就按 OpenAI 兼容端点处理
    baseURL = str(oai.custom_url) || str(oai.reverse_proxy) || undefined
    model = str(oai.custom_model) || str(oai.openai_model)
  }
  if (!model) return null

  const keyRef = `ST_${source.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
  const keyValue = pickSecret(secrets, keyName)
  // 非目录路由（st-custom）：必须显式声明协议与模型清单（llm-pi-ai 校验"可服务"）
  const profile: Record<string, unknown> = provider === 'st-custom'
    ? {
      apiKeyEnv: keyRef,
      displayName: `ST 迁移（${source}）`,
      api: 'openai-completions',
      ...(baseURL ? { baseURL } : {}),
      models: [{ id: model, name: model }],
    }
    : { apiKeyEnv: keyRef, ...(baseURL ? { baseURL } : {}) }
  return { provider, baseURL, model, keyRef, keyValue, profile, source }
}

// ---------------------------------------------------------------------------
// 插件主体
// ---------------------------------------------------------------------------

interface LoadedBook { entries: LoreEntry[] }

/** 把快照消息追加到 enter decision 批次（官方 runtime-context 同款位置：claimed 之后） */
function withSnapshot(decision: LikeDecision, snapshotText: string): LikeDecision {
  const snapshotMessage: LikeMessage = {
    role: 'user',
    content: [{ type: 'text', text: snapshotText }],
    source: {
      kind: 'plugin',
      plugin: name,
      form: 'snapshot',
      // sections 结构由官方 ContextFormed 契约定义（快照分节署名）
      sections: [{ name: 'dsht-rp:worldinfo', text: neutralizeResidualMacros(snapshotText) }],
    },
  }  ;(snapshotMessage as { id?: string }).id = `dsht-rp-${randomUUID()}`
  return { kind: decision.kind, messages: [...decision.messages, snapshotMessage] }
}

export function apply(ctx: LikeContext & { agents?: LikeAgentRegistry; sessions?: { get: (id: string) => LikeSession | undefined } }, _config: unknown): void {
  // DSH home 解析与官方 resolveDshHome 同优先级：$DSH_HOME > ~/
  // .dsh（Windows 上 os.homedir() 读 USERPROFILE 不读 HOME——Android 的
  // NodeService 与 PC 验证环境都设 DSH_HOME，两边一致）
  const envHome = process.env.DSH_HOME?.trim()
  const dshHome = envHome ? resolve(envHome) : join(homedir(), '.dsh')
  /** 快照去重：上次注入文本相同则跳过（官方 RuntimeContextProjection 同语义） */
  const retained = new WeakMap<LikeAgent, string>()
  /** 组装 trace（T1.5）：sessionId → 最近一轮 trace，/dsht-rp/trace 暴露 */
  const lastTrace = new Map<string, AssemblyTraceRuntime>()
  /** lore.json 缓存（路径 → 条目集；迁移数据不变，进程内缓存足够） */
  const bookCache = new Map<string, LoadedBook>()
  /** T2.8：全局正则缓存（$DSH_HOME/rp/regex/global.json；管理面板保存时失效） */
  let globalRegexCache: RegexScript[] | null = null

  /** 嵌入版导入中心静态资产（插件安装目录 assets/；index.js 在 lib/ 下 → ../assets/） */
  const readAsset = (name: string): string | null => {
    try {
      return readFileSync(new URL(`../assets/${name}`, import.meta.url), 'utf8')
    } catch {
      return null
    }
  }

  // ---- T-63：四个 ST 标准模块资产（ES module）----
  // 背景：卡（TH 同源形态）用 `import { promptManager, … } from './scripts/openai'` 这类
  // **静态** import 取用宿主模块；静态 import 是**原子**的 —— 任一符号取不到，整段模块脚本
  // 不执行。故这四个路径必须真的提供文件，**不得**塞空壳（空壳 = 假成功，比 404 更难查）。
  // 资产 = src/dsh-plugin/assets/st-modules/**（构建期同步进包）。
  const ST_MODULE_ASSETS: Record<string, string> = {
    ['/script.js']: 'st-modules/script.js',
    ['/scripts/utils.js']: 'st-modules/scripts/utils.js',
    ['/scripts/preset-manager.js']: 'st-modules/scripts/preset-manager.js',
    ['/scripts/openai.js']: 'st-modules/scripts/openai.js',
  }
  /**
   * 取 ST 标准模块资产；未命中返回 `null`（交给后续路由）。
   * 命中但资产缺失 → **真 404**（资产没进包 = 卡的 bootstrap 整段中断，必须显式暴露）。
   */
  const readStModule = (subPath: string): { code: number; body: string; type: string } | null => {
    if (!Object.prototype.hasOwnProperty.call(ST_MODULE_ASSETS, subPath)) return null
    const body = readAsset(ST_MODULE_ASSETS[subPath])
    if (body === null) {
      return { code: 404, body: subPath + ' not found (build assets)', type: 'text/plain' }
    }
    // ES module 必须给 JS MIME（否则浏览器拒绝执行）
    return { code: 200, body, type: 'text/javascript; charset=utf-8' }
  }
  console.log(`[dsht-rp] ST compat modules on webServer: ${Object.keys(ST_MODULE_ASSETS).join(', ')}`)
  /** 最近插件日志尾部（诊断面板用；环形缓存避免无限增长） */
  const pluginLogTail: string[] = []
  const logLine = (line: string): void => {
    pluginLogTail.push(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${line}`)
    if (pluginLogTail.length > 200) pluginLogTail.splice(0, pluginLogTail.length - 200)
  }

  // ---- I8-6（移动端鲁棒性）：live 会话登记 + 主动耐久通道。
  // Android onPause/onTrimMemory 无法直调 node 内部 → 壳侧写 $DSH_HOME/flush-request
  // 触发文件，本侧 1s 轮询消费后全量 flush；另加 5s 周期 flush 兜底（把 200ms 批写
  // 窗口的崩溃丢失风险收敛到 5s）。registerLiveSession 在 pre-step 登记活跃 session。
  const liveSessionRegistry = new Map<string, unknown>()
  const registerLiveSession = (sid: string, session: unknown): void => {
    if (sid) liveSessionRegistry.set(sid, session)
  }
  /** 【审查修复 2026-09-05】会话关闭/会话不可达时清理 registry（防止只增不减） */
  const pruneLiveSessionRegistry = (): void => {
    for (const [sid, session] of liveSessionRegistry) {
      const live = ctx.sessions?.get?.(sid)
      if (live === undefined || live !== session) liveSessionRegistry.delete(sid)
    }
  }
  const flushAllLiveSessions = async (reason: string): Promise<number> => {
    pruneLiveSessionRegistry()
    let ok = 0
    for (const [sid, session] of liveSessionRegistry) {
      try { if (await flushLiveSession(ctx.sessions, session)) ok++ } catch (e) {
        logLine(`flush-all(${reason}): ${sid} 失败：${(e as Error).message}`)
      }
    }
    return ok
  }
  const flushTimer = setInterval(() => { void flushAllLiveSessions('periodic') }, 5_000)
  flushTimer.unref?.()
  process.once('SIGTERM', () => { void flushAllLiveSessions('sigterm') })
  process.once('SIGINT', () => { void flushAllLiveSessions('sigint') })
  const flushRequestPath = join(dshHome, 'flush-request')
  let flushRequestBusy = false
  const flushRequestPoller = setInterval(() => {
    if (flushRequestBusy) return
    flushRequestBusy = true
    void stat(flushRequestPath).then(async () => {
      const n = await flushAllLiveSessions('android')
      try { await rm(flushRequestPath, { force: true }) } catch { /* 清理失败下次再删 */ }
      logLine(`flush-all(android): ${n} 个 live 会话已耐久`)
    }).catch(() => { /* 无触发文件 */ }).finally(() => { flushRequestBusy = false })
  }, 1_000)
  flushRequestPoller.unref?.()

  // ---- I8-7（观测）：coordinator 告警转发——持久化层的「background write ... failed
  // (buffered events retained)」/ seq gap 告警只进 stdout（Android 上仅 logcat 可见，
  // 插件日志页盲区）。同进程 = 拦 process.stdout/stderr 写入，命中告警样式即镜像进
  // logLine 环（诊断面板可见）。全局只装一次（插件重载不重复挂）。
  currentRuntimeLogLine = logLine
  const gStd = globalThis as { __dshtStdoutPatched?: boolean }
  if (!gStd.__dshtStdoutPatched) {
    gStd.__dshtStdoutPatched = true
    const COORD_RE = /background write .*failed|buffered events retained|seq gap|SessionPersistence|corrupt session log/i
    for (const streamName of ['stdout', 'stderr'] as const) {
      const stream = process[streamName] as { write?: (...args: unknown[]) => boolean } | undefined
      const orig = typeof stream?.write === 'function' ? stream.write.bind(stream) : null
      if (!orig || !stream) continue
      stream.write = (...args: unknown[]): boolean => {
        try {
          const s = typeof args[0] === 'string' ? args[0] : String(args[0] ?? '')
          if (COORD_RE.test(s)) currentRuntimeLogLine?.(`[runtime ${streamName}] ${s.trim().slice(0, 300)}`)
        } catch { /* 观测失败不影响原通道 */ }
        return orig(...args)
      }
    }
  }

  /** T2.11：数据面诊断（替代 Android getDiag 桥——node 侧直接汇总） */
  const diagSnapshot = async (): Promise<Record<string, unknown>> => {
    let workspaces = 0, skills = 0, sessions = 0
    try {
      const rpDir = join(dshHome, 'rp')
      const dirs = await readdir(rpDir).catch(() => [] as string[])
      for (const d of dirs) {
        try {
          if (JSON.parse(await readFile(join(rpDir, d, 'rp.json'), 'utf8'))) workspaces++
        } catch { /* 非工作区目录 */ }
      }
    } catch { /* 无 rp 目录 */ }
    try { skills = (await readdir(join(dshHome, 'skills')).catch(() => [] as string[])).length } catch { /* 无 */ }
    try { sessions = (await readdir(join(dshHome, 'sessions')).catch(() => [] as string[])).length } catch { /* 无 */ }
    return {
      state: 'RUNNING',
      portOpen: true,
      port: ctx.webServer?.host === '0.0.0.0' ? 'LAN' : 3080,
      dshHome,
      workspaces,
      skills,
      sessions,
      lastError: null,
      output: pluginLogTail.slice(-15),
    }
  }

  /** host 进程内 loopback /api 信封调用（import-kickoff 与 register-workspaces 回退路径共用） */
  // @adapt contract:wire.auth-cookie
  // 0.1.2 token 鉴权（dsh-client-connection fence）：/api RPC 全部要求 30 天签名
  // cookie（仅 index 的 ?token= 交换会种 cookie）——node 进程内 loopback 调用没有
  // 浏览器 cookie，不处理则 kickoff/续跑/编辑重发全 401（真机 v114 实证）。
  // 解法：inject 'connection' 拿 launchToken → 自走一次 token 交换（GET /?token=，
  // redirect manual）收 set-cookie 缓存 → hostRpc 全部带 Cookie 头；401 时清缓存
  // 重交换一次再试。旧版 DSH 无 fence：裸调照常（ensureAuthCookie 返回 null）。
  let authCookie: string | null = null
  const ensureAuthCookie = async (): Promise<string | null> => {
    if (authCookie !== null) return authCookie
    const conn = (ctx as { connection?: { browserAuth?: { launchToken?: string } } }).connection
    const token = conn?.browserAuth?.launchToken
    console.log(`[dsht-rp] auth-cookie: launchToken=${token === undefined || token === null ? 'absent' : 'present'}(${String(token ?? '').length})`)
    if (!token) return null
    const port = ctx.webServer?.port ?? 3080
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`, { redirect: 'manual' })
      const sc = resp.headers.get('set-cookie') ?? ''
      const seg = sc.split(';')[0]?.trim() ?? ''
      console.log(`[dsht-rp] auth-cookie: exchange status=${resp.status} set-cookie=${sc === '' ? 'EMPTY' : `${sc.length}ch`}`)
      authCookie = seg.includes('=') ? seg : null
    } catch (e) {
      console.log(`[dsht-rp] auth-cookie: exchange failed: ${(e as Error).message}`)
      authCookie = null
    }
    return authCookie
  }
  const hostRpc = async (method: string, p: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const port = ctx.webServer?.port ?? 3080
    // @adapt contract:wire-api.method-slash
    // 0.1.2 坑 #21：wire 契约变更——method 斜杠式 + payload 包 {args}（与客户端 dshRpc 同步修）
    const wire = method.replace(/\./g, '/')
    const doFetch = async (cookie: string | null): Promise<Response> => fetch(`http://127.0.0.1:${port}/api/${wire}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie !== null ? { cookie } : {}) },
      // @adapt contract:wire-api.payload-args
      body: JSON.stringify({ type: 'client-request', rpcId: `dsht-hostrpc-${Date.now()}-${randomUUID().slice(0, 8)}`, method: wire, payload: { args: p } }),
    })
    let cookie = await ensureAuthCookie()
    let resp = await doFetch(cookie)
    if (resp.status === 401 && cookie !== null) {
      authCookie = null // cookie 失效（进程重启换 token/过期）→ 重交换一次
      cookie = await ensureAuthCookie()
      resp = await doFetch(cookie)
    }
    // 【心跳 47】同款 `as typeof body` 自引用：初始化式里 `typeof body` 退化为 `{}`，
    // 于是 `body.result` 的类型保护失效（这是 RPC 直调路径）。改显式命名类型。
    interface RpcEnvelope { result?: { ok: boolean; value?: Record<string, unknown>; error?: { code?: string; message?: string } } }
    const text = await resp.text()
    let body: RpcEnvelope = {}
    try { body = JSON.parse(text) as RpcEnvelope } catch {
      throw new Error(`${method}: HTTP ${resp.status} ${text.slice(0, 80)}`)
    }
    if (!body.result || body.result.ok === false) {
      const e = new Error(body.result?.error?.message ?? `${method} failed`) as Error & { code?: string }
      e.code = body.result?.error?.code
      throw e
    }
    return body.result.value ?? {}
  }

  /** WorkspaceRegistry 进程内直取（cordis 全局服务存储；web profile 与 host 同进程）。不可用返回 null → 回退 hostRpc */
  const getWorkspaceRegistry = (): LikeWorkspaceRegistry | null => {
    try {
      const get = (ctx as unknown as { get?: (name: string) => unknown }).get
      const reg = typeof get === 'function' ? get.call(ctx, 'workspaceRegistry') : undefined
      if (reg !== null && typeof reg === 'object'
        && typeof (reg as LikeWorkspaceRegistry).create === 'function'
        && typeof (reg as LikeWorkspaceRegistry).resolveByPath === 'function'
        && typeof (reg as LikeWorkspaceRegistry).list === 'function') {
        return reg as LikeWorkspaceRegistry
      }
    } catch { /* 服务未挂载（PC 验证环境/非 web profile） */ }
    return null
  }

  /** 扫 $DSH_HOME/sessions/<projectKey>/<sid>/session.jsonl 首行 header（实现抽至共享模块 session-surgery.ts） */
  const scanSessionHeaders = () => scanSessionHeadersShared(dshHome)

  // ---- 任务 1：会话内文件快照（dsh-tavern nativeCommits 思路；共享模块 file-snapshots.ts）----
  /** 写前快照：无 session 上下文（全局设置类拿不到锚点）跳过快照；快照失败不阻塞写操作 */
  const snapshotRpFiles = async (sessionId: string, relPaths: string[]): Promise<void> => {
    if (!sessionId || relPaths.length === 0) return
    try {
      const r = await snapshotBeforeWrite(dshHome, sessionId, relPaths)
      if (r.snapshotted > 0) console.log(`[dsht-rp] file snapshot: ${sessionId} turn=${r.anchor} +${r.snapshotted} files`)
    } catch { /* 快照失败不阻塞写操作 */ }
  }
  /** 会话归属解析：slug 工作区名下的会话（多个取 session.jsonl mtime 最新者）；无 → '' */
  const sessionIdForSlug = async (slug: string): Promise<string> => {
    let best = ''
    let bestMtime = -1
    for (const h of await scanSessionHeaders()) {
      if (rpSlugFromCwd(h.cwd, dshHome) !== slug) continue
      try {
        const m = (await stat(h.file)).mtimeMs
        if (m > bestMtime) { best = h.sessionId; bestMtime = m }
      } catch { /* 无 session.jsonl */ }
    }
    return best
  }
  /** 最近活跃的 RP 会话（全局设置类写操作的归属锚点；无 → ''） */
  const latestRpSessionId = async (): Promise<string> => {
    let best = ''
    let bestMtime = -1
    for (const h of await scanSessionHeaders()) {
      const slug = rpSlugFromCwd(h.cwd, dshHome)
      if (slug === null || slug === '_start') continue
      try {
        const m = (await stat(h.file)).mtimeMs
        if (m > bestMtime) { best = h.sessionId; bestMtime = m }
      } catch { /* 无 session.jsonl */ }
    }
    return best
  }

  /** 最近活跃的迁移适配会话（cwd 以 rp-import/_adapter 结尾；checkpoint 写前快照的归属锚点；无 → ''） */
  const latestAdapterSessionId = async (): Promise<string> => {
    let best = ''
    let bestMtime = -1
    for (const h of await scanSessionHeaders()) {
      // cwd 可能是 /data/user/0 symlink 形态——只比后缀，不比对绝对形态
      const cwd = (h.cwd ?? '').replaceAll(sep, '/')
      if (!cwd.endsWith('rp-import/_adapter')) continue
      try {
        const m = (await stat(h.file)).mtimeMs
        if (m > bestMtime) { best = h.sessionId; bestMtime = m }
      } catch { /* 无 session.jsonl */ }
    }
    return best
  }

  /**
   * 存量 session cwd 规范化（两种形态 → 绝对且 realpath 规范）。
   *  ① `/data/user/0/…` symlink 形态 → realpath
   *  ② 相对路径（如 `rp/_start`）→ 相对 $DSH_HOME 解析后 realpath
   * 幂等：只处理 sessionCwdNeedsRepair 命中的 header；live session 跳过（目录搬迁会
   * 拔掉它的落盘句柄）；projectKey 变化时先搬目录再改首行（assertStoredIdentity 契约）。
   */
  const repairSessionCwds = async (): Promise<Record<string, unknown>> => {
    const repaired: Array<{ sessionId: string; from: string; to: string; moved: boolean }> = []
    const skipped: Array<{ sessionId: string; reason: string }> = []
    const errors: string[] = []
    const headers = await scanSessionHeaders()
    for (const h of headers) {
      if (!sessionCwdNeedsRepair(h.cwd)) continue
      if (ctx.sessions?.get(h.sessionId) !== undefined) {
        skipped.push({ sessionId: h.sessionId, reason: 'live（下次未挂载时重跑）' })
        continue
      }
      try {
        // 相对 cwd 以 $DSH_HOME 为基准解析（历史引导会话写的 `rp/_start`）；
        // 绝对形态直接 realpath（symlink → 规范）。realpath 失败（目录不存在）保留原值。
        const resolved = isAbsolute(h.cwd) ? h.cwd : resolve(dshHome, h.cwd)
        const canonical = await realpath(resolved).catch(() => resolved)
        if (canonical === h.cwd) continue
        const newLine = rewriteSessionHeaderCwd(h.firstLine, canonical)
        if (newLine === null) continue
        const root = join(dshHome, 'sessions')
        const targetProject = projectKey(canonical)
        let moved = false
        if (targetProject !== h.project) {
          const targetDir = join(root, targetProject, h.sdir)
          let exists = true
          try { await stat(targetDir) } catch { exists = false }
          if (exists) {
            errors.push(`${h.sessionId}: 目标目录已存在（${targetProject}/${h.sdir}），未动`)
            continue
          }
          await mkdir(join(root, targetProject), { recursive: true })
          await rename(join(root, h.project, h.sdir), targetDir)
          moved = true
        }
        // 整读单文件只发生在命中的少数待修复会话上；首行替换，事件行原样保留。
        // 【鲁棒轮收尾】原子发布 + .bak 备份（repairAllSessionSeqs 同款规范）——原裸
        // writeFile 中途被杀 = torn 日志，会话打不开。
        // 【心跳 61 修复 · 严重】原为 `join(root, targetProject, h.sdir, 'session.jsonl')`
        // —— **硬编码文件名**。0.1.5 世代起会话日志是 `session.v3.jsonl`（`session.jsonl`
        // 作为 v0 历史世代被冻结保留、目录里根本不存在），于是 readFile 抛 ENOENT，
        // 而此时**目录已经 rename 走了** ⇒ 落成半修复态：目录名 = projectKey(规范 cwd)、
        // header.cwd 仍是 symlink 形态 ⇒ **违反官方 assertStoredIdentity 强不变量**
        // （目录名必须 == projectKey(header.cwd)）＝ 会话打不开/丢失级；且因目录已搬走，
        // 下一轮 targetProject === h.project 不再搬迁，只剩同一个 ENOENT ⇒ **永不收敛**。
        // 修法：用扫描器已经算好的当前世代绝对路径 `h.file` 取 basename（scanner 侧
        // `pickCurrentSessionFilename` 早已做对；`SessionHeaderHit.file` 的文档也明写
        // 「读侧一律用这个，不要自己拼 session.jsonl」——这条约束此前只写在注释里）。
        // 抽到 `relocatedSessionLogPath` 是为了让这条约束**可单测**（session-generation.spec.ts）。
        const sessionPath = relocatedSessionLogPath(root, targetProject, h.sdir, h.file)
        const full = await readFile(sessionPath, 'utf8')
        const nl = full.indexOf('\n')
        await atomicWriteFile(`${sessionPath}.bak`, full)
        await atomicWriteFile(sessionPath, newLine + (nl === -1 ? '' : full.slice(nl)))
        repaired.push({ sessionId: h.sessionId, from: h.cwd, to: canonical, moved })
      } catch (e) {
        errors.push(`${h.sessionId}: ${(e as Error).message}`)
      }
    }
    if (repaired.length > 0 || errors.length > 0) {
      logLine(`repair-session-cwd: 修复 ${repaired.length}，跳过 ${skipped.length}，失败 ${errors.length}`)
      console.log(`[dsht-rp] repair-session-cwd: repaired=${repaired.length} skipped=${skipped.length} errors=${errors.length}`)
    }
    // 【心跳 61 修复】逐会话留痕。此前只记**计数**——设备实测 `errors=1`，
    // 但"哪个会话、什么错"在 logcat 里查不到（只能调 /rp/repair-session-cwd 才拿得到
    // errors 数组），一个真实的数据一致性缺陷就这么以"errors=1"的形状挂在启动日志里。
    // 姊妹函数 repairAllSessionSeqs 在心跳 49 已因同型问题改成"跳过/失败都留具体 id + 原因"
    // ——本条是那次修复的漏网（L86 同族：有意 ≠ 可以静默；有计数 ≠ 可定位）。
    for (const r of repaired) {
      logLine(`repair-session-cwd: 修复 ${r.sessionId} —— ${r.from} → ${r.to}${r.moved ? '（已搬迁目录）' : ''}`)
    }
    for (const e of errors) logLine(`repair-session-cwd: 失败 ${e}`)
    // 失败**额外**打一条 console.log（→ logcat）：`logLine` 只进内存环形缓冲（/rp/log 才读得到），
    // 而 `errors` 是"数据一致性已经坏了"的信号 —— 本次正是靠它才发现
    // 「目录已搬走、header.cwd 没改」这条会把 node 打成 crash-loop 的半修复态。
    // 只对 errors 开 logcat 通道（正常路径零噪声），与"有意 ≠ 可以静默"同一条纪律。
    for (const e of errors) console.log(`[dsht-rp] repair-session-cwd: 失败 ${e}`)
    return { scanned: headers.length, repaired, skipped, errors }
  }

  /**
   * 存量 session seq 断号修复（/rp/repair-sessions；register-workspaces 顺带调用）。
   * 扫 sessions/<project>/<sid>/session.jsonl 校验 committed 区 seq 连续性；断号的重编号
   * （repairSessionSeqs），修复前备份 .bak。幂等：连续的直接短路。
   * live session 跳过（内存态权威，落盘文件可能被 flush 覆盖回断号态）。
   */
  // 实测：rp-import 工作区的 agent 迁移会话能长到 254MB——整读+split+逐行 parse+重建
  // 需要 3-4 倍内存，Android node 堆直接 OOM（启动即修循环崩）。超大文件跳过自动修复
  //（import 工作区会话 seq 断号不影响聊天打开）。
  //
  // 【阶段 3 2026-09-10 修正】原上限 8MiB 定得太低，**误伤了真实聊天会话**：设备实测
  // `st-asm3yf`（8.66MiB，ST 导入的 RP 会话）被跳过 → 其 assistant/message 的 replace 链
  // 未拆分，0.1.5 下仍打不开（`chunk provenance is not one complete ordered attempt`）。
  // 现值 32MiB 的依据（本机实测，/tmp/mem-probe.mjs）：
  //   · 修复器峰值堆 ≈ **7.2 × 文件体积**（9.64MiB → 77MiB；62.3MiB → 448MiB）
  //   · Android node `--max-old-space-size=2048`（NodeService.kt:553）
  //   → 32MiB 文件峰值 ≈ 230MiB，占堆上限 11%，安全；254MB 的 import 怪物仍被挡在外面。
  const REPAIR_MAX_FILE_BYTES = 32 * 1024 * 1024
  /**
   * 只读会话**首行**取身份，用于超限跳过时的留痕（L42：有意跳过也必须能定位到具体对象）。
   *
   * 动机（2026-09-11 心跳 50，设备实证）：设备上唯一超限的文件是
   * `sessions/--…rp-import-_adapter--/64e580f0-…/session.jsonl`（62.3MiB），
   * 首行是 `{"type":"session","origin":"subagent","agentPreset":"dsht-adapter",
   * "parentSession":"session-5a1b4508-…"}` —— 它是**一次性 ST 预设导入管线的子代理会话**，
   * 不是用户聊天。旧日志只写「文件 62.3MiB 超 32MiB 上限，跳过自动修复」，
   * 用户/排查者看到后**无法区分**"我自己的聊天坏了"还是"一个内部产物被跳过"。
   *
   * 纪律：**只读 4KiB**（header 是单行 JSON，远小于此），绝不为了写一行日志把 62MiB 拉进内存
   * ——那正是本上限要避免的事。读不出/首行超长 → 返回空串，**退回旧行为**（不猜）。
   */
  const readSessionIdentity = async (file: string): Promise<string> => {
    let fh: Awaited<ReturnType<typeof open>> | null = null
    try {
      fh = await open(file, 'r')
      const buf = Buffer.alloc(4096)
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
      const firstLine = buf.subarray(0, bytesRead).toString('utf8').split('\n')[0] ?? ''
      const h = JSON.parse(firstLine) as { type?: unknown; origin?: unknown; agentPreset?: unknown }
      if (h.type !== 'session') return ''
      const origin = typeof h.origin === 'string' ? h.origin : 'chat'
      const preset = typeof h.agentPreset === 'string' ? `，agentPreset=${h.agentPreset}` : ''
      const who = origin === 'chat' ? '用户聊天会话' : `**非用户聊天**（${origin}）`
      return `｜origin=${origin}${preset} → ${who}`
    } catch { return '' } finally {
      if (fh !== null) await fh.close().catch(() => undefined)
    }
  }
  const repairAllSessionSeqs = async (): Promise<Record<string, unknown>> => {
    const repaired: Array<{ sessionId: string; events: number; normChanged: number; v3Changed: boolean; salvaged?: number }> = []
    const skipped: Array<{ sessionId: string; reason: string }> = []
    const errors: string[] = []
    const headers = await scanSessionHeaders()
    for (const h of headers) {
      if (ctx.sessions?.get(h.sessionId) !== undefined) {
        skipped.push({ sessionId: h.sessionId, reason: 'live（关闭会话后重跑）' })
        continue
      }
      const file = h.file
      try {
        const st = await stat(file)
        if (st.size > REPAIR_MAX_FILE_BYTES) {
          const identity = await readSessionIdentity(file)
          skipped.push({ sessionId: h.sessionId, reason: `文件 ${(st.size / 1048576).toFixed(1)}MiB 超 ${REPAIR_MAX_FILE_BYTES / 1048576}MiB 上限${identity}，跳过自动修复` })
          continue
        }
        const content = await readFile(file, 'utf8')
        // 三重修复：
        //  ① seq 断号修复（I8-4：回绕截尾/单调重编号）
        //  ② 快照消息角色归一化（rc.8 冷启动校验要求 user/message 的 role === 'user'）
        //  ③【阶段3 2026-09-10】v0→v3 迁移合法性修复——0.1.5 的两处破坏性契约收紧
        //    （surfaceOp start/end→startSeq/endSeq；assistant/message 禁止做 replace 节点）
        //    外加存量写入习惯留下的 8 类不合规（缺 id / source 自定义键 / 信封 source /
        //    prune 端点 / turn-step 状态机 / 聚合行 seq 冲突 / header cwd 非绝对）。
        //    实测：设备 80 个真实会话里 41 个因此打不开；本步把它们全部救回且内容无损。
        const norm = normalizeSnapshotMessageRoles(content)
        const v3 = repairSessionForV3(norm.content)
        const r = repairSessionSeqs(v3.content)
        if (r.error) { errors.push(`${h.sessionId}: ${r.error}`); continue }
        // 【2026-09-11 修复】原守卫写作 `norm.changed === 0 && v3.changed === 0`，但
        // `v3.changed` 是 **boolean** → `false === 0` 恒为 false → 守卫永不成立 →
        // **每次启动重写全部 79 个会话**（~200MB 无效写入 + 79 个 .bak / 136MB 堆积）。
        // 改走带类型谓词，类型不匹配时 tsc 直接报错（TS2367），不再靠人眼。
        if (!sessionRepairNeedsWrite(norm.changed, v3.changed, r.repaired)) continue
        // 【2026-09-10 回归事故防呆闸】官方 persistence `assertStoredIdentity` 要求
        // 物理路径恒等于 logPath(root, cwd, id)，即**目录名必须 == projectKey(header.cwd)**。
        // 本函数只该改事件、不该改 header.cwd；一旦某次「顺手」的 header 改写把 cwd 换了
        // （事故实证：相对 cwd `rp/_start` 被补成绝对路径，而目录仍叫 `--rp-_start--`），
        // 会话就变成「目录名与 cwd 不符」的形态：DSH 下次列 header 即抛
        // `corrupt session log ... header id ... and cwd identify ...`，整个 plugin tree
        // 加载失败、node 退出码 1 无限重启；实测还伴随**会话文件在核心搬迁中丢失**。
        // 故落盘前做最后一道闸：cwd 改变导致 projectKey 不匹配 → 拒绝写入并如实报错。
        const outCwd = sessionHeaderCwd(r.content)
        if (outCwd !== null && projectKey(outCwd) !== h.project) {
          errors.push(`${h.sessionId}: 修复后 cwd 与目录身份不符（projectKey=${projectKey(outCwd)} 目录=${h.project}），拒绝落盘（须走 repairSessionCwds 的搬迁路径）`)
          continue
        }
        // I8-2：原子写 + I8-3：.bak 先耐久再发布正文件
        await atomicWriteFile(`${file}.bak`, content)
        await atomicWriteFile(file, r.content)
        // 【阶段3 2026-09-10】source 上摘下来的自定义键（thData/thSystem 等）落 sidecar。
        // 不落盘 = 静默丢数据（TH 楼层附加数据 / 飞讯记录映射就读不回来了）。
        if (v3.salvaged.length > 0) {
          const table: Record<string, ThFloorRecord> = {}
          for (const s of v3.salvaged) {
            const rec = table[s.key] ?? {}
            for (const [k, val] of Object.entries(s.payload)) {
              if (k === 'thData') rec.data = val
              else if (k === 'thSystem' && val === true) rec.system = true
              else rec.legacy = { ...(rec.legacy ?? {}), [k]: val }
            }
            table[s.key] = rec
          }
          const n = mergeSalvagedThFloors(dshHome, h.sessionId, table)
          console.log(`[dsht-rp] repair-sessions(salvage): ${h.sessionId} ${n} 个楼层的 source 扩展键已迁入 sidecar`)
        }
        repaired.push({
          sessionId: h.sessionId,
          // 【心跳 47 修复】原为 `r.events + norm.changed + v3.changed` —— `norm.changed` 是
          // **number**、`v3.changed` 是 **boolean**（session-repair.ts:56），运行时靠 `true → 1`
          // 隐式转换"凑合能跑"，把一个「事件总数」字段污染成「事件数 + 0/1 + 0/1」。
          // 这正是 L14 记录过的同型缺陷（布尔当计数）。类型闸门一开即报 TS2365。
          // 现在各归其位：events 就是事件总数，改动量单独记字段（消费方只用 repaired.length，
          // 无人读 events，故不构成下游兼容风险）。
          events: r.events,
          normChanged: norm.changed,
          v3Changed: v3.changed,
          salvaged: v3.salvaged.length,
        })
        if (v3.changed) console.log(`[dsht-rp] repair-sessions(v3): ${h.sessionId} ${v3.notes.join('；')}`)
        if (r.note) console.log(`[dsht-rp] repair-sessions: ${h.sessionId} ${r.note}${r.truncated ? `（truncated=${r.truncated}）` : ''}`)
      } catch (e) {
        errors.push(`${h.sessionId}: ${(e as Error).message}`)
      }
    }
    // 【心跳 49】原条件 `repaired>0 || errors>0` 会让「只跳过、没修也没错」的场景**完全不出日志**
    // —— 设备实测 `scanned 80 repaired 0 skipped 2` 正是这种：日志一行没有，看起来像"什么都没发生"。
    // 跳过是**有意行为**（见上方 live / 超限注释），但**有意 ≠ 可以静默**：目标会话被跳过时
    // 用户看到的是"打开就红字"，而日志里零线索。故：只要有跳过就出日志，并按原因归类计数。
    if (repaired.length > 0 || errors.length > 0 || skipped.length > 0) {
      const byReason = new Map<string, number>()
      for (const s of skipped) {
        const key = s.reason.startsWith('live') ? 'live'
          : s.reason.startsWith('文件 ') ? '超上限' : s.reason
        byReason.set(key, (byReason.get(key) ?? 0) + 1)
      }
      const detail = skipped.length > 0
        ? `，跳过 ${skipped.length}（${[...byReason].map(([k, v]) => `${k}×${v}`).join(' / ')}）`
        : ''
      logLine(`repair-sessions: 修复 ${repaired.length}${detail}，失败 ${errors.length}`)
      console.log(`[dsht-rp] repair-sessions: repaired=${repaired.length} skipped=${skipped.length} errors=${errors.length}${skipped.length ? ` skippedReason=${JSON.stringify(Object.fromEntries(byReason))}` : ''}`)
      // 被跳过的**具体会话 id** 也要留痕（否则"哪个会话没修上"仍然查不到）。
      for (const s of skipped) logLine(`repair-sessions: 跳过 ${s.sessionId} —— ${s.reason}`)
    }
    return { scanned: headers.length, repaired, skipped, errors }
  }

  /**
   * 任务 2 存量迁移（幂等；register-workspaces 顺带调用）：
   * 扫 .agent-presets/rp-*（角色卡 preset 旧形态），对每个目录：
   * 1. 对应工作区 rp/<目录名>/rp.json 缺 promptPersona 时，从 agent.cordis.yml 抽出
   *    persona 正文写进 rp.json.promptPersona（preset 目录名 = 工作区 slug，同一 dshSlug 产物）；
   * 2. 删除该 preset 目录——**除非有会话在用**：DSH 冷恢复会按 session log 解析出的
   *    preset id 重新挂载（api-proxy agentFor → composeAgent(resolveSessionPreset) →
   *    presets.resolve 抛 UnknownPresetError = agent-preset-not-found，会话打不开），
   *    被引用的目录保留并在返回里如实列出。
   * 在用判定：session.jsonl 首行 header 的 agentPreset 字段（agent-preset/selected 事件
   * 在日志体里，首行扫不到——RP 会话从不切 agent preset，header 即全部，够用）。
   */
  const migrateCardAgentPresets = async (): Promise<Record<string, unknown>> => {
    const migrated: string[] = []
    const removed: string[] = []
    const keptInUse: string[] = []
    const errors: string[] = []
    const inUse = new Set<string>()
    for (const h of await scanSessionHeaders()) {
      try {
        const header = JSON.parse(h.firstLine) as { agentPreset?: unknown }
        if (typeof header.agentPreset === 'string') inUse.add(header.agentPreset)
      } catch { /* 非 JSON 首行 */ }
    }
    let dirs: string[] = []
    try { dirs = await readdir(join(dshHome, '.agent-presets')) } catch { return { migrated, removed, keptInUse, errors } }
    for (const d of dirs.sort()) {
      if (!d.startsWith('rp-')) continue
      try {
        const rpPath = join(dshHome, 'rp', d, 'rp.json')
        let rp: Record<string, unknown> | null = null
        try { rp = JSON.parse(await readFile(rpPath, 'utf8')) as Record<string, unknown> } catch { /* 无对应工作区 */ }
        if (rp !== null && rp.schemaVersion === 1 && typeof rp.promptPersona !== 'string') {
          let persona: string | null = null
          try {
            persona = extractPersonaTextFromAgentYml(await readFile(join(dshHome, '.agent-presets', d, 'agent.cordis.yml'), 'utf8'))
          } catch { /* 无 agent.cordis.yml */ }
          if (persona) {
            rp.promptPersona = persona
            await writeFile(rpPath, JSON.stringify(rp, null, 1), 'utf8')
            migrated.push(d)
          }
        }
        if (inUse.has(d)) {
          keptInUse.push(d) // 会话引用未断：保留（删了重挂会炸 agent-preset-not-found）
          continue
        }
        await rm(join(dshHome, '.agent-presets', d), { recursive: true, force: true })
        removed.push(d)
      } catch (e) {
        errors.push(`${d}: ${(e as Error).message}`)
      }
    }
    if (migrated.length + removed.length + keptInUse.length > 0 || errors.length > 0) {
      logLine(`卡 preset 迁移: promptPersona 回填 ${migrated.length}，删除 ${removed.length}，在用保留 ${keptInUse.length}，失败 ${errors.length}`)
      console.log(`[dsht-rp] card preset migration: migrated=${migrated.length} removed=${removed.length} keptInUse=${keptInUse.length} errors=${errors.length}`)
    }
    return { migrated, removed, keptInUse, errors }
  }

  /** T2.8：全局作用域正则（ST global_scripts 对应物）。无文件 = 空集。 */
  const loadGlobalRegex = (signal: AbortSignal): RegexScript[] => {
    if (globalRegexCache !== null) return globalRegexCache
    try {
      signal.throwIfAborted()
      // 同步读（首启一次）：小文件；失败静默空集
      const text = readFileSync(join(dshHome, 'rp', 'regex', 'global.json'), 'utf8')
      const parsed = JSON.parse(text) as { scripts?: RegexScript[] }
      globalRegexCache = Array.isArray(parsed.scripts) ? parsed.scripts : []
    } catch {
      globalRegexCache = []
    }
    return globalRegexCache
  }

  /** T2.3：已提取状态的 assistant 消息 id（避免多 step turn 对同一消息重复提取/重复应用 delta） */
  const stateSeen = new Set<string>()

  /** C-5 护栏：已警告过「RP 会话误入 st-preset 预设模式」的会话（每进程每会话一次，防刷屏） */
  const presetModeWarned = new Set<string>()

  /** T2.8：三源正则合并（ST getRegexScripts 语义）——全局 + 角色（rp.json.regex）+
   * 预设（rp-presets/<id>/regex.json；会话当前 presetId，无选中则空）。disabled 项排除。 */
  const presetRegexCache = new Map<string, RegexScript[]>()
  const loadPresetRegex = async (presetId: string, signal: AbortSignal): Promise<RegexScript[]> => {
    const cached = presetRegexCache.get(presetId)
    if (cached) return cached
    const out: RegexScript[] = []
    try {
      signal.throwIfAborted()
      const text = await readFile(join(dshHome, 'rp-presets', presetId, 'regex.json'), 'utf8')
      const parsed = JSON.parse(text) as { scripts?: RegexScript[] }
      if (Array.isArray(parsed.scripts)) out.push(...parsed.scripts)
    } catch { /* 无文件或坏文件 = 空集 */ }
    presetRegexCache.set(presetId, out)
    return out
  }

  // ---- ST 激活预设默认绑定（预设 display/prompt 正则生效的前提）----
  // ST 语义：「当前激活预设」全局生效，不按聊天绑定。导入的会话从未显式绑预设
  //（presetId 空）→ 预设正则/预设注入全哑火（悬浮球/思维链美化全在预设 display
  // 正则里）。默认源 = 最近导入批次 settings.json 的 oai_settings.preset_settings_openai
  //（导出时 ST 的激活预设名），按 displayName 匹配 rp-presets。会话显式选择恒优先。
  let activeStPresetCache: string | null | undefined
  const resolveActiveStPresetId = async (): Promise<string | null> => {
    if (activeStPresetCache !== undefined) return activeStPresetCache
    activeStPresetCache = null
    try {
      const batches = (await readdir(join(dshHome, 'rp-import'))).filter(isValidBatchId).sort().reverse()
      let activeName = ''
      for (const b of batches) {
        const dir = join(dshHome, 'rp-import', b)
        let stRoot = 'data/default-user'
        try {
          const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as { manifest?: { stRoot?: unknown } }
          if (typeof meta.manifest?.stRoot === 'string' && meta.manifest.stRoot) stRoot = meta.manifest.stRoot
        } catch { /* 无 meta 用默认 */ }
        let text = ''
        try { text = await readFile(join(dir, 'unpacked', stRoot, 'settings.json'), 'utf8') } catch { continue }
        const name = (JSON.parse(text) as { oai_settings?: { preset_settings_openai?: unknown } })
          .oai_settings?.preset_settings_openai
        if (typeof name === 'string' && name.trim()) { activeName = name.trim(); break }
      }
      if (activeName) {
        const dirs = await readdir(join(dshHome, 'rp-presets'))
        for (const id of dirs.sort()) {
          try {
            const p = JSON.parse(await readFile(join(dshHome, 'rp-presets', id, 'preset.json'), 'utf8')) as { displayName?: unknown }
            if (p.displayName === activeName) { activeStPresetCache = id; break }
          } catch { /* 坏 preset.json 跳过 */ }
        }
        if (activeStPresetCache) console.log(`[dsht-rp] ST 激活预设默认绑定：${activeName} → ${activeStPresetCache}`)
      }
    } catch { /* rp-import/rp-presets 不存在 = 无默认 */ }
    return activeStPresetCache
  }

  /** 会话有效预设 = 显式选择 ?? ST 激活预设默认（prompt 组装、正则合并、/preset/state 共用） */
  const resolveSessionPresetId = async (sessionId: string): Promise<string | null> => {
    const st = await loadSessionState(sessionId)
    if (typeof st.presetId === 'string' && st.presetId) return st.presetId
    return resolveActiveStPresetId()
  }

  // ---- 【管线切换 2026-09-20】预设内容注入的所有权判定 ----
  // bychv/dsh-preset-enhance 绑定启用的会话：预设内容（relative + depth 条目）统一由其
  // llm/stream 编译承担（不落会话日志、每轮现算——架构上比我方 pre-step 快照干净），
  // 我方两个注入点（assemble relative 段 / withPresetLayer depth 段）一律跳过。
  // 否则同一预设被两条管线各注一遍（模拟器双注实证：scripts/emu-preset-rp-verify.mjs）。
  // 注意边界：D-3 槽位（状态/角色卡/记忆/表格）、D-6 工具修剪、采样落地、预设正则
  // **不动**——它们不是 bychv 的承担面（bychv 没有对应物）。
  // 判据来源 = $DSH_HOME/preset-enhance/state.json 的 bindings[sid].enabled（解析纯函数
  // 归 dsht-plugin-shared/preset-ownership.ts，本处只做文件读取与 mtime 摊销缓存——
  // assemble 每 step 一次，state.json 含全量预设可能上 MB）。
  let bychvBindCache: { mtimeMs: number; enabled: ReadonlySet<string> } | null = null
  const bychvPresetOwned = async (sessionId: string): Promise<boolean> => {
    try {
      const p = join(dshHome, 'preset-enhance', 'state.json')
      const st = await stat(p)
      if (!bychvBindCache || bychvBindCache.mtimeMs !== st.mtimeMs) {
        const j = JSON.parse(await readFile(p, 'utf8')) as unknown
        bychvBindCache = { mtimeMs: st.mtimeMs, enabled: enabledPresetBindings(j) }
      }
      return bychvBindCache.enabled.has(sessionId)
    } catch {
      return false // 文件不存在/坏 JSON = bychv 未启用过，我方管线照常
    }
  }

  const mergedRegex = async (rp: RpWorkspace, signal: AbortSignal, sessionId: string): Promise<RegexScript[]> => {
    const global = loadGlobalRegex(signal)
    const scoped = rp.regex ?? []
    const presetId = await resolveSessionPresetId(sessionId)
    const preset = presetId ? await loadPresetRegex(presetId, signal) : []
    return [...global, ...preset, ...scoped].filter(s => !s.disabled)
  }

  // ---- T2.7：RP 预设体系（组装层关注点——session 内随时切换）----
  // 内置示范（demo.ts 编译内联）+ 用户预设（$DSH_HOME/rp-presets/<id>/preset.json）
  const builtinPresets: RPPreset[] = [demoDirectPreset(), demoLightAgentPreset()]
  const presetCache = new Map<string, RPPreset>()

  /** 全部预设（内置 + 用户文件；presetId 唯一化：内置前缀 builtin/） */
  const listPresets = async (signal: AbortSignal): Promise<RPPreset[]> => {
    const out = [...builtinPresets]
    try {
      signal.throwIfAborted()
      const dirs = await readdir(join(dshHome, 'rp-presets'))
      for (const id of dirs.sort()) {
        try {
          const text = await readFile(join(dshHome, 'rp-presets', id, 'preset.json'), 'utf8')
          const p = JSON.parse(text) as RPPreset
          if (p?.schemaVersion === 1 && p.id) out.push(p)
        } catch { /* 坏 preset.json 跳过 */ }
      }
    } catch { /* 无目录 */ }
    return out
  }

  const resolvePreset = async (presetId: string, signal: AbortSignal): Promise<RPPreset | null> => {
    const cached = presetCache.get(presetId)
    if (cached) return cached
    const all = await listPresets(signal)
    const hit = all.find(p => p.id === presetId) ?? null
    if (hit) presetCache.set(presetId, hit)
    return hit
  }

  /** 会话 RP 状态（$DSH_HOME/rp/state/<sessionId>.json）：presetId + MVU 状态变量树（T2.3） */
  interface SessionRpState { presetId?: string; state?: Record<string, unknown>; variables?: Record<string, unknown>; cursor?: number; loreTimed?: TimedEffect[]; mvuExtractSeq?: number; lastExtract?: { ts: number; scanned: number; patches: number; applied: boolean } }
  // 形状保留键（与 dsht-plugin-mvu 的分权契约一致）；一个都没有 = 历史扁平 MVU 树。
  // E1/E11 补：sheets/sheetHistory/tablesMigrated（表格系统新键）与 tables/tableData
  // （ST 1.0 旧键，loadSheets 迁移源）都不是 MVU 变量——入保留集防被误判成扁平变量树
  const STATE_RESERVED_KEYS = new Set(['presetId', 'state', 'variables', 'variableSchema', 'cursor', 'loreTimed', 'sheets', 'sheetHistory', 'tablesMigrated', 'tables', 'tableData'])
  const loadSessionState = async (sessionId: string): Promise<SessionRpState> => {
    try {
      const s = JSON.parse(await readFile(join(dshHome, 'rp', 'state', `${sessionId}.json`), 'utf8')) as SessionRpState
      if (s.state !== undefined && (s.state === null || typeof s.state !== 'object')) s.state = undefined
      // 兼容历史扁平文件（rebuild-chats 曾把 chat_metadata.variables 裸树直写文件根）：
      // 整树视作 variables（MVU 变量），/state 路由与状态摘要经 variables 兜底消费
      if (s && typeof s === 'object' && !Object.keys(s).some(k => STATE_RESERVED_KEYS.has(k))) {
        return { variables: s as Record<string, unknown> }
      }
      return s
    } catch {
      return {}
    }
  }

  const saveSessionState = async (sessionId: string, state: SessionRpState): Promise<void> => {
    await mkdir(join(dshHome, 'rp', 'state'), { recursive: true })
    // 【鲁棒轮 2026-09-09】字段级 merge 写——rp/state/<sid>.json 多写方共享（本插件 cursor/
    // presetId/loreTimed、dsht-plugin-memory sheets、MVU variables/state）。原实现整文件
    // 覆写：pre-step 在 t0 读入 → 用户 t1 切预设（写 presetId）→ pre-step t2 用 t0 旧树
    // 整文件写回 → presetId 静默丢失（下一轮回落默认预设）。改为保存前重读最新盘面合并
    // （本次写入的键优先），其余键保留最新值；原子写防撕裂。
    const path = join(dshHome, 'rp', 'state', `${sessionId}.json`)
    let merged: Record<string, unknown> = state as unknown as Record<string, unknown>
    try {
      const latest = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
      if (latest && typeof latest === 'object' && !Array.isArray(latest)) {
        merged = { ...latest, ...state }
      }
    } catch { /* 首写/读失败 → 整树写 */ }
    await atomicWriteText(path, JSON.stringify(merged))
  }

  /**
   * ⑧（2026-09-06 预设机制完整移植）：预设内容不再拍平成尾部 user 快照 blob。
   * - relative 条目（depth==null 的 system/configSummary/skillRef，prompt_order 保序）
   *   → system-prompt/assemble 瀑布进 request.system 顶部（ST relative 位置语义；
   *   UI「系统提示词」气泡直接可见——预设生效的用户可验证证据）；
   * - depth 条目（jailbreak 类）→ pre-step 真深度 splice（ST in-chat 注入语义）；
   * - marker/state 槽（卡文本/状态摘要）→ 下方 withStateSnapshot/withPersonaSnapshot
   *   尾部快照带承担（每轮动态内容，进 system 会让 request/header 每轮重写 + 缓存全废）。
   * 宿主硬约束：decision.messages 全部落 user/message 事件，restore 校验 role 必须 'user'
   * （assertMessageEventShape）——per-entry role 分配无法经消息通道移植，system 字段是唯一
   * 顶部通道；采样参数经 agent/request 瀑布落地（temperature/maxTokens/stop/reasoningEffort，
   * 宿主适配器仅透传此四键）。
   */

  // ---- P1#6 双轴分离：能力轴运行时权威判定（对照 dsh-agent-rp agent-capability-preset.ts
  // agentHasAgentRpRuntime L48 的双重判定——session header 的 agentPreset id + 组合源码
  // 特征；serviceFor 探测对我们不适用：能力轴挂的是宿主层按 scope 分层的 skill 注册表，
  // 组内无预设私有服务可探，见 compiler.ts isDshtRpAgentComposition 头注）----
  // 内容轴（上方快照注入）不依赖本探测结果；探测只做一次性可观测性提示，失败静默。
  const capabilityAxisSeen = new WeakMap<LikeAgent, string>()
  const probeCapabilityAxis = async (agent: LikeAgent, preset: RPPreset): Promise<void> => {
    const agentPreset = readHeaderAgentPreset(agent.session)
    const key = `${preset.id}@${agentPreset ?? ''}`
    if (capabilityAxisSeen.get(agent) === key) return
    capabilityAxisSeen.set(agent, key)
    try {
      const presets = ctx.get?.('agentPresets') as { read?: (id: string) => Promise<string> } | undefined
      const source = agentPreset && typeof presets?.read === 'function'
        ? await presets.read(agentPreset)
        : undefined
      if (source !== undefined && isDshtRpAgentComposition(source)) {
        console.log(`[dsht-rp] P1#6 双轴：内容轴「${preset.displayName}」× 能力轴 agent preset「${agentPreset}」组合生效（preset-* 技能块可调用）`)
        return
      }
      console.log(`[dsht-rp] P1#6 双轴：agent 型预设「${preset.displayName}」仅内容轴生效；技能块（skills/preset-*）需 DSH agent 预设选择「${agentPresetDirId(preset.id)}」（或保留 preset-capability 组的派生预设）才可被模型调用`)
    } catch { /* 探测失败不影响内容轴注入 */ }
  }

  /** T2.3：状态摘要快照消息（stateSummary 槽位的组装层填充） */
  const withStateSnapshot = (decision: LikeDecision, summary: string): LikeDecision => {
    const m: LikeMessage = {
      role: 'user', // rc.8 冷启动校验：user/message 的 role 必须 'user'（同 persona 快照注释）
      content: [{ type: 'text', text: neutralizeResidualMacros(summary) }],
      source: { kind: 'plugin', plugin: name, form: 'snapshot', sections: [{ name: 'dsht-rp:state', text: neutralizeResidualMacros(summary) }] },
    }    ;(m as { id?: string }).id = `dsht-rp-state-${randomUUID()}`
    return { kind: decision.kind, messages: [...decision.messages, m] }
  }

  /** 状态摘要快照去重（影子化豁免最新副本后跳过安全） */
  const retainedState = new WeakMap<LikeAgent, string>()

  /** 任务 2：卡设定快照消息（取代 .agent-presets/rp-* 的 persona 插件注入） */
  const withPersonaSnapshot = (decision: LikeDecision, text: string): LikeDecision =>
    ({ kind: decision.kind, messages: [...decision.messages, buildPersonaSnapshotMessage(text)] })

  /** 卡设定快照去重（影子化豁免最新副本后跳过安全） */
  const retainedPersona = new WeakMap<LikeAgent, string>()

  /** 长期记忆快照消息（user 席快照，sections 署名 dsht-rp:memory） */
  const withMemorySnapshot = (decision: LikeDecision, text: string): LikeDecision => {
    const m: LikeMessage = {
      role: 'user', // rc.8 冷启动校验：user/message 的 role 必须 'user'（同 persona 快照注释）
      content: [{ type: 'text', text: neutralizeResidualMacros(text) }],
      source: { kind: 'plugin', plugin: name, form: 'snapshot', sections: [{ name: 'dsht-rp:memory', text: neutralizeResidualMacros(text) }] },
    }    ;(m as { id?: string }).id = `dsht-rp-memory-${randomUUID()}`
    return { kind: decision.kind, messages: [...decision.messages, m] }
  }

  /** 长期记忆快照去重（影子化豁免最新副本后跳过安全） */
  const retainedMemory = new WeakMap<LikeAgent, string>()

  /** E3：表格快照消息（user 席快照，sections 署名 dsht-memory:tables；st-memory-enhancement 表格注入同位） */
  const withTablesSnapshot = (decision: LikeDecision, text: string): LikeDecision => {
    const m: LikeMessage = {
      role: 'user', // rc.8 冷启动校验：user/message 的 role 必须 'user'（同记忆快照注释）
      content: [{ type: 'text', text: neutralizeResidualMacros(text) }],
      source: { kind: 'plugin', plugin: name, form: 'snapshot', sections: [{ name: 'dsht-memory:tables', text: neutralizeResidualMacros(text) }] },
    }    ;(m as { id?: string }).id = `dsht-memory-tables-${randomUUID()}`
    return { kind: decision.kind, messages: [...decision.messages, m] }
  }

  /** E3：表格快照去重（同 retainedMemory 样例） */
  const retainedTables = new WeakMap<LikeAgent, string>()

  // ---- D-3：system 槽位发布器（pre-step 写、assemble 读）----
  // 为什么需要跨 hook 传递：`agent.ts:230` assemble 先于 `agent.ts:233` pre-step 执行，
  // 而角色卡/世界书/记忆/状态树的内容都在 pre-step 里算（那里能拿到会话态与快照去重）。
  // 因此 pre-step 把"本轮该进 system 的正文"发布到本表，assemble 下一 step 读走。
  // 时序无害：内容在 turn 内是常量快照（同 retainedState 系列的去重语义），
  // 首个 step 用上一轮的同内容副本，等价；turn 内任何 step 的 system 都一致。
  const slotPublished = new WeakMap<LikeAgent, SlotBatch>()

  /**
   * D-3 开关：把系统级 RP 内容从 `user` 席位迁到 `system` 槽位。
   * 默认开（对齐 TT）；`$DSH_HOME/rp/slot-routing-OFF` 存在时关闭（回滚通道，
   * 用于 A/B 对照与线上排障——不依赖改代码即可回到旧行为）。
   */
  const SLOT_ROUTING = !existsSync(join(dshHome, 'rp', 'slot-routing-OFF'))

  /** 发布本轮 system 槽位内容（pre-step 调用）。按 name 合并——pre-step 的
   *  世界书分支与 withPresetLayer 分支分头发布，覆盖式会让后发布者吃掉前者
   *  （实机踩过：世界书 24,221ch 被丢，slot=2 只剩角色卡+状态树）。 */
  const publishSlots = (agent: LikeAgent, sections: SlotSection[]): void => {
    if (!SLOT_ROUTING) return
    const prev = slotPublished.get(agent)?.sections ?? []
    const byName = new Map(prev.map(s => [s.name, s]))
    for (const s of sections) byName.set(s.name, s)
    slotPublished.set(agent, { sections: [...byName.values()] })
  }

  // ---- 任务 1：快照宏展开（真运行期语义，替代"全角化了事"）----
  // 与 preset/compiler.ts neutralizePromptVariables 的职责分工见 dsht-plugin-shared/macros.ts 头注：
  // 中性化只管"写进 DSH persona 插件的文本"（防爆 turn）；这里的 {{…}} 由宏引擎真求值。
  const loadVarScopeTree = async (scope: 'global' | 'character' | 'chat', slug: string, sid: string): Promise<Record<string, unknown>> => {
    try {
      if (scope === 'global') {
        const p = JSON.parse(await readFile(join(dshHome, 'rp', 'variables', 'global.json'), 'utf8'))
        return p && typeof p === 'object' && !Array.isArray(p) ? p as Record<string, unknown> : {}
      }
      if (scope === 'character') {
        const p = JSON.parse(await readFile(join(dshHome, 'rp', slug, 'variables.json'), 'utf8'))
        return p && typeof p === 'object' && !Array.isArray(p) ? p as Record<string, unknown> : {}
      }
      const p = JSON.parse(await readFile(join(dshHome, 'rp', 'state', `${sid}.json`), 'utf8'))
      const v = (p as { variables?: unknown })?.variables
      return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
    } catch {
      return {} // 无文件/坏 JSON = 空树
    }
  }

  /**
   * 快照文本宏展开：getvar 按 chat > character > global 读；setvar 写回 chat 作用域
   *（rp/state/<sid>.json 的 variables 键）并进 undo 日志（任务 4 回滚联动）。
   */
  const expandSnapshotMacros = async (text: string, rp: RpWorkspace, slug: string, sid: string): Promise<string> => {
    if (!text.includes('{{')) return text
    try {
      const identity = await resolveIdentity(dshHome, slug)
      const globalVars = await loadVarScopeTree('global', '', '')
      const charVars = slug ? await loadVarScopeTree('character', slug, '') : {}
      const chatVars = sid ? await loadVarScopeTree('chat', '', sid) : {}
      const r = expandTavernMacros(text, {
        user: identity.user || rp.macros.user || '用户',
        char: identity.char || rp.macros.char,
        persona: identity.persona,
        getVar: path => readVarPath(chatVars, path) ?? readVarPath(charVars, path) ?? readVarPath(globalVars, path),
        stableSeed: sid ? `rp-${sid}` : `rp-${slug}`,
      })
      if (r.writes.length > 0) {
        // 【T-22 2026-09-11】按 write.scope 分流：{{setglobalvar}} 族显式标 'global'，
        // 必须落到 rp/variables/global.json —— 不能因为「当前有 sid」就写进会话树
        //（否则全局变量随会话各自为政，跨会话读不到）。
        const globalWrites = r.writes.filter(w => w.scope === 'global')
        const chatWrites = r.writes.filter(w => w.scope !== 'global')
        if (globalWrites.length > 0) {
          const globalFile = join(dshHome, 'rp', 'variables', 'global.json')
          let gtree: Record<string, unknown> = {}
          try {
            const parsed = JSON.parse(await readFile(globalFile, 'utf8'))
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) gtree = parsed as Record<string, unknown>
          } catch { /* 新全局变量文件 */ }
          const gUndo = []
          for (const w of globalWrites) {
            gUndo.push(makeUndoEntry('global', '', w.path, gtree))
            gtree = writeVarPath(gtree, w.path, w.value)
          }
          if (sid) await appendUndoEntries(dshHome, sid, gUndo)
          await mkdir(dirname(globalFile), { recursive: true })
          await writeFile(globalFile, JSON.stringify(gtree), 'utf8')
        }
        if (chatWrites.length > 0 && sid) {
          const stateFile = join(dshHome, 'rp', 'state', `${sid}.json`)
          let whole: Record<string, unknown> = {}
          try {
            const parsed = JSON.parse(await readFile(stateFile, 'utf8'))
            if (parsed && typeof parsed === 'object') whole = parsed as Record<string, unknown>
          } catch { /* 新会话状态文件 */ }
          let vars = (whole.variables && typeof whole.variables === 'object' && !Array.isArray(whole.variables)
            ? whole.variables : {}) as Record<string, unknown>
          const undoSeq = []
          for (const w of chatWrites) {
            undoSeq.push(makeUndoEntry('chat', '', w.path, vars))
            vars = writeVarPath(vars, w.path, w.value)
          }
          await appendUndoEntries(dshHome, sid, undoSeq)
          whole.variables = vars
          await mkdir(dirname(stateFile), { recursive: true })
          await writeFile(stateFile, JSON.stringify(whole), 'utf8')
        }
      }
      let out = r.text
      // E8：表格宏（{{tableData}}/{{tablePrompt}}/{{GET::表名:行:列}}）——st-memory-enhancement
      // 表格宏语义，用当前会话 sheets 渲染替换；只在快照求值链路做（不改全局宏引擎），
      // 文本含宏才读 sheets（避免每轮多一次状态文件 IO）
      if (/\{\{\s*(?:tableData|tablePrompt|GET::)/i.test(out)) {
        // 【心跳 47】独立 try：表格宏取不到 sheets 时**只跳过表格宏**，
        // 不得连带放弃整段宏展开（外层 catch 会 `return text`，把 {{user}}/{{char}} 等全丢）。
        try {
          const { sheets } = await loadSheets(dshHome, sid)
          out = expandTableMacros(out, sheets)
        } catch (e) {
          console.log(`[dsht-rp] 表格宏跳过（sheets 读取失败，其余宏照常展开）：${(e as Error).message}`)
        }
      }
      if (r.unknownMacros.length > 0) {
        console.log(`[dsht-rp] macro expand: writes=${r.writes.length} unknown=${r.unknownMacros.length}（原样保留）`)
      }
      return out
    } catch (e) {
      console.log(`[dsht-rp] macro expand skipped: ${(e as Error).message}`)
      return text // 展开失败不阻塞：原文注入
    }
  }

  /**
   * **唯一的卡正文处置入口**（T-79）。卡正文有两条互斥注入路径 ——
   * `gatherSlotSections` 的 system 槽位、pre-step 的尾部快照 —— 两者都必须经此函数。
   * **不得在注入点各写一份处置逻辑**（同语义多副本 = 假修；单测有守卫）。
   *
   * 流程：宏引擎展开 → `guardCardContent`（越权标记消毒 + 残留宏转义 + nonce 围栏）→ 命中出声。
   * 处置必须在宏引擎**之后**：此刻残留的 `{{…}}` 必为未知宏（合法宏已展开成角色名/变量值），
   * 故整体全角化不会误伤 `{{char}}` / `{{getvar::…}}` 这类 Tier 1 功能。
   *
   * @param personaRaw 卡正文原文（**未**展开宏）
   * @param kind 处置面标识（'character' 槽位 / 'snapshot' 尾部快照；用于 nonce 缓存与出声去重）
   * @returns 可直接注入的文本（已围栏）
   */
  const renderGuardedCardText = async (
    personaRaw: string, rp: RpWorkspace, slug: string, sid: string, kind: 'character' | 'snapshot',
  ): Promise<string> => {
    const expanded = await expandSnapshotMacros(personaRaw, rp, slug, sid)
    if (!expanded) return expanded
    // 同内容复用 nonce（内容指纹变则重掷）：避免「每次 assemble 新 nonce」造成逐步 system 抖动
    const cacheKey = `${slug}|${kind}|${expanded.length}|${expanded.slice(0, 64)}`
    const nonce = cardFenceNonces.get(cacheKey) ?? newCardNonce()
    cardFenceNonces.set(cacheKey, nonce)
    const g: CardGuardResult = guardCardContent(expanded, { nonce })
    if (totalHits(g.hits) > 0) {
      // 出声按「slug|kind|命中摘要」去重（同一张卡的同一处越权标记只报一次，不刷屏）
      const reportKey = `${slug}|${kind}|${g.hits.chatml}|${g.hits.inst}|${g.hits.roleLine}|${g.hits.residualMacros}`
      if (!cardFenceReported.has(reportKey)) {
        cardFenceReported.add(reportKey)
        console.warn(
          `[dsht-rp] 卡正文防护降级（T-79，不静默）：${slug}/${kind} ` +
          `越权标记 chatml=${g.hits.chatml} inst=${g.hits.inst} roleLine=${g.hits.roleLine}；` +
          `未知宏残留=${g.hits.residualMacros} 样本=${JSON.stringify(g.hits.residualSamples)}`,
        )
      }
    }
    return g.text
  }

  const loadRpJson = async (slug: string, signal: AbortSignal): Promise<RpWorkspace | null> => {
    try {
      signal.throwIfAborted()
      const text = await readFile(join(dshHome, 'rp', slug, 'rp.json'), 'utf8')
      const parsed = JSON.parse(text) as RpWorkspace
      if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.books)) {
        console.log(`[dsht-rp] rp.json invalid: ${slug}`)
        return null
      }
      return parsed
    } catch (e) {
      console.log(`[dsht-rp] rp.json load failed (${slug}): ${(e as Error).message}`)
      return null
    }
  }

  /** ⑧ 条件槽运行期求值（§4.4 声明的落地）：state/variables 树按 path 取值比较 */
  const evalSlotCondition = (cond: CompiledSlot['condition'], stateTree: Record<string, unknown>): boolean => {
    if (!cond) return true
    const val = cond.path.split('.').reduce<unknown>((o, k) => (o !== null && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), stateTree)
    if (cond.exists === true && val === undefined) return false
    if (cond.exists === false && val !== undefined) return false
    if (cond.equals !== undefined && val !== cond.equals) return false
    if (cond.notEquals !== undefined && val === cond.notEquals) return false
    return true
  }

  /** ⑧ 预设机制移植的共享解析：agent → RP 工作区 + 有效预设（assemble/request 瀑布与 pre-step 共用） */
  const resolveAgentPreset = async (agent: LikeAgent): Promise<{ slug: string; rp: RpWorkspace; preset: RPPreset; sessionId: string } | null> => {
    try {
      const slug = rpSlugFromCwd(readSessionCwd(agent.session), dshHome)
      if (!slug) return null
      const rp = await loadRpJson(slug, new AbortController().signal)
      if (!rp) return null
      const sessionId = readHostSessionId(agent.session)
      const presetId = sessionId ? await resolveSessionPresetId(sessionId) : await resolveActiveStPresetId()
      if (!presetId) return null
      const preset = await resolvePreset(presetId, new AbortController().signal)
      if (!preset) return null
      return { slug, rp, preset, sessionId }
    } catch { return null }
  }

  /**
   * D-3：在 assemble 时**现算**系统级 RP 内容（角色卡 / 状态树 / 长期记忆 / 表格）。
   *
   * 世界书不在此处（它需要 pre-step 的关键词扫描管线：对 history 做 triggerWorldInfo +
   * 预算裁剪 + EJS generate-loader），由 pre-step 发布后经 `publishSlots` 汇入。
   *
   * 不复用 pre-step 里那套 `retained*` 去重（那是为"避免向耐久日志重复 append"设计的）；
   * assemble 每 step 现算、不落日志，故无需去重，反而必须每轮给全量——否则某个 step
   * 会拿到残缺的 system（例如工具轮跳过表格时把角色卡也吞掉）。
   *
   * 任何一步失败都只跳过该项，不阻塞 assemble（否则整个 system 渲染抛错 → 会话不可用）。
   */
  const gatherSlotSections = async (agent: LikeAgent): Promise<SlotSection[]> => {
    if (!SLOT_ROUTING) return []
    const out: SlotSection[] = []
    try {
      const slug = rpSlugFromCwd(readSessionCwd(agent.session), dshHome)
      if (!slug) return out
      const rp = await loadRpJson(slug, new AbortController().signal)
      if (!rp) return out
      const sid = readHostSessionId(agent.session)
      if (!sid) return out

      // 角色卡（TT dump-008 [3] stage_1_base_requirements 同位置语义）
      const personaRaw = (rp.promptPersona ?? '').trim()
      if (personaRaw) {
        try {
          // T-79：经唯一处置漏斗（宏展开 → 越权标记消毒 + 残留转义 + nonce 围栏）
          const personaText = await renderGuardedCardText(personaRaw, rp, slug, sid, 'character')
          if (personaText) {
            out.push({ name: 'dsht-rp:slot:character', order: SLOT_ORDERS.characterCard, text: personaText })
          }
        } catch (e) { console.log(`[dsht-rp] D-3 角色卡渲染失败（跳过）：${(e as Error).message}`) }
      }

      // MVU 状态树（TT [14] status_current_variables 同语义，但 TT 侧在 user 席——
      // DSHT 统一走 system：状态是"系统对模型的当前事实"，放 system 无歧义）
      try {
        const st = await loadSessionState(sid)
        const summary = renderStateSummary(st.state ?? st.variables ?? {})
        if (summary) out.push({ name: 'dsht-rp:slot:state', order: SLOT_ORDERS.stateTree, text: summary })
      } catch (e) { console.log(`[dsht-rp] D-3 状态树渲染失败（跳过）：${(e as Error).message}`) }

      // 长期记忆（TT [11] 过往记忆 同语义）
      try {
        const memoryText = renderMemorySnapshot((await loadMemory(dshHome, sid)).entries)
        if (memoryText) {
          out.push({
            name: 'dsht-rp:slot:memory',
            order: SLOT_ORDERS.memory,
            text: `【长期记忆】（此前固化的用户偏好/设定变动/承诺；生成回复前可先 memory_query 检索更多）\n${memoryText}`,
          })
        }
      } catch (e) { console.log(`[dsht-rp] D-3 记忆渲染失败（跳过）：${(e as Error).message}`) }

      // st-memory-enhancement 表格
      try {
        const { sheets } = await loadSheets(dshHome, sid)
        const active = sheets.filter(s => s.enabled)
        if (active.length > 0) {
          const tablesText = renderTablePrompt(active)
          if (tablesText) out.push({ name: 'dsht-memory:slot:tables', order: SLOT_ORDERS.tables, text: tablesText })
        }
      } catch (e) {
        // 【心跳 47】原为空 catch：任何失败都无声无息。空 catch 是静默失败的温床（LEARNINGS L24），
        // 正因为它是空的，`loadSheets 未定义` 这个致命错误藏了整整一个版本周期没被发现。
        // 注：loadSheets 对「无表文件」返回空集而非抛错（tables.ts:163-171），故此处只会记录真实故障。
        console.log(`[dsht-rp] 表格槽位跳过（sheets 读取失败）：${(e as Error).message}`)
      }

      // ---- 【2026-09-10】promptOnly 正则投影 → system 槽位（TT GENERATE_AFTER_COMBINE_PROMPTS）----
      // 为什么在这里而不是 llm/stream：见该钩子头注 —— loop 组装的 options 是 deep-frozen
      // （dsh-llm/lib/index.js:87 / dsh-agent-loop/lib/index.js:747），messages 改写被架构封死。
      // system-prompt/assemble 是显式可变通道（dsh-system-prompt/lib/types/index.d.ts:23
      // "the mutable assembly"），故投影内容改由本槽位承载。
      //
      // 保真度说明：这不是把正则结果塞回 messages（DD 做不到，且那样会破坏
      // reconstructability），而是把「投影后的整批文本」作为一个 system section 附在尾部，
      // 令模型看到的**文本内容**与 TT 的 prompt 期变换一致。TT 侧该变换同样是"只进
      // prompt 不回写 chat"，语义等价。
      try {
        // 【时序取证】实测 turn 内顺序为 assemble → pre-step（v197 探针，见本文件 3040 附近注释）。
        // 故 pre-step 预热对**本 turn** 的 assemble 不可见 —— 此处自己按需预热，
        // 缓存已有的（pre-step 写过）直接复用。
        let pj = preparedPromptProjections.get(sid)
        if (pj === undefined) {
          try {
            const all = await mergedRegex(rp, new AbortController().signal, sid)
            pj = { slug, scripts: all.filter(s => s.promptOnly === true) }
            preparedPromptProjections.set(sid, pj)
          } catch { pj = undefined }
        }
        if (pj !== undefined && pj.scripts.length > 0) {
          const msgs = agent.session.deriveMessages() as unknown as LikeMessage[]
          if (msgs.length > 0) {
            const hits: Array<{ scriptName: string; count: number }> = []
            // findRegex 的宏替换（substituteRegex 1/2）需要身份宏；与快照展开同一来源
            const regexIdentity = await resolveIdentity(dshHome, slug)
            const projected = applyPromptRegexes(msgs, pj.scripts, hits, 'prompt', {
              user: regexIdentity.user, char: regexIdentity.char || rp.macros.char,
            })
            if (hits.length > 0) {
              // 只投影"确实被改写过"的那几条（未命中的层与原文一致，无需重复入 prompt）
              const changed: string[] = []
              for (let i = 0; i < projected.length; i++) {
                const a = messageText(msgs[i] as LikeMessage)
                const b = messageText(projected[i] as LikeMessage)
                if (a !== b) changed.push(b)
              }
              if (changed.length > 0) {
                out.push({
                  name: 'dsht-rp:slot:prompt-projection',
                  order: SLOT_ORDERS.projectedPrompt,
                  text: `【生成期正则投影】（以下 ${changed.length} 段为经 promptOnly 正则处理后的最终文本，`
                    + `与聊天记录显示的原文可能不同；命中脚本：${hits.map(h => h.scriptName).join('、')}）\n\n`
                    + changed.join('\n\n'),
                })
                console.log(`[dsht-rp] promptOnly 投影入 system 槽位：${changed.length} 段命中（${hits.map(h => h.scriptName).join('、')}）`)
              }
            }
          }
        }
      } catch (e) { console.log(`[dsht-rp] promptOnly 投影槽位失败（跳过）：${(e as Error).message}`) }
    } catch (e) {
      console.log(`[dsht-rp] D-3 slot 内容收集失败（不阻塞）：${(e as Error).message}`)
    }
    return out
  }

  /** 读世界书 lore.json（$DSH_HOME 相对路径）。此前两处调用但函数缺失（ReferenceError 被吞），补齐。 */
  const loadBook = async (lorePath: string, signal: AbortSignal): Promise<LoadedBook | null> => {
    try {
      signal.throwIfAborted()
      const text = await readFile(join(dshHome, lorePath), 'utf8')
      const parsed = JSON.parse(text) as { entries?: Array<Record<string, unknown>> }
      // 规范化最小集（实机抓到：手写/ST 原样落盘的书用 disable 字段且无 enabled，
      // triggerWorldInfo 的 `!entry.enabled → continue` 把整本书静默跳过——关键词
      // 触发对非导入管线产出的书整体失效）。导入管线产出的书已带 enabled，不受影响。
      const entries = (Array.isArray(parsed?.entries) ? parsed.entries : []).map((e) => ({
        ...e,
        enabled: typeof e.enabled === 'boolean' ? e.enabled : !(e.disable === true || e.disabled === true),
        keys: Array.isArray(e.keys) ? e.keys : (typeof e.key === 'string' && e.key !== '' ? [e.key] : []),
        secondaryKeys: Array.isArray(e.secondaryKeys) ? e.secondaryKeys : (Array.isArray(e.keysecondary) ? e.keysecondary : []),
        // 预算排序键：raw 书缺 insertionOrder → NaN 排最末必被预算裁掉（实机 droppedByBudget=357 抓到）
        insertionOrder: typeof e.insertionOrder === 'number' ? e.insertionOrder : (typeof e.order === 'number' ? e.order : 100),
        constant: e.constant === true,
      }))
      return { entries: entries as unknown as LoreEntry[] }
    } catch {
      return null
    }
  }

  // ---- T2.6：欢迎工作区（新手引导 = 默认工作区里的第一条消息，用户定案）----
  const WELCOME_SLUG = '_start'
  const ensureWelcomeWorkspace = async (): Promise<void> => {
    try {
      const startDir = join(dshHome, 'rp', WELCOME_SLUG)
      const rpJsonPath = join(startDir, 'rp.json')
      try {
        await readFile(rpJsonPath, 'utf8')
        return // 已存在（幂等）
      } catch { /* 不存在 → 首启引导 */ }
      await mkdir(startDir, { recursive: true })
      await writeFile(rpJsonPath, JSON.stringify({
        schemaVersion: 1,
        characterName: 'DSHTavern 向导',
        books: [],
        trigger: { scanDepth: 2, matchWholeWords: false, budgetPercent: 25, budgetCap: 6000 },
        macros: { char: '向导', user: '' },
        firstMes: '',
      }, null, 1), 'utf8')
      await writeFile(join(startDir, 'README.md'),
        '# DSHTavern 向导\n\n新手引导工作区：本会话首条消息是上手指引；导入摘要也会出现在这里。\n', 'utf8')
      // 引导 session：首条 assistant 消息 = 上手指引（oneTurnLog 契约）
      const sessionId = 'dsht-welcome'
      const createdAt = Date.now()
      const ev = (type: string, seq: number, data: Record<string, unknown>, surfaceOp?: string): string =>
        JSON.stringify({ type, seq, time: createdAt + seq, data, ...(surfaceOp !== undefined ? { surfaceOp } : {}) })
      const guide = [
        '欢迎使用 DSHTavern！开始角色扮演前的两步准备：',
        '',
        '**第一步：配置 API（导入管线的 AI 语义分类和对话都依赖它）**',
        '去 DSH **设置 → 模型** 配置：填入 DeepSeek 官方 API Key，或任意 OpenAI 兼容端点（硅基流动 / OpenRouter / vLLM 等，DSH 原生支持）。配置完再回来导入。',
        '',
        '**第二步：导入你的 SillyTavern 数据**',
        '点侧栏底部「🎭 角色扮演」→「导入」页（数据迁移）：',
        '- 📦 完整数据包（data 文件夹 zip）——角色卡/世界书/聊天记录/预设一次迁移',
        '- 🎴 角色卡（PNG/JSON）——会生成一个工作区 + 带开场白的会话',
        '- 📚 世界书（world JSON）——成为角色工作区里的知识库；附触发测试器',
        '',
        '导入完成后回到「角色」页点开角色卡即可开聊（聊天记录会作为会话历史延续）。',
        '会话顶部有 🎛 下拉可随时切换 RP 预设；「正则」页管理全局/角色正则。',
        '',
        '有什么想调整的，直接在这个会话里留言即可——祝玩得开心！',
      ].join('\n')
      // 【阶段3 2026-09-10 修正】header.cwd 必须是**绝对且 realpath 规范**形态：
      // 历史实现写的 `rp/_start` 是相对路径，0.1.5 的 v0 迁移器硬要求
      // `header cwd must be absolute`（dsh-session-format-v0-to-v1:1487），该会话
      // 迁移即被拒。且 cwd 与所在目录名是一对强不变量（目录名 == projectKey(cwd)），
      // 故此处用 realpath 求出的绝对路径同时决定两者，杜绝再次错配。
      const wsCwd = normAndroidPath(await realpath(startDir).catch(() => startDir))
      const lines = [
        JSON.stringify({ type: 'session', version: 0, id: sessionId, createdAt, cwd: wsCwd, delegationDepth: 0 }),
        ev('turn/start', 0, { turn: 1 }),
        ev('step/start', 1, { turn: 1, step: 1 }),
        // ⚠️ 本行**故意不写 `stream`**：此处产出的是 **v0** 文件（version: 0），
        // v0 的 assistant/message 必需成员是 `["turn","step","message"]`
        // （`dsh-session-format-v0-to-v1/lib/index.js:42-45`），**带上 stream 反而是非法成员**；
        // `stream` 由 v1→v2 迁移器从 assistant/chunk 累积生成
        // （`v1-to-v2/lib/index.js:752-768`）。**live 会话（v2+）的写入必须带 stream**
        // —— 代次不同则字段不同，勿"顺手统一"（见 session-write.ts `assistantSettlement`）。
        ev('assistant/message', 2, {
          turn: 1, step: 1,
          message: {
            id: 'dsht-welcome-guide',
            role: 'assistant',
            content: [{ type: 'text', text: guide }],
            source: { kind: 'model', provider: 'dshtavern', model: 'welcome' },
          },
        }, 'append'),
        ev('step/end', 3, { turn: 1, step: 1 }),
        ev('turn/end', 4, { turn: 1, reason: { kind: 'completed' } }),
      ]
      // 目录名必须 == projectKey(header.cwd)（官方 assertStoredIdentity 强不变量）——
      // 与上面 header 用同一个 wsCwd 派生，两者不会再错配。
      const sessionDir = join(dshHome, 'sessions', projectKey(wsCwd), sessionId)
      await mkdir(sessionDir, { recursive: true })
      // 【鲁棒轮收尾】原子发布（欢迎会话首建；半写文件会被幂等跳过——原子写消除该窗口）
      await atomicWriteFile(join(sessionDir, 'session.jsonl'), lines.join('\n') + '\n')
      console.log('[dsht-rp] welcome workspace created (rp/_start + guide session)')
    } catch (e) {
      console.log(`[dsht-rp] welcome workspace skipped: ${(e as Error).message}`)
    }
  }
  void ensureWelcomeWorkspace()

  // ---- R0/R4/R13：迁移资产首启同步（skill + 适配工作区 preset）----
  // 分发链路与 import-center.html 同款：构建期打进插件 assets/（build-dsht.ps1
  // Step 4.7；NodeService copyPackageDir / setup-pc-verify 拷贝到 profile），
  // 运行时从这里写到 $DSH_HOME/skills/st-migration 与 .agent-presets/dsht-adapter
  // （skill-filesystem / agent-presets 的 user root 热发现）。幂等：内容相同跳过。
  const syncAssetTree = async (assetRel: string, dstDir: string): Promise<number> => {
    let written = 0
    const srcRoot = new URL(`../assets/${assetRel}/`, import.meta.url)
    const walk = async (srcUrl: URL, rel: string): Promise<void> => {
      let entries: Array<{ name: string; isDirectory: () => boolean }>
      try { entries = await readdir(srcUrl, { withFileTypes: true }) as never } catch { return }
      for (const e of entries) {
        const childRel = rel ? `${rel}/${e.name}` : e.name
        if (e.isDirectory()) { await walk(new URL(`${e.name}/`, srcUrl), childRel); continue }
        try {
          const content = readFileSync(new URL(e.name, srcUrl), 'utf8')
          const abs = join(dstDir, ...childRel.split('/'))
          let same = false
          try { same = (await readFile(abs, 'utf8')) === content } catch { /* 不存在 */ }
          if (same) continue
          await mkdir(dirname(abs), { recursive: true })
          await writeFile(abs, content, 'utf8')
          written++
        } catch { /* 单文件失败不阻塞 */ }
      }
    }
    await walk(srcRoot, '')
    return written
  }
  const ensureMigrationAssets = async (): Promise<void> => {
    try {
      const skillN = await syncAssetTree('skills/st-migration', join(dshHome, 'skills', 'st-migration'))
      const presetN = await syncAssetTree('agent-presets/dsht-adapter', join(dshHome, '.agent-presets', 'dsht-adapter'))
      if (skillN + presetN > 0) console.log(`[dsht-rp] migration assets synced: st-migration=${skillN} dsht-adapter=${presetN}`)
    } catch (e) {
      console.log(`[dsht-rp] migration assets sync skipped: ${(e as Error).message}`)
    }
  }
  void ensureMigrationAssets()

  // ---- R5：预设体系统一（rp-presets/<id>/preset.json = 唯一编辑源；写盘时编译
  // 同步产出 DSH agent preset .agent-presets/<id>/，agent 预设界面可见 ST 迁移预设。
  // 只管理 st- 前缀（ST 预设迁移来源）——角色卡 preset（rp-<slug>）不同步覆盖/删除）----
  const AGENT_SYNC_PREFIX = 'st-'
  const syncRpPresetToAgent = async (preset: RPPreset): Promise<void> => {
    if (!preset.id.startsWith(AGENT_SYNC_PREFIX)) return
    // 目录名必须过 PRESET_ID（discovery 硬过滤）——raw id 含 CJK/emoji 时净化
    const dirId = agentPresetDirId(preset.id)
    // compilePreset 产出形态 = exportCardPreset 同款（persona text = 编译后 system prompt）
    const files = compilePreset(preset, { user: '用户', char: '角色' })
    for (const f of files) {
      // preset.yml：name = displayName；description 标注同步来源（编译器默认描述无来源标注）。
      // YAML 标量必须引号化（JSON 串是合法 YAML 双引号标量）——裸写遇 [ 开头
      // （如「[Agent] V14.7 示例预设」）会被 js-yaml 当 flow collection 解析失败，
      // metadata 整体降级为空（选择器里丢显示名）。
      const content = f.path.endsWith('/preset.yml')
        ? [
          `name: ${JSON.stringify(preset.displayName)}`,
          `description: ${JSON.stringify(`由 RP 预设「${preset.displayName}」同步（编辑源：rp-presets/${preset.id}/preset.json —— 勿手改，表层保存后自动重新同步）`)}`,
          `order: 100`,
          ``,
        ].join('\n')
        : f.content
      const abs = join(dshHome, f.path.replace(`.agent-presets/${preset.id}/`, `.agent-presets/${dirId}/`))
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, content, 'utf8')
    }
    // 旧版直用 raw id 写的目录（discovery 永不入列）清掉，避免占 id/误导
    if (dirId !== preset.id) {
      await rm(join(dshHome, '.agent-presets', preset.id), { recursive: true, force: true })
    }
    console.log(`[dsht-rp] R5 preset synced → .agent-presets/${dirId}（${preset.displayName}）`)
  }
  const removeRpPresetAgent = async (id: string): Promise<void> => {
    if (!id.startsWith(AGENT_SYNC_PREFIX)) return
    await rm(join(dshHome, '.agent-presets', agentPresetDirId(id)), { recursive: true, force: true })
    await rm(join(dshHome, '.agent-presets', id), { recursive: true, force: true }) // 旧 raw 目录一并清
  }
  // 存量迁移（幂等）：启动时扫 rp-presets/*/preset.json，缺对应 .agent-presets/<dirId>/ 的补编译；
  // P1#6：已同步但缺能力轴组（双轴分离前的旧编译形态）的 agent 型预设重编译升级。
  const ensureRpPresetSync = async (): Promise<void> => {
    try {
      let dirs: string[] = []
      try { dirs = await readdir(join(dshHome, 'rp-presets')) } catch { return }
      let synced = 0
      for (const id of dirs.sort()) {
        if (!id.startsWith(AGENT_SYNC_PREFIX)) continue
        try {
          const preset = JSON.parse(await readFile(join(dshHome, 'rp-presets', id, 'preset.json'), 'utf8')) as RPPreset
          if (preset?.schemaVersion !== 1 || preset.id !== id) continue
          const dirId = agentPresetDirId(id)
          try {
            const yml = await readFile(join(dshHome, '.agent-presets', dirId, 'agent.cordis.yml'), 'utf8')
            // agent 型预设的旧形态（无 preset-capability 组）→ 落到补编译分支升级
            if (preset.path === 'agent' && !isDshtRpAgentComposition(yml)) {
              throw new Error('stale capability axis')
            }
            // §2.3 ②：缺紧凑 persona 标记 = 两套规则重复的旧形态（所有路径）→ 升级
            if (!yml.includes(AGENT_COMPACT_PERSONA_MARKER)) {
              throw new Error('stale full-text persona')
            }
            continue // 已同步且形态当前（存在即跳过）
          } catch { /* 缺失/旧形态 → 补编译 */ }
          await syncRpPresetToAgent(preset)
          synced++
        } catch { /* 坏 preset.json 跳过 */ }
      }
      if (synced > 0) console.log(`[dsht-rp] R5 preset sync backfill: ${synced} agent presets`)
    } catch (e) {
      console.log(`[dsht-rp] R5 preset sync backfill skipped: ${(e as Error).message}`)
    }
  }
  void ensureRpPresetSync()
  // 任务 2：启动时执行卡 preset 存量迁移（幂等）——.agent-presets/rp-* 的 persona 正文
  // 回填 rp.json.promptPersona 后删除目录（有会话引用的保留），agent 预设界面只留真预设
  void migrateCardAgentPresets()

  // ---- L1b：自定义宏启动水合（rp/macros.json → 引擎注册表；注册路由见 /macros/*）----
  void (async () => {
    try {
      const disk = JSON.parse(await readFile(join(dshHome, 'rp', 'macros.json'), 'utf8')) as Record<string, string>
      hydrateCustomMacros(disk)
      const n = Object.keys(disk).length
      if (n > 0) console.log(`[dsht-rp] custom macros hydrated: ${n} 个（${Object.keys(disk).join(', ')}）`)
    } catch { /* 无自定义宏文件 = 正常 */ }
  })()

  // ---- P0 顺手项：repairAllSessionSeqs「启动即修窗口」----
  // host 刚起、尚无 live 会话：此刻全量 seq 修复不会因 live 跳过留下窗口
  //（/rp/repair-sessions 与 register-workspaces 对 live 会话跳过——断号会话若一直
  // live 就永远修不到）。幂等短路（seq 连续直接 continue）；超大文件有 8MiB 上限护栏。
  void repairAllSessionSeqs().then(r => {
    const n = (r.repaired as unknown[]).length
    if (n > 0) logLine(`启动即修：seq 断号修复 ${n} 个会话`)
  }).catch(e => console.log(`[dsht-rp] startup repair skipped: ${(e as Error).message}`))

  // ---- 【阶段3 2026-09-10】session header cwd 规范化「启动即修」----
  // 为什么必须在启动做：0.1.5 的 v0 迁移器硬要求 `header cwd must be absolute`
  // （dsh-session-format-v0-to-v1:1487），历史引导会话写的是相对形态 `rp/_start`；
  // 而 DSH 的 dsh-workspace 在**插件树加载期**就逐个校验 header 与所在目录的身份一致性
  // （persistence assertStoredIdentity：目录名必须 == projectKey(header.cwd)）——
  // 校验失败会让整个 plugin tree 加载失败、node 退出码 1 无限重启（实机 crash-loop 实证）。
  // 故 cwd 修复必须在此窗口完成（只改 cwd 不搬目录 = 制造上述 crash-loop，本函数两者同做）。
  void repairSessionCwds().then(r => {
    const n = (r.repaired as unknown[]).length
    const errs = (r.errors as unknown[]).length
    if (n > 0 || errs > 0) logLine(`启动即修：session cwd 规范化 ${n} 个（失败 ${errs}）`)
  }).catch(e => console.log(`[dsht-rp] startup cwd repair skipped: ${(e as Error).message}`))

  // ---- R49：重复 turn/start「启动即修」----
  // 物化 turn 计数失同步（已修源头，phase 同步）留下的存量日志：重复 turn/start 让
  // 前端 ConversationNodeAssembler 全量重放崩溃（折叠行/会话流停摆）。此处磁盘手术
  // 重编号重复段（正在 live 的会话下次重开生效——启动窗口 live 集为空，与本窗口同理）。
  void (async () => {
    let fixed = 0
    for (const h of await scanSessionHeaders()) {
      const file = h.file
      try {
        const stat0 = await stat(file)
        if (stat0.size > 64 * 1024 * 1024) continue // 护栏与 repairAllSessionSeqs 同级
        const content = await readFile(file, 'utf8')
        const r = repairDuplicateTurnStarts(content)
        if (r.renumberedTurns === 0) continue
        await atomicWriteFile(`${file}.bak`, content)
        await atomicWriteFile(file, r.content.endsWith('\n') ? r.content : r.content + '\n')
        fixed++
        logLine(`启动即修：重复 turn/start 重编号 ${r.renumberedTurns} 段（${r.eventsRewritten} 事件）→ ${h.sessionId}`)
      } catch { /* 单会话失败不阻塞其余 */ }
    }
    if (fixed > 0) console.log(`[dsht-rp] duplicate turn/start repaired: ${fixed} sessions`)
  })().catch(e => console.log(`[dsht-rp] turn repair skipped: ${(e as Error).message}`))

  // ---- R15：deepseek 目录模型补齐（启动时幂等）----
  // pi-ai 内建 deepseek 目录只有 deepseek-v4-flash / deepseek-v4-pro
  // （@earendil-works/pi-ai providers/data/deepseek.json），缺 vision 实验模型。
  // llm-pi-ai 契约：profile 配置 models 会整体替换内建目录（resolveRouteModels），
  // 且 settings.update 是递归 merge（数组整体覆盖、不 concat）——所以必须先读
  // 现有 models 再写回完整清单（只写 id 的条目自动继承内建目录字段）。
  const DEEPSEEK_VISION_MODEL = 'deepseek-v4-flash-vision-exp'
  const ensureDeepseekModels = async (): Promise<void> => {
    try {
      const get = ctx.settings?.get
      if (!ctx.settings || typeof get !== 'function') {
        // 降级：settings 服务不可读（参考 import-api-config 的 ctx.settings 判空路径）——
        // 无法安全合并 models（盲写会整体替换目录），跳过并如实记录
        logLine('deepseek 模型补齐跳过：settings 服务不可读（无法安全合并 models，保持现状）')
        return
      }
      const section = get.call(ctx.settings, 'llm-pi-ai') as {
        providers?: Record<string, { models?: Array<Record<string, unknown>>; modelOverrides?: Record<string, unknown> }>
      } | undefined
      const ds = section?.providers?.deepseek
      if (!ds) return // deepseek 路由未配置（目录路由未声明），不动
      if (ds.modelOverrides && Object.keys(ds.modelOverrides).length > 0) {
        logLine('deepseek 模型补齐跳过：路由用了 modelOverrides（与 models 互斥，不盲合）')
        return
      }
      const configured = Array.isArray(ds.models) ? ds.models : null
      if (configured?.some(m => m?.id === DEEPSEEK_VISION_MODEL)) return // 已有（幂等）
      const base = configured ?? [{ id: 'deepseek-v4-flash' }, { id: 'deepseek-v4-pro' }] // 未配置 = 内建目录，显式保留
      const models = [...base, { id: DEEPSEEK_VISION_MODEL, name: 'DeepSeek V4 Flash Vision（实验）', input: ['text', 'image'] }]
      await ctx.settings.update('llm-pi-ai', { providers: { deepseek: { models } } })
      logLine(`deepseek 模型补齐：+${DEEPSEEK_VISION_MODEL}（路由共 ${models.length} 个模型，live 生效）`)
      console.log(`[dsht-rp] deepseek model top-up: +${DEEPSEEK_VISION_MODEL} (total ${models.length})`)
    } catch (e) {
      console.log(`[dsht-rp] deepseek model top-up skipped: ${(e as Error).message}`)
    }
  }
  void ensureDeepseekModels()

  // ---- §2.3 ③：聊天界面偏好（楼层号显示）——settings 真实 Schema + /rp/chat-prefs 读路由。
  // 设置→插件「可配置」tab 渲染（中文键 = 标签）；前端 RpFloorBadge 每会话视图取一次。
  const CHAT_PREFS_NS = 'dsht-rp-chat'
  try {
    // 【实机测试修复 2026-09-05】settings.register 对 schema 是鸭子类型调用
    // （schema(value)+toJSON()，见 dsht-plugin-shared/settings-ns.ts）——裸对象报
    // "schema is not a function"。改 schemastery z.object（runtime 同版本已打包）。
    ctx.settings?.register?.(CHAT_PREFS_NS, z.object({ 楼层号显示: z.boolean().default(true) }), { base: { 楼层号显示: true } })
  } catch (e) {
    logLine(`聊天偏好设置注册失败（不影响本体）：${(e as Error).message}`)
  }
  const readChatPrefs = (): { floorBadge: boolean } => {
    try {
      const v = ctx.settings?.get?.(CHAT_PREFS_NS) as { 楼层号显示?: unknown } | undefined
      return { floorBadge: v?.['楼层号显示'] !== false }
    } catch {
      return { floorBadge: true }
    }
  }

  // ---- lore_query 工具（T1.8：轻 agent 路径世界书深查，按会话工作区）----
  if (ctx.tools && ctx.systemPrompt) {
    ctx.systemPrompt.section({
      name: 'tool:lore_query',
      order: 112,
      text: 'Use the lore_query tool to look up roleplay worldbook lore (characters, places, rules, history) that is not in the active worldbook snapshot. Pass a search term (a name or keyword from the story). Prefer it over inventing setting details.',
    })
    ctx.tools.register({
      name: 'lore_query',
      description: 'Search the roleplay worldbook for lore entries (characters, places, rules). Use when a scene references setting details not already in context.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term: character name, place, or keyword' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const query = String((args as { query?: unknown }).query ?? '')
        const slug = exec.agent ? rpSlugFromCwd(readSessionCwd(exec.agent.session), dshHome) : null
        if (slug === null) return 'No roleplay workspace in this session.'
        const rp = await loadRpJson(slug, exec.signal)
        if (!rp || rp.books.length === 0) return 'This roleplay workspace has no worldbooks.'
        const entries: LoreEntry[] = []
        for (const b of rp.books) {
          const book = await loadBook(b.lorePath, exec.signal)
          if (book) entries.push(...book.entries)
        }
        console.log(`[dsht-rp] lore_query: "${query}" over ${entries.length} entries`)
        return searchLoreEntries(entries, query)
      },
    })
    // ---- T2.3：state_update 工具（MVU 状态维护）----
    // 模型主动写状态：默认 session 作用域（变量树随会话持久化），scope=global 写全局
    ctx.systemPrompt.section({
      name: 'tool:state_update',
      order: 113,
      text: 'Use the state_update tool to persist roleplay variables (favorability, location, flags, story state) across turns. Prefer updating only what changed. If the card already emits <UpdateVariable> blocks, those are captured automatically — use this tool only when you need to record state explicitly.',
    })
    ctx.tools.register({
      name: 'state_update',
      description: 'Persist a roleplay variable (MVU variable tree) for the current session. Path uses JSONPointer like /character/favorability or /location. scope=session persists per-chat; scope=global persists across chats.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'JSONPointer path, e.g. /云梦璃/好感度 or /location' },
          value: { description: 'Value to set (number, string, boolean, object)' },
          scope: { type: 'string', enum: ['session', 'global'], description: 'session (default) or global persistence' },
        },
        required: ['path', 'value'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const path = String((args as { path?: unknown }).path ?? '')
        const value = (args as { value?: unknown }).value
        const scope = String((args as { scope?: unknown }).scope ?? 'session')
        if (!path.trim()) return 'path required'
        const session = exec.agent?.session
        const sid = session ? String((session as unknown as { id?: string }).id ?? '') : ''
        if (scope === 'global') {
          const g = JSON.parse(await readFile(join(dshHome, 'rp', 'state', 'global.json'), 'utf8').catch(() => '{}')) as Record<string, unknown>
          const next = applyStatePatches(g, [{ op: 'replace', path, value }])
          await mkdir(join(dshHome, 'rp', 'state'), { recursive: true })
          await writeFile(join(dshHome, 'rp', 'state', 'global.json'), JSON.stringify(next), 'utf8')
          console.log(`[dsht-rp] state_update(global): ${path}`)
          return `global state updated: ${path}`
        }
        if (!sid) return 'no session'
        const st = await loadSessionState(sid)
        const next = applyStatePatches(st.state ?? {}, [{ op: 'replace', path, value }])
        st.state = next
        await saveSessionState(sid, st)
        console.log(`[dsht-rp] state_update(session): ${path} (${sid})`)
        return `session state updated: ${path}`
      },
    })
    // ---- R0：dsht_bridge 工具（迁移 agent 的 HTTP 路由通道）----
    // 迁移/适配工作区的 agent 需要调 /dsht-* 数据面（write-files、import-api-config、
    // MVU/酒馆助手/模板插件路由），但 Android 运行时无 curl/node CLI 可用——
    // 注册一个进程内 loopback 转发工具（fetch 127.0.0.1:<webServer.port>，同源信任栅栏放行）。
    ctx.systemPrompt.section({
      name: 'tool:dsht_bridge',
      order: 114,
      text: 'Use the dsht_bridge tool to call DSHTavern data-plane HTTP routes (/dsht-rp/*, /dsht-mvu/*, /dsht-tavern-helper/*, /dsht-prompt-template/*) — file writes into DSH_HOME, MVU variable registration, API config import, etc. Prefer it over raw filesystem writes outside the workspace (those trigger approval prompts).',
    })
    ctx.tools.register({
      name: 'dsht_bridge',
      description: 'Call a DSHTavern data-plane route (dsht-rp / dsht-mvu / dsht-tavern-helper / dsht-prompt-template). Example: {base:"dsht-rp", path:"rp/import-api-config", payload:{batchId:"..."}}. GET routes (e.g. dsht-rp rp/import-batches) use method:"GET".',
      parameters: {
        type: 'object',
        properties: {
          base: { type: 'string', enum: ['dsht-rp', 'dsht-mvu', 'dsht-tavern-helper', 'dsht-prompt-template'], description: 'Route prefix (without slash)' },
          path: { type: 'string', description: 'Sub path under the prefix, e.g. write-files or rp/import-stage' },
          method: { type: 'string', enum: ['POST', 'GET'], description: 'default POST' },
          payload: { type: 'object', description: 'JSON body (POST)' },
        },
        required: ['base', 'path'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const base = String((args as { base?: unknown }).base ?? '')
        const path = String((args as { path?: unknown }).path ?? '').replace(/^\/+/, '')
        const method = String((args as { method?: unknown }).method ?? 'POST')
        if (!/^dsht-[a-z-]+$/.test(base) || !path || path.includes('..')) return 'bad base/path'
        const port = ctx.webServer?.port ?? 3080
        const url = `http://127.0.0.1:${port}/${base}/${path}`
        try {
          const resp = await fetch(url, {
            method,
            headers: { 'content-type': 'application/json' },
            ...(method === 'POST' ? { body: JSON.stringify((args as { payload?: unknown }).payload ?? {}) } : {}),
          })
          const text = await resp.text()
          return `HTTP ${resp.status}\n${text}`
        } catch (e) {
          return `dsht_bridge failed: ${(e as Error).message}`
        }
      },
    })
    // ---- T3.2：memory_save / memory_query 工具（会话长期记忆最小闭环，规则层无 LLM）----
    // 存储在 $DSH_HOME/rp/memory/<sessionId>.json（核心逻辑在 ./memory.ts，纯函数可单测）；
    // 组装层每轮 pre-step 自动注入最近 20 条记忆（无记忆不注入），这里是模型主动写/查通道。
    ctx.systemPrompt.section({
      name: 'tool:memory_save',
      order: 115,
      text: 'Use the memory_save tool to store facts that must persist across turns (user preferences, important setting changes, promises made in the story). Recent memories are injected into context automatically each turn; before generating a reply you may first call memory_query to recall relevant facts and avoid duplicates.',
    })
    ctx.tools.register({
      name: 'memory_save',
      description: '把需要跨轮长期记住的事实（用户偏好、重要设定变动、承诺）存入会话记忆。生成回复前可先 memory_query 检索已有记忆，避免重复保存。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '要固化的事实（一句话，≤2000 字）' },
          source: { type: 'string', enum: ['agent', 'user'], description: '默认 agent；用户亲口说的偏好可用 user' },
        },
        required: ['text'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const text = String((args as { text?: unknown }).text ?? '')
        if (!text.trim()) return 'text required'
        const source = normalizeMemorySource((args as { source?: unknown }).source)
        const session = exec.agent?.session
        const sid = session ? String((session as unknown as { id?: string }).id ?? '') : ''
        if (!sid) return 'no session'
        const file = await loadMemory(dshHome, sid)
        const r = appendMemory(file, text, source)
        if (!r.ok) return r.error === 'too-long' ? `text 超过 ${MEMORY_TEXT_MAX} 字上限` : 'text required'
        await saveMemory(dshHome, sid, r.file)
        console.log(`[dsht-rp] memory_save: ${sid} ${r.entry?.id}${r.duplicate ? '（去抖命中）' : ''}，共 ${r.file.entries.length} 条`)
        return r.duplicate === true ? `memory already saved: ${r.entry?.id}` : `memory saved: ${r.entry?.id} (${r.file.entries.length} entries)`
      },
    })
    ctx.systemPrompt.section({
      name: 'tool:memory_query',
      order: 116,
      text: 'Use the memory_query tool to retrieve the session long-term memory (previously stored user preferences / setting changes / promises). Call it before generating a reply when continuity with earlier facts matters; an empty result means no relevant memory has been stored yet.',
    })
    ctx.tools.register({
      name: 'memory_query',
      description: '检索本会话的长期记忆（此前固化的用户偏好/设定/承诺）。生成回复前可先查询相关记忆；空结果说明尚无相关记忆。query 用空格分隔多个关键词，命中任一即返回。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '关键词（空格分隔多个词）' },
          limit: { type: 'number', description: '返回条数上限，默认 10' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const query = String((args as { query?: unknown }).query ?? '')
        const rawLimit = (args as { limit?: unknown }).limit
        const limit = typeof rawLimit === 'number' && Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : 10
        const session = exec.agent?.session
        const sid = session ? String((session as unknown as { id?: string }).id ?? '') : ''
        if (!sid) return 'no session'
        const { entries } = await loadMemory(dshHome, sid)
        const hits = queryMemory(entries, query, limit)
        console.log(`[dsht-rp] memory_query: "${query}" → ${hits.length}/${entries.length} hits (${sid})`)
        if (hits.length === 0) return `No memory matches "${query}"（本会话尚无相关长期记忆）`
        return ['memory hits:', ...hits.map(h => `- [${formatMemoryTime(h.createdAt)}] ${h.text}`)].join('\n')
      },
    })
  }

  // ---- ⑧ ST 预设机制移植①：relative 条目（prompt_order 保序）→ request.system 顶部 ----
  // ST 对应物：PromptManager 里 position=relative 的条目按 prompt_order 排在 prompt 顶部。
  // DSH 宿主语义：request.system 是唯一顶部通道（decision.messages 全落 user/message 且
  // restore 校验 role 必须 user）。每 step assemble 时现算——会话内切预设下一 step 即生效；
  // 预设不变则 system 文本不变，不触发 request/header 重写。
  ctx.on('system-prompt/assemble', async (_assembly: unknown, context: unknown, next: () => Promise<unknown>) => {
    let assembly = (await next()) as { sections: Array<{ name: string; text: string }> }
    try {
      const agent = (context as { agent?: LikeAgent; scope?: LikeAgent }).agent
        ?? (context as { scope?: LikeAgent }).scope
      if (!agent || !assembly || !Array.isArray(assembly.sections)) return assembly

      // ---- D-3：把系统级 RP 内容并入 system 槽位 ----
      // 唯一合法通道取证：`agent.ts:337` `const system = renderPrompt(assembly)` →
      // `agent.ts:339` `buildRequest(..., system, session.deriveMessages(), ...)`。
      // `assembleContextFor`（`agent/src/dispatch.ts:173`）把 live Agent 放进 context.agent。
      // 内容保序由 SLOT_ORDERS 统一裁定（同 TT dump-008 的语义拼接序）。
      //
      // 【为什么在本处现算，而不是只读 pre-step 的发布】
      // 实机时序取证（v197 探针）：turn 内顺序恒为
      //   assemble(agent.ts:230) → pre-step(agent.ts:233) → step/渲染(agent.ts:337)
      // 且 mock/无工具调用时 **一 turn 仅一步**。故 pre-step 的发布对**本 turn 不可见**，
      // 只对下一 turn 可见 —— 首个 turn 的 system 槽位会是空的，语义错误。
      // 因此这里以"本处现算"为主，pre-step 的发布仅作为**额外**来源（两者按 name 合并）。
      const selfSections = await gatherSlotSections(agent)

      const published = slotPublished.get(agent)?.sections ?? []
      const merged = new Map<string, SlotSection>()
      for (const s of [...selfSections, ...published]) merged.set(s.name, s)
      if (merged.size > 0) {
        const extra = planSlotSections({ sections: [...merged.values()] }, neutralizeResidualMacros)
        if (extra.length > 0) {
          assembly = {
            ...assembly,
            sections: [...assembly.sections, ...extra],
          }
          console.log(`[dsht-rp] D-3 system 槽位注入：${extra.length} 段 / ${extra.reduce((n, s) => n + s.text.length, 0)}ch（${extra.map(s => s.name).join(', ')}）[self=${selfSections.length} published=${published.length}]`)
        }
      }

      const resolved = await resolveAgentPreset(agent)

      // ---- D-6（T-08 / T-12）：RP 会话的 agent 层工具修剪 ----
      // 判据 = **是否 RP 会话**（cwd 落在 `$DSH_HOME/rp/<slug>` 下），而不是「有没有预设」——
      // 无预设的 RP 会话同样要修剪（用户拍板：对齐基准 TT，其请求体没有 tools 字段）。
      // 迁移类会话的 cwd 是 `rp-import/<batchId>`（**不匹配** `rp/` 前缀，见 rpSlugFromCwd），
      // 且它们靠工具干活 → 天然不受影响。
      // 若 presetId 解析不出（resolved=null）→ shouldStripRpTools(undefined)=true → 照样修剪。
      if (rpSlugFromCwd(readSessionCwd(agent.session), dshHome)) {
        if (shouldStripRpTools(resolved?.preset.path)) {
          const stripped = stripAssemblyTools(assembly as unknown as { tools?: unknown; sections?: unknown })
          if (stripped.removed.length > 0) {
            assembly = stripped.assembly as typeof assembly
            console.log(`[dsht-rp] D-6 工具修剪：移除 ${stripped.removed.length} 个工具定义（对齐 TT 无 tools 字段；path=${resolved?.preset.path ?? 'none'}）`)
          }
        }
      }

      if (!resolved) return assembly
      const { slug, rp, preset, sessionId } = resolved
      // 【管线切换 2026-09-20】bychv 绑定启用的会话：relative 条目注入跳过
      // （预设内容统一归其 llm/stream 编译；详见 bychvPresetOwned 头注）。
      if (sessionId && await bychvPresetOwned(sessionId)) return assembly
      const st = sessionId ? await loadSessionState(sessionId) : ({} as SessionRpState)
      const stateTree = (st.state ?? st.variables ?? {}) as Record<string, unknown>
      const parts: string[] = []
      for (const slot of compileSlots(preset)) {
        if (slot.depth != null) continue // depth 条目归 pre-step 真 splice
        if (slot.type === 'marker' || slot.type === 'state') continue // 动态位归尾部快照带
        if (!evalSlotCondition(slot.condition, stateTree)) continue
        const text = slot.content.trim()
        if (text) parts.push(text)
      }
      if (parts.length === 0) return assembly
      const expanded = await expandSnapshotMacros(parts.join('\n\n'), rp, slug, sessionId)
      // renderPrompt 对 section 文本做严格 {{variable}} 插值（未知变量即 throw）——
      // 宏求值后的残余 {{…}} 必须中性化，否则整个 assemble 崩溃
      const text = neutralizeResidualMacros(expanded).trim()
      if (!text) return assembly
      return {
        ...assembly,
        sections: [...assembly.sections, {
          name: `dsht-rp:preset:${preset.id}`,
          text: `【RP 预设：${preset.displayName}】以下为当前预设的生效指令（用户可在会话中随时切换预设）：\n\n${text}`,
        }],
      }
    } catch (e) {
      console.log(`[dsht-rp] preset system-section 注入失败（不阻塞）：${(e as Error).message}`)
      return assembly
    }
  })

  // ---- ⑧ ST 预设机制移植②：采样参数落地（agent/request 瀑布）----
  // ST 预设的 temperature/max_tokens/stop/reasoning_effort 随预设走。宿主适配器
  // （dsh-llm-deepseek）仅透传 temperature/max_tokens/stop 三键 + 配置管线 reasoningEffort；
  // topP/topK/minP/topA/penalties/seed/logitBias 宿主不支持（AUDIT_TASKLIST 标注为宿主限制）。
  // ---- Golden Master 对照（DSHT 侧 dump#3，2026-09-09）：provider 层 fetch 拦截 ----
  // pre-step 的 messages 只是本轮增量；"发给 LLM 的最终完整 payload"在 provider 出站请求里。
  // ENABLED 开关存在时 patch globalThis.fetch（只读透传不改请求），把 LLM chat 请求体落盘
  // golden/dsht/llm-NNN.json，与 TT 侧 chat_completion_prompt_ready（25 条完整组装）配对 diff。
  try {
    if (existsSync(join(dshHome, 'rp', 'golden', 'dsht-ENABLED')) && !(globalThis as Record<string, unknown>).__dshtGoldenFetchPatched) {
      ;(globalThis as Record<string, unknown>).__dshtGoldenFetchPatched = true
      const gdir0 = join(dshHome, 'rp', 'golden', 'dsht')
      mkdirSync(gdir0, { recursive: true })
      const seqFile0 = join(gdir0, 'llm-seq.txt')
      const gFetch = globalThis.fetch.bind(globalThis)
      globalThis.fetch = (async (input: unknown, init?: unknown) => {
        const url0 = typeof input === 'string' ? input : (input as { url?: string })?.url ?? String(input)
        try {
          const body = typeof init === 'object' && init !== null ? (init as { body?: unknown }).body : undefined
          if (typeof body === 'string' && body.length > 200 && /chat\/completions|\/v1\/messages|provider\/v1/i.test(url0)) {
            let seq = 0
            try { seq = parseInt((readFileSync(seqFile0, 'utf8')).trim() || '0', 10) || 0 } catch { /* 首次 */ }
            seq += 1
            writeFileSync(join(gdir0, `llm-${String(seq).padStart(3, '0')}.json`), JSON.stringify({
              tag: 'provider_llm_request', seq, env: 'dshtavern', ts: new Date().toISOString(),
              url: url0.slice(0, 200),
              data: { body: JSON.parse(body) },
            }, null, 1))
            writeFileSync(seqFile0, String(seq))
          }
        } catch { /* golden dump 失败不影响请求 */ }
        // 【2026-09-10 排障】记录每一次出站 fetch 的目标与结果 —— 「发不出来消息」的
        // TRANSPORT/Connection error 需要看到 URL 与底层异常才能归因（此前只有
        // llm/stream 观测，看不到 provider 层）。
        const isLlmRoute = /chat\/completions|\/v1\/messages|\/models|provider\/v1/i.test(url0)
        if (isLlmRoute) console.log(`[dsht-rp] outbound fetch → ${url0.slice(0, 160)}`)
        try {
          return await gFetch(input as Parameters<typeof gFetch>[0], init as Parameters<typeof gFetch>[1])
        } catch (e) {
          if (isLlmRoute) {
            const err = e as { name?: string; message?: string; cause?: unknown }
            const cause = err.cause as { code?: string; message?: string } | undefined
            console.log(`[dsht-rp] outbound fetch 失败 ← ${url0.slice(0, 160)} :: ${err.name}: ${err.message}`
              + (cause ? ` | cause=${cause.code ?? ''} ${cause.message ?? ''}` : ''))
          }
          throw e
        }
      }) as typeof fetch
      console.log('[dsht-rp] golden: provider fetch 拦截已启用（llm dump → rp/golden/dsht/）')
    }
  } catch { /* patch 失败不阻塞插件 */ }

  ctx.on('agent/request', async (payload: unknown, next: () => Promise<unknown>) => {
    const config = (await next()) as Record<string, unknown>
    try {
      const agent = (payload as { agent?: LikeAgent }).agent
      if (!agent) return config
      const resolved = await resolveAgentPreset(agent)
      if (!resolved) return config
      const s = resolved.preset.sampling
      const out = { ...config }
      if (typeof s.temperature === 'number') out.temperature = s.temperature
      if (typeof s.maxTokens === 'number') out.maxTokens = s.maxTokens
      if (Array.isArray(s.stopSequences) && s.stopSequences.length > 0) out.stop = s.stopSequences
      // 【TT 对照修复 2026-09-09】reasoning_effort 值域映射：ST/TT 预设的 'auto' 等"由 provider
      // 自行决定"语义，在 DSH provider 侧不被支持（实测报 does not support reasoning effort "auto"，
      // 发送直接失败）。TT 的行为 = 不支持的值不发该字段。此处仅透传 DSH 支持的档位。
      const REASONING_EFFORT_SUPPORTED = new Set(['minimal', 'low', 'medium', 'high'])
      if (typeof s.reasoningEffort === 'string' && REASONING_EFFORT_SUPPORTED.has(s.reasoningEffort)) {
        out.reasoningEffort = s.reasoningEffort
      } else {
        // 'auto' / 未知值：TT 语义 = 不发该字段（provider 自行决定）。显式删除，
        // 避免 DSH config 默认残留 'auto' 触发 provider 校验拒绝（实测报错）。
        delete out.reasoningEffort
      }
      // ---- Golden Master 对照（DSHT 侧 dump，2026-09-09）：rp/golden/dsht-ENABLED 存在时落盘最终请求配置 ----
      // 与 ST/TauriTavern 侧 golden-master 采集器（CHAT_COMPLETION_PROMPT_READY 挂点）配对，
      // 同卡同输入产出两侧 dump 后逐项 diff。失败绝不影响主链路。
      try {
        if (existsSync(join(dshHome, 'rp', 'golden', 'dsht-ENABLED'))) {
          const gdir = join(dshHome, 'rp', 'golden', 'dsht')
          await mkdir(gdir, { recursive: true })
          const seqFile = join(gdir, 'seq.txt')
          let seq = 0
          try { seq = parseInt((await readFile(seqFile, 'utf8')).trim() || '0', 10) || 0 } catch { /* 首次 */ }
          seq += 1
          await writeFile(join(gdir, `dump-${String(seq).padStart(3, '0')}.json`), JSON.stringify({
            tag: 'agent_request_config', seq, env: 'dshtavern', ts: new Date().toISOString(),
            cwd: readSessionCwd(agent.session) || null,
            data: { config: out },
          }, null, 1))
          await writeFile(seqFile, String(seq))
        }
      } catch { /* golden dump 失败不影响请求 */ }
      return out
    } catch { return config }
  })

  // 【2026-09-10】sessionId → promptOnly 投影脚本缓存。
  // 为什么需要：`llm/stream` 是 **generator 型 waterfall**（`next: () => AsyncIterable<StreamChunk>`，
  // 见 dsh-llm/lib/types/index.d.ts:43），handler 必须是同步的（返回 AsyncIterable 而非 Promise）。
  // 因此不能在钩子里 await 读盘，改为在 pre-step（async 语境）预热本缓存，llm/stream 同步读。
  const preparedPromptProjections = new Map<string, { scripts: RegexScript[]; slug: string }>()

  /** 【2026-09-10】promptOnly 投影命中记录（诊断用；llm/stream 只读不写，见该钩子头注）。 */
  const projectedPromptHits = new Map<string, { at: number; hits: string[]; chars: number }>()

  // ---- D-3/D-4 投影层探针 + promptOnly 正则投影（2026-09-10）
  //
  // 【为什么 promptOnly 正则在 llm/stream 而不在 pre-step】
  // ST/TT 语义：`promptOnly: true` 的脚本只在生成期变换**发往 LLM 的文本**，
  // **从不回写 chat 数组**（对照 TT `script.js:5282-5312`：`getRegexedStringBatchAsync(...,
  // { isPrompt: true })` 的结果写进局部 `coreChat`，`chat` 保持原样）。
  //
  // DSH 的 pre-step `decision.messages` 会被宿主**落成 `user/message` 耐久事件**
  // （index.ts:2167 注释：「宿主硬约束：decision.messages 全部落 user/message 事件」）。
  // 故 pre-step 阶段只能跑「通用」脚本（`applyPromptRegexes(mode:'persist')`），
  // `promptOnly` 脚本必须推迟到本钩子 —— 这是「最终请求」投影点，其改写不会落盘
  // （TT 的 `GENERATE_AFTER_COMBINE_PROMPTS` 等价物）。
  //
  // 修复前的症状：Kemini 预设的「aether opus正则一」（`promptOnly:true`,
  // `maxDepth:1`, replaceString=`<interactive_input>\n$1\n</interactive_input>`）
  // 在 pre-step 就跑并被落盘 → 聊天记录被写成 `<interactive_input>…</interactive_input>`，
  // UI 气泡直接显示包装标签。
  ctx.on('llm/stream', (options: unknown, next: () => unknown) => {
    try {
      const o = options as {
        provider?: unknown; model?: unknown; sessionId?: unknown
        messages?: unknown[]; system?: unknown; tools?: unknown[]
        maxTokens?: unknown; temperature?: unknown; thinking?: unknown
        purpose?: unknown
      }
      const msgs0 = Array.isArray(o.messages) ? o.messages : []
      const head = msgs0.slice(0, 3).map((m) => {
        const mm = m as { role?: unknown; content?: unknown }
        const c = typeof mm.content === 'string' ? mm.content : JSON.stringify(mm.content ?? '')
        return `${String(mm.role ?? '?')}:${c.length}ch`
      })
      console.log(`[dsht-rp] llm/stream 观测: provider=${String(o.provider ?? '')} model=${String(o.model ?? '')} `
        + `messages=${msgs0.length} system=${typeof o.system === 'string' ? o.system.length + 'ch' : '(none)'} `
        + `tools=${Array.isArray(o.tools) ? o.tools.length : 0} maxTokens=${String(o.maxTokens ?? '')} `
        + `temp=${String(o.temperature ?? '')} purpose=${String(o.purpose ?? '')} sessionId=${String(o.sessionId ?? '')} `
        + `| 首3条: ${head.join(' ')}`)

      // ---- promptOnly 正则投影（不落盘）----
      // 【签名约束】llm/stream 是 generator 型 waterfall（dsh-llm/lib/types/index.d.ts:43
      // `next: () => AsyncIterable<StreamChunk>`），**不能**用 async handler（会返回 Promise
      // 而非 AsyncIterable，下游 validateStream 直接炸）。
      //
      // 【2026-09-10 二次修复：为什么不再直接改 o.messages】
      // 原实现 `o.messages = projected` 在实机抛
      //   TypeError: Cannot assign to read only property 'messages' of object '#<Object>'
      // 根因不是笔误，而是**宿主的架构约束**：
      //   - dsh-llm/lib/index.js:87 `isAgentLoopRequest` 的文档明写：loop 组装的 request
      //     到达本瀑布时 **deep-frozen（mutation throws）**，其内容是「会话日志的纯函数」
      //     （reconstructability Agent Note），**listeners read it, never rewrite it**；
      //   - dsh-agent-loop/lib/index.js:747 `markAgentLoopRequest(deepFreeze({...}))`
      //     正是那个 freeze 点。
      // 即 messages 的改写通道在架构上被**故意封死**（保证历史可从日志重建）。
      //
      // 那 promptOnly 投影该落在哪？——**落 system 槽位**（`system-prompt/assemble`
      // waterfall 是显式可变的：dsh-system-prompt/lib/types/index.d.ts:23 原文
      // "the **mutable** assembly built from registered providers"）。
      // 发送前由 pre-step 侧把「正则投影后的消息文本」发布进 `projectedPromptSections`，
      // 本钩子只负责**读**（日志/探针），真正的注入由 system 槽位完成。
      // 这样既满足 TT 语义（promptOnly 只影响发给模型的投影、不回写 chat），
      // 又不触碰任何 frozen 对象。
      const proj = preparedPromptProjections.get(String(o.sessionId ?? ''))
      if (proj !== undefined && proj.scripts.length > 0 && msgs0.length > 0) {
        const hits: Array<{ scriptName: string; count: number }> = []
        const projected = applyPromptRegexes(msgs0 as LikeMessage[], proj.scripts, hits, 'prompt')
        if (hits.length > 0) {
          // 【为什么这里只读不写】options 是 deep-frozen 的 loop request（见上）。
          // 投影结果改由 pre-step 发布到 system 槽位（projectedPromptSections）。
          // 此处仅记录命中，供日志与 Golden Master 对照取证。
          projectedPromptHits.set(String(o.sessionId ?? ''), {
            at: Date.now(),
            hits: hits.map(h => h.scriptName),
            chars: projected.reduce((n, m) => {
              const c = (m as { content?: unknown }).content
              if (typeof c === 'string') return n + c.length
              if (Array.isArray(c)) return n + c.reduce((k, b) => k + (typeof (b as { text?: unknown }).text === 'string' ? ((b as { text: string }).text.length) : 0), 0)
              return n
            }, 0),
          })
          console.log(`[dsht-rp] promptOnly 正则投影: ${hits.length} 条命中（${hits.map(h => h.scriptName).join('、')}）—— 经 system 槽位生效，未落盘`)
        }
      }
    } catch (e) {
      console.log(`[dsht-rp] llm/stream 观测失败: ${(e as Error).message}`)
    }
    return next()
  })

  ctx.on('agent/pre-step', async (raw, next) => {
    const decision = (await next()) as LikeDecision
    if (decision.kind !== 'enter') return decision
    const { agent, messages, signal } = raw as LikePreStepEvent

    const slug = rpSlugFromCwd(readSessionCwd(agent.session), dshHome)
    console.log(`[dsht-rp] pre-step: cwd=${readSessionCwd(agent.session) || '(none)'} slug=${slug ?? '(not-rp)'} turn=${(raw as LikePreStepEvent).turn}`)
    // ---- Golden Master 对照（DSHT 侧 dump#2）：**本批真正发给 LLM 的消息序列** ----
    // agent/request 瀑布只有采样参数；消息序列在 pre-step。rp/golden/dsht-ENABLED 存在时落盘，
    // 与 TT/ST 侧 chat_completion_prompt_ready（GENERATE_AFTER_COMBINE_PROMPTS）配对 diff。
    //
    // 【T-15 口径修正 2026-09-11】原实现落的是 `raw.messages`——即 **宿主传进来的原始批**
    // （RP 注入前的形态）。而 TT 侧 `chat_completion_prompt_ready` 抓的是**最终发给模型**的
    // 完整组装结果 → 两侧 dump 一比就是「我方少了整个世界书/预设/记忆注入」，差异全是假的。
    // 现改为在**每个出口**落 `decision.messages`（组装 + 第三方 `dsht-rp/assemble` 钩子后的最终态）。
    const dumpPrestepMessages = async (
      a: LikeAgent, msgs: LikeDecision['messages'], turn: number | null,
    ): Promise<void> => {
      try {
        if (!existsSync(join(dshHome, 'rp', 'golden', 'dsht-ENABLED'))) return
        const gdir = join(dshHome, 'rp', 'golden', 'dsht')
        await mkdir(gdir, { recursive: true })
        const seqFile = join(gdir, 'msg-seq.txt')
        let seq = 0
        try { seq = parseInt((await readFile(seqFile, 'utf8')).trim() || '0', 10) || 0 } catch { /* 首次 */ }
        seq += 1
        await writeFile(join(gdir, `msg-${String(seq).padStart(3, '0')}.json`), JSON.stringify({
          tag: 'agent_prestep_messages', seq, env: 'dshtavern', ts: new Date().toISOString(),
          cwd: readSessionCwd(a.session) || null,
          turn: turn ?? null,
          data: { messages: msgs },
        }, null, 1))
        await writeFile(seqFile, String(seq))
      } catch { /* golden dump 失败不影响主链路 */ }
    }
    if (slug === null) {
      await dumpPrestepMessages(agent, decision.messages, (raw as LikePreStepEvent).turn ?? null)
      return decision
    }
    try {
      signal.throwIfAborted()
      const rp = await loadRpJson(slug, signal)
      if (!rp) return decision
      const turnNo = (raw as LikePreStepEvent).turn ?? 0
      const traceKey = readHostSessionId(agent.session) || slug
      // I8-6：登记 live 会话（flush-all 通道的 flush 对象清单）
      registerLiveSession(traceKey, agent.session)
      // 【C-5 护栏 2026-09-20】RP 会话被切到 bychv「预设模式」（st-preset）时出声警告：
      // 该模式的 presetModeHistory 会过滤 source.plugin=dsh-system-prompt 的 system 消息——
      // RP 的全部注入（角色 persona/世界书/MVU/记忆）都汇在同一条 system 消息里，会被整体
      // 滤掉（角色 persona 全丢，机制见 PLUGIN-COMPAT §二b）。默认不可能走到这（RP 会话
      // agentPreset 为空、autoEnableModes 只含 st-preset），只在用户手动误切时出现。
      // 每会话每进程只报一次（防逐轮刷屏）。
      if (readHeaderAgentPreset(agent.session) === 'st-preset' && !presetModeWarned.has(traceKey)) {
        presetModeWarned.add(traceKey)
        console.log(`[dsht-rp] ⚠ RP 会话正处于 bychv「预设模式」（st-preset）——该模式会把 RP 注入整体过滤（角色 persona 丢失）。请在工作台切回默认模式（预设绑定不受影响）。session=${traceKey} slug=${slug}`)
      }

      // I4/I5 + R26 + R33：userName 单一事实源（persona active 优先）——EJS 生成期 ctx、
      // WI 宏上下文 macroCtx、withPresetLayer finalize 三处共用（此前各算各的：EJS 用
      // rp.macros.user 不含 persona、macroCtx 引用悬空——R33 实机炸过全注入链）
      globalUserProfile = await loadUserProfileCached(dshHome)
      const persona = await loadActivePersona(dshHome)
      const userName = persona?.name || globalUserProfile?.name || rp.macros.user || '用户'

      /**
       * T2.7：预设快照包装——本 handler 全部返回路径统一过这里（session 内随时
       * 切换预设：状态文件变了，下一轮即注入新预设内容，历史零搁浅）。
       * T2.3 扩展：同一次读取里顺带注入 MVU 状态摘要（stateSummary 槽位填充，
       * 变量树变化才注入，与预设/WI 快照并列去重）。
       */
      const withPresetLayer = async (d: LikeDecision): Promise<LikeDecision> => {
        // userName/persona/globalUserProfile 已在上方统一计算（persona active 优先）
        const userDesc = persona?.description || globalUserProfile?.description || ''
        void userDesc // persona 描述暂不进 prompt（persona 槽位由 withPersonaSnapshot 承担）
        // I4（ST 宏系统）：最终消息统一过核心宏（{{user}}/{{char}}/{{time}} 等——
        // 用户输入与世界书内容里的宏在生成期求值，ST 同语义）
        const finalize = (dd: LikeDecision): LikeDecision => {
          try {
            // I7（性能）：重载荷截断先行（工具参数 base64 等 10MB+ 大字符串占位化）
            // 【心跳 47】两处 `as` 直转失败：`LikeMessage`（有 role/content 必填）与
            // `Record<string, unknown>`（有字符串索引签名）互不可比 → TS2352。走 unknown 中转。
            const heavy = truncateHeavyToolPayloads(dd.messages as unknown as Array<Record<string, unknown>>)
            if (heavy.truncated > 0) console.log(`[dsht-rp] heavy-payload truncate: ${heavy.truncated} 个工具块参数占位化`)
            const macroCtx = {
              user: userName,
              char: rp.macros.char || rp.characterName,
            }
            const messages = (heavy.messages as unknown as LikeDecision['messages']).map(m => {
              if (!m || !Array.isArray(m.content)) return m
              let changed = false
              const content = m.content.map(b => {
                if (b && b.type === 'text' && typeof b.text === 'string' && b.text.includes('{{')) {
                  const next = expandCoreMacros(b.text, macroCtx)
                  if (next !== b.text) { changed = true; return { ...b, text: next } }
                }
                return b
              })
              return changed ? { ...m, content } : m
            })
            return { ...dd, messages }
          } catch { return dd }
        }
        try {
          signal.throwIfAborted()
          const sid = readHostSessionId(agent.session)
          if (!sid) return finalize(d)
          const st = await loadSessionState(sid)
          // ---- D-3 启用时：本区四类内容（状态/角色卡/记忆/表格）全部改由
          // `gatherSlotSections`（assemble 内现算）承担，此处**不再向 user 席位注入**。
          // 原因：assemble 先于 pre-step，靠 pre-step 发布会对首个 turn 失效（实机取证：
          // 一 turn 一步时发布只对下一 turn 可见）；且两处各算一遍必然分叉。
          // 关闭 D-3（slot-routing-OFF）时走原路径，行为与修复前完全一致。
          // ---- T2.3 状态摘要注入（先于预设；文本不变跳过）。§2.2 修正：影子化豁免每个
          // 签名的最新副本（planShadowOps），所以 retained 跳过安全——请求恒为一份副本，
          // 不会像 turn 43 那样双份（always-inject 会让请求多扛一份上轮副本 ~17 万 token）----
          const summary = renderStateSummary(st.state ?? st.variables ?? {})
          if (summary && retainedState.get(agent) !== summary) {
            retainedState.set(agent, summary)
            if (!SLOT_ROUTING) d = withStateSnapshot(d, summary)
          }
          // ---- 任务 2：promptPersona 卡设定快照（retained 跳过——影子化豁免最新副本）----
          const personaRaw = (rp.promptPersona ?? '').trim()
          if (personaRaw) {
            // T-79：经唯一处置漏斗（宏展开 → 越权标记消毒 + 残留转义 + nonce 围栏）。
            // 卡正文的宏展开只能发生在这里或 system 槽位那处（同一函数），不得就地再写一份。
            const personaText = await renderGuardedCardText(personaRaw, rp, slug, sid, 'snapshot')
            if (personaText && retainedPersona.get(agent) !== personaText) {
              retainedPersona.set(agent, personaText)
              if (!SLOT_ROUTING) d = withPersonaSnapshot(d, personaText)
            }
          }
          // ---- T3.2：长期记忆注入（世界书快照同一带区）：最近 20 条 `- [时间] 文本`；
          // 无记忆不注入；retained 跳过（影子化豁免最新副本）----
          const memoryText = renderMemorySnapshot((await loadMemory(dshHome, sid)).entries)
          if (memoryText) {
            const memorySnapshot = `【长期记忆】（此前固化的用户偏好/设定变动/承诺；生成回复前可先 memory_query 检索更多）\n${memoryText}`
            if (retainedMemory.get(agent) !== memorySnapshot) {
              retainedMemory.set(agent, memorySnapshot)
              if (!SLOT_ROUTING) d = withMemorySnapshot(d, memorySnapshot)
            }
          }
          // ---- E3：表格快照注入（st-memory-enhancement 表格系统）：会话有启用表且本 step
          // 来自用户轮才注入（工具轮零影响）；无表/渲染空不注入；retained 跳过（同上）----
          if (hasDirectUserInput(messages)) {
            try {
              const { sheets } = await loadSheets(dshHome, sid)
              const active = sheets.filter(s => s.enabled)
              if (active.length > 0) {
                const tablesText = renderTablePrompt(active)
                if (tablesText && retainedTables.get(agent) !== tablesText) {
                  retainedTables.set(agent, tablesText)
                  if (!SLOT_ROUTING) d = withTablesSnapshot(d, tablesText)
                }
              }
            } catch (e) {
              // 【心跳 47】原为空 catch（"不阻塞主流程"）：改成如实记录，否则表格快照永不注入也无迹可循。
              console.log(`[dsht-rp] 表格快照跳过（sheets 读取失败，不阻塞）：${(e as Error).message}`)
            }
          }
          // ---- T2.7/⑧ 预设注入（有效预设 = 显式选择 ?? ST 激活预设默认）----
          // relative 条目由 system-prompt/assemble 瀑布注入 request.system（顶部、prompt_order
          // 保序）；这里只承担 depth 条目（jailbreak 类）——真深度 splice（ST in-chat 注入语义），
          // 签名快照形态（planShadowOps 同签名只留最新副本，防逐轮堆积）。
          // 【管线切换 2026-09-20】bychv 绑定启用的会话：depth 条目注入跳过
          // （预设内容统一归其 llm/stream 编译；详见 bychvPresetOwned 头注）。
          if (await bychvPresetOwned(sid)) return finalize(d)
          const effectivePresetId = typeof st.presetId === 'string' && st.presetId
            ? st.presetId
            : await resolveActiveStPresetId()
          if (!effectivePresetId) {
            return finalize(d)
          }
          const preset = await resolvePreset(effectivePresetId, signal)
          if (!preset) return finalize(d)
          // P1#6：agent 型预设的能力轴探测独立于内容去重（agent preset 切换时 prompt 可能未变）
          if (preset.path === 'agent') void probeCapabilityAxis(agent, preset)
          const depthSlots = compileSlots(preset).filter(s =>
            s.depth != null && s.content.trim() !== '' &&
            evalSlotCondition(s.condition, (st.state ?? st.variables ?? {}) as Record<string, unknown>))
          if (depthSlots.length === 0) return finalize(d)
          const depthTexts: Array<{ depth: number; role: string; content: string }> = []
          for (const slot of depthSlots) {
            const text = (await expandSnapshotMacros(slot.content.trim(), rp, slug, sid)).trim()
            if (text) depthTexts.push({ depth: slot.depth ?? 0, role: slot.role, content: text })
          }
          if (depthTexts.length === 0) return finalize(d)
          const byDepth = new Map<number, string[]>()
          for (const t of depthTexts) {
            const l = byDepth.get(t.depth) ?? []
            l.push(t.content)
            byDepth.set(t.depth, l)
          }
          let msgs = d.messages
          for (const [depth, list] of [...byDepth.entries()].sort((a, b) => b[0] - a[0])) {
            const text = neutralizeResidualMacros(list.join('\n'))
            const m = {
              role: 'user', // restore 校验：user/message 的 role 必须 'user'（同 spliceDepthInjections）
              content: [{ type: 'text', text }],
              source: { kind: 'plugin', plugin: name, form: 'snapshot', sections: [{ name: 'dsht-rp:preset-depth', text }] },
              id: `dsht-rp-preset-depth-${randomUUID()}`,
            } as unknown as LikeMessage
            const at = Math.max(0, msgs.length - depth)
            msgs = [...msgs.slice(0, at), m, ...msgs.slice(at)]
          }
          console.log(`[dsht-rp] preset depth inject: ${preset.displayName} ${depthTexts.length} 条目（depth=${[...byDepth.keys()].join(',')}）`)
          return finalize({ kind: d.kind, messages: msgs })
        } catch { return finalize(d) }
      }

      // 【hook 移植 L3】assemble 挂点（ST GENERATE_AFTER_COMBINE_PROMPTS / GENERATE_AFTER_DATA
      // 对应物）：本 handler 全部正常返回路径统一过这里——第三方插件 ctx.on('dsht-rp/assemble',
      // (p, next) => ...) 可在最终决定发给模型前改写 decision.messages（p.decision 读回语义）。
      // 异常路径（catch 降级为普通会话）不过挂点——钩子失败不该连坐已有容错。
      const viaAssembleHook = async (dp: Promise<LikeDecision>): Promise<LikeDecision> => {
        const dd = await dp
        const out = await ctx.waterfall(null, 'dsht-rp/assemble',
          { agent, sessionId: traceKey, slug, turn: turnNo, decision: dd },
          (p: { decision: LikeDecision }) => Promise.resolve(p.decision)) as LikeDecision
        // 【T-15】Golden dump 落**最终态**（组装 + assemble 钩子之后）——与 TT 侧
        // chat_completion_prompt_ready 同口径，两侧 diff 才有意义。
        await dumpPrestepMessages(agent, out.messages, turnNo)
        return out
      }

      // ---- 组装管线（§4.1）步骤 1：正则 prompt 时机跑完整批（enter decision.messages）----
      // 注意不能只跑 payload.messages（claimed 新消息）：多 step turn 里后续 step 的批由
      // DSH 从 surface 原文重建，claimed 已空——只跑 claimed 会让正则在 step 2+ 失效。
      // ST 语义 = 每轮对整个 prompt 过正则 → 对 decision.messages 全批跑。
      // T2.8：三源合并（全局 + 预设 + 角色）
      const sessionIdForRegex = readHostSessionId(agent.session)
      const regexScripts = await mergedRegex(rp, signal, sessionIdForRegex)
      // 【2026-09-10】预热 promptOnly 投影脚本（供 llm/stream 同步读取——该钩子是 generator
      // 型 waterfall，handler 不能 async）。只留 promptOnly 脚本，减少钩子内过滤开销。
      if (sessionIdForRegex) {
        preparedPromptProjections.set(sessionIdForRegex, {
          slug: slug ?? '',
          scripts: regexScripts.filter(s => s.promptOnly === true),
        })
      }
      const regexHits: Array<{ scriptName: string; count: number }> = []
      // 【hook 移植 L3 2026-09-06】RP 域自定义 cordis 事件链（ST/Luker generate() 分段开放
      // 挂点的同构建面）。设计决策：内置逻辑作 waterfall 的 fallback（最内层 next），第三方
      // 插件 ctx.on('dsht-rp/regex', (p, next) => ...) 包裹/改写/否决——cordis 官方惯用法
      // （与 agent/pre-step 的默认 enter 决策同款）。注意首参 null：cordis dispatch 会把
      // 首个 object 参数误当 scope thisArg（cordis/lib/index.js:259），必须显式占住。
      // 事件链：dsht-rp/turn(emit) → dsht-rp/regex(waterfall) → dsht-rp/wi-scan(waterfall)
      //        → dsht-rp/wi-activated(emit) → dsht-rp/wi-finalize(waterfall) → dsht-rp/assemble(waterfall)
      // 【2026-09-10 TT 语义修正】本批只跑「通用」脚本（mode:'persist'——排除 promptOnly）。
      // 原因：此处结果会随 decision.messages 落 user/message 耐久事件，而 promptOnly 脚本
      // 按 ST/TT 语义只该影响发给 LLM 的投影、不该改聊天记录本体（TT script.js:5282-5312
      // 写的是局部 coreChat）。promptOnly 统一推迟到 llm/stream 投影（不落盘）。
      ctx.emit(null, 'dsht-rp/turn', { sessionId: sessionIdForRegex, slug, turn: turnNo })
      let batch = await ctx.waterfall(null, 'dsht-rp/regex',
        { agent, sessionId: sessionIdForRegex, slug, turn: turnNo, messages: decision.messages, hits: regexHits },
        (p: { messages: LikeDecision['messages'] }) => applyPromptRegexes(
          p.messages, regexScripts, regexHits, 'persist',
          { user: userName, char: rp.macros.char || rp.characterName },
        )) as LikeDecision['messages']

      // ---- B9 + B2（提示词模板生成期管线；rp/ejs-settings.json 驱动）----
      // B9 filter_chat_message：楼层里的 <% %> 模板语句剥除（不进模型上下文）；
      // B2 generate_enabled：含 <% %> 的楼层在生成期自求值（template='' → 消息文本即模板，
      // chatDepth 深度门控同款）。二者互斥（过滤优先——ST 同序）。
      try {
        const ejs = await loadEjsSettings(dshHome)
        // ①轮收口：EJS ctx 的 user 也走 persona 优先的 userName（原来用 rp.macros.user，
        // persona 切换后 EJS 楼层自求值的 {{user}} 与其他通道不一致）
        const ejsCtx = { user: userName, char: rp.macros.char || rp.characterName }
        if (ejs.enabled !== false && ejs.filterChatMessage === true) {
          const fr = filterTemplateStatements(batch as unknown as Array<Record<string, unknown>>)
          if (fr.filtered > 0) {
            batch = fr.messages as unknown as typeof batch
            regexHits.push({ scriptName: 'ejs:filter-chat-message', count: fr.filtered })
            console.log(`[dsht-rp] ejs filter-chat: ${fr.filtered} 条消息剥除 <% %> 模板语句`)
          }
        } else if (ejs.enabled !== false && ejs.generateEnabled === true) {
          const depthLimit = typeof ejs.chatDepth === 'number' ? ejs.chatDepth : -1
          const idxs: number[] = []
          batch.forEach((m, i) => {
            const depth = batch.length - 1 - i
            if (depthLimit >= 0 && depth >= depthLimit) return
            const content = (m as { content?: Array<{ type?: unknown }> }).content
            if (!Array.isArray(content)) return
            const textBlocks = content.filter(b => b?.type === 'text')
            if (textBlocks.length !== 1 || content.length !== textBlocks.length) return // 多块/推理块消息跳过（防结构破坏）
            if (messageText(m).includes('<%')) idxs.push(i)
          })
          if (idxs.length > 0) {
            const stMsgs: LikeStMessage[] = idxs.map(i => ({ mes: messageText(batch[i]), role: batch[i].role }))
            // 【心跳 47 修复】两个引擎的返回形状必须归一：
            //  · sandbox 引擎 → SandboxMessagesResult（ok:true 时 `messages` 是**数组**）
            //  · subset 引擎的 renderMessages → **对象** {messages, rendered, skipped}（ejs.ts:521）
            // 原实现写作 `{ ok: true, messages: ejsRenderMessages(...) }`，把**对象**塞进了 messages 字段
            // → 下面 `r.messages[k]` 恒 undefined → `mes` 恒 '' → **含 <% %> 的楼层正文被静默清空**，
            // 且因 batch 随 decision.messages 落盘，是"写得成功、无报错、内容全错"（LEARNINGS L24 同族）。
            // 类型闸门一开即报 TS7053（number 不能索引该联合类型）。
            let r: SandboxMessagesResult
            if (ejs.sandbox === true) {
              r = ejsRenderMessagesSandboxVm('', ejsCtx, stMsgs)
            } else {
              r = asSandboxMessagesResult(ejsRenderMessages('', ejsCtx, stMsgs))
            }
            if (r.ok) {
              batch = [...batch]
              idxs.forEach((origIdx, k) => {
                const mes = String(r.messages[k]?.mes ?? '')
                batch[origIdx] = { ...batch[origIdx], content: [{ type: 'text', text: mes }] } as typeof batch[typeof origIdx]
              })
              console.log(`[dsht-rp] ejs generate: ${idxs.length} 条楼层自求值（engine=${ejs.sandbox === true ? 'sandbox' : 'subset'}）`)
            } else {
              console.log(`[dsht-rp] ejs generate 失败（kind=${r.kind}）——原文透传`)
            }
          }
        }
      } catch (e) {
        console.log(`[dsht-rp] ejs generate/filter 管线异常（原文透传）：${(e as Error).message}`)
      }

      // ---- T2.3：MVU 状态提取（本批新 assistant 消息的 <UpdateVariable> → 合并落盘）----
      // 幂等：按消息 id 去重（多 step turn 后续 step 的批从 surface 重建，防 delta 重复累加）
      const stateSid = readHostSessionId(agent.session)
      if (stateSid) {
        const st0 = await loadSessionState(stateSid)
        let sessionState = st0.state ?? {}
        let dirty = false
        for (const msg of batch) {
          if (msg.role !== 'assistant' || msg.source?.form === 'snapshot') continue
          const mid = (msg as { id?: string }).id
          if (!mid || stateSeen.has(mid)) continue
          // D2/D3：UpdateVariable 块优先，裸 <JSONPatch> 兜底（新一代卡直接输出 JSONPatch）
          const patches0 = parseUpdateVariable(messageText(msg))
          const patches = patches0.length > 0 ? patches0 : parseJsonPatches(messageText(msg))
          if (patches.length > 0) {
            sessionState = applyStatePatches(sessionState, patches)
            stateSeen.add(mid)
            dirty = true
          }
        }
        if (dirty) {
          const st1 = await loadSessionState(stateSid)
          st1.state = sessionState
          await saveSessionState(stateSid, st1)
          console.log(`[dsht-rp] MVU state updated: ${Object.keys(sessionState).length} top keys (${stateSid})`)
        }
      }

      // ---- T2.3b（2026-09-20 修复）：direct 形态 assistant 文本块的 surface 增量提取 ----
      // 根因（官方 dsh-agent-loop preStep 实证）：T2.3 扫的 batch = enter decision.messages
      // = inbox.claim（增量输入）——历史 assistant 消息**从不在其中**（claimed 只有用户输入/
      // 工具结果）⇒ 「assistant 文本 UpdateVariable/JSONPatch 提取」从未命中过任何消息。
      // agent 卡靠 state_update 工具兜底所以未暴露；direct 卡无工具 ⇒ 该 ST 主路径结构性全哑
      // （模拟器对照实验 + st-87rfra 真实 state 历来为空双实证，GOAL-PRESET-SWITCH W-A1）。
      // 本段对 **direct 形态**（shouldStripRpTools；agent 卡走工具路径——文本块提取对它启用
      // 会引入「文本块 + 工具调用同轮双写」的 delta 重复风险，故保守排除，GOAL 负控①）：
      // 从 surface 事件流增量扫 assistant/message 事件提取。
      // 游标 mvuExtractSeq 持久化在 rp/state/<sid>.json：进程重启不重扫；
      // 首见无游标 = 锚到当前 surface 末尾（不补扫历史——delta 补扫不可控）。
      try {
        if (stateSid) {
          const resolvedForMvu = await resolveAgentPreset(agent)
          if (shouldStripRpTools(resolvedForMvu?.preset.path)) {
            const surfaceSeqs = readSurfaceNodes(agent.session)
            const stM = await loadSessionState(stateSid)
            const lastSeq = typeof stM.mvuExtractSeq === 'number' ? stM.mvuExtractSeq : null
            if (lastSeq === null) {
              const tail = surfaceSeqs.length > 0 ? surfaceSeqs[surfaceSeqs.length - 1] : 0
              if (tail > 0) {
                stM.mvuExtractSeq = tail
                await saveSessionState(stateSid, stM)
              }
            } else {
              let tree = stM.state ?? {}
              let dirty = false
              let maxSeq = lastSeq
              // 【MVU-1 调试面 2026-09-21】提取打点：扫描/命中计数落 state.lastExtract，
              // client 调试模式轮询 /dsht-mvu/last-extract 进 toasts（命中/未中各一条）
              let scanned = 0
              let patchCount = 0
              for (const seq of surfaceSeqs) {
                if (seq <= lastSeq) continue
                // 读取方式与 scanSurfaceHistory 同源（0.1.2 坑 #22：eventAt 优先，events 直索引兜底）
                const ev = typeof (agent.session as unknown as { eventAt?: unknown }).eventAt === 'function'
                  ? (agent.session as unknown as { eventAt: (q: number) => { type?: string; data?: unknown } | undefined }).eventAt(seq)
                  : (agent.session as unknown as { events?: Record<number, { type?: string; data?: unknown }> }).events?.[seq]
                if (ev?.type !== 'assistant/message') continue
                const msg = (ev.data as { message?: LikeMessage } | undefined)?.message
                // 无论可否提取都推进游标（这条消息不属于提取面，不是漏扫）
                if (!msg || !Array.isArray(msg.content)) { maxSeq = Math.max(maxSeq, seq); continue }
                if (msg.source?.form === 'snapshot' || msg.source?.plugin === name) { maxSeq = Math.max(maxSeq, seq); continue }
                // 官方 assistant 消息可能无 id（DSH 事件本体 id 可选）——无 id 按内容 hash 去重
                const mid = typeof msg.id === 'string' && msg.id ? msg.id : `h:${hash36(messageText(msg))}`
                if (stateSeen.has(mid)) { maxSeq = Math.max(maxSeq, seq); continue }
                scanned += 1
                const patches0 = parseUpdateVariable(messageText(msg))
                const patches = patches0.length > 0 ? patches0 : parseJsonPatches(messageText(msg))
                if (patches.length > 0) {
                  tree = applyStatePatches(tree, patches)
                  stateSeen.add(mid)
                  patchCount += patches.length
                  dirty = true
                }
                maxSeq = Math.max(maxSeq, seq)
              }
              if (dirty || maxSeq !== lastSeq) {
                const stM2 = await loadSessionState(stateSid)
                if (dirty) stM2.state = tree
                stM2.mvuExtractSeq = maxSeq
                if (scanned > 0 || dirty) stM2.lastExtract = { ts: Date.now(), scanned, patches: patchCount, applied: dirty }
                await saveSessionState(stateSid, stM2)
                if (dirty) console.log(`[dsht-rp] MVU surface extract (direct): ${Object.keys(tree).length} top keys (${stateSid})`)
              }
            }
          }
        }
      } catch (e) {
        console.log(`[dsht-rp] MVU surface extract 失败（不阻塞主链路）：${(e as Error).message}`)
      }

      // ---- P0-5：per-turn 闸门 + 时间游标 ----
      // 闸门：本 step 的 inbox 消息里没有 source.kind==='user' 的真实用户消息 =
      // 工具/思考轮 → 跳过世界书注入（不重复注入；prompt 正则与 MVU 提取不受影响）。
      // 游标：事件流里真实 user/assistant 消息累计数（排除插件注入/快照），写进
      // rp/state/<sid>.json 的 cursor 键（变化才写盘）。
      const cursor = visibleMessageCursor(sessionEventsSnapshot(agent.session))
      if (stateSid) {
        const stc = await loadSessionState(stateSid)
        if (stc.cursor !== cursor) {
          stc.cursor = cursor
          await saveSessionState(stateSid, stc)
        }
      }
      const hasUserInput = hasDirectUserInput((raw as LikePreStepEvent).messages)
      if (!hasUserInput) {
        console.log(`[dsht-rp] pre-step: 工具轮（无真实用户消息），跳过世界书注入（cursor=${cursor}）`)
        return await viaAssembleHook(withPresetLayer({ ...decision, messages: batch }))
      }

      // 触发扫描（M1 引擎）：历史 + 本批消息（扫描文本也过 prompt 正则——ST 语义：WI 看到的是正则后文本）
      const history = scanSurfaceHistory(agent.session, batch, rp.trigger.scanDepth ?? 2, regexScripts)
      const entries: LoreEntry[] = []
      for (const b of rp.books) {
        const book = await loadBook(b.lorePath, signal)
        if (book) entries.push(...book.entries)
      }

      // ---- D1（MVU initvar）+ B12（预载世界书）：开局变量初始化——
      // <initvar>/[initvar]/[InitialVariables]/<defineEJSVariable> 块解析合并进
      // rp/state/<sid>.json 的 variables（幂等：内容 hash 记账，世界书变了才重放）。
      if (stateSid && entries.length > 0) {
        try {
          const initTree = parseInitVariables(entries)
          const initHash = JSON.stringify(initTree)
          if (Object.keys(initTree).length > 0) {
            const sti = await loadSessionState(stateSid)
            if ((sti as { mvuInitHash?: unknown }).mvuInitHash !== initHash) {
              const before = (sti.variables ?? {}) as Record<string, unknown>
              sti.variables = deepMergeInitVars(before, initTree)
              // 【审查修复 2026-09-05】双写 state 树——生成期摘要读 state ?? variables、
              // 状态栏读 variables ?? state：两树都初始化避免分叉（运行期 UpdateVariable 只写 state）
              sti.state = deepMergeInitVars((sti.state ?? {}) as Record<string, unknown>, initTree)
              ;(sti as { mvuInitHash?: unknown }).mvuInitHash = initHash
              await saveSessionState(stateSid, sti)
              logLine(`MVU initvar：世界书变量初始化 ${Object.keys(initTree).length} 个顶层键（${stateSid}）`)
              console.log(`[dsht-rp] mvu initvar: +${Object.keys(initTree).length} top keys (${stateSid})`)
            }
          }
        } catch (e) { console.log(`[dsht-rp] mvu initvar 失败（不阻塞）：${(e as Error).message}`) }
      }

      // 新会话首步：开场白注入（surface 无任何消息时，firstMes 作为剧情起点进快照）
      const isNewChat = readSurfaceNodes(agent.session).every(seq => {
        const ev = sessionEventAt(agent.session, seq)
        return ev === undefined || (ev.type !== 'user/message' && ev.type !== 'assistant/message')
      })
      const opening = isNewChat && rp.firstMes ? `【故事开场（已发生的剧情）】\n${rp.firstMes}\n\n【开场结束。自此用户介入剧情。】\n\n` : ''

      // 宏上下文（§4.1.1：WI 内容组装期求值；stableSeed 锚定 pick 宏）
      // userName 用上方统一计算的（persona active 优先，R33 悬空引用事故的收口）
      const macroCtx: MacroContext = {
              user: userName,
              char: rp.macros.char,
              stableSeed: `rp-${slug}`,
            }

      const traceRuntime: AssemblyTraceRuntime = {
        sessionId: readHostSessionId(agent.session) || slug,
        turn: turnNo,
        ts: Date.now(),
        regexHits: [],
        activatedEntries: [],
        depthInjections: [],
        snapshotChars: 0,
        droppedByBudget: 0,
      }
      /** turn 内聚合（存 trace 时调用）：step 1 净化过的消息在 step 2 的批里保持净化（不重复命中），
       * 各 step 的命中按 scriptName 累加；turn 变化则重开新 trace */
      const mergeTraceHits = () => {
        const prev = lastTrace.get(traceKey)
        const merged = new Map((prev && prev.turn === turnNo ? prev.regexHits : []).map(h => [h.scriptName, h.count]))
        for (const h of regexHits) merged.set(h.scriptName, (merged.get(h.scriptName) ?? 0) + h.count)
        traceRuntime.regexHits = [...merged].map(([scriptName, count]) => ({ scriptName, count }))
      }

      if (entries.length === 0) {
        console.log(`[dsht-rp] no book entries loaded (books=${rp.books.length}, dshHome=${dshHome})`)
        mergeTraceHits(); lastTrace.set(traceKey, traceRuntime)
        if (opening) {
          // 无书但新会话：开场白单独成快照（任务 1：过宏引擎——开场白可含 {{setvar}} 等）
          const openingOnly = await expandSnapshotMacros(`${opening}Current active worldbook entries: none.`, rp, slug, sessionIdForRegex)
          if (retained.get(agent) !== openingOnly) {
            retained.set(agent, openingOnly)
            traceRuntime.snapshotChars = openingOnly.length
            return await viaAssembleHook(withPresetLayer(withSnapshot({ ...decision, messages: batch }, openingOnly)))
          }
        }
        return await viaAssembleHook(withPresetLayer({ ...decision, messages: batch }))
      }
      // P2#11：跨轮 timed effects（sticky/cooldown）从 rp/state/<sid>.json 的 loreTimed 键读回，
      // 时间轴 = 上方已算好的 visibleMessageCursor；本轮新写入的 effect 由引擎合入结果返回后写回。
      let priorTimed: TimedEffect[] = []
      if (stateSid) {
        const stt = await loadSessionState(stateSid)
        if (Array.isArray(stt.loreTimed)) priorTimed = stt.loreTimed
      }
      // 【hook 移植 L3】wi-scan 挂点（ST GENERATION_BEFORE/AFTER_WORLD_INFO_SCAN 对应物）：
      // 第三方可改写扫描输入（history/entries/options）或完全接管（不调 next 自产 result）
      const wiScanOptions = {
        scanDepth: rp.trigger.scanDepth ?? 2,
        matchWholeWords: rp.trigger.matchWholeWords ?? false,
        budgetPercent: rp.trigger.budgetPercent ?? 25,
        budgetCap: rp.trigger.budgetCap ?? 6000,
        cursor,
        timedEffects: priorTimed,
      }
      const result = await ctx.waterfall(null, 'dsht-rp/wi-scan',
        { agent, sessionId: stateSid, slug, turn: turnNo, history, entries, options: wiScanOptions },
        (p: { entries: LoreEntry[]; history: unknown; options: typeof wiScanOptions }) =>
          Promise.resolve(triggerWorldInfo(p.entries, p.history as never, p.options))) as ReturnType<typeof triggerWorldInfo>
      if (stateSid) {
        const stw = await loadSessionState(stateSid)
        if (JSON.stringify(stw.loreTimed ?? []) !== JSON.stringify(result.timedEffects)) {
          stw.loreTimed = result.timedEffects
          await saveSessionState(stateSid, stw)
        }
      }
      traceRuntime.droppedByBudget = result.budgetDropped.length

      // ---- 步骤 2+4：激活条目 → 正则（WORLD_INFO）+ 宏求值 + 位置分桶 ----
      // 【hook 移植 L3】wi-activated 通知（ST WORLD_INFO_ACTIVATED）+ wi-finalize 挂点
      // （ST GENERATION_WORLD_INFO_FINALIZED 对应物：分桶产物可改写）
      ctx.emit(null, 'dsht-rp/wi-activated', {
        sessionId: stateSid, slug, turn: turnNo,
        entries: result.activated.map(a => ({ comment: a.entry.comment, reason: a.reason })),
      })
      const buckets = await ctx.waterfall(null, 'dsht-rp/wi-finalize',
        { agent, sessionId: stateSid, slug, turn: turnNo, result, buckets: processActivatedEntries(result.activated, regexScripts, macroCtx, regexHits) },
        (p: { buckets: ReturnType<typeof processActivatedEntries> }) => p.buckets) as ReturnType<typeof processActivatedEntries>
      traceRuntime.activatedEntries = result.activated.map(a => ({
        comment: a.entry.comment,
        reason: a.reason,
        position: a.entry.position === 4 ? `depth-${a.entry.depth}` : a.entry.position === 1 ? 'after' : 'before',
      }))
      traceRuntime.depthInjections = buckets.atDepth.map(d => ({ depth: d.depth, chars: d.content.length }))

      // ---- 步骤 3：深度注入条目 splice 进本批（BEFORE/AFTER 走快照）----
      batch = spliceDepthInjections(batch, buckets.atDepth)

      // ---- B4：@Inject 指令条目（ST inject_loader）——不看关键词激活，按 depth 定位注入
      // （depth = 距批尾的消息数；order 大者优先；内容过 EJS 求值 + 宏引擎双通道）----
      try {
        const ejsInj = await loadEjsSettings(dshHome)
        if (ejsInj.enabled !== false && ejsInj.injectLoaderEnabled === true) {
          const inj = scanInjectEntries(entries.filter(e => entryActive(e as { disable?: unknown; enabled?: unknown }, ejsInj.invertEnabled === true)))
            .sort((a, b) => b.order - a.order)
          for (const d of inj) {
            const text = await expandSnapshotMacros(
              renderEjsSubset(d.entry.content, { user: macroCtx.user, char: macroCtx.char }),
              rp, slug, sessionIdForRegex)
            const pos = Math.max(0, Math.min(d.depth, batch.length))
            // 【⑧审查修复 2026-09-06】role 强制 user + 补 id/source 契约——原实现透传
            // d.role（system/assistant）且无 id：decision.messages 全落 user/message 事件，
            // 冷启动 restore 校验（assertMessageEventShape：role 必须 user + id 必填）
            // 必拒 → 含 @Inject 注入的会话重启即 corrupt。role 语义以签名节名承载。
            const clean = neutralizeResidualMacros(text)
            batch = [...batch.slice(0, batch.length - pos), {
              role: 'user',
              content: [{ type: 'text', text: clean }],
              source: { kind: 'plugin', plugin: name, form: 'snapshot', sections: [{ name: `dsht-rp:ejs-inject:${d.role}`, text: clean }] },
              id: `dsht-rp-ejs-inject-${randomUUID()}`,
            } as unknown as LikeMessage, ...batch.slice(batch.length - pos)]
            traceRuntime.snapshotChars += text.length
          }
          if (inj.length > 0) console.log(`[dsht-rp] ejs inject: ${inj.length} 条 @Inject 指令注入`)
        }
        // ---- C8 消费端：酒馆助手 injectPrompts（rp/th-injections/<sid>.json）——
        // 脚本经 TH 插件 /inject 写入，本侧按 depth/role 注入；once 条目注入后删除 ----
        if (stateSid) {
          const injFile = join(dshHome, 'rp', 'th-injections', `${stateSid}.json`)
          const injList = await readFile(injFile, 'utf8')
            .then(t => JSON.parse(t) as Array<Record<string, unknown>>)
            .catch(() => [] as Array<Record<string, unknown>>)
          if (Array.isArray(injList) && injList.length > 0) {
            const onceKeys: string[] = []
            const sorted = [...injList].sort((a, b) => Number(b.order ?? 100) - Number(a.order ?? 100))
            for (const inj of sorted) {
              const text = String(inj.prompt ?? '')
              if (!text.trim()) continue
              const depth = Math.max(0, Math.min(Number(inj.depth ?? 4), batch.length))
              const roleRaw = String(inj.role ?? 'system')
              const pos = batch.length - depth
              // 【⑧审查修复 2026-09-06】同 @Inject 修复：role 强制 user + 补 id（restore
              // 校验硬约束），role 语义以签名节名承载；form:'snapshot' 让旧副本被影子化
              const clean = neutralizeResidualMacros(text)
              batch = [...batch.slice(0, pos), {
                role: 'user',
                content: [{ type: 'text', text: clean }],
                source: { kind: 'plugin', plugin: name, form: 'snapshot', sections: [{ name: `dsht-rp:th-inject:${roleRaw}`, text: clean }] },
                id: `dsht-rp-th-inject-${randomUUID()}`,
              } as unknown as LikeMessage, ...batch.slice(pos)]
              if (inj.once === true && typeof inj.key === 'string') onceKeys.push(inj.key)
              traceRuntime.snapshotChars += text.length
            }
            if (onceKeys.length > 0) {
              const rest = injList.filter(e => !(e.once === true && typeof e.key === 'string' && onceKeys.includes(e.key)))
              await mkdir(dirname(injFile), { recursive: true })
              // 【审查修复 2026-09-05】once 消费写回原子化（I8-2 同款规范，防 TH /inject 并发时丢更新）
              await atomicWriteFile(injFile, JSON.stringify(rest))
            }
            console.log(`[dsht-rp] th injects: ${sorted.length} 条酒馆助手注入（once 消费 ${onceKeys.length}）`)
          }
        }
      } catch (e) { console.log(`[dsht-rp] ejs inject 失败（跳过）：${(e as Error).message}`) }

      // ---- B3：[GENERATE:BEFORE/AFTER] 条目（ST generate_loader）——不看激活，生成期恒注入
      // （BEFORE → WI 快照带区前；AFTER → 后；内容过 EJS 求值 + 宏引擎）----
      let genPrefix = ''
      let genSuffix = ''
      try {
        const ejsGen = await loadEjsSettings(dshHome)
        if (ejsGen.enabled !== false && ejsGen.generateLoaderEnabled === true) {
          const ge = scanGenerateEntries(entries.filter(e => entryActive(e as { disable?: unknown; enabled?: unknown }, ejsGen.invertEnabled === true)))
          const evalEntry = async (e: LoreEntry): Promise<string> => expandSnapshotMacros(
            renderEjsSubset(e.content, { user: macroCtx.user, char: macroCtx.char }), rp, slug, sessionIdForRegex)
          const bef = await Promise.all(ge.before.map(evalEntry))
          const aft = await Promise.all(ge.after.map(evalEntry))
          genPrefix = bef.filter(Boolean).join('\n')
          genSuffix = aft.filter(Boolean).join('\n')
          if (genPrefix || genSuffix) console.log(`[dsht-rp] ejs generate-loader: BEFORE=${ge.before.length} AFTER=${ge.after.length}`)
        }
      } catch (e) { console.log(`[dsht-rp] ejs generate-loader 失败（跳过）：${(e as Error).message}`) }

      // 常驻/关键词条目（BEFORE/AFTER）→ 快照（官方 runtime-context 语义）
      const snapshotEntries = [
        ...buckets.before.map(b => ({ entry: { comment: b.comment, content: b.content } as LoreEntry, reason: b.reason })),
        ...buckets.after.map(b => ({ entry: { comment: b.comment, content: b.content } as LoreEntry, reason: b.reason })),
      ]
      const baseDecision: LikeDecision = { ...decision, messages: batch }

      if (snapshotEntries.length === 0 && buckets.atDepth.length === 0 && !genPrefix && !genSuffix) {
        // 无激活：清空 retained，下轮内容变化才再注入（正则/深度注入已应用）
        console.log(`[dsht-rp] no activation (entries=${entries.length}, history=${history.length})`)
        retained.set(agent, '')
        mergeTraceHits(); lastTrace.set(traceKey, traceRuntime)
        return await viaAssembleHook(withPresetLayer(baseDecision))
      }
      // 任务 1：快照文本过宏引擎（WI 条目内容已在 processActivatedEntries 过旧引擎求值；
      // 这里补全 getvar/setvar/time 等酒馆助手宏的真语义，未知宏原样保留）
      const snapshotText = await expandSnapshotMacros(opening + genPrefix + renderWorldInfoSnapshot(snapshotEntries, rp.macros) + genSuffix, rp, slug, sessionIdForRegex)
      traceRuntime.snapshotChars = snapshotText.length
      mergeTraceHits(); lastTrace.set(traceKey, traceRuntime)
      console.log(`[dsht-rp] scan: entries=${entries.length} activated=${result.activated.length} dropped=${result.budgetDropped.length} snapshot=${snapshotText.length}ch depthInj=${buckets.atDepth.length} regexHits=${regexHits.length}${opening ? ' (+opening)' : ''}`)
      // retained 跳过（影子化豁免最新副本—— WI 快照恒一份）
      if (retained.get(agent) === snapshotText) return await viaAssembleHook(withPresetLayer(baseDecision))
      retained.set(agent, snapshotText)
      // ---- D-3：世界书 → system 槽位（TT dump-008 的 [6]/[7] World_Lore_Database 同位置语义）----
      // 与 withPresetLayer 内部的 slot 发布共用同一张表：世界书在 pre-step 的两个分支里
      // 计算（有激活/无激活），本处覆盖"有激活"的主路径。合并而非覆盖，避免把
      // withPresetLayer 已发布的状态树/记忆丢掉。
      if (SLOT_ROUTING) {
        publishSlots(agent, [
          { name: 'dsht-rp:slot:worldbook', order: SLOT_ORDERS.worldbook, text: snapshotText },
        ])
        return await viaAssembleHook(withPresetLayer(baseDecision))
      }
      return await viaAssembleHook(withPresetLayer(withSnapshot(baseDecision, snapshotText)))
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') throw error
      // RP 注入失败不阻塞对话（降级为普通会话）
      console.log(`[dsht-rp] pre-step error: ${(error as Error)?.message}`)
      return decision
    }
  })

  // ---- 变体操作 + RP 数据 HTTP 数据面：ctx.webServer 前缀路由 /dsht-rp/*（T2.5f）----
  // 同源（DSH web UI 页面直接 fetch('/dsht-rp/...')）、零端口冲突、无 CORS。
  // 旧 3081 独立端口方案废弃：端口被占时 server.listen 的未处理 error 会击穿
  // 整个 DSH 进程（实测），且 Android WebView appassets 页面跨源需 JS Bridge 特判。
  // POST /dsht-rp/variant/switch {sessionId, targetSeq} —— 切回历史变体（含重roll后的旧版本回看）
  // POST /dsht-rp/variant/groups {sessionId} —— 变体组清单（前端渲染左右切换箭头）
  // POST /dsht-rp/rp/home {} / /dsht-rp/rp/workspaces {} / /dsht-rp/rp/import-card { json } / /dsht-rp/llm/classify
  // ---- 构建信息 / 更新检查（T-27）：GET 与 POST 双通 ----
  // 【2026-09-11 心跳 46 · 静默失败修复】`/rp/build-info` 原先**只挂在 GET 块**，而前端
  // `rpApi()` 恒为 POST → 实机 POST 恒 404，客户端 `.catch(() => setBuildInfo(null))` 吞掉
  // 错误 → 前端拿到的 buildInfo 永远为 null。后果：「我装的到底是不是最新包」这个
  // 2026-09-08 专门为用户痛点做的功能**从未生效过**（面板摘要行从不显示构建哨兵）。
  // 实测证据（模拟器 emulator-5554，adb forward 13080→3080）：
  //   GET  /dsht-rp/rp/build-info → 200 {"sentinel":".installed-v223","dshVersion":"0.1.5-rc.1"}
  //   POST /dsht-rp/rp/build-info → 404   ← 客户端走的正是这条路
  //   POST /dsht-rp/rp/status     → 200   ← 对照：POST 分发本身正常
  // 处置：抽成**单实现** `buildInfoPayload()`，GET/POST 两侧共用 —— 杜绝两份实现漂移。
  const buildInfoPayload = async (): Promise<Record<string, unknown>> => {
    let sentinel: string | null = null
    try {
      const runtimeDir = join(dshHome, '..', 'dsh-runtime')
      const entries = await readdir(runtimeDir)
      // 【2026-09-08 鲁棒性】历史哨兵不清理（NodeService 每次升级写新文件不删旧，
      // 实机曾残留 28 个）——解析 vNNN 取最大（= 最近一次成功解压的标记）。
      let maxV = -1
      for (const e of entries) {
        if (!e.startsWith('.installed-v')) continue
        const n = Number(e.slice('.installed-v'.length))
        if (Number.isFinite(n) && n > maxV) { maxV = n; sentinel = e }
      }
      if (maxV < 0) sentinel = null
    } catch { /* PC 验证环境无 runtime 目录 */ }
    let dshVersion: string | null = null
    try {
      const pkg = JSON.parse(readFileSync(join(dshHome, '..', 'dsh-runtime', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')) as { version?: string }
      dshVersion = pkg.version ?? null
    } catch { /* PC 无 node_modules 布局 */ }
    // APK 版本：NodeService 以 BuildConfig.VERSION_NAME 注入（PC 验证环境为空）
    const env = (typeof process !== 'undefined' ? process.env : {}) as Record<string, string | undefined>
    const appVersion = typeof env.DSHT_APP_VERSION === 'string' && env.DSHT_APP_VERSION.trim() !== ''
      ? env.DSHT_APP_VERSION.trim()
      : null
    const codeRaw = env.DSHT_APP_VERSION_CODE
    const appVersionCode = typeof codeRaw === 'string' && /^\d+$/.test(codeRaw) ? Number(codeRaw) : null
    const appAbi = typeof env.DSHT_APP_ABI === 'string' && env.DSHT_APP_ABI.trim() !== '' ? env.DSHT_APP_ABI.trim() : null
    return { sentinel, dshVersion, appVersion, appVersionCode, appAbi, fixTag: 'wb-fix-0908' }
  }

  // ---- T-27：更新源配置 + 手动检查更新 ----
  // 更新源**尚未决**（用户需选：GitHub Releases API / 自建静态 JSON）→ 先落**可用骨架**：
  // 更新源可配置并可手动检查；判定与失败**全部显式回显**（绝不静默吞错）。
  // 判定内核复用 `dsht-plugin-shared/version-compare.ts`（纯函数，与服务端/前端同一份实现）。
  const updateCfgPath = (): string => join(dshHome, 'rp', 'update-source.json')
  /** 写配置：先确保父目录存在（atomicWriteText 不做 mkdir——首次安装在 $DSH_HOME/rp 缺席时
   *  会 ENOENT 抛 500，那又是一次"看起来没反应"的静默失败） */
  const writeUpdateCfg = async (cfg: { source: string; kind: '' | 'github' | 'json' }): Promise<void> => {
    const p = updateCfgPath()
    await mkdir(dirname(p), { recursive: true })
    await atomicWriteText(p, JSON.stringify(cfg, null, 2))
  }
  const readUpdateCfg = async (): Promise<{ source: string; kind: 'github' | 'json' | '' }> => {
    try {
      const raw = JSON.parse(await readFile(updateCfgPath(), 'utf8')) as { source?: unknown; kind?: unknown }
      const source = typeof raw.source === 'string' ? raw.source.trim() : ''
      const kind = raw.kind === 'github' || raw.kind === 'json' ? raw.kind : ''
      return { source, kind }
    } catch { return { source: '', kind: '' } }
  }
  /** 带超时的 JSON 拉取——网络失败必须抛，由调用方转成显式 reason */
  const fetchJsonWithTimeout = async (url: string, ms = 12000): Promise<unknown> => {
    const ac = new AbortController()
    const timer = setTimeout(() => { ac.abort() }, ms)
    try {
      const resp = await fetch(url, {
        signal: ac.signal,
        headers: { accept: 'application/json', 'user-agent': 'DSHTavern-update-check' },
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      return await resp.json() as unknown
    } finally { clearTimeout(timer) }
  }
  // 形态识别与响应归一化走 `dsht-plugin-shared/update-feed.ts`（纯函数 + 单测，
  // 两种更新源字段形态在那里钉死）——此处不再重复实现，避免"两份实现漂移"。

  if (ctx.webServer) {
    /** 信任栅栏（对照 connection 包 isTrustedApiRequest 语义）：
     *  - webServer 绑 127.0.0.1（默认）：Host 必须是 loopback（防 DNS rebinding）
     *  - webServer 绑 0.0.0.0（用户显式开放 LAN）：Host 任意，但浏览器请求（带 Origin）必须同源 */
    const isTrusted = (req: { headers: Record<string, unknown> }): boolean => {
      const host = String(req.headers.host ?? '').toLowerCase()
      const hostname = host.replace(/:\d+$/, '').replace(/^\[/, '').replace(/\]$/, '')
      const lanMode = ctx.webServer?.host === '0.0.0.0'
      if (!lanMode && !['127.0.0.1', 'localhost', '::1'].includes(hostname)) return false
      const origin = req.headers.origin
      if (typeof origin === 'string' && origin !== 'null' && !origin.endsWith(host)) {
        // Origin 的 authority 与 Host 不一致（跨源浏览器请求）→ 拒绝
        try { return new URL(origin).host === host } catch { return false }
      }
      return true
    }
    // §4.16.1 import-progress 轮询用的预览缓存（60s TTL）：claims 的预览扫描里聊天计数
    // 是重活（逐文件读 8MiB），前端 30s 轮询 + 多批次徽章刷新不能每次都扫盘。
    // 作用域挂本次 webServer 注册（插件生命周期）；key = unpacked 目录绝对路径。
    const previewCache = new Map<string, { at: number; preview: ImportPreview }>()
    const PREVIEW_CACHE_TTL = 60_000
    const getCachedPreview = (unpackedDir: string): ImportPreview | null => {
      const hit = previewCache.get(unpackedDir)
      if (!hit) return null
      if (Date.now() - hit.at > PREVIEW_CACHE_TTL) {
        previewCache.delete(unpackedDir)
        return null
      }
      return hit.preview
    }
    const cachePreview = (unpackedDir: string, preview: ImportPreview): void => {
      previewCache.set(unpackedDir, { at: Date.now(), preview })
      if (previewCache.size > 16) { // 护栏：只留最近用过的批次，防长驻进程涨内存
        let oldestKey = ''
        let oldestAt = Infinity
        for (const [k, v] of previewCache) {
          if (v.at < oldestAt) { oldestAt = v.at; oldestKey = k }
        }
        if (oldestKey && oldestKey !== unpackedDir) previewCache.delete(oldestKey)
      }
    }
    const dispose = ctx.webServer.register({
      kind: 'prefix',
      path: '/dsht-rp',
      handler: (rawReq: unknown, rawRes: unknown) => {
        void (async () => {
          const req = rawReq as { method?: string; url?: string; headers: Record<string, unknown> } & AsyncIterable<Buffer>
          const res = rawRes as { writeHead: (code: number, headers?: Record<string, string | number>) => void; end: (body?: string) => void }
          // 【W8 2026-09-15 单源收口（P-1）】原为就地闭包，函数体与
          // `dsht-plugin-shared/http.ts:sendJson` **逐字相同**（跨包复制）。
          // 漂移后果：一处改了响应形态（如加 `charset=utf-8`、加 CORS 头），另一处不变
          // ⇒ 同一服务端在不同路由前缀下响应头不一致，且零报错。
          // ⇒ 委托单源那份（闭包保留，只把实现换掉，破坏面最小）。
          const send = (code: number, body: unknown): void => { sendJson(res, code, body) }
          if (!isTrusted(req)) return send(403, { error: 'forbidden' })
          const sub = decodeURIComponent((req.url ?? '').replace(/^\/dsht-rp/, '')) || '/'
          // query 拆分（§4.16.1 断点续跑 GET /rp/import-checkpoint?batchId= 的读参形态；
          // 路由匹配一律用 subPath——老路由无 query，行为不变）
          const qIdx = sub.indexOf('?')
          const subPath = qIdx === -1 ? sub : sub.slice(0, qIdx)
          const subQuery = qIdx === -1 ? '' : sub.slice(qIdx + 1)
          // T2.11：嵌入版导入中心静态服务（GET；同源 iframe 页面 + 引擎 bundle）
          if (req.method === 'GET' || req.method === 'HEAD') {
            const sendText = (code: number, body: string, type: string): void => {
              res.writeHead(code, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) })
              res.end(body)
            }
            if (subPath === '/import-center') {
              const html = readAsset('import-center.html')
              if (html === null) return sendText(404, 'import-center.html not found (build assets)', 'text/plain')
              return sendText(200, html, 'text/html; charset=utf-8')
            }
            if (subPath === '/import-center/app.js') {
              const js = readAsset('app.js')
              if (js === null) return sendText(404, 'app.js not found (build assets)', 'text/plain')
              return sendText(200, js, 'application/javascript; charset=utf-8')
            }
            // ---- T-63：四个 ST 标准模块路径（ES module；卡的静态 import 依赖真文件）----
            const stMod = readStModule(subPath)
            if (stMod !== null) return sendText(stMod.code, stMod.body, stMod.type)
            // R0：批次清单（$DSH_HOME/rp-import/*/meta.json + 报告存在性 + checkpoint 状态）
            if (subPath === '/rp/import-batches') {
              const batches: Array<Record<string, unknown>> = []
              try {
                const dirs = await readdir(join(dshHome, 'rp-import'))
                for (const d of dirs.sort().reverse()) {
                  if (!isValidBatchId(d)) continue
                  const dir = join(dshHome, 'rp-import', d)
                  let meta: Record<string, unknown> = {}
                  try { meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as Record<string, unknown> } catch { /* 无 meta */ }
                  let hasReport = false
                  for (const rf of ['migration-report.md', 'REPORT.md']) {
                    try { await readFile(join(dir, rf), 'utf8'); hasReport = true; break } catch { /* 无报告 */ }
                  }
                  // §4.16.1 断点续跑：checkpoint 状态（agent 逐类目写入；前端标「中断可续跑」）
                  let checkpoint: CheckpointFile | null = null
                  try { checkpoint = parseCheckpointFile(await readFile(join(dir, 'checkpoint.json'), 'utf8')) } catch { /* 无 checkpoint */ }
                  const summary = summarizeCheckpoint(checkpoint)
                  batches.push({
                    batchId: d, dir, hasReport, ...meta,
                    checkpoint: summary.hasCheckpoint ? { stages: summary.stages, doneCount: summary.doneCount, updatedAt: summary.updatedAt } : null,
                  })
                }
              } catch { /* 无 rp-import 目录 */ }
              return send(200, { batches, dshHome })
            }
            // §4.16.1 断点续跑：读迁移 checkpoint（agent 开工先查；前端判断「中断可续跑」）
            if (subPath === '/rp/import-checkpoint') {
              const batchId = new URLSearchParams(subQuery).get('batchId') ?? ''
              if (!isValidBatchId(batchId)) return send(400, { error: 'batchId required（?batchId=）' })
              let checkpoint: CheckpointFile | null = null
              try { checkpoint = parseCheckpointFile(await readFile(join(dshHome, 'rp-import', batchId, 'checkpoint.json'), 'utf8')) } catch { /* 无 checkpoint */ }
              return send(200, { batchId, checkpoint, summary: summarizeCheckpoint(checkpoint) })
            }
            // §4.16.1 六屏迁移向导（屏5 执行/屏6 报告）：GET /rp/import-progress?batchId=
            // 进度模型（meta.json manifest 计数 total × checkpoint 逐类目 done）+
            // 预估剩余时间（类目速率外推）+ 待认领清单（孤儿聊天/同名卡版本更新/agent claim 标记）。
            // 纯逻辑在 import-preview.ts（buildBatchProgress/collectPreviewClaims），这里只做 FS 接线。
            if (subPath === '/rp/import-progress') {
              const batchId = new URLSearchParams(subQuery).get('batchId') ?? ''
              if (!isValidBatchId(batchId)) return send(400, { error: 'batchId required（?batchId=）' })
              const dir = join(dshHome, 'rp-import', batchId)
              let meta: Record<string, unknown> = {}
              try { meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as Record<string, unknown> } catch {
                return send(404, { error: `批次不存在：${batchId}（先 import-stage）` })
              }
              let checkpoint: CheckpointFile | null = null
              try { checkpoint = parseCheckpointFile(await readFile(join(dir, 'checkpoint.json'), 'utf8')) } catch { /* 无 checkpoint */ }
              // claims 需要预览扫描（聊天计数是重活）：60s 内存缓存——前端 30s 轮询不重复扫盘
              const unpacked = join(dir, 'unpacked')
              let preview: ImportPreview | null = getCachedPreview(unpacked)
              if (!preview) {
                try {
                  preview = await scanImportPreview(unpacked, { dshHome })
                  cachePreview(unpacked, preview)
                } catch { preview = null } // unpacked 缺失等：claims 只剩 checkpoint 标记来源
              }
              const previewClaims = preview ? await collectPreviewClaims(dshHome, unpacked, preview) : []
              return send(200, { batchId, progress: buildBatchProgress(meta, checkpoint, previewClaims) })
            }
            // 【2026-09-06 视觉验收】GET /rp/avatar?slug=… → 工作区头像（ST 楼层头像同源物）。
            // 卡导入/迁移时把 ST 角色 PNG 缩制落盘 <rp>/<slug>/avatar.png；缺文件 → 404
            //（前端 onError 隐藏 img，占位圆）。同源缓存 1h。
            if (subPath === '/rp/avatar') {
              const slug = new URLSearchParams(subQuery).get('slug') ?? ''
              if (!/^[\w.-]{1,80}$/.test(slug)) return send(400, { error: 'slug required' })
              try {
                const buf = await readFile(join(dshHome, 'rp', slug, 'avatar.png'))
                res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(buf.length), 'Cache-Control': 'max-age=3600' })
                return (res.end as (b?: Buffer | string) => void)(buf)
              } catch {
                return sendText(404, 'no avatar', 'text/plain')
              }
            }
            // 【2026-09-07 ST 对齐】GET /rp/charname?slug=… → 角色显示名（ST 楼层名同源物，
            // rp.json 的 characterName；基准 316 楼层名「ExampleGame ExampleWorld MVU Edition」）。
            // 旧实现楼层名直接用 workspace slug → 头像列被长 slug 名撑爆（真机回归实证）。
            if (subPath === '/rp/charname') {
              const slug = new URLSearchParams(subQuery).get('slug') ?? ''
              if (!/^[\w.-]{1,80}$/.test(slug)) return send(400, { error: 'slug required' })
              let name = slug
              try {
                const raw = JSON.parse(await readFile(join(dshHome, 'rp', slug, 'rp.json'), 'utf8')) as { characterName?: unknown }
                if (typeof raw.characterName === 'string' && raw.characterName.trim()) name = raw.characterName.trim()
              } catch { /* rp.json 缺失 → slug 兜底 */ }
              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'max-age=3600' })
              return (res.end as (b?: Buffer | string) => void)(JSON.stringify({ name }))
            }
            // ---- /rp/build-info：构建版本可见性（2026-09-08 用户痛点「我装的到底是不是最新包」）----
            // 读 filesDir/dsh-runtime/.installed-v* 哨兵（APK 内 NodeService.RUNTIME_SENTINEL
            // 写入的解压标记）+ node 运行时真实版本 + APK 自身版本（env 注入）——
            // 手机上一眼对出安装包新旧。dsh-runtime 缺席（PC 纯前端验证）→ sentinel: null。
            // 【2026-09-11 心跳 46】改为共用 buildInfoPayload()（同一实现亦挂在 POST 块，
            // 修掉「前端 POST、后端只认 GET」导致的恒 404 静默失败，详见该函数上方注释）。
            // 匹配用 subPath（剥 query）——会话级 query 参数不再导致 404。
            if (subPath === '/rp/build-info') {
              return send(200, await buildInfoPayload())
            }
            return sendText(404, 'not found', 'text/plain')
          }
          // §4.16.1 断点续跑：DELETE 语义清 checkpoint（= POST {reset:true} 的等价形式；
          // dsht_bridge 只有 GET/POST，SKILL 契约约定用 POST reset:true）
          if (req.method === 'DELETE' && subPath === '/rp/import-checkpoint') {
            const batchId = new URLSearchParams(subQuery).get('batchId') ?? ''
            if (!isValidBatchId(batchId)) return send(400, { error: 'batchId required（?batchId=）' })
            await rm(join(dshHome, 'rp-import', batchId, 'checkpoint.json'), { force: true })
            logLine(`import-checkpoint: ${batchId} checkpoint 已清除（DELETE）`)
            return send(200, { ok: true, batchId, cleared: true })
          }
          if (req.method !== 'POST') return send(405, { error: 'POST only' })
          const chunks: Buffer[] = []
          for await (const c of req) chunks.push(c as Buffer)
          let payload: Record<string, unknown>
          try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return send(400, { error: 'bad json' }) }
          // 【鲁棒轮 2026-09-09】body 为 JSON null/数组时 payload.xxx 抛 TypeError → 统一 500；
          // 显式 400 让调用方看到真实错误（合法 JSON 但形状不对）。
          if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return send(400, { error: 'bad json: body must be an object' })

          try {
            // T2.11：数据面诊断（嵌入导入中心「运行时诊断」面板消费）
            if (sub === '/diag') {
              return send(200, await diagSnapshot())
            }
            // ---- R0：/rp/import-stage —— 上传落盘暂存（导入管线 agent 化的第一步）----
            // 单块：{name, dataBase64, format?}；分块：{name, batchId?, chunk, index, done, format?}
            // （index 0 无 batchId → 服务端建批次并返回，后续块带 batchId 追加写）。
            // format:'zip'（默认）→ source.zip + done 时解压 unpacked/；
            // format:'file'（单卡/单书）→ 原样写 unpacked/inbox/<name>，不解压。
            // done（或单块）时写 meta.json（含 manifest 快速统计）。
            // 返回 {batchId, dir, fileCount, manifest}。无显式大小上限（本机 loopback + 手动读流）。
            if (sub === '/rp/import-stage') {
              const nameRaw = String(payload.name ?? 'st-data.zip')
              const name = nameRaw.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'st-data.zip'
              const rawFile = payload.format === 'file'
              const stageBatch = async (batchId: string, dir: string): Promise<Record<string, unknown>> => {
                const unpacked = join(dir, 'unpacked')
                let fileCount = 1
                if (!rawFile) {
                  fileCount = await unpackZipTo(join(dir, 'source.zip'), unpacked)
                }
                const manifest = await scanImportManifest(unpacked)
                await writeFile(join(dir, 'meta.json'), JSON.stringify({
                  batchId, name, format: rawFile ? 'file' : 'zip',
                  stagedAt: new Date().toISOString(), fileCount, manifest,
                }, null, 1), 'utf8')
                logLine(`import-stage: ${batchId}（${name}）${rawFile ? '单文件' : `解压 ${fileCount} 文件`} kind=${manifest.kind}`)
                console.log(`[dsht-rp] import-stage: ${batchId} (${name}) → ${rawFile ? 'raw file' : `${fileCount} files`} kind=${manifest.kind}`)
                return { batchId, dir, fileCount, manifest }
              }
              // 单块模式
              if (typeof payload.dataBase64 === 'string' && payload.dataBase64) {
                const batchId = makeBatchId(name)
                const dir = join(dshHome, 'rp-import', batchId)
                if (rawFile) {
                  await mkdir(join(dir, 'unpacked', 'inbox'), { recursive: true })
                  await writeFile(join(dir, 'unpacked', 'inbox', name), Buffer.from(payload.dataBase64, 'base64'))
                } else {
                  await mkdir(dir, { recursive: true })
                  await writeFile(join(dir, 'source.zip'), Buffer.from(payload.dataBase64, 'base64'))
                }
                return send(200, await stageBatch(batchId, dir))
              }
              // 分块模式
              const chunk = typeof payload.chunk === 'string' ? payload.chunk : ''
              const index = Number(payload.index ?? -1)
              if (!chunk || index < 0) return send(400, { error: '需要 dataBase64（单块）或 chunk+index（分块）' })
              let batchId = typeof payload.batchId === 'string' ? payload.batchId : ''
              if (index === 0 && !batchId) batchId = makeBatchId(name)
              if (!isValidBatchId(batchId)) return send(400, { error: 'batchId 非法（index 0 时不传则由服务端分配）' })
              const dir = join(dshHome, 'rp-import', batchId)
              const target = rawFile ? join(dir, 'unpacked', 'inbox', name) : join(dir, 'source.zip')
              await mkdir(dirname(target), { recursive: true })
              await writeFile(target, Buffer.from(chunk, 'base64'), { flag: index === 0 ? 'w' : 'a' })
              if (payload.done !== true) return send(200, { batchId, index, staged: false })
              return send(200, await stageBatch(batchId, dir))
            }
            // ---- §4.6 diff 预览：POST /rp/import-preview {batchId} —— 分类预览（只读不改）----
            // 扫 rp-import/<batchId>/unpacked 产出 {cards, books, chats, presets, dropped, ejsTemplates}：
            // 前端「预览」步骤消费（徽章：新/覆盖/丢弃），用户确认后才可 kickoff——
            // 纯逻辑在 import-preview.ts（scanImportPreview），这里只做批次定位与接线。
            if (subPath === '/rp/import-preview') {
              const batchId = String(payload.batchId ?? '')
              if (!isValidBatchId(batchId)) return send(400, { error: 'batchId required' })
              const unpacked = join(dshHome, 'rp-import', batchId, 'unpacked')
              try {
                await readdir(unpacked)
              } catch {
                return send(404, { error: `批次不存在或未解压：${batchId}（先 import-stage）` })
              }
              const preview = await scanImportPreview(unpacked, { dshHome })
              logLine(`import-preview: ${batchId} 卡 ${preview.cards.length} · 书 ${preview.books.length} · 聊 ${preview.chats.length} · 预设 ${preview.presets.length} · 丢弃 ${preview.dropped.length}`)
              console.log(`[dsht-rp] import-preview: ${batchId} cards=${preview.cards.length} books=${preview.books.length} chats=${preview.chats.length} presets=${preview.presets.length} dropped=${preview.dropped.length} ejs=${preview.ejsTemplates}`)
              return send(200, { batchId, preview })
            }
            // ---- §4.16.1 断点续跑：POST /rp/import-checkpoint —— 迁移进度落盘 ----
            // {batchId, stage, done:[...]} → 归并写 rp-import/<batchId>/checkpoint.json
            //（agent 逐类目完成后调；消费契约见 SKILL.md「断点续跑（必做）」）。
            // {batchId, reset:true} → 清 checkpoint（迁移完结；下次 kickoff 不再误判续跑）。
            // 写前快照：归属迁移适配会话（payload.sessionId 优先，缺省取最近活跃的
            // rp-import/_adapter 会话）；拿不到会话上下文就跳过快照，不阻塞写。
            if (subPath === '/rp/import-checkpoint') {
              const batchId = String(payload.batchId ?? '')
              if (!isValidBatchId(batchId)) return send(400, { error: 'batchId required' })
              const cpPath = join(dshHome, 'rp-import', batchId, 'checkpoint.json')
              if (payload.reset === true) {
                await rm(cpPath, { force: true })
                logLine(`import-checkpoint: ${batchId} checkpoint 已清除`)
                console.log(`[dsht-rp] import-checkpoint: ${batchId} cleared`)
                return send(200, { ok: true, batchId, cleared: true })
              }
              const stage = typeof payload.stage === 'string' ? payload.stage as CheckpointStage : '' as CheckpointStage
              if (!(CHECKPOINT_STAGES as readonly string[]).includes(stage)) {
                return send(400, { error: `stage 非法（合法值：${CHECKPOINT_STAGES.join('/')}）` })
              }
              let existing: CheckpointFile | null = null
              try { existing = parseCheckpointFile(await readFile(cpPath, 'utf8')) } catch { /* 首次写 */ }
              const merged = normalizeCheckpointWrite(batchId, existing, { stage, done: payload.done })
              await snapshotRpFiles(
                String(payload.sessionId ?? '') || await latestAdapterSessionId(),
                [`rp-import/${batchId}/checkpoint.json`],
              )
              await mkdir(dirname(cpPath), { recursive: true })
              await writeFile(cpPath, JSON.stringify(merged, null, 1), 'utf8')
              const summary = summarizeCheckpoint(merged)
              logLine(`import-checkpoint: ${batchId} stage=${stage} done=${merged.stages[stage]?.done.length ?? 0}`)
              console.log(`[dsht-rp] import-checkpoint: ${batchId} stage=${stage} doneCount=${summary.doneCount}`)
              return send(200, { ok: true, batchId, checkpoint: merged, summary })
            }
            // ---- 批次修复 10：/rp/persona —— 「我的设定」读写 + macros.user 联动 ----
            // GET（空 body）→ {active, list}；POST {active, list} → 写 rp/persona.json
            // 并把默认 persona 名同步进所有 rp/*/rp.json 的 macros.user（{{user}} 展开源）。
            if (sub === '/rp/persona') {
              const personaPath = join(dshHome, 'rp', 'persona.json')
              const isWrite = typeof payload.active !== 'undefined' || Array.isArray(payload.list)
              if (!isWrite) {
                try {
                  const f = JSON.parse(await readFile(personaPath, 'utf8')) as { active?: string | null; list?: unknown }
                  return send(200, { active: f.active ?? null, list: Array.isArray(f.list) ? f.list : [] })
                } catch {
                  return send(200, { active: null, list: [] })
                }
              }
              const list = (Array.isArray(payload.list) ? payload.list : []) as Array<{ name?: unknown; description?: unknown }>
              const clean = list
                .filter(p => typeof p?.name === 'string' && (p.name as string).trim())
                .map(p => ({ name: String(p.name).trim(), description: typeof p.description === 'string' ? p.description : '' }))
              const active = typeof payload.active === 'string' && clean.some(p => p.name === payload.active) ? payload.active as string : null
              const file = { schemaVersion: 1, active, list: clean }
              await mkdir(dirname(personaPath), { recursive: true })
              // 任务 1：写前文件快照（persona.json + 将被联动改写的全部 rp/*/rp.json；
              // 归属最近活跃的 RP 会话；无会话上下文跳过）
              {
                const snapPaths = ['rp/persona.json']
                for (const dir of await readdir(join(dshHome, 'rp')).catch(() => [] as string[])) {
                  try {
                    await readFile(join(dshHome, 'rp', dir, 'rp.json'), 'utf8')
                    snapPaths.push(`rp/${dir}/rp.json`)
                  } catch { /* 无 rp.json 的工作区不会被联动写 */ }
                }
                await snapshotRpFiles(String(payload.sessionId ?? '') || await latestRpSessionId(), snapPaths)
              }
              await writeFile(personaPath, JSON.stringify(file, null, 1), 'utf8')
              // macros.user 联动：所有 RP 工作区（下一论对话生效）
              let touched = 0
              if (active !== null) {
                for (const dir of await readdir(join(dshHome, 'rp')).catch(() => [] as string[])) {
                  const rpPath = join(dshHome, 'rp', dir, 'rp.json')
                  try {
                    const rp = JSON.parse(await readFile(rpPath, 'utf8')) as { macros?: { user?: string } }
                    rp.macros = { ...(rp.macros ?? {}), user: active }
                    await writeFile(rpPath, JSON.stringify(rp, null, 1), 'utf8')
                    touched++
                  } catch { /* 无 rp.json 跳过 */ }
                }
              }
              console.log(`[dsht-rp] persona saved: active=${active ?? '(none)'} list=${clean.length} → ${touched} 工作区 macros.user 同步`)
              return send(200, { ok: true, active, count: clean.length, workspacesTouched: touched })
            }
            // Android 宿主无 bash sandbox / ripgrep：agent 的 bash/glob 工具不可用，
            // 枚举 unpacked 目录树必须走本路由（否则 agent 会去申请 danger-full-access 卡审批）。
            if (sub === '/rp/import-ls') {
              const batchId = String(payload.batchId ?? '')
              if (!isValidBatchId(batchId)) return send(400, { error: 'batchId required' })
              const base = join(dshHome, 'rp-import', batchId, 'unpacked')
              const rel = String(payload.rel ?? '').replace(/^\/+|\/+$/g, '')
              if (rel.includes('..')) return send(400, { error: 'rel 不允许 ..' })
              const depth = Math.min(6, Math.max(1, Number(payload.depth ?? 2)))
              const root = join(base, rel)
              const out: string[] = []
              const walk = async (d: string, lv: number): Promise<void> => {
                if (out.length > 4000) return
                let names: string[]
                try { names = await readdir(d) } catch { return }
                for (const n of names.sort()) {
                  if (out.length > 4000) return
                  const p = join(d, n)
                  const r = relative(base, p).replaceAll(sep, '/')
                  let isDir = false
                  try { isDir = (await readdir(p)) !== undefined } catch { /* 文件 */ }
                  out.push(isDir ? r + '/' : r)
                  if (isDir && lv < depth) await walk(p, lv + 1)
                }
              }
              await walk(root, 1)
              return send(200, { batchId, rel, count: out.length, entries: out })
            }
            // ---- R0/R20：/rp/import-kickoff {batchId} —— 为批次创建/唤醒适配工作区会话 ----
            // 插件在 host 进程内：经 loopback /api 信封直调 workspace.create/rename +
            // session.create(agentPreset=dsht-adapter) + session.prompt（开工消息）。
            // R20：适配工作区固定为 rp-import/_adapter（title「ST 数据适配」，全批次共用；
            // 新批次在同一工作区开新会话，cwd 与批次数据目录 rp-import/<batchId>/ 分离）。
            // 幂等：meta.json.kickoff 已记录 sessionId 时直接复返（同批次复用会话，唤醒语义 = 前端再跳过去）。
            if (sub === '/rp/import-kickoff') {
              const batchId = String(payload.batchId ?? '')
              if (!isValidBatchId(batchId)) return send(400, { error: 'batchId required' })
              const dir = join(dshHome, 'rp-import', batchId)
              const metaPath = join(dir, 'meta.json')
              let meta: Record<string, unknown>
              try { meta = JSON.parse(await readFile(metaPath, 'utf8')) as Record<string, unknown> } catch {
                return send(404, { error: `批次不存在：${batchId}（先 import-stage）` })
              }
              const prior = meta.kickoff as { sessionId?: string; workspaceId?: string } | undefined
              // §4.16.1 断点续跑：resumeFrom=true 时读 checkpoint——有已完成类目就把
              // 「跳过 done 类目、只补缺失」的续跑事实注入开工消息（执行者是迁移 agent，
              // 消费契约在 SKILL.md「断点续跑（必做）」；这里只做事实注入）。
              const readCheckpoint = async (): Promise<CheckpointFile | null> => {
                try { return parseCheckpointFile(await readFile(join(dir, 'checkpoint.json'), 'utf8')) } catch { return null }
              }
              const resumeNote = async (): Promise<string> => {
                if (payload.resumeFrom !== true) return ''
                const cp = await readCheckpoint()
                const summary = summarizeCheckpoint(cp)
                if (!summary.hasCheckpoint) return ''
                return [
                  ``,
                  `【断点续跑】本批次此前迁移中断过（checkpoint 更新于 ${summary.updatedAt}）：`,
                  `已完成类目：${summary.stages.join('、')}（明细 GET dsht-rp rp/import-checkpoint?batchId=${batchId} 核对）。`,
                  `已 done 类目直接跳过（可抽查校验数量），只补缺失类目；`,
                  `全部完成交报告后照常 POST {batchId, reset:true} 清 checkpoint。`,
                ].join('\n')
              }
              if (prior?.sessionId) {
                // 批次已开工过：默认幂等复返；resumeFrom=true 且有 checkpoint → 向既有会话
                // 发续跑指令（agent 中断后「续跑」按钮的主路径，不新开会话）
                if (payload.resumeFrom === true) {
                  const cp = await readCheckpoint()
                  const summary = summarizeCheckpoint(cp)
                  if (summary.hasCheckpoint) {
                    const resumeText = [
                      `【ST 数据迁移续跑】批次 ${batchId}`,
                      ``,
                      `本批次此前迁移中断，现在从断点继续（不是重做）：`,
                      `已完成类目：${summary.stages.join('、')}（checkpoint 更新于 ${summary.updatedAt}）。`,
                      `请先 GET dsht-rp rp/import-checkpoint?batchId=${batchId} 核对 done 明细，`,
                      `已 done 类目直接跳过，只补缺失类目（契约见 st-migration skill「断点续跑（必做）」）。`,
                    ].join('\n')
                    try {
                      await hostRpc('session.prompt', {
                        request: {
                          requestId: randomUUID(),
                          sessionId: prior.sessionId,
                          mode: 'queue',
                          content: [{ type: 'text', text: resumeText }],
                        },
                      })
                    } catch (e) {
                      // 既有会话已不可达（被删/宿主异常）：不阻塞——回退幂等复返语义，日志如实记录
                      logLine(`import-kickoff: ${batchId} 续跑指令投递失败（${(e as Error).message}），回退复返`)
                      console.log(`[dsht-rp] import-kickoff: ${batchId} resume prompt failed: ${(e as Error).message}`)
                      return send(200, { batchId, dir, sessionId: prior.sessionId, workspaceId: prior.workspaceId ?? null, reused: true })
                    }
                    logLine(`import-kickoff: ${batchId} 续跑指令 → 既有会话 ${prior.sessionId}（done 类目 ${summary.stages.join('/')}）`)
                    console.log(`[dsht-rp] import-kickoff: ${batchId} resume → existing session=${prior.sessionId} stages=${summary.stages.join('/')}`)
                    return send(200, {
                      batchId, dir, sessionId: prior.sessionId, workspaceId: prior.workspaceId ?? null,
                      reused: true, resumed: true, checkpoint: { stages: summary.stages, doneCount: summary.doneCount, updatedAt: summary.updatedAt },
                    })
                  }
                }
                return send(200, { batchId, dir, sessionId: prior.sessionId, workspaceId: prior.workspaceId ?? null, reused: true })
              }
              const rpc = hostRpc
              // 1. 适配工作区（R20 单一工作区定案）：全部批次共用固定工作区
              //    $DSH_HOME/rp-import/_adapter（title 固定「ST 数据适配」）——
              //    真机实测一批次一工作区会出现多个「ST 数据适配」刷屏侧栏。
              //    cwd（会话工作目录）与批次数据目录分离：cwd = _adapter（固定），
              //    批次数据仍在 rp-import/<batchId>/（开工消息里给出绝对路径）。
              // realpath 规范化：Android 上 dshHome 可能是 /data/user/0 symlink 形态，
              // 而 WorkspaceRegistry/session header 一律存规范形态（/data/data）——
              // 混用会让后续 session.create(workspaceId) 认领与侧边栏分组比对不上。
              const adapterDir = join(dshHome, 'rp-import', '_adapter')
              await mkdir(adapterDir, { recursive: true })
              const wsDir = await realpath(adapterDir).catch(() => adapterDir)
              // 0.1.2 wire 信封（R21 同族修复，2026-09-09）：kickoff 的 4 处 loopback 调用
              // 此前为裸形状（R21 适配时只改了 register-workspaces 路径，kickoff 漏网）——
              // workspace.create 报 missing "request"。统一包 { request: {...} } 信封，
              // session.prompt 补 0.1.2 必填 requestId。
              const ws = await rpc('workspace.create', { request: { path: wsDir } })
              const workspace = ws.workspace as { workspaceId?: string } | undefined
              const workspaceId = workspace?.workspaceId
              // 2. 命名「ST 数据适配」（固定标题；rename 失败不阻塞）
              if (workspaceId) {
                try {
                  await rpc('workspace.rename', { request: { workspaceId, title: 'ST 数据适配' } })
                } catch (e) {
                  console.log(`[dsht-rp] kickoff rename failed: ${(e as Error).message}`)
                }
              }
              // 3. 会话：dsht-adapter preset（PTC 基底）；preset 缺失时退默认 preset
              let sessionId = ''
              let presetUsed: string | null = 'dsht-adapter'
              try {
                const created = await rpc('session.create', {
                  request: {
                    ...(workspaceId ? { workspaceId } : { cwd: wsDir }),
                    agentPreset: 'dsht-adapter',
                  },
                })
                sessionId = String(created.sessionId ?? '')
              } catch (e) {
                const code = (e as Error & { code?: string }).code ?? ''
                if (!code.startsWith('agent-preset')) throw e
                presetUsed = null
                const created = await rpc('session.create', { request: workspaceId ? { workspaceId } : { cwd: wsDir } })
                sessionId = String(created.sessionId ?? '')
                console.log(`[dsht-rp] kickoff: dsht-adapter preset 不可用（${(e as Error).message}），退默认 preset`)
              }
              if (!sessionId) return send(500, { error: 'session.create 未返回 sessionId' })
              // 4. 开工消息：批次路径 + 资源清单 + skill 名 + 验收项
              const m = (meta.manifest ?? {}) as Partial<ImportManifest>
              const inventory = m.kind === 'st-data'
                ? `角色卡 ${m.cards ?? 0} 张 · 世界书 ${m.books ?? 0} 本 · 聊天 ${m.chats ?? 0} 个 · ST 预设 ${m.presets ?? 0} 个（ST 数据根：unpacked/${m.stRoot ?? '.'}）`
                : m.kind === 'single-card' ? `单张角色卡（unpacked/${m.singleFile ?? 'inbox/'}）`
                : m.kind === 'single-book' ? `单本世界书（unpacked/${m.singleFile ?? 'inbox/'}）`
                : '内容待识别'
              const kickoffText = [
                `【ST 数据迁移任务】批次 ${batchId}`,
                ``,
                `适配工作区（本会话 cwd，全部批次共用的固定工作区）：${wsDir}`,
                `批次数据目录（本批次资源在这里处理）：${dir}`,
                `原始数据：${m.kind === 'st-data' ? 'source.zip 已解压到 unpacked/（只读对待）' : `unpacked/${m.singleFile ?? 'inbox/'}`}`,
                `资源清单：${inventory}`,
                ``,
                `请立即加载 st-migration skill（use_skill / 技能目录），严格按其中的目标形态契约逐类资源处理：`,
                `每类完成后做校验回执（工作区已注册/重命名？session.list 可见？数量对得上？），`,
                `终态产出 migration-report.md（本批次目录下）并在会话里给出中文总结；失败项显式列出，不静默。`,
                // §4.16.1 断点续跑：resumeFrom=true 且 checkpoint 非空时追加续跑指示（否则空串）
                await resumeNote(),
              ].join('\n')
              await rpc('session.prompt', { request: { requestId: randomUUID(), sessionId, mode: 'queue', content: [{ type: 'text', text: kickoffText }] } })
              // 5. 幂等记录
              meta.kickoff = { sessionId, workspaceId: workspaceId ?? null, preset: presetUsed, at: new Date().toISOString() }
              await writeFile(metaPath, JSON.stringify(meta, null, 1), 'utf8')
              logLine(`import-kickoff: ${batchId} → session ${sessionId}（preset=${presetUsed ?? '默认'}）`)
              console.log(`[dsht-rp] import-kickoff: ${batchId} → session=${sessionId} preset=${presetUsed ?? 'default'}`)
              return send(200, { batchId, dir, sessionId, workspaceId: workspaceId ?? null, preset: presetUsed, reused: false })
            }
            // ---- R14：/rp/repair-session-cwd —— 存量 session header cwd 规范化 ----
            // 扫 $DSH_HOME/sessions/**/session.jsonl，把 /data/user/0 symlink 形态的
            // header cwd 改写为 realpath 规范形态（含 projectKey 目录搬迁）。幂等。
            if (sub === '/rp/repair-session-cwd') {
              return send(200, await repairSessionCwds())
            }
            // ---- R17：/rp/repair-sessions —— 存量 session seq 断号修复 ----
            // 真机实测：agent 手写 session.jsonl 时 seq 断号（header 后 0,1,2,4），
            // DSH 拒绝打开（"corrupt session log: seq gap in committed region"）。
            // 重编号修复（含 replace 链 start/end/sourceEventSeqs old→new 重写），
            // 修复前备份 .bak，幂等。返回 {scanned, repaired, skipped, errors}。
            if (sub === '/rp/repair-sessions') {
              return send(200, await repairAllSessionSeqs())
            }
            // ---- R21：/rp/sessions-audit —— 侧边栏会话审计（2026-09-04 用户要求）----
            // 扫 sessions/<projectKey>/<sessionId>/session.jsonl 全量 header+行数：
            // kind 分类——branch-parent（被 branch/fork 过的父会话 = "回退/分叉后被弃用的
            // 旧会话"，用户要清理的主角）/ forked（branch 产物，用户在用）/ subagent
            // （origin=subagent，不碰）/ empty（0 事件空壳）/ normal。
            // 依据：0.1.2 header 契约 parentSession?/isSeeded/origin?/createdAt/cwd。
            const collectSessionsAudit = async (): Promise<Array<{
              projectKey: string; workspace: string | null; sessionId: string
              parentSession: string | null; isSeeded: boolean; origin: string | null
              events: number; lastTime: number | null; createdAt: number | null
              kind: 'branch-parent' | 'forked' | 'subagent' | 'empty' | 'normal'
            }>> => {
              const sessionsRoot = join(dshHome, 'sessions')
              const nameByKey = new Map<string, string>()
              const rpDir = join(dshHome, 'rp')
              for (const dir of await readdir(rpDir).catch(() => [] as string[])) {
                try {
                  const abs = await realpath(join(rpDir, dir)).catch(() => join(rpDir, dir))
                  nameByKey.set(projectKey(abs), dir)
                } catch { /* 无 rp.json */ }
              }
              const out: Array<{ projectKey: string; workspace: string | null; sessionId: string; parentSession: string | null; isSeeded: boolean; origin: string | null; events: number; lastTime: number | null; createdAt: number | null; kind: 'branch-parent' | 'forked' | 'subagent' | 'empty' | 'normal' }> = []
              // 【心跳 63D · T-70】两处修复，且两者**都必要**：
              //   ① **换算法**（主修复）：`scanJsonlEdges` 用字节扫描代替 `readline` 逐行 ——
              //      原实现为了拿一个「行数」把全部字节**逐行字符串化**（100k+ 次字符串分配）。
              //      实测根因是 **CPU 而非 I/O**：设备裸读 65 MB 仅 **65 ms**（≈1 GB/s），
              //      而宿主上 62.3 MB 逐行 **442 ms** vs 字节扫描 **21 ms**（**8–21×**）。
              //   ② **有界并发**（叠加）：`mapBounded` 让多个会话的读**同时**在跑。
              //      ⚠️ 只做②是不够的 —— 单线程 JS 里并发不产生 CPU 并行，只重叠 I/O 等待，
              //      实测仅 1.4×（6.4 s → 5.3 s）；换算法后单文件成本降一个数量级，并发才开始有意义。
              //
              // 为什么不加缓存/索引：会话写入虽是 append，但修复器会**整体重写**文件
              //（心跳 53 的 `fixPruneSurfaceSpans` 即如此），任何 `(size, mtime)` 水位都可能
              // 把"慢"换成**静默陈旧**（本项目主力缺陷族，见 T-70 正文）。
              // ①+② 都是**纯等价替换**：同样的输入、同样的输出，只是不再排「逐行字符串化」的队。
              const jobs: Array<{ pk: string; sid: string }> = []
              for (const pk of await readdir(sessionsRoot).catch(() => [] as string[])) {
                for (const sid of await readdir(join(sessionsRoot, pk)).catch(() => [] as string[])) jobs.push({ pk, sid })
              }
              const rows = await mapBounded<{ pk: string; sid: string }, (typeof out)[number]>(
                jobs,
                DEFAULT_MAP_CONCURRENCY,
                async (job) => {
                  const { pk, sid } = job
                  const f = await currentSessionLogPath(dshHome, pk, sid)
                  let header: Record<string, unknown> = {}
                  let lines = 0
                  let lastTime: number | null = null
                  try {
                    // 【鲁棒轮 2026-09-09】内存恒定（原实现整文件读入 + split：rp-import 适配会话
                    // 可到 254MB，手机端审计/自动清理一扫即 OOM 崩整个 node 进程）。
                    // 【心跳 63D】内存恒定的同时把 **CPU** 也降下来：只取三样东西
                    //（首非空行 header / 非空行数 / 末非空行 time），不再逐行产出字符串。
                    // 语义与旧 readline 实现**逐字相同**，由 `tests/jsonl-scan.spec.ts` 的
                    // 「新实现 ≡ 参考实现」20 条对拍用例钉住（含 CRLF / 空行 / U+00A0 / 跨块）。
                    const edges = await scanJsonlEdges(f)
                    header = edges.header
                    lines = edges.lines
                    lastTime = edges.lastTime
                  } catch { return null }
                  const parent = typeof header.parentSession === 'string' ? header.parentSession : null
                  const seeded = header.isSeeded === true
                  const origin = typeof header.origin === 'string' ? header.origin : null
                  const createdAt = Number(header.createdAt ?? 0) || null
                  return {
                    projectKey: pk, workspace: nameByKey.get(pk) ?? null, sessionId: sid,
                    parentSession: parent, isSeeded: seeded, origin, events: lines, lastTime, createdAt,
                    kind: origin === 'subagent' ? 'subagent' : seeded || parent !== null ? 'forked' : lines <= 0 ? 'empty' : 'normal',
                  } as (typeof out)[number]
                },
                // 读失败此前是 `catch { continue }`（静默丢弃一个会话）—— 保留该语义，但**出声**
                //（L42：有意跳过 ≠ 可以静默；一个会话读不出来时，面板上的总数会少一个而无人知晓）
                (err, index) => {
                  console.warn('[dsht-rp] sessions-audit 读取失败（该会话本次不计入）:',
                    (jobs[index] as { pk: string; sid: string }).pk, (jobs[index] as { pk: string; sid: string }).sid,
                    (err as Error).message)
                },
              )
              for (const r of rows) if (r !== null) out.push(r)
              const parents = new Set(out.filter(s => s.parentSession !== null).map(s => s.parentSession as string))
              for (const s of out) if (parents.has(s.sessionId)) s.kind = 'branch-parent'
              return out
            }
            if (sub === '/rp/sessions-audit') {
              return send(200, { sessions: await collectSessionsAudit() })
            }
            // ---- R21b：/rp/sessions-archive —— 归档（侧边栏隐藏、数据保留、可恢复）----
            // POST {sessionIds: [...]}。归档实现 = **workspaceRegistry.archiveSession 进程内
            // 直调**（api-workspace-controller 同款 API；0.1.2 的 /api 有 cookie fence 且
            // workspace.archiveSession 不在平坦 method 空间——HTTP 路径实测 404 不可行）。
            // registry-global archivedSessionIds 集 → grouping surfaces 全部隐藏。
            const archiveOne = async (sid: string): Promise<void> => {
              const reg = getWorkspaceRegistry()
              const fn = (reg as { archiveSession?: (id: string) => unknown } | null)?.archiveSession
              if (typeof fn === 'function') { fn.call(reg, sid); return }
              throw new Error('workspaceRegistry.archiveSession 不可用（进程内直取失败）')
            }
            if (sub === '/rp/sessions-archive') {
              const ids = Array.isArray(payload.sessionIds) ? (payload.sessionIds as unknown[]).map(String) : []
              if (ids.length === 0) return send(400, { error: 'sessionIds required' })
              const archived: string[] = []
              const failed: Array<{ sessionId: string; error: string }> = []
              for (const sid of ids) {
                try {
                  await archiveOne(sid)
                  archived.push(sid)
                } catch (e) {
                  failed.push({ sessionId: sid, error: (e as Error).message })
                }
              }
              return send(200, { archived, failed })
            }
            // ---- R21c：/rp/sessions-autoclean —— 自动清理（dryRun 预览 → 执行）----
            // POST {mode:'branch-parents'|'empty', dryRun?:boolean}：
            // - branch-parents：归档全部"被 branch/fork 过的父会话"（= 回退/分叉后弃用的旧会话）
            // - empty：归档全部 0 事件空壳会话
            // origin=subagent 与 forked（branch 产物，用户在用）永不触碰。
            if (sub === '/rp/sessions-autoclean') {
              const mode = String(payload.mode ?? '')
              const dryRun = payload.dryRun === true
              const all = await collectSessionsAudit()
              const targets = all.filter(s => s.kind === (mode === 'empty' ? 'empty' : 'branch-parent'))
              if (dryRun) return send(200, { mode, dryRun: true, targets: targets.map(t => ({ sessionId: t.sessionId, workspace: t.workspace, events: t.events })) })
              const archived: string[] = []
              const failed: Array<{ sessionId: string; error: string }> = []
              for (const t of targets) {
                try {
                  await archiveOne(t.sessionId)
                  archived.push(t.sessionId)
                } catch (e) {
                  failed.push({ sessionId: t.sessionId, error: (e as Error).message })
                }
              }
              console.log(`[dsht-rp] sessions-autoclean(${mode}): archived=${archived.length} failed=${failed.length}`)
              return send(200, { mode, archived, failed })
            }
            // ---- R17：/rp/convert-chat —— 确定性聊天转换（禁止 agent 手写 session 事件）----
            // 两种模式（2026-09-04 瘦身：12.9MB jsonl 全量进 HTTP body = ANR/内存峰值，
            // 手机 agent 自检实证——大 payload 一律走文件，不再过 HTTP）：
            // - 文件模式（推荐，真机/长会话必用）：{filePath, sessionId, cwd, createdAt?}
            //   → 从 dshHome 相对路径直读 → convertChatFile → **直接落盘**
            //   sessions/<projectKey(cwd)>/<sessionId>/session.jsonl（已存在先备份 .bak2）
            //   → 响应只回统计（零大 payload 往返）。
            // - 旧文本模式（兼容 PC/小会话）：{jsonlText, sessionId, cwd?, createdAt?}
            //   → 原样返回 {content,...}，agent 自行 write-files。
            if (sub === '/rp/convert-chat') {
              const sessionId = String(payload.sessionId ?? '')
              if (!/^[a-z0-9][a-z0-9-]{0,80}$/i.test(sessionId)) {
                return send(400, { error: 'sessionId 非法（[a-z0-9-]，如 st-<hash>；见 slug-rules）' })
              }
              const cwd = typeof payload.cwd === 'string' && payload.cwd.trim() ? payload.cwd.trim() : undefined
              const createdAt = Number.isSafeInteger(payload.createdAt) && (payload.createdAt as number) > 0
                ? payload.createdAt as number
                : Date.now()
              const filePath = typeof payload.filePath === 'string' ? payload.filePath.trim() : ''
              if (filePath !== '') {
                const segs = filePath.split('/').filter(s => s.length > 0)
                const safePath = filePath.length > 0 && !filePath.startsWith('/')
                  && segs.every(s => s !== '.' && s !== '..')
                  && segs.join('/').startsWith('rp-import/')
                if (!safePath) return send(400, { error: 'filePath 必须是 dshHome 内 rp-import/ 下的相对路径' })
                const srcAbs = join(dshHome, filePath)
                if (!resolve(srcAbs).startsWith(resolve(dshHome) + sep)) return send(400, { error: 'filePath 越界' })
                const text = await readFile(srcAbs, 'utf8').catch(() => null)
                if (text === null) return send(404, { error: `filePath 不存在：${filePath}` })
                const conv = convertChatFile(text, { sessionId, createdAt, cwd })
                if (cwd === undefined) return send(400, { error: '文件模式必须带 cwd（直接落盘需要工作区路径）' })
                const wsAbs = await realpath(cwd).catch(() => cwd)
                const target = join(dshHome, 'sessions', projectKey(wsAbs), encodeSegment(sessionId), 'session.jsonl')
                const existed = await readFile(target, 'utf8').then(() => true, () => false)
                if (existed) await atomicWriteFile(`${target}.bak2`, await readFile(target, 'utf8'))
                await mkdir(join(target, '..'), { recursive: true })
                // 【鲁棒轮收尾】原子发布——裸 writeFile 中途被杀 = torn session 会话打不开
                await atomicWriteFile(target, conv.content)
                console.log(`[dsht-rp] convert-chat(file): ${sessionId} ← ${filePath} → ${conv.turns} turns, ${conv.variantGroups} variant groups, ${conv.skipped} skipped`)
                return send(200, {
                  written: true, path: relative(join(dshHome, 'sessions'), target).split(sep).join('/'),
                  turns: conv.turns, skipped: conv.skipped, variantGroups: conv.variantGroups,
                  firstUserText: conv.firstUserText, overwritten: existed,
                })
              }
              const jsonlText = String(payload.jsonlText ?? '')
              if (!jsonlText.trim()) return send(400, { error: 'jsonlText 或 filePath 必传其一' })
              const conv = convertChatFile(jsonlText, { sessionId, createdAt, cwd })
              console.log(`[dsht-rp] convert-chat: ${sessionId} → ${conv.turns} turns, ${conv.variantGroups} variant groups, ${conv.skipped} skipped`)
              return send(200, {
                content: conv.content, turns: conv.turns, skipped: conv.skipped,
                variantGroups: conv.variantGroups, firstUserText: conv.firstUserText,
              })
            }
            // ---- R17b：/rp/rebuild-chats —— 批次聊天整包确定性重建 ----
            // 真机实测教训：agent 手写 session 事件会把 turn 边界/变体链写烂（71 turn/start
            // 对 1 turn/end，surface 被 replace 链折叠到只剩 1 条可见）。本路由用
            // convertChatFile 对批次里全部聊天原地重建（覆盖同 sessionId 的损坏文件）。
            // {batchId?}（缺省取最新 st-data 批次）→ {converted, overwritten, orphans, errors}。
            if (sub === '/rp/rebuild-chats') {
              const batchId = String(payload.batchId ?? '')
              const importRoot = join(dshHome, 'rp-import')
              let batchDir = ''
              if (batchId) {
                batchDir = join(importRoot, batchId)
              } else {
                const batches = (await readdir(importRoot).catch(() => [] as string[]))
                  .filter(d => d !== '_adapter').sort().reverse()
                for (const b of batches) {
                  if (await findStDataRoot(join(importRoot, b, 'unpacked'))) { batchDir = join(importRoot, b); break }
                }
              }
              const stRoot = batchDir ? await findStDataRoot(join(batchDir, 'unpacked')) : null
              if (!stRoot) return send(404, { error: '找不到带 ST 数据的批次（先 import-stage）' })

              // 卡名 → 工作区 slug（rp.json characterName 为准；对不上进 _orphan）
              const slugByName = new Map<string, string>()
              const rpDir = join(dshHome, 'rp')
              for (const dir of await readdir(rpDir).catch(() => [] as string[])) {
                try {
                  const rp = JSON.parse(await readFile(join(rpDir, dir, 'rp.json'), 'utf8')) as { characterName?: string }
                  if (rp.characterName) slugByName.set(rp.characterName, dir)
                } catch { /* 无 rp.json */ }
              }
              const norm = (s: string): string => s.replace(/\s+/g, '').toLowerCase()
              const normMap = new Map<string, string>()
              for (const [n, s] of slugByName) normMap.set(norm(n), s)

              const chatsDir = join(stRoot, 'chats')
              const owners = await readdir(chatsDir).catch(() => [] as string[])
              let converted = 0, overwritten = 0
              const orphans: string[] = []
              const errors: string[] = []
              for (const owner of owners) {
                const ownerDir = join(chatsDir, owner)
                const files = (await readdir(ownerDir).catch(() => [] as string[])).filter(f => f.endsWith('.jsonl'))
                if (files.length === 0) continue
                let slug = slugByName.get(owner) ?? normMap.get(norm(owner))
                if (!slug) {
                  // 三键兜底：卡内 name 与目录名只有标点差异的场景再试一次去标点匹配
                  const stripped = norm(owner).replace(/[\p{P}\p{S}]/gu, '')
                  for (const [n, s] of slugByName) {
                    if (norm(n).replace(/[\p{P}\p{S}]/gu, '') === stripped) { slug = s; break }
                  }
                }
                if (!slug) { orphans.push(owner); continue }
                const wsAbs = await realpath(join(rpDir, slug)).catch(() => join(rpDir, slug))
                for (const f of files) {
                  try {
                    const text = await readFile(join(ownerDir, f), 'utf8')
                    const sessionId = chatSessionId(owner, f)
                    let createdAt = Date.now()
                    try {
                      const meta = JSON.parse(text.split('\n')[0]) as { create_date?: string }
                      const cd = Date.parse(String(meta?.create_date ?? ''))
                      if (Number.isSafeInteger(cd) && cd > 0) createdAt = cd
                    } catch { /* 无元数据行 */ }
                    const conv = convertChatFile(text, { sessionId, createdAt, cwd: wsAbs })
                    const target = join(dshHome, 'sessions', projectKey(wsAbs), encodeSegment(sessionId), 'session.jsonl')
                    const existed = await readFile(target, 'utf8').then(() => true, () => false)
                    if (existed) await atomicWriteFile(`${target}.bak2`, await readFile(target, 'utf8'))
                    await mkdir(join(target, '..'), { recursive: true })
                    // 【鲁棒轮收尾】原子发布（同 convert-chat 文件模式）
                    await atomicWriteFile(target, conv.content)
                    // MVU 变量：chat_metadata.variables → rp/state/<sessionId>.json（裸对象形态）
                    try {
                      const meta = JSON.parse(text.split('\n')[0]) as { chat_metadata?: { variables?: unknown } }
                      const vars = meta?.chat_metadata?.variables
                      if (vars && typeof vars === 'object' && Object.keys(vars as object).length > 0) {
                        const statePath = join(dshHome, 'rp', 'state', `${sessionId}.json`)
                        await mkdir(dirname(statePath), { recursive: true })
                        await atomicWriteText(statePath, JSON.stringify(vars))
                      }
                    } catch { /* 变量缺失不阻塞 */ }
                    converted++
                    if (existed) overwritten++
                  } catch (e) {
                    errors.push(`${owner}/${f}: ${(e as Error).message}`)
                  }
                }
              }
              logLine(`rebuild-chats: ${converted} 聊天重建（覆盖 ${overwritten}），孤儿 ${orphans.length}`)
              console.log(`[dsht-rp] rebuild-chats: converted=${converted} overwritten=${overwritten} orphans=${orphans.length} errors=${errors.length}`)
              return send(200, { converted, overwritten, orphans, errors })
            }
            // ---- R18：/rp/session-rollback —— 会话回退（截断到 keepThroughSeq 含）----
            // {sessionId, keepThroughSeq} → 双路径（2026-09-04）：
            // - **live**（前端打开中，常态）：官方 append 原语**逻辑回退**——compaction/prune
            //   计量 + user/message marker 带 surfaceOp replace 把 [目标消息之后, 视图末]
            //   顶替掉。事件留在日志（聊天数据零丢失），模型视图与 UI 投影立即生效，
            //   无需关闭会话/重启（409 文件手术路径对 RP 常态不可用，真机实证）。
            // - 非 live：session.jsonl 文件截断（原路径：header 保留、事件只留
            //   seq<=keepThroughSeq；先备份 .bak）。
            // 两路径都做变量回滚（undo 日志回放）+ 文件快照回滚（非 live）。
            if (sub === '/rp/session-rollback' || sub === '/rp/session-edit') {
              const sessionId = String(payload.sessionId ?? '')
              const keepThroughSeq = Number(payload.keepThroughSeq ?? -1)
              const isEdit = sub === '/rp/session-edit'
              const editSeq = isEdit ? Number(payload.seq ?? -1) : keepThroughSeq
              const editText = isEdit ? String(payload.text ?? '') : ''
              if (!sessionId) return send(400, { error: 'sessionId required' })
              if (isEdit) {
                if (!Number.isInteger(editSeq) || editSeq < 0) return send(400, { error: 'seq 须为 >= 0 的整数' })
                if (!editText.trim()) return send(400, { error: 'text 不能为空' })
              } else {
                if (!Number.isInteger(keepThroughSeq) || keepThroughSeq < 0) return send(400, { error: 'keepThroughSeq 须为 >= 0 的整数' })
              }
              const live = ctx.sessions?.get(sessionId) as
                | { surface?: { nodes?: number[] }; events?: Record<string | number, { type?: unknown; time?: unknown; data?: { content?: unknown } } | undefined>; append?: (type: string, data: unknown, opts?: { surfaceOp?: { op: 'replace'; start: number; end: number }; sourceEventSeqs?: number[] }) => unknown }
                | undefined
              // 【2026-09-08 用户语义】回退到此处 = 「内容回输入框」：includeAnchor=true 时
              // 锚消息本身连同其后一切一起移出上下文（文本由前端放回 composer 供修改重发，
              // ST「回退」同语义）。掩码 rolledBackTo = anchor-1 → UI 连锚一起隐藏。
              const includeAnchor = payload.includeAnchor === true
              // 【W4】原写 `Array.isArray(live.surface?.nodes)` 后 `live.surface.nodes`
              // —— 裸深层读 + 手写形状守卫。改走单源 OrNull 变体（语义等价：非数组 ⇒ null）。
              const liveView = readSurfaceNodesOrNull(live)
              if (live !== undefined && typeof live.append === 'function' && liveView !== null) {
                const liveNodes = liveView
                // 【心跳 47】本块的内联类型把 `append` 声明为**可选**（守卫已证实它是函数），
                // 而 `appendReplace` 需要「必需 append」的 AppendableSession → 断言收敛一次。
                const liveWritable = live as unknown as AppendableSession
                // 【心跳 47】守卫收窄结果固化为非可选局部：闭包（async () => …）内 TS 会丢弃对
                // `live.append` / `live.surface` 的收窄（TS2722 / TS18048）。
                // 【心跳 55 修正】这不是「纯类型层」修正——裸写 `= live.append` 会 **丢失接收者**，
                // 官方 Session 的 append 读 `this.log`（dsh-session/lib/index.js:457/1075），
                // detach 即 `TypeError: Cannot read properties of undefined (reading 'log')`。
                // 必须经 boundAppend 绑定（详见 dsht-plugin-shared/session-write.ts）。
                const liveAppend = boundAppend(liveWritable)
                // ---- live：逻辑回退（官方原语）——【鲁棒轮】per-session 串行（withLiveSurgery），
                // 防 await replayUndoLog 窗口内并发请求捕获过期视图 → 错位 replace ----
                return await withLiveSurgery(sessionId, async () => {
                const view = liveNodes
                const anchor = isEdit ? editSeq : keepThroughSeq // edit 锚点消息本身也移出视图
                // 【2026-09-08 大会话修复】锚不在当前视图不再硬报错：视图窗口化/此前压缩
                // 后旧 seq 不在 surface.nodes（实机 155 轮会话 seq=1362 实证）。取视图中
                // 第一个 > 锚 的 seq 作为 replace 起点——「锚之后的一切移出上下文」语义
                // 不变（视图早于锚的节点本就应保留）。视图全部 ≤ 锚 → no-op。
                let start: number
                const idx = view.indexOf(anchor)
                if (idx !== -1) {
                  start = includeAnchor ? anchor : (idx + 1 < view.length ? view[idx + 1] : -1)
                } else {
                  start = view.find(q => q > anchor) ?? -1
                }
                if (start === -1 || start > view[view.length - 1]) return send(200, { logical: true, replaced: 0, note: 'no-op（目标之后没有可回退的视图内容）' })
                const end = view[view.length - 1]
                const seqs = view.filter(q => q >= start)
                // 计量（core 估价器同款——replace 必须带紧邻 claim，否则投影/meter 不更新）
                let shadowed = 0
                for (const q of seqs) {
                  // 坑 #22：sessionEventAt 替代 live.events?.[q]（0.1.2 无公开 events）
                  const raw = (sessionEventAt(live, q)?.data ?? {}) as { content?: unknown; message?: { content?: unknown } }
                  // 【鲁棒轮 2026-09-09】assistant/message 的 payload 是 {turn,step,message:{...}}
                  // ——原实现直接读 data.content 恒 undefined → 每条 assistant 消息只计 4
                  // token（meter 严重少记；chat/update 路由 5710 行早已同口径解包，此处补齐）
                  const d = (raw.message && typeof raw.message === 'object' ? raw.message : raw) as { content?: unknown }
                  const blocks = Array.isArray(d.content) ? d.content as Array<Record<string, unknown>> : []
                  shadowed += blocks.reduce((t, b) => t + (b && (b.type === 'text' || b.type === 'reasoning') && typeof b.text === 'string' ? Math.ceil((b.text as string).length / 4) + 4 : 4 + Math.ceil(JSON.stringify(b).length / 4)), 0) + 4
                }
                // 【2026-09-08 鲁棒性】undo 回放挪到 claim 之前：compaction/prune claim 必须
                // **紧邻** marker replace（影子化协议铁律）——旧顺序 claim → await replayUndoLog
                // → marker，await 窗口里运行中 turn 的 append 会插进两者之间，投影/meter 漂移。
                const anchorTime = typeof sessionEventAt(live, anchor)?.time === 'number' ? sessionEventAt(live, anchor)?.time as number : Date.now()
                // 【2026-09-19 回退连带面修复】连带范围（含非 surface 事件）：起点 = 锚所在轮
                // 的 turn/start（早于用户消息），终点 = 回退那一刻的日志末尾。harness 运行过程
                // 节点（系统提示词 / 上下文注入 / 本轮运行失败）的锚只落在这条区间里。
                const evSnapForRange = sessionEventsSnapshot(live)
                const shadowedRange = { start: turnStartSeqFor(evSnapForRange, anchor), end: maxEventSeq(evSnapForRange) }
                const undo = await replayUndoLog(dshHome, sessionId, anchorTime)
                liveAppend('compaction/prune', { shadowedRange: { start, end }, shadowedSeqs: seqs, shadowedTokenCount: shadowed })
                const markerText = isEdit
                  ? `[消息已编辑] 该消息原文及其后的回复已从上下文移除，编辑后的新消息随后发出。`
                  : includeAnchor
                    ? `[已回退] 该消息及其后的对话已从上下文移除（原文已放回输入框；事件仍保留在日志，可经 /expand 查看）。`
                    : `[已回退] 该消息之后的对话已从上下文移除（事件仍保留在日志，可经 /expand 查看）。`
                // 【阶段3 2026-09-10】标记载荷必须放进官方白名单字段：旧写法
                // `source.editedFrom` / `source.rolledBackTo` 是顶层自定义键 → v0→v1 迁移器
                // 判 `source has unexpected member` → 整会话在 0.1.5 下打不开（实测 6 个真实会话）。
                // 改用 form:'snapshot' + sections（官方唯一能带结构化文本的合法形态）。
                const markerPayload: SurgicalMarkerPayload = isEdit
                  ? { editedFrom: anchor, shadowedSeqs: seqs, shadowedRange }
                  : { rolledBackTo: includeAnchor ? anchor - 1 : keepThroughSeq, shadowedSeqs: seqs, shadowedRange }
                appendReplace(liveWritable, 'user/message', {
                  id: `dsht-rp-${isEdit ? 'edit' : 'rollback'}-${randomUUID()}`,
                  role: 'user',
                  content: [{ type: 'text', text: markerText }],
                  source: markerSource('dsht-rp', 'surgical', markerPayload as unknown as Record<string, unknown>),
                }, { start, end }, seqs)
                logLine(`${isEdit ? 'session-edit' : 'session-rollback'}(live): ${sessionId} 锚 seq ${anchor} → replace [${start},${end}] ${seqs.length} 事件；连带范围 [${shadowedRange.start},${shadowedRange.end}]；变量回滚 ${undo.restored} 条`)
                console.log(`[dsht-rp] ${isEdit ? 'session-edit' : 'session-rollback'}: ${sessionId} (live) replace[${start},${end}] n=${seqs.length} undoRestored=${undo.restored}`)
                // 【B3 2026-09-14 三条路径对齐】文件快照整批回滚——**live 分支此前完全缺失**。
                // 判据（goal 轨道 B / B3）：rollback / regenerate / edit 的连带状态必须一致
                // （消息投影 + 变量 + 文件快照 + 帧内脚本状态）。此前只有**非 live** 分支
                // 做了文件快照回滚（见下方 restoreSnapshotsAfter 的 3 处调用点），
                // live 分支漏了 ⇒ 回退后「该 turn 写过的会话内文件」仍是新内容，
                // 而 ST 语义是**一并回退**（用户看到的是「回退了但世界状态没退」）。
                // 边界判据与文本入口**共用同一函数**（snapshotRestoreBoundaryFromEvents →
                // boundaryFromTurnPairs），零漂移。
                try {
                  const evSnap = sessionEventsSnapshot(live)
                  const boundary = snapshotRestoreBoundaryFromEvents(
                    evSnap.map(e => ({ seq: e.seq, data: e.data })),
                    isEdit ? anchor - 1 : keepThroughSeq,
                  )
                  const fsnap = await restoreSnapshotsAfter(dshHome, sessionId, boundary)
                  if (fsnap.restoredTurns.length > 0 || fsnap.errors.length > 0) {
                    logLine(`${isEdit ? 'session-edit' : 'session-rollback'}(live) 文件快照回滚 ${fsnap.restoredTurns.length} turn/${fsnap.filesRestored + fsnap.filesDeleted} 文件${fsnap.errors.length > 0 ? `（${fsnap.errors.length} 项错误）` : ''}`)
                  }
                } catch (e) {
                  // 【R8 失败必须出声】快照回滚失败**不得**吞掉已成功的会话回退——
                  // 但必须留痕并如实回报（前端据此提示「世界状态可能未完全回退」）。
                  console.warn(`[dsht-rp] ${isEdit ? 'session-edit' : 'session-rollback'}(live) 文件快照回滚失败：${(e as Error).message}`)
                }
                // I8-1：立即耐久 barrier——手机端进程被杀在 200ms 窗口内 = 回退标记丢失
                try { await flushLiveSession(ctx.sessions, live) } catch (e) {
                  return send(500, { error: `${isEdit ? '编辑' : '回退'}已应用但落盘失败：${(e as Error).message}` })
                }
                rollbackMaskCache.clear()
                return send(200, { logical: true, replaced: seqs.length, variablesRestored: undo.restored, ...(isEdit ? { editedSeq: anchor } : { truncatedTo: keepThroughSeq }) })
                }) // end withLiveSurgery
              }
              // ---- 非 live：文件截断（原路径）----
              if (!isEdit) {
                // 【心跳 58 · T-58】会话是否允许文件手术 = 单源判据（原先三处逐字复制，
                // 且无测试覆盖 → 心跳 57 因此误判「缺门槛」，实为「有门槛但没被钉住」）。
                const guard = canSurgicallyTruncate(ctx.sessions?.get(sessionId) !== undefined, 'rollback')
                if (!guard.allowed) return send(409, { error: guard.error })
                const hit = (await scanSessionHeaders()).find(h => h.sessionId === sessionId)
                if (!hit) return send(404, { error: `session not found: ${sessionId}` })
                const file = hit.file
                const content = await readFile(file, 'utf8')
                const r = truncateSessionJsonl(content, keepThroughSeq)
                if (r.error) return send(400, { error: r.error })
                if (r.dropped === 0) return send(200, { kept: r.kept, dropped: 0, note: 'no-op（没有更靠后的事件）' })
                // I8-3：手术锁（0.1.2 无 lease，防残留 runtime 并发写制造 seq gap）
                try {
                  await withSessionLock(file, async () => {
                    const cur = await readFile(file, 'utf8')
                    if (cur !== content) throw new Error('会话文件在手术期间被并发修改——放弃本次手术')
                    // I8-2：原子写（.bak 先 fsync 耐久，再原子发布正文件）
                    await atomicWriteFile(`${file}.bak`, content)
                    await atomicWriteFile(file, r.content)
                  })
                } catch (e) {
                  return send(409, { error: `会话手术锁失败：${(e as Error).message}` })
                }
                // 任务 1：文件快照整批回滚（dsh-tavern nativeCommits 思路）——截断点之后
                // turn 的会话内文件写操作逆序恢复 before 状态（共享资产不在快照范围，
                // 见 dsht-plugin-shared/file-snapshots.ts 头注），恢复后删除快照记录
                const fsnap = await restoreSnapshotsAfter(dshHome, sessionId, snapshotRestoreBoundary(content, keepThroughSeq))
                // 任务 4：变量联动回滚——undo 日志回放，把 ts 晚于截断点（截后日志最后
                // 事件时间）的变量写按时间倒序恢复旧值（chat/character/global 三作用域），
                // 回放后截断 undo 日志。
                const cutoff = sessionContentMaxTime(r.content)
                const undo = await replayUndoLog(dshHome, sessionId, cutoff)
                rollbackMaskCache.clear() // 掩码缓存按 mtime 失效已覆盖；显式 clear 与 edit/regenerate 分支一致（mtime 粒度内重复回退防串值）
                logLine(`session-rollback: ${sessionId} 截到 seq ${keepThroughSeq}（留 ${r.kept} 事件，截 ${r.dropped}；变量回滚 ${undo.restored} 条；文件快照回滚 ${fsnap.restoredTurns.length} turn/${fsnap.filesRestored + fsnap.filesDeleted} 文件）`)
                console.log(`[dsht-rp] session-rollback: ${sessionId} → kept=${r.kept} dropped=${r.dropped} undoRestored=${undo.restored} snapshotTurns=${fsnap.restoredTurns.join(',')}`)
                return send(200, { kept: r.kept, dropped: r.dropped, variablesRestored: undo.restored, fileSnapshots: { turns: fsnap.restoredTurns, restored: fsnap.filesRestored, deleted: fsnap.filesDeleted, errors: fsnap.errors } })
              }
              // edit 非 live：文件截断到目标消息之前（原 R20 语义）
              {
                // 【鲁棒轮 2026-09-09】live 会话 409 守卫（rollback/regenerate 非 live 分支
                // 同款）——edit 漏了：会话已 attach 但 surface 异常降级时会直接做文件手术，
                // 随后 live flush 把内存旧事件写回 → 内容复活/seq gap。
                // 【心跳 58】统一走单源判据 `canSurgicallyTruncate`。
                {
                  const guard = canSurgicallyTruncate(ctx.sessions?.get(sessionId) !== undefined, 'edit')
                  if (!guard.allowed) return send(409, { error: guard.error })
                }
                const hit = (await scanSessionHeaders()).find(h => h.sessionId === sessionId)
                if (!hit) return send(404, { error: `session not found: ${sessionId}` })
                const file = hit.file
                const content = await readFile(file, 'utf8')
                const lines = content.split('\n')
                let keep = -1
                let found = false
                // 【心跳 47】原写法 `let ev: X | null = null` + `as typeof ev`：初始化式里的 `typeof ev`
                // 取到的是**声明点已被收窄成 `null` 的类型** → 等价 `as null` → 守卫之后 `ev` 的流类型
                // 塌成 `never`（ev.seq / ev.type / ev.data 全报 TS2339）。运行时因 JSON.parse 返回真对象
                // 而"侥幸正确"，但编辑/重生成这条关键路径的类型保护等于零。改为显式命名类型。
                type RawEventLine = { type?: string; seq?: unknown; data?: { source?: { kind?: unknown } } }
                let prevSeq = -1
                for (let i = 1; i < lines.length; i++) {
                  const line = lines[i]
                  if (!line.trim()) continue
                  let ev: RawEventLine | null = null
                  try { ev = JSON.parse(line) as RawEventLine } catch { continue }
                  if (ev === null || typeof ev.seq !== 'number') continue
                  if (!found && ev.type === 'user/message' && ev.seq === editSeq
                    && (ev.data as { source?: { kind?: unknown } } | undefined)?.source?.kind === 'user') {
                    keep = prevSeq
                    found = true
                    break
                  }
                  prevSeq = ev.seq
                }
                if (!found) return send(404, { error: `未找到该消息（seq=${editSeq} 的真用户消息不存在）` })
                const r = truncateSessionJsonl(content, keep)
                if (r.error) return send(400, { error: r.error })
                if (r.dropped === 0) return send(200, { truncatedTo: keep, truncated: 0, note: 'no-op（该消息之后没有事件）' })
                // I8-3 + I8-2：手术锁 + 原子写（同 rollback）
                try {
                  await withSessionLock(file, async () => {
                    const cur = await readFile(file, 'utf8')
                    if (cur !== content) throw new Error('会话文件在手术期间被并发修改——放弃本次手术')
                    await atomicWriteFile(`${file}.bak`, content)
                    await atomicWriteFile(file, r.content)
                  })
                } catch (e) {
                  return send(409, { error: `会话手术锁失败：${(e as Error).message}` })
                }
                const fsnap = await restoreSnapshotsAfter(dshHome, sessionId, snapshotRestoreBoundary(content, keep))
                const undo = await replayUndoLog(dshHome, sessionId, sessionContentMaxTime(r.content))
                logLine(`session-edit: ${sessionId} seq ${editSeq} 截到 keepThroughSeq ${keep}（截 ${r.dropped} 事件；变量回滚 ${undo.restored} 条）`)
                console.log(`[dsht-rp] session-edit: ${sessionId} → seq=${editSeq} keep=${keep} truncated=${r.dropped} undoRestored=${undo.restored}`)
                rollbackMaskCache.clear()
                return send(200, { truncatedTo: keep, truncated: r.dropped, variablesRestored: undo.restored })
              }
            }
            // ---- 任务 4：/rp/session-regenerate —— 重发最后一轮（前端拿 lastUserText 重发）----
            // {sessionId} → 锚 = 最后一条真 user 消息。双路径（同 R18）：
            // - live：逻辑回退——replace [锚消息之后, 视图末]，保留锚消息；返回 lastUserText
            //   供前端 session.prompt 重发。事件留在日志，立即生效。
            // - 非 live：文件截断 + 变量回滚 + 文件快照回滚（原路径）。
            if (sub === '/rp/session-regenerate') {
              const sessionId = String(payload.sessionId ?? '')
              if (!sessionId) return send(400, { error: 'sessionId required' })
              const live = ctx.sessions?.get(sessionId) as
                | { surface?: { nodes?: number[] }; events?: Record<string | number, { type?: unknown; time?: unknown; data?: { content?: unknown; source?: { kind?: unknown } } | undefined }> | Map<string | number, { type?: unknown; time?: unknown; data?: { content?: unknown; source?: { kind?: unknown } } | undefined }>; append?: (type: string, data: unknown, opts?: { surfaceOp?: { op: 'replace'; start: number; end: number }; sourceEventSeqs?: number[] }) => unknown }
                | undefined
              // 【W4】同 rollback 路由：裸深层读 + 手写形状守卫 → 单源 OrNull 变体。
              const regenView = readSurfaceNodesOrNull(live)
              if (live !== undefined && typeof live.append === 'function' && regenView !== null) {
                const liveNodes = regenView
                // 【心跳 47/55】`appendReplace` 需要「必需 append」的 AppendableSession：
                // 守卫已证实 append 是函数，但闭包内 TS 会丢弃该收窄（TS2722 / TS18048）。
                // 【心跳 55 修正】必须 **bind**：官方 Session.append 读 `this.log`，
                // `const f = live.append; f(...)` 会 detach → `Cannot read properties of undefined (reading 'log')`
                // （设备实证：本路由 500 且零事件写入）。
                const liveWritable = live as unknown as AppendableSession
                const liveAppend = boundAppend(liveWritable)
                // live：找事件流里最后一条真 user 消息——【鲁棒轮】per-session 串行（同 rollback）
                return await withLiveSurgery(sessionId, async () => {
                const evList: Array<{ seq: number; time?: number; text: string }> = []
                let n = 0
                for (const ev of sessionEventsSnapshot(live)) {
                  const seq = typeof ev.seq === 'number' ? ev.seq : n++
                  if (!ev || ev.type !== 'user/message') continue
                  // 【心跳 47】`sessionEventsSnapshot` 的 `data` 是 unknown，原代码在同一行里两次
                  // 以不同形状访问它（`ev.data as {source}` 与 `ev.data?.content`），后者 TS 判为
                  // "Property 'content' does not exist on type '{}'"。取一次带类型的局部，两处共用。
                  const evData = ev.data as { content?: unknown; source?: { kind?: unknown } } | undefined
                  if (evData?.source?.kind !== 'user') continue
                  const blocks = Array.isArray(evData.content) ? evData.content as Array<{ type?: unknown; text?: unknown }> : []
                  const text = blocks.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text as string).join('\n')
                  evList.push({ seq, time: typeof ev.time === 'number' ? ev.time : undefined, text })
                }
                evList.sort((a, b) => a.seq - b.seq)
                const anchorEv = evList[evList.length - 1]
                if (anchorEv === undefined) return send(400, { error: '会话里没有用户消息（无可重新生成的锚点）' })
                const view = liveNodes
                const idx = view.indexOf(anchorEv.seq)
                // 【2026-09-08 大会话修复】锚不在视图不再硬报错（回退路由同款降级）——
                // 取视图中第一个 > 锚 的 seq 作为 replace 起点；视图全部 ≤ 锚 → no-op。
                const start = idx !== -1
                  ? (idx + 1 < view.length ? view[idx + 1] : -1)
                  : (view.find(q => q > anchorEv.seq) ?? -1)
                if (start === -1 || start > view[view.length - 1]) return send(200, { logical: true, replaced: 0, lastUserText: anchorEv.text, note: 'no-op（锚消息之后没有可重生成的视图内容）' })
                const end = view[view.length - 1]
                const seqs = view.filter(q => q >= start)
                let shadowed = 0
                for (const q of seqs) {
                  // 【鲁棒轮 2026-09-09】assistant/message 解包 data.message（同 rollback 补齐——
                  // 原实现每条 assistant 消息只计 4 token，meter 少记）
                  const raw = ((sessionEventAt(live, q)?.data) ?? {}) as { content?: unknown; message?: { content?: unknown } }
                  const d = (raw.message && typeof raw.message === 'object' ? raw.message : raw) as { content?: unknown }
                  const blocks = Array.isArray(d.content) ? d.content as Array<{ type?: unknown; text?: unknown }> : []
                  shadowed += blocks.reduce((t, b) => t + (b && (b.type === 'text' || b.type === 'reasoning') && typeof b.text === 'string' ? Math.ceil((b.text as string).length / 4) + 4 : 4 + Math.ceil(JSON.stringify(b).length / 4)), 0) + 4
                }
                // 【2026-09-08 鲁棒性】undo 回放挪到 claim 之前（紧邻铁律，同 session-rollback）
                const anchorTime = typeof anchorEv.time === 'number' ? anchorEv.time : Date.now()
                // 【2026-09-19 回退连带面修复】连带范围（同 rollback/edit 的 live 分支）
                const evSnapForRange = sessionEventsSnapshot(live)
                const shadowedRange = { start: turnStartSeqFor(evSnapForRange, anchorEv.seq), end: maxEventSeq(evSnapForRange) }
                const undo = await replayUndoLog(dshHome, sessionId, anchorTime)
                liveAppend('compaction/prune', { shadowedRange: { start, end }, shadowedSeqs: seqs, shadowedTokenCount: shadowed })
                const markerText = `[重新生成中] 该消息此前的回复已从上下文移除，正在以原消息重新生成。`
                // 【阶段3 2026-09-10】同 rollback：标记载荷进 sections（顶层自定义键会被迁移器拒）
                appendReplace(liveWritable, 'user/message', {
                  id: `dsht-rp-regenerate-${randomUUID()}`,
                  role: 'user',
                  content: [{ type: 'text', text: markerText }],
                  source: markerSource('dsht-rp', 'surgical', { regeneratedFrom: anchorEv.seq, shadowedSeqs: seqs, shadowedRange }),
                }, { start, end }, seqs)
                logLine(`session-regenerate(live): ${sessionId} 锚 seq ${anchorEv.seq} → replace [${start},${end}] ${seqs.length} 事件；连带范围 [${shadowedRange.start},${shadowedRange.end}]；变量回滚 ${undo.restored} 条`)
                console.log(`[dsht-rp] session-regenerate: ${sessionId} (live) anchor=${anchorEv.seq} replace[${start},${end}] n=${seqs.length} undoRestored=${undo.restored}`)
                // 【B3 2026-09-14 三条路径对齐】文件快照整批回滚（与 rollback/edit 的 live 分支同款）。
                // 判据：三条路径的连带状态必须一致；此前 live 分支只有 rollback/regenerate 的
                // **非 live**  counterparts 做了快照回滚，live 全漏。边界取锚消息 seq
                // （= 最后一条 user/message；该 turn 被腰斩 → includeBoundary 生效）。
                try {
                  const evSnap = sessionEventsSnapshot(live)
                  const boundary = snapshotRestoreBoundaryFromEvents(
                    evSnap.map(e => ({ seq: e.seq, data: e.data })),
                    anchorEv.seq,
                  )
                  const fsnap = await restoreSnapshotsAfter(dshHome, sessionId, boundary)
                  if (fsnap.restoredTurns.length > 0 || fsnap.errors.length > 0) {
                    logLine(`session-regenerate(live) 文件快照回滚 ${fsnap.restoredTurns.length} turn/${fsnap.filesRestored + fsnap.filesDeleted} 文件${fsnap.errors.length > 0 ? `（${fsnap.errors.length} 项错误）` : ''}`)
                  }
                } catch (e) {
                  console.warn(`[dsht-rp] session-regenerate(live) 文件快照回滚失败：${(e as Error).message}`)
                }
                // I8-1：立即耐久 barrier（同 rollback）
                try { await flushLiveSession(ctx.sessions, live) } catch (e) {
                  return send(500, { error: `重生成标记已应用但落盘失败：${(e as Error).message}` })
                }
                rollbackMaskCache.clear()
                return send(200, { logical: true, replaced: seqs.length, lastUserText: anchorEv.text, variablesRestored: undo.restored })
                }) // end withLiveSurgery
              }
              // 非 live：文件截断（原路径）
              {
                // 【心跳 58】统一走单源判据 `canSurgicallyTruncate`。
                const guard = canSurgicallyTruncate(ctx.sessions?.get(sessionId) !== undefined, 'regenerate')
                if (!guard.allowed) return send(409, { error: guard.error })
                const hit = (await scanSessionHeaders()).find(h => h.sessionId === sessionId)
                if (!hit) return send(404, { error: `session not found: ${sessionId}` })
                const file = hit.file
                const content = await readFile(file, 'utf8')
                const events: Array<{ type: string; seq: number; data?: unknown }> = []
                for (const line of content.split('\n').slice(1)) {
                  if (!line.trim()) continue
                  try { events.push(JSON.parse(line) as { type: string; seq: number; data?: unknown }) } catch { /* 坏行跳过 */ }
                }
                const lastUser = findLastUserMessage(events)
                if (!lastUser) return send(400, { error: '会话里没有用户消息（无可重新生成的锚点）' })
                const r = truncateSessionJsonl(content, lastUser.seq)
                if (r.error) return send(400, { error: r.error })
                if (r.dropped === 0) return send(200, { truncated: 0, lastUserText: lastUser.text, variablesRestored: 0, note: 'no-op（最后一条用户消息之后没有事件）' })
                // I8-3 + I8-2：手术锁 + 原子写（同 rollback）
                try {
                  await withSessionLock(file, async () => {
                    const cur = await readFile(file, 'utf8')
                    if (cur !== content) throw new Error('会话文件在手术期间被并发修改——放弃本次手术')
                    await atomicWriteFile(`${file}.bak`, content)
                    await atomicWriteFile(file, r.content)
                  })
                } catch (e) {
                  return send(409, { error: `会话手术锁失败：${(e as Error).message}` })
                }
                // 任务 1：文件快照整批回滚（同 session-rollback；截到最后用户消息 = 腰斩
                // 该 turn → includeBoundary，该 turn 内的文件写一并回退）
                const fsnap = await restoreSnapshotsAfter(dshHome, sessionId, snapshotRestoreBoundary(content, lastUser.seq))
                const undo = await replayUndoLog(dshHome, sessionId, sessionContentMaxTime(r.content))
                logLine(`session-regenerate: ${sessionId} 截到最后用户消息 seq ${lastUser.seq}（截 ${r.dropped} 事件；变量回滚 ${undo.restored} 条；文件快照回滚 ${fsnap.restoredTurns.length} turn/${fsnap.filesRestored + fsnap.filesDeleted} 文件）`)
                console.log(`[dsht-rp] session-regenerate: ${sessionId} → anchor=${lastUser.seq} truncated=${r.dropped} undoRestored=${undo.restored} snapshotTurns=${fsnap.restoredTurns.join(',')}`)
                return send(200, { truncated: r.dropped, lastUserText: lastUser.text, variablesRestored: undo.restored, fileSnapshots: { turns: fsnap.restoredTurns, restored: fsnap.filesRestored, deleted: fsnap.filesDeleted, errors: fsnap.errors } })
              }
            }
            // ---- R18b：/rp/rollback-mask —— 逻辑回退掩码查询（前端 UI 隐藏被回退消息）----
            // {sessionId} → {hideAfter, hiddenSeqs}：从 session.jsonl 扫 dsht-rp 的回退/编辑/
            // 重新生成 marker，解析出**精确的被移出 seq 集合**。
            //
            // 【2026-09-14 F2 架构修复】此前的实现有两个根本缺陷，用户实测触发：
            //   ① 判据是**阈值** `hideAfter`（「seq 大于它就隐藏」）——但回退后用户正常
            //      发的新消息 seq 也大于锚点，会被一起隐掉；
            //   ② 为修补 ①，加了一条「marker 之后出现新用户消息 → hide 整体归零」的
            //      兜底 —— 结果用户「回退 → 重发」时（必然产生新用户消息）掩码归零，
            //      **被回退的旧楼层全部复活**（用户截图实证）。
            // 正解：直接用写侧已记录的 `shadowedSeqs`（被 replace 逐条移出的 seq）——
            // 集合语义精确且**持久有效**，与后续新增消息无关。
            // `hideAfter` 保留在响应里 **仅为兼容旧前端与降级路径**（存量会话可能只写锚点）；
            // 前端必须优先用 `hiddenSeqs`。
            if (sub === '/rp/rollback-mask') {
              const sessionId = String(payload.sessionId ?? '')
              if (!sessionId) return send(400, { error: 'sessionId required' })
              // 缓存（性能，2026-09-04）：前端每个消息行组件挂载都触发本路由——全量扫
              // session.jsonl 在大会话上是可观的重复 I/O。按文件 mtime 失效：变了才重扫。
              // （逻辑回退/编辑/重新生成的 live 分支成功后会 clear 本缓存——见下）
              let hide = 0
              const hidden = new Set<number>()
              // 【2026-09-19】连带范围集合（每次回退/编辑/重生成一条）——见 payload.shadowedRange
              const ranges: Array<{ start: number; end: number }> = []
              const hit = (await scanSessionHeaders()).find(h => h.sessionId === sessionId)
              if (hit) {
                const file = hit.file
                const fm = await stat(file).then(s => ({ size: s.size, mtimeMs: s.mtimeMs })).catch(() => null)
                const cached = rollbackMaskCache.get(file)
                if (fm !== null && cached !== undefined && cached.size === fm.size && cached.mtimeMs === fm.mtimeMs) {
                  return send(200, { hideAfter: cached.hide, hiddenSeqs: cached.seqs, hiddenRanges: cached.ranges })
                }
                const content = await readFile(file, 'utf8')
                // 【阶段4 2026-09-11 修复 · 静默失败族】原实现**只读 source 顶层**的
                // `rolledBackTo / editedFrom / regeneratedFrom`。0.1.5 迁移不再允许
                // source 上的扩展键（`source has unexpected member` 整会话打不开），
                // 写侧已改为官方白名单形态 `form:'snapshot' + sections[{name:'dsht:surgical',
                // text: JSON.stringify(payload)}]`（0.1.2 存量会话被迁移器搬进
                // `name:'dsht:legacy'` 段）。顶层键从此恒 undefined → hide 恒 0 →
                // **回退/编辑/重新生成后 UI 永不隐藏被移除的楼层**（服务端已正确截断，
                // 前端照旧显示，无任何报错——典型静默失败）。统一走 readSurgical
                // （新形态 + 存量形态 + 顶层键三路兜底，与写侧同一套语义）。
                let markerSeq = -1
                let anchorCount = 0
                for (const line of content.split('\n')) {
                  if (!line.includes('dsht:surgical') && !line.includes('dsht:legacy')
                    && !line.includes('rolledBackTo') && !line.includes('editedFrom') && !line.includes('regeneratedFrom')) continue
                  try {
                    const ev = JSON.parse(line) as { type?: string; seq?: number; data?: unknown }
                    const { anchor, payload } = readSurgical(ev)
                    if (anchor !== null) { hide = Math.max(hide, anchor); markerSeq = Math.max(markerSeq, ev.seq ?? -1); anchorCount += 1 }
                    // 精确集合：写侧逐条记录的被移出 seq（权威判据）
                    for (const q of payload.shadowedSeqs ?? []) hidden.add(q)
                    // edit 语义 = 锚消息本身也移出 → 把它并入集合（阈值路径下靠 editedFrom-1 表达）
                    if (typeof payload.editedFrom === 'number') hidden.add(payload.editedFrom)
                    // 【2026-09-19】连带范围：harness 运行过程节点（系统提示词 / 上下文注入 /
                    // 本轮运行失败）的锚不是 surface 事件 seq（见 session-write.ts 的字段注释），
                    // 逐条 seq 集合拦不住它们，只能靠区间判定。
                    if (payload.shadowedRange !== undefined) {
                      const dup = ranges.some(r => r.start === payload.shadowedRange!.start && r.end === payload.shadowedRange!.end)
                      if (!dup) ranges.push(payload.shadowedRange)
                    }
                  } catch { /* 坏行跳过 */ }
                }
                // 【2026-09-14 F2】删除了原「marker 之后出现新用户消息 → hide 归零」补丁。
                // 该补丁是为绕开阈值语义的固有缺陷而加，代价是「回退后重发 = 旧楼层复活」。
                // 改用集合语义后不再需要它：新消息的 seq 不在 hidden 集合里 → 正常显示；
                // 被回退的旧 seq 在集合里 → 永久隐藏。两件事互不干扰。
                // 但**降级路径**（存量会话没写 shadowedSeqs，只有锚点）仍受阈值语义限制：
                // 此时若 marker 之后已出现新的真用户消息，阈值会把它们一起隐掉 →
                // 只能退回「不隐藏」并**出声**（不许静默）。
                if (hidden.size === 0 && hide > 0 && markerSeq >= 0) {
                  for (const line of content.split('\n')) {
                    try {
                      const ev = JSON.parse(line) as { seq?: number; type?: string; data?: { source?: { kind?: string } } }
                      if (typeof ev.seq === 'number' && ev.seq > markerSeq && ev.type === 'user/message' && ev.data?.source?.kind === 'user') {
                        console.warn(`[dsht-rp] rollback-mask 降级：会话 ${sessionId} 的回退标记缺少 shadowedSeqs（存量格式），且其后已有新用户消息——阈值语义会把新消息一并隐藏，故本次不隐藏（hideAfter=${hide} → 0）`)
                        hide = 0
                        break
                      }
                    } catch { /* 坏行跳过 */ }
                  }
                }
                if (fm !== null) rollbackMaskCache.set(file, { ...fm, hide, seqs: [...hidden], ranges: [...ranges] })
              }
              return send(200, { hideAfter: hide, hiddenSeqs: [...hidden], hiddenRanges: [...ranges] })
            }
            // ---- R19：/rp/import-reset —— 清空 RP 相关数据（zip 重导重置；前端弹窗确认后调）----
            // （/rp/session-edit 已并入 R18 双路径：live 逻辑回退 + 非 live 文件截断）
            // 删：rp/ 下除 _start 外全部（含 rp/state/、rp/global-books.json、rp/regex/）、
            // skills/wb-*、rp-presets/*、.agent-presets/rp-* 与 st-*、
            // sessions/ 下 cwd 属于 rp/<slug>（slug≠_start）的会话目录。rp-import/ 批次保留。
            if (sub === '/rp/import-reset') {
              const removed = { workspaces: 0, skills: 0, rpPresets: 0, agentPresets: 0, sessions: 0 }
              const errors: string[] = []
              const rmEntry = async (abs: string, bucket: keyof typeof removed): Promise<void> => {
                try { await rm(abs, { recursive: true, force: true }); removed[bucket]++ } catch (e) {
                  errors.push(`${abs}: ${(e as Error).message}`)
                }
              }
              // rp/ 下除 _start 外全部（state/、global-books.json、regex/ 随目录项一起清）
              try {
                for (const d of await readdir(join(dshHome, 'rp'))) {
                  if (d === '_start') continue
                  await rmEntry(join(dshHome, 'rp', d), 'workspaces')
                }
              } catch { /* 无 rp 目录 */ }
              try {
                for (const d of await readdir(join(dshHome, 'skills'))) {
                  if (d.startsWith('wb-')) await rmEntry(join(dshHome, 'skills', d), 'skills')
                }
              } catch { /* 无 skills 目录 */ }
              try {
                for (const d of await readdir(join(dshHome, 'rp-presets'))) {
                  await rmEntry(join(dshHome, 'rp-presets', d), 'rpPresets')
                }
              } catch { /* 无 rp-presets 目录 */ }
              try {
                for (const d of await readdir(join(dshHome, '.agent-presets'))) {
                  if (d.startsWith('rp-') || d.startsWith('st-')) await rmEntry(join(dshHome, '.agent-presets', d), 'agentPresets')
                }
              } catch { /* 无 .agent-presets 目录 */ }
              // 会话：cwd 属于 rp/<slug>（slug≠_start；相对/绝对/symlink/Windows 反斜杠形态都认）的目录删
              const rpCwdSlug = (cwd: string | undefined): string | null => {
                if (!cwd) return null
                const n = normAndroidPath(cwd).replaceAll('\\', '/')
                const m = n.match(/(?:^|\/)rp\/([^/]+)$/)
                return m ? m[1] : null
              }
              for (const h of await scanSessionHeaders()) {
                const slug = rpCwdSlug(h.cwd)
                if (slug === null || slug === '_start') continue
                await rmEntry(join(dshHome, 'sessions', h.project, h.sdir), 'sessions')
                // 空 project 目录顺手清掉（读目录确认空了才删，防误删同项目其他会话）
                const leftovers = await readdir(join(dshHome, 'sessions', h.project)).catch(() => null)
                if (leftovers !== null && leftovers.length === 0) {
                  await rm(join(dshHome, 'sessions', h.project), { recursive: true, force: true })
                }
              }
              // 缓存失效（下轮重读空态）
              globalRegexCache = null
              presetCache.clear()
              presetRegexCache.clear()
              bookCache.clear()
              activeStPresetCache = undefined // rp-presets 清空 → ST 激活预设默认重解析
              logLine(`import-reset: 工作区 ${removed.workspaces}、书 ${removed.skills}、RP 预设 ${removed.rpPresets}、agent 预设 ${removed.agentPresets}、会话 ${removed.sessions}；失败 ${errors.length}`)
              console.log(`[dsht-rp] import-reset: ${JSON.stringify(removed)} errors=${errors.length}`)
              return send(200, { removed, errors, note: 'rp-import/ 批次目录与 rp/_start 欢迎工作区保留；live 会话的内存态不受影响（重开会话生效）' })
            }
            // ---- R14：/rp/register-workspaces —— 迁移收尾一次性可见性注册 ----
            // 扫 $DSH_HOME/rp/*/（rp.json 拿 characterName），对每个工作区：
            // workspace.create（幂等）+ rename(卡名) + 迁移会话归组（attachSession）。
            // 优先 host 进程内直调 WorkspaceRegistry（attach 不需要 resume agent，
            // 比 session.create 认领轻得多）；服务不可达时回退 loopback /api（无归组）。
            // 顺带：先跑存量 cwd 修复 + st-* 预设 agent preset 回填（热发现，无需重启）。
            // 客户端刷新：workspace.* 变更经 host 帧即时推送到侧边栏；会话清单由
            // RP overlay 调完后触发 ctx.sessions.refresh()。
            // 0.1.2 坑 #21：workspace.list 端点已删除（改 workspace/follow 流，浏览器端
            // 直连要过 mux websocket）——这里进程内直取 registry 一次性回视图，供 RP
            // overlay 角色列表与对账使用（免网关/免 cookie）。
            if (sub === '/workspace-views') {
              const reg = getWorkspaceRegistry()
              if (reg === null) return send(503, { error: 'workspaceRegistry 不可用（宿主服务未就绪）' })
              const items = reg.list().map(w => ({
                workspaceId: w.id,
                path: w.path ?? '',
                title: w.title,
              }))
              return send(200, { items })
            }

            if (sub === '/rp/register-workspaces') {              // R17：先修 seq 断号再归组（断号会话 DSH 拒绝打开，attach 进去也是坏的）
              const seqRepair = await repairAllSessionSeqs()
              const repair = await repairSessionCwds()
              // 会话按 cwd 的 realpath 规范形态归桶（attach 校验走同一规范）
              const byCanonicalCwd = new Map<string, string[]>()
              for (const h of await scanSessionHeaders()) {
                if (h.cwd === undefined) continue
                try {
                  const canonical = await realpath(h.cwd)
                  const list = byCanonicalCwd.get(canonical) ?? []
                  list.push(h.sessionId)
                  byCanonicalCwd.set(canonical, list)
                } catch { /* cwd 不可解（相对路径/已删目录）跳过 */ }
              }
              const rpRoot = join(dshHome, 'rp')
              let slugs: string[] = []
              try { slugs = await readdir(rpRoot) } catch { /* 无 rp 目录 */ }
              const registered: Array<Record<string, unknown>> = []
              const registry = getWorkspaceRegistry()
              if (registry !== null) {
                for (const slug of slugs.sort()) {
                  let characterName = slug
                  try {
                    const rp = JSON.parse(await readFile(join(rpRoot, slug, 'rp.json'), 'utf8')) as { characterName?: string }
                    if (typeof rp.characterName === 'string' && rp.characterName.trim()) characterName = rp.characterName.trim()
                  } catch { continue } // 无 rp.json 的目录不是 RP 工作区
                  const entry: Record<string, unknown> = { slug, name: characterName }
                  try {
                    const dir = join(rpRoot, slug)
                    const canonical = await realpath(dir).catch(() => dir)
                    let entity = await registry.resolveByPath(canonical)
                    let created = false
                    if (entity === undefined) {
                      entity = await registry.create(canonical)
                      created = true
                    }
                    entry.workspaceId = entity.id
                    entry.created = created
                    // 命名：默认名（basename）或与卡名不同则改；重名冲突加 slug 后缀
                    if (entity.title !== characterName) {
                      const conflict = registry.list().some(w => w.id !== entity.id && w.title === characterName)
                      const title = conflict ? `${characterName} · ${slug.slice(-6)}` : characterName
                      await entity.setTitle(title)
                      entry.renamed = title
                    }
                    // 会话归组：cwd 规范形态命中的迁移会话 attach 进工作区账户
                    const adopted: string[] = []
                    const adoptFailed: Array<{ sessionId: string; error: string }> = []
                    for (const sid of byCanonicalCwd.get(canonical) ?? []) {
                      try {
                        await entity.attachSession(sid)
                        adopted.push(sid)
                      } catch (e) {
                        adoptFailed.push({ sessionId: sid, error: (e as Error).message })
                      }
                    }
                    entry.adopted = adopted
                    if (adoptFailed.length > 0) entry.adoptFailed = adoptFailed
                  } catch (e) {
                    entry.error = (e as Error).message
                  }
                  registered.push(entry)
                }
              } else {
                // 回退：loopback /api（workspace.create + rename；会话归组不可用，如实标注）
                // 0.1.2 坑 #21 续：workspace.list 端点已删除（改 workspace/follow 流）——
                // registry 再试一次拿存量集合；仍不可用则空集合盲建（重复风险如实进 note）
                const regRetry = getWorkspaceRegistry()
                const existingPaths = new Set<string>()
                if (regRetry !== null) {
                  try {
                    for (const w of regRetry.list()) existingPaths.add(String(w.path ?? ''))
                  } catch { /* list 失败不阻塞——盲建 */ }
                }
                for (const slug of slugs.sort()) {
                  let characterName = slug
                  try {
                    const rp = JSON.parse(await readFile(join(rpRoot, slug, 'rp.json'), 'utf8')) as { characterName?: string }
                    if (typeof rp.characterName === 'string' && rp.characterName.trim()) characterName = rp.characterName.trim()
                  } catch { continue }
                  const entry: Record<string, unknown> = { slug, name: characterName }
                  try {
                    const dir = join(rpRoot, slug)
                    const canonical = await realpath(dir).catch(() => dir)
                    if (existingPaths.has(canonical)) {
                      entry.created = false
                    } else {
                      const ws = await hostRpc('workspace.create', { request: { path: canonical } })
                      const workspace = ws.workspace as { workspaceId?: string } | undefined
                      entry.workspaceId = workspace?.workspaceId ?? null
                      entry.created = true
                      if (workspace?.workspaceId) {
                        try {
                          await hostRpc('workspace.rename', { request: { workspaceId: workspace.workspaceId, title: characterName } })
                          entry.renamed = characterName
                        } catch {
                          try {
                            await hostRpc('workspace.rename', { request: { workspaceId: workspace.workspaceId, title: `${characterName} · ${slug.slice(-6)}` } })
                            entry.renamed = `${characterName} · ${slug.slice(-6)}`
                          } catch { /* rename 失败不阻塞 */ }
                        }
                      }
                    }
                    entry.note = 'registry 服务不可达（loopback 回退）：会话归组未执行'
                  } catch (e) {
                    entry.error = (e as Error).message
                  }
                  registered.push(entry)
                }
              }
              // R5 回填：st-* RP 预设 → .agent-presets/（agent preset 发现是逐次扫盘，写完即可见）
              await ensureRpPresetSync()
              // 任务 2 存量迁移：.agent-presets/rp-* → rp.json.promptPersona 后删除（在用会话的保留）
              const cardPresetMigration = await migrateCardAgentPresets()
              const createdCount = registered.filter(r => r.created === true).length
              const adoptedCount = registered.reduce((n, r) => n + (Array.isArray(r.adopted) ? r.adopted.length : 0), 0)
              const errorCount = registered.filter(r => typeof r.error === 'string').length
              logLine(`register-workspaces: ${registered.length} 个工作区（新建 ${createdCount}），归组会话 ${adoptedCount}，失败 ${errorCount}`)
              console.log(`[dsht-rp] register-workspaces: workspaces=${registered.length} created=${createdCount} adopted=${adoptedCount} errors=${errorCount} mode=${registry !== null ? 'registry' : 'loopback'}`)
              return send(200, {
                mode: registry !== null ? 'registry' : 'loopback',
                workspaces: registered,
                repair,
                seqRepair,
                cardPresetMigration,
                refresh: 'workspace.* 变更帧已推送；会话清单请客户端调 sessions.refresh（session.list 为逐次扫盘，host 侧无缓存）',
              })
            }
            // ---- 第五轮：/rp/backfill-assets —— 卡内嵌正则 + 酒馆助手脚本库确定性补齐 ----
            // 背景（用户实测抓到）：迁移 agent 漏写卡 extensions.regex_scripts（SKILL.md 有
            // 契约但没执行——ExampleGame 卡 17 条 249KB 全丢）；卡/预设的 extensions.tavern_helper
            // .scripts（悬浮球等前端脚本库）整体未搬运。此路由幂等补齐：
            // - 卡：rp.json.regex 为空 ← card.json embeddedRegex（parseCharacterCard 归一）；
            //   tavern_helper.scripts 原样落 rp/<slug>/tavern-helper-scripts.json（数据保全）。
            // - 预设：按 displayName 匹配最近批次 unpacked OpenAI Settings/*.json，
            //   tavern_helper.scripts 落 rp-presets/<id>/tavern-helper-scripts.json。
            if (sub === '/rp/backfill-assets') {
              const cards: Array<Record<string, unknown>> = []
              const presets: Array<Record<string, unknown>> = []
              const errors: string[] = []
              // ---- 卡 ----
              let slugs: string[] = []
              try { slugs = await readdir(join(dshHome, 'rp')) } catch { /* 无 rp 目录 */ }
              for (const slug of slugs) {
                if (slug === '_start') continue
                try {
                  const dir = join(dshHome, 'rp', slug)
                  const st = await stat(dir)
                  if (!st.isDirectory()) continue // rp/ 下的散文件（persona.json 等）跳过
                  let rawCard = ''
                  try { rawCard = await readFile(join(dir, 'card.json'), 'utf8') } catch { continue } // 无卡目录（regex/state 等）跳过
                  const rpPath = join(dir, 'rp.json')
                  const rp = JSON.parse(await readFile(rpPath, 'utf8')) as RpWorkspace
                  const card = importCharacterJson(rawCard, slug)
                  let filled = false
                  if (card && card.embeddedRegex.length > 0 && (!Array.isArray(rp.regex) || rp.regex.length === 0)) {
                    await snapshotRpFiles(await sessionIdForSlug(slug), [`rp/${slug}/rp.json`])
                    rp.regex = card.embeddedRegex
                    await writeFile(rpPath, JSON.stringify(rp, null, 1), 'utf8')
                    filled = true
                  }
                  // 酒馆助手脚本库（卡作用域，原样搬运）
                  const rawJ = JSON.parse(rawCard) as Record<string, unknown>
                  const cdata = (rawJ.data && typeof rawJ.data === 'object' ? rawJ.data : rawJ) as Record<string, unknown>
                  const cext = (cdata.extensions && typeof cdata.extensions === 'object' ? cdata.extensions : {}) as Record<string, unknown>
                  const th = (cext.tavern_helper && typeof cext.tavern_helper === 'object'
                    ? (cext.tavern_helper as Record<string, unknown>).scripts : undefined)
                  let thCount = 0
                  if (Array.isArray(th) && th.length > 0) {
                    await writeFile(join(dir, 'tavern-helper-scripts.json'), JSON.stringify({ scripts: th }, null, 1), 'utf8')
                    thCount = th.length
                  }
                  cards.push({ slug, embeddedRegex: card?.embeddedRegex.length ?? 0, filled, tavernHelperScripts: thCount })
                } catch (e) { errors.push(`card ${slug}: ${(e as Error).message}`) }
              }
              // ---- 预设（最近批次 OpenAI Settings 原文按 displayName 匹配）----
              try {
                const batches = (await readdir(join(dshHome, 'rp-import'))).filter(isValidBatchId).sort().reverse()
                for (const b of batches) {
                  const dir = join(dshHome, 'rp-import', b)
                  let stRoot = 'data/default-user'
                  try {
                    const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as { manifest?: { stRoot?: unknown } }
                    if (typeof meta.manifest?.stRoot === 'string' && meta.manifest.stRoot) stRoot = meta.manifest.stRoot
                  } catch { /* 无 meta 用默认 */ }
                  const oaiDir = join(dir, 'unpacked', stRoot, 'OpenAI Settings')
                  let files: string[] = []
                  try { files = (await readdir(oaiDir)).filter(f => f.endsWith('.json')) } catch { continue }
                  if (files.length === 0) continue
                  let presetDirs: string[] = []
                  try { presetDirs = await readdir(join(dshHome, 'rp-presets')) } catch { break }
                  for (const pid of presetDirs.sort()) {
                    try {
                      const p = JSON.parse(await readFile(join(dshHome, 'rp-presets', pid, 'preset.json'), 'utf8')) as { displayName?: unknown }
                      if (typeof p.displayName !== 'string') continue
                      const file = files.find(f => f.replace(/\.json$/i, '') === p.displayName)
                      if (!file) continue
                      const st = JSON.parse(await readFile(join(oaiDir, file), 'utf8')) as { extensions?: { tavern_helper?: { scripts?: unknown } } }
                      const scripts = st.extensions?.tavern_helper?.scripts
                      if (!Array.isArray(scripts) || scripts.length === 0) continue
                      await writeFile(join(dshHome, 'rp-presets', pid, 'tavern-helper-scripts.json'),
                        JSON.stringify({ scripts }, null, 1), 'utf8')
                      presets.push({ presetId: pid, displayName: p.displayName, tavernHelperScripts: scripts.length })
                    } catch (e) { errors.push(`preset ${pid}: ${(e as Error).message}`) }
                  }
                  break // 只用最近一个有效批次
                }
              } catch { /* 无批次 */ }
              // ---- 会话状态文件形状规范化（历史扁平 MVU 裸树 → {variables: tree}）----
              let stateFixed = 0
              try {
                for (const f of await readdir(join(dshHome, 'rp', 'state'))) {
                  if (!f.endsWith('.json') || f.endsWith('.undo.jsonl')) continue
                  try {
                    const fp = join(dshHome, 'rp', 'state', f)
                    const parsed = JSON.parse(await readFile(fp, 'utf8')) as Record<string, unknown>
                    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
                    if (Object.keys(parsed).some(k => STATE_RESERVED_KEYS.has(k))) continue // 已包裹
                    const sid = f.replace(/\.json$/, '')
                    await snapshotRpFiles(sid, [`rp/state/${f}`])
                    await writeFile(fp, JSON.stringify({ variables: parsed }), 'utf8')
                    stateFixed++
                  } catch (e) { errors.push(`state ${f}: ${(e as Error).message}`) }
                }
              } catch { /* 无 state 目录 */ }
              const filledCards = cards.filter(c => c.filled === true).length
              logLine(`backfill-assets: 卡正则补齐 ${filledCards}/${cards.length}，酒馆助手脚本库 卡 ${cards.filter(c => (c.tavernHelperScripts as number) > 0).length} 份 + 预设 ${presets.length} 份，状态文件规范化 ${stateFixed} 个`)
              console.log(`[dsht-rp] backfill-assets: cards=${cards.length} filled=${filledCards} presets=${presets.length} stateFixed=${stateFixed} errors=${errors.length}`)
              return send(200, { cards, presets, errors })
            }
            // ---- R4：/rp/import-api-config —— ST API 配置导入 DSH ----
            // 两种入参：{batchId}（从批次 unpacked/ 找 settings.json+secrets.json）
            // 或 {settingsJson, secretsJson?} 直传（原文 JSON 字符串）。
            // 优先 host 内直调 settings/credentials 服务（llm-pi-ai 路由 live 注册，
            // 无需重启）；服务不可用时退化为写 settings.yaml/.credentials.yaml（需重启）。
            // 安全：凭据值绝不进日志与响应（响应只回 keyRef 名）。
            if (sub === '/rp/import-api-config') {
              let settings: Record<string, unknown> = {}
              let secrets: Record<string, unknown> = {}
              let root: string | null = null
              if (typeof payload.settingsJson === 'string' && payload.settingsJson.trim()) {
                // 直传模式（无批次上下文）
                try { settings = JSON.parse(payload.settingsJson) as Record<string, unknown> } catch {
                  return send(400, { error: 'settingsJson 不是合法 JSON' })
                }
                if (typeof payload.secretsJson === 'string' && payload.secretsJson.trim()) {
                  try { secrets = JSON.parse(payload.secretsJson) as Record<string, unknown> } catch { /* 无凭据 */ }
                }
              } else {
                const batchId = String(payload.batchId ?? '')
                if (!isValidBatchId(batchId)) return send(400, { error: 'batchId 或 settingsJson 必给其一' })
                const batchDir = join(dshHome, 'rp-import', batchId)
                root = await findStDataRoot(join(batchDir, 'unpacked'))
                if (!root) return send(404, { error: '批次内找不到 settings.json（不是 ST data 结构？）' })
                try { settings = JSON.parse(await readFile(join(root, 'settings.json'), 'utf8')) as Record<string, unknown> } catch { /* 坏文件 */ }
                try { secrets = JSON.parse(await readFile(join(root, 'secrets.json'), 'utf8')) as Record<string, unknown> } catch { /* 无 secrets */ }
              }
              const parsed = parseStApiConfig(settings, secrets)
              if (!parsed) return send(400, { error: 'settings.json 里识别不到可用的 API 配置（无模型名）' })

              if (ctx.settings && ctx.credentials) {
                // RPC（进程内直调）：凭据 → provider profile → 默认模型指向导入路由
                if (parsed.keyValue) await ctx.credentials.set(parsed.keyRef, parsed.keyValue)
                await ctx.settings.update('llm-pi-ai', { providers: { [parsed.provider]: parsed.profile } })
                if (ctx.agentDefaultModel?.saveSelection) {
                  try { await ctx.agentDefaultModel.saveSelection({ provider: parsed.provider, model: parsed.model }) } catch { /* 默认模型设置失败不阻塞 */ }
                }
                logLine(`import-api-config: ${parsed.provider}（${parsed.model}）经 settings/credentials 服务写入，live 生效`)
                console.log(`[dsht-rp] import-api-config: provider=${parsed.provider} model=${parsed.model} key=${parsed.keyRef}${parsed.keyValue ? '' : '（无凭据）'} method=rpc`)
                return send(200, {
                  provider: parsed.provider, baseURL: parsed.baseURL ?? null, model: parsed.model,
                  keyNames: [parsed.keyRef], keyConfigured: parsed.keyValue !== null,
                  method: 'rpc', restarted: false, stRoot: root,
                })
              }
              // 文件退化：settings.yaml + .credentials.yaml（重启生效）
              const yamlStr = (s: string): string => `"${s.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
              const credPath = join(dshHome, '.credentials.yaml')
              if (parsed.keyValue) {
                let cred = ''
                try { cred = await readFile(credPath, 'utf8') } catch { /* 新建 */ }
                const line = `${parsed.keyRef}: ${yamlStr(parsed.keyValue)}`
                const re = new RegExp(`^${parsed.keyRef}:.*$`, 'm')
                cred = re.test(cred) ? cred.replace(re, line) : cred.trimEnd() + (cred.trim() ? '\n' : '') + line + '\n'
                await writeFile(credPath, cred, { encoding: 'utf8', mode: 0o600 })
              }
              const settingsPath = join(dshHome, 'settings.yaml')
              let doc = ''
              try { doc = await readFile(settingsPath, 'utf8') } catch { /* 新建 */ }
              if (/^llm-pi-ai:/m.test(doc)) {
                return send(409, { error: 'settings.yaml 已有 llm-pi-ai 段，文件退化模式无法安全合并——请经 DSH 设置 → 模型手工配置，或重启后重试（RPC 模式）' })
              }
              const profileYaml = Object.entries(parsed.profile)
                .map(([k, v]) => `      ${k}: ${typeof v === 'string' ? yamlStr(v) : JSON.stringify(v)}`).join('\n')
              const modelsYaml = Array.isArray(parsed.profile.models)
                ? `\n      models:\n${(parsed.profile.models as Array<Record<string, string>>).map(m => `        - id: ${yamlStr(m.id)}\n          name: ${yamlStr(m.name)}`).join('\n')}`
                : ''
              const block = `llm-pi-ai:\n  providers:\n    ${parsed.provider}:\n${Object.entries(parsed.profile).filter(([k]) => k !== 'models').map(([k, v]) => `      ${k}: ${typeof v === 'string' ? yamlStr(v) : JSON.stringify(v)}`).join('\n')}${modelsYaml}\nagent-default-model:\n  provider: ${yamlStr(parsed.provider)}\n  model: ${yamlStr(parsed.model)}\n`
              void profileYaml
              await writeFile(settingsPath, doc.trimEnd() + (doc.trim() ? '\n' : '') + block, 'utf8')
              logLine(`import-api-config: ${parsed.provider} 写入 settings.yaml（重启生效）`)
              return send(200, {
                provider: parsed.provider, baseURL: parsed.baseURL ?? null, model: parsed.model,
                keyNames: [parsed.keyRef], keyConfigured: parsed.keyValue !== null,
                method: 'file', restarted: true, stRoot: root,
              })
            }
            // T2.11：迁移写盘（嵌入导入中心 writeDshFiles 的 node 侧实现——
            // 替代 Android DSHTNative.writeDshFiles 桥；白名单语义同 Kotlin 原版）
            // 2026-09-04 节流：百级文件批量落盘（迁移段）连续写大文件会把事件循环
            // 拉满（ANR 判定窗口，手机 agent 自检实证）——每 4 个文件让出一拍，
            // 让 pending I/O / UI 帧得到调度；单文件仍走异步 writeFile。
            if (sub === '/write-files') {
              const files = Array.isArray(payload.files)
                ? (payload.files as Array<{ path?: unknown; content?: unknown; binary?: unknown }>)
                : []
              const allowPrefixes = ['skills/', '.agent-presets/', 'sessions/', 'rp/', 'rp-presets/', 'rp-import/']
              let written = 0
              const failed: string[] = []
              let batch = 0
              for (const f of files) {
                if ((batch++ % 4) === 0 && batch > 1) await new Promise<void>(r => { setImmediate(r) })
                const rel = String(f?.path ?? '')
                // T3.1b：二进制内容（{base64}），用于立绘 avatar.png 落盘。
                // 【2026-09-11 心跳 46 收紧】原判据是「content 是对象就当二进制」——过于宽松：
                // 任何**误传对象**的调用方（实测 card-export 的 worldbook.json 就漏了
                // JSON.stringify）都会被静默 base64 解码成 `[object Object]` 的乱码字节，
                // 文件写成功、无报错、内容全错（静默失败族）。
                // 收紧为：显式 `binary:true`，或对象**确实带 string 型 base64 字段**。
                // 不带 base64 的对象 → 落成明确失败（宁可报错，不可静默写垃圾）。
                const asObj = (f?.content !== null && typeof f?.content === 'object') ? f.content as Record<string, unknown> : null
                const hasB64Shape = asObj !== null && typeof asObj.base64 === 'string'
                const explicitBinary = f?.binary === true
                const binary = explicitBinary || hasB64Shape
                const content = String(f?.content ?? '')
                if (asObj !== null && !binary) {
                  failed.push(`${String(f?.path ?? '')}: content 是对象但没有 base64 字段，也不是 binary:true（疑似上游漏了 JSON.stringify）`)
                  continue
                }
                const segs = rel.split('/').filter(s => s.length > 0)
                const safe = rel.length > 0 && !rel.startsWith('/')
                  && segs.every(s => s !== '.' && s !== '..')
                  && allowPrefixes.some(p => segs.join('/').startsWith(p))
                if (!safe) { failed.push(`${rel}: 非法路径`); continue }
                try {
                  const abs = join(dshHome, rel)
                  // canonical 越界防御（.. 逃逸）
                  if (!resolve(abs).startsWith(resolve(dshHome) + sep)) { failed.push(`${rel}: 越界`); continue }
                  await mkdir(dirname(abs), { recursive: true })
                  if (binary) {
                    const b64 = String((f?.content as { base64?: string })?.base64 ?? f?.content ?? '')
                    await writeFile(abs, Buffer.from(b64, 'base64'))
                  } else {
                    await writeFile(abs, content, 'utf8')
                  }
                  written++
                } catch (e) {
                  failed.push(`${rel}: ${(e as Error).message}`)
                }
              }
              logLine(`write-files: ${written} 个文件已写, ${failed.length} 失败`)
              return send(200, { written, failed, dshHome })
            }
            if (sub === '/variant/groups') {
              const sessionId = String(payload.sessionId ?? '')
              const session = ctx.sessions?.get(sessionId)
              if (!session) return send(404, { error: 'session not attached (open it in DSH first)' })
              const groups = collectVariantGroups(sessionEventsSnapshot(session) as never[])
              const seen = new Set<VariantGroup>()
              const list: Array<{ members: Array<{ seq: number; text: string }>; activeSeq: number }> = []
              for (const g of groups.values()) {
                if (seen.has(g)) continue
                seen.add(g)
                list.push({ members: g.members, activeSeq: g.activeSeq })
              }
              return send(200, { groups: list })
            }
            if (sub === '/variant/switch') {
              const sessionId = String(payload.sessionId ?? '')
              const targetSeq = Number(payload.targetSeq ?? -1)
              const session = ctx.sessions?.get(sessionId)
              if (!session) return send(404, { error: 'session not attached (open it in DSH first)' })
              // 当前 active：surface 上的 assistant 消息中，target 所属组的 active
              // 0.1.2 坑 #22：session.events 数组已移除——snapshotEvents() 快照替代
              const s2 = session as unknown as { snapshotEvents?: () => readonly unknown[]; events?: unknown[] }
              const eventsForGroups = (typeof s2.snapshotEvents === 'function' ? s2.snapshotEvents() : s2.events ?? []) as never[]
              const groups = collectVariantGroups(eventsForGroups)
              const group = groups.get(targetSeq)
              if (!group) return send(400, { error: 'target not in any variant group' })
              if (group.activeSeq === targetSeq) return send(200, { ok: true, note: 'already active' })
              const target = group.members.find(m => m.seq === targetSeq)
              if (!target) return send(400, { error: 'target member missing' })
              // 【阶段3 2026-09-10 重写】assistant/message 在 0.1.5 不能做 replace 节点
              // 也不能带 sourceEventSeqs（官方设计死锁）。改走官方 compaction 同款形态：
              //   ① user/message 标记（合法 replace）把当前 active 变体移出模型上下文
              //   ② 目标变体文本作为新 assistant/message **追加**（落进打开的 step）
              // 前端显示层照旧按变体组覆盖渲染（RpNativeChat variantOverride 不变）。
              const existingView = readSurfaceNodes(session)
              if (!existingView.includes(group.activeSeq)) {
                return send(400, { error: '当前变体不在模型视图（可能已被回退/折叠），无法切换' })
              }
              const agent = ctx.agents?.get(sessionId) as { phase?: { kind?: string; lastTurn?: number } } | undefined
              const idle = agent?.phase?.kind === 'idle'
              const plan = planAssistantRewrite(eventsForGroups as Array<{ type?: unknown; data?: { turn?: unknown } }>, idle)
              const ev = buildVariantSwitchEvent(sessionId, eventsForGroups.length, group.activeSeq, target.text)
              if (!ev) return send(400, { error: 'empty target text' })
              if (plan.openTurn) session.append('turn/start', { turn: plan.turn })
              session.append('step/start', { turn: plan.turn, step: plan.step })
              // compaction/prune 必须**紧邻** replace（影子化协议铁律，官方 toolResultPruner 同款）
              const activeEv = sessionEventAt(session, group.activeSeq)
              const activeBlocks = (() => {
                const dm = (activeEv?.data ?? {}) as { message?: { content?: unknown }; content?: unknown }
                const inner = (dm.message && typeof dm.message === 'object' ? dm.message : dm) as { content?: unknown }
                return Array.isArray(inner.content) ? inner.content as Array<Record<string, unknown>> : []
              })()
              const shadowedTokens = activeBlocks.reduce((t, b) =>
                t + (b && (b['type'] === 'text' || b['type'] === 'reasoning') && typeof b['text'] === 'string'
                  ? Math.ceil((b['text'] as string).length / 4) + 4
                  : 4 + Math.ceil(JSON.stringify(b).length / 4)), 0) + 4
              session.append('compaction/prune', {
                shadowedRange: { start: group.activeSeq, end: group.activeSeq },
                shadowedSeqs: [group.activeSeq],
                shadowedTokenCount: shadowedTokens,
              })
              appendReplace(session as unknown as AppendableSession, 'user/message', {
                id: `dsht-variant-mark-${randomUUID()}`,
                role: 'user',
                content: [{ type: 'text', text: `[变体切换] 已切换到该楼层的第 ${group.members.findIndex(m => m.seq === targetSeq) + 1}/${group.members.length} 个变体。` }],
                source: markerSource('dsht-rp', 'surgical', { variantOf: targetSeq, shadowedSeqs: [group.activeSeq] }),
              }, { start: group.activeSeq, end: group.activeSeq }, [group.activeSeq])
              session.append(ev.type, {
                ...(ev.data as object),
                turn: plan.turn, step: plan.step,
                message: { ...(ev.data as { message: object }).message, id: `dsht-variant-${sessionId}-${eventsForGroups.length}` },
              }, { surfaceOp: 'append' })
              session.append('step/end', { turn: plan.turn, step: plan.step })
              if (plan.openTurn) session.append('turn/end', { turn: plan.turn, reason: { kind: 'completed' } })
              // R49 同步：内核 phase.lastTurn 不刷新会让内核重开同一 turn（前端装配器崩溃）
              if (plan.openTurn && agent?.phase && typeof agent.phase.lastTurn === 'number' && agent.phase.lastTurn < plan.turn) {
                agent.phase.lastTurn = plan.turn
              }
              group.activeSeq = targetSeq
              groups.set(targetSeq, group)
              console.log(`[dsht-rp] variant switch: session=${sessionId} → seq ${targetSeq}（marker replace + append，turn=${plan.turn}）`)
              // I8-1：立即耐久 barrier（切变体后崩溃 = 变体切换丢失）
              try { await flushLiveSession(ctx.sessions, session) } catch (e) {
                return send(500, { error: `变体切换已应用但落盘失败：${(e as Error).message}` })
              }
              return send(200, { ok: true })
            }
            // ---- /llm/classify：导入管线 AI 语义分类（§4.5 第二层，非可选项）----
            // 入参 { system?, prompt } → 走已配置默认模型与凭据的一次性补全 → { ok, text }
            // 分类协议（类目/输出 JSON 形状）由调用方组织——插件侧保持薄通道。
            if (sub === '/llm/classify') {
              if (!ctx.llm) return send(503, { error: 'llm service unavailable' })
              const sel = ctx.agentDefaultModel?.currentSelection?.()
              if (!sel?.provider || !sel?.model) {
                return send(503, { error: 'no default model configured (先在导入中心配置 API 连接)' })
              }
              const system = typeof payload.system === 'string' && payload.system.trim()
                ? payload.system
                : '你是 SillyTavern → DSH 迁移管线的语义分类器。严格按用户指定的 JSON 协议输出，不要输出任何 JSON 之外的文字。'
              const prompt = String(payload.prompt ?? '')
              if (!prompt.trim()) return send(400, { error: 'empty prompt' })
              let text = ''
              for await (const chunk of ctx.llm.stream({
                provider: sel.provider,
                model: sel.model,
                system,
                messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
              })) {
                if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
              }
              console.log(`[dsht-rp] llm/classify: ${sel.provider}/${sel.model} → ${text.length}ch`)
              // D4 产物日志化（诊断面板可见）：额外解析时把模型原文尾部落 logLine
              const extraNote = (payload as { extraAnalysis?: unknown }).extraAnalysis === true
              if (extraNote) logLine(`MVU 额外解析产物（${text.length}ch）：${text.slice(-300)}`)
              return send(200, { ok: true, text })
            }
            // ---- /trace：组装 trace（T1.5："这条消息怎么被生成的"，前端/调试消费）----
            if (sub === '/trace') {
              const sessionId = String(payload.sessionId ?? '')
              if (!sessionId) return send(400, { error: 'sessionId required' })
              const trace = lastTrace.get(sessionId)
              if (!trace) return send(404, { error: 'no trace yet (send a message first)' })
              return send(200, { trace })
            }
            // ---- /rp/home：DSH_HOME 绝对路径（overlay 建 session 拼 cwd 用）----
            // 【心跳 61 修复】返回**规范化**形态（`/data/user/0/<pkg>` → `/data/data/<pkg>`）。
            // 原样透传 `DSH_HOME` 会让 overlay 用它拼出的 cwd 是 symlink 形态，而全项目
            // 其余位置一律按 `normAndroidPath` 规范形态比对/落盘（`rpSlugFromCwd`、
            // `ensureWelcomeWorkspace` 的 wsCwd、WorkspaceRegistry 的 realpath）——
            // 结果：**每一次从 RP UI 新建会话都会写出一条非规范 cwd**，只能靠
            // `repairSessionCwds` 在下次冷启动搬迁目录 + 改首行来收尾。而那条收尾路径
            // 在 0.1.5 世代下有缺陷（见其上「心跳 61 修复 · 严重」），会把会话留在
            // 「目录名 ≠ projectKey(header.cwd)」的非法态 ⇒ 打不开。
            // 在源头规范化后：新建会话**当场**就满足 assertStoredIdentity，不再需要搬迁。
            // 安全性：本值在客户端只用于 (a) 拼 `session.create` 的 cwd、(b) 设置面板显示/
            // 复制路径；两处路径越界守卫（/rp/convert-chat、写文件路由）只接受**相对路径**
            // （显式拒绝 `/` 开头），与这里给的绝对路径无交互 ⇒ 改动面仅此一处。
            if (sub === '/rp/home') {
              return send(200, { dshHome: normAndroidPath(dshHome) })
            }
            // ---- §2.3 ③：/rp/chat-prefs → 聊天界面偏好（楼层号显示；前端徽章开关）----
            if (sub === '/rp/chat-prefs') {
              return send(200, readChatPrefs())
            }
            // ---- I4：/rp/identity?slug= → {user, char}（显示期核心宏的数据源；persona active 优先）----
            // 【实机测试修复 2026-09-05】路由匹配用 subPath（剥 query）——客户端按
            // POST+查询串消费，用 sub 全串匹配时带 ?slug= 必 404（显示期宏静默退化）。
            if (subPath === '/rp/identity') {
              const slugQ = String(new URL(req.url ?? '/', 'http://localhost').searchParams.get('slug') ?? '')
              const persona = await loadActivePersona(dshHome)
              let char = ''
              let macrosUser = ''
              if (slugQ) {
                try {
                  const rp = JSON.parse(await readFile(join(dshHome, 'rp', slugQ, 'rp.json'), 'utf8')) as {
                    characterName?: unknown; macros?: { char?: unknown; user?: unknown }
                  }
                  char = typeof rp?.macros?.char === 'string' && rp.macros.char ? rp.macros.char : String(rp?.characterName ?? '')
                  macrosUser = typeof rp?.macros?.user === 'string' ? rp.macros.user : ''
                } catch { /* 无 rp.json */ }
              }
              return send(200, {
                user: persona?.name || macrosUser || '用户',
                char: char || '角色',
                persona: persona?.description ?? '',
              })
            }
            // ---- I8-6：/rp/flush-all POST → 全部 live 会话立即耐久（诊断/手动触发用；
            // Android 壳走 flush-request 文件通道，不依赖 HTTP）----
            if (subPath === '/rp/flush-all' && req.method === 'POST') {
              const n = await flushAllLiveSessions('http')
              return send(200, { ok: true, flushed: n })
            }
            // ---- D4：MVU 额外模型解析——回复无有效更新块时，用默认模型的一次性补全
            // 产出 <UpdateVariable>（ST MagVarUpdate isDuringExtraAnalysis 同语义）。
            // POST {sessionId, reply?} → {ok, applied, patches, note?}
            if (sub === '/rp/mvu/extra-analyze' && req.method === 'POST') {
              const sessionId = String(payload.sessionId ?? '')
              if (!sessionId) return send(400, { error: 'sessionId required' })
              const settings = await readFile(join(dshHome, 'rp', 'mvu-settings.json'), 'utf8')
                .then(t => JSON.parse(t) as Record<string, unknown>).catch(() => ({}) as Record<string, unknown>)
              const enabled = settings.enableExtraAnalysis === true || settings.extra_analysis_enabled === true
                || (settings.extraAnalysis && (settings.extraAnalysis as Record<string, unknown>).enabled === true)
              if (!enabled) return send(200, { ok: false, applied: 0, note: '额外模型解析未开启（mvu-settings.enableExtraAnalysis）' })
              const session = ctx.sessions?.get(sessionId)
              let replyText = typeof payload.reply === 'string' ? payload.reply : ''
              if (!replyText && session) {
                const snap = sessionEventsSnapshot(session)
                for (let i = snap.length - 1; i >= 0; i--) {
                  const ev = snap[i]
                  if (ev?.type === 'assistant/message') {
                    // 【心跳 47】原为 `messageText((ev.data as {message?: LikeMessage}).message ?? {})`：
                    // `?? {}` 产出 `LikeMessage | {}`，直传 messageText 报 TS2345。改为显式取值，
                    // **保持原控制流**（无论有无 message 都在此处 break，缺 message 时留空串）。
                    const replyMsg = (ev.data as { message?: LikeMessage } | undefined)?.message
                    replyText = replyMsg !== undefined ? messageText(replyMsg) : ''
                    break
                  }
                }
              }
              if (!replyText.trim()) return send(400, { error: 'no assistant reply to analyze' })
              if (parseUpdateVariable(replyText).length > 0 || parseJsonPatches(replyText).length > 0) {
                return send(200, { ok: true, applied: 0, note: '回复已含有效更新块（无需额外解析）' })
              }
              if (!ctx.llm) return send(503, { error: 'llm service unavailable' })
              const sel = ctx.agentDefaultModel?.currentSelection?.()
              if (!sel?.provider || !sel?.model) return send(503, { error: 'no default model configured' })
              const stCur = await loadSessionState(sessionId)
              // 【审查修复 2026-09-05】统一 state 主树：生成期摘要读 state ?? variables、
              // 运行期 UpdateVariable 写 state——D4 补丁必须落 state 才对下一轮可见
              const stateNow = renderStateSummary((stCur.state ?? stCur.variables ?? {}) as Record<string, unknown>)
              const system = '你是 MVU 变量解析器。根据角色回复与当前状态，产出本轮需要的变量更新。只输出一个 <UpdateVariable> 块，块内是 <JSONPatch> 包裹的 JSON 数组（op: add/replace/remove，path 为 JSON Pointer，value 为新值），不要输出任何其他文字。形态示例：\n<UpdateVariable>\n<JSONPatch>\n[{"op":"replace","path":"/好感度","value":5},{"op":"replace","path":"/地点","value":"仓库"}]\n</JSONPatch>\n</UpdateVariable>\n没有需要更新的变量时输出空数组。'
              const prompt = `【当前状态】\n${stateNow || '（空）'}\n\n【角色回复】\n${replyText.slice(0, 8000)}\n\n请输出 <UpdateVariable> 更新块（按系统提示的形态；本轮确实无变化就输出空数组）。`
              let text = ''
              try {
                for await (const chunk of ctx.llm.stream({
                  provider: sel.provider, model: sel.model, system,
                  messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
                })) {
                  if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
                }
              } catch (e) {
                logLine(`MVU 额外解析 LLM 流失败（无降级）：${(e as Error).message}`)
                return send(500, { error: `LLM 流调用失败：${(e as Error).message}` })
              }
              // 解析链：UpdateVariable 块 → 裸 JSONPatch 块 → 裸 JSON 数组（模型不守包装时兜底）
              let patches = parseUpdateVariable(text).length > 0 ? parseUpdateVariable(text) : parseJsonPatches(text)
              if (patches.length === 0) {
                const arrM = text.match(/\[[\s\S]*\]/)
                if (arrM) {
                  try {
                    const arr = JSON.parse(arrM[0]) as Array<Record<string, unknown>>
                    if (Array.isArray(arr) && arr.every(p => p && typeof p === 'object' && 'op' in p && 'path' in p)) {
                      patches = arr as unknown as typeof patches
                    }
                  } catch { /* 非数组 JSON */ }
                }
              }
              // D4 产物日志化：模型原文尾部落 logLine（诊断面板可见，排查格式不守约定时用）
              logLine(`MVU 额外解析产物（${text.length}ch）：${text.slice(-300)}`)
              if (patches.length === 0) return send(200, { ok: false, applied: 0, note: '额外解析未产出有效更新块' })
              const st2 = await loadSessionState(sessionId)
              const before = (st2.state ?? st2.variables ?? {}) as Record<string, unknown>
              await appendUndoEntries(dshHome, sessionId, patches.map(p => makeUndoEntry('chat', '', p.path, before)))
              st2.state = applyStatePatches(before, patches)
              await saveSessionState(sessionId, st2)
              logLine(`MVU 额外解析：${patches.length} 个补丁已应用（${sessionId}，模型 ${sel.model}）`)
              return send(200, { ok: true, applied: patches.length, patches })
            }
            // ---- /rp/session-cwd {sessionId} → {cwd}（dock 席位 props 的 session 快照
            // 不带 cwd——cwd 在宿主 useSessions().byId；前端悬浮球/开场白窗的 RP 门槛用）----
            if (sub === '/rp/session-cwd') {
              const sessionId = String(payload.sessionId ?? '')
              if (!sessionId) return send(400, { error: 'sessionId required' })
              const headers = await scanSessionHeaders()
              const h = headers.find(x => x.sessionId === sessionId)
              return send(200, { cwd: h?.cwd ?? null })
            }
            // ---- 【2026-09-14 F4】/rp/model-capability —— 当前模型的真实上下文能力 ----
            // 前端 token 计量条的「分母」必须来自模型真实能力，而不是「预设拉不到就
            // 兜底 16384」——后者会显示 `≈ 1.1M / 16.4k tokens` 这种自相矛盾的读数
            // （用户实测截图）。数据源：
            //   ① pi-ai 内建模型目录（@earendil-works/pi-ai/dist/providers/data/<provider>.json
            //      的 contextWindow/maxTokens）—— 这是 CONTEXT_WINDOW_EXCEEDED 的真实判据来源；
            //   ② settings 里 llm-pi-ai 的用户层 models 覆盖（resolveRouteModels 契约：
            //      profile 配置的 models 会整体替换内建目录）；
            //   ③ 都拿不到 → 显式返回 null（前端标注「预算未知」，不许装作准确）。
            // 只读，无副作用；失败一律返回 null（调用方降级），绝不抛给前端。
            if (sub === '/rp/model-capability') {
              const sel = (() => {
                try { return ctx.agentDefaultModel?.currentSelection?.() ?? null } catch { return null }
              })()
              if (sel === null || !sel.provider) return send(200, { contextWindow: null, maxTokens: null, provider: null, model: null, origin: null })
              const provider = sel.provider
              const model = sel.model
              // ① 用户层覆盖（llm-pi-ai.providers.<provider>.models[]）
              let cw: number | null = null
              let mt: number | null = null
              try {
                const getS = ctx.settings?.get
                if (ctx.settings && typeof getS === 'function') {
                  const section = getS.call(ctx.settings, 'llm-pi-ai') as
                    | { providers?: Record<string, { models?: Array<Record<string, unknown>> }> }
                    | undefined
                  const hit = section?.providers?.[provider]?.models?.find(m => m?.id === model)
                  if (hit) {
                    if (typeof hit.contextWindow === 'number' && hit.contextWindow > 0) cw = hit.contextWindow
                    if (typeof hit.maxTokens === 'number' && hit.maxTokens > 0) mt = hit.maxTokens
                  }
                }
              } catch { /* settings 不可读 → 走内建目录 */ }
              // ② pi-ai 内建目录
              if (cw === null) {
                try {
                  cw = await readPiAiCatalogCapability(provider, model, 'contextWindow')
                  mt = mt ?? await readPiAiCatalogCapability(provider, model, 'maxTokens')
                } catch (e) {
                  // 出声（R8）：目录读不到时**必须**留痕，否则「预算未知」在 UI 上
                  // 与「目录里真没有这个模型」无法区分（P-9 可观测性）。
                  console.warn(`[dsht-rp] model-capability：读 pi-ai 目录失败（${provider}/${model}）：${(e as Error).message}`)
                }
              }
              return send(200, {
                contextWindow: cw,
                maxTokens: mt,
                provider,
                model,
                origin: cw !== null ? 'model-catalog' : null,
              })
            }
            // ---- 任务 C：/rp/status —— 迁移验收面板的只读聚合（大白话数据源）----
            // 最近批次（meta.json manifest 计数）+ 最新 migration-report.md 资源清单表计数
            // + 当前 API 连接（agentDefaultModel 选择）。插件存活探测由前端各自 ping。
            if (sub === '/rp/status') {
              let latestBatch: Record<string, unknown> | null = null
              try {
                const dirs = (await readdir(join(dshHome, 'rp-import'))).sort().reverse()
                for (const d of dirs) {
                  if (!isValidBatchId(d)) continue
                  const dir = join(dshHome, 'rp-import', d)
                  let meta: Record<string, unknown> = {}
                  try { meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as Record<string, unknown> } catch { /* 无 meta */ }
                  // 迁移报告的资源清单表：| 类别 | 总数 | 成功 | 失败 | 说明 |
                  let report: Array<{ category: string; total: number; ok: number; fail: number }> | null = null
                  for (const rf of ['migration-report.md', 'REPORT.md']) {
                    try {
                      const text = await readFile(join(dir, rf), 'utf8')
                      const rows: Array<{ category: string; total: number; ok: number; fail: number }> = []
                      for (const line of text.split('\n')) {
                        const m = line.match(/^\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/)
                        if (m) rows.push({ category: String(m[1]), total: Number(m[2]), ok: Number(m[3]), fail: Number(m[4]) })
                      }
                      report = rows
                      break
                    } catch { /* 无报告，试下一个文件名 */ }
                  }
                  latestBatch = {
                    batchId: d,
                    name: typeof meta.name === 'string' ? meta.name : d,
                    stagedAt: typeof meta.stagedAt === 'string' ? meta.stagedAt : null,
                    manifest: meta.manifest ?? null,
                    hasReport: report !== null,
                    report,
                  }
                  break // 只取最新一批
                }
              } catch { /* 无 rp-import 目录 */ }
              let api: { provider: string; model: string } | null = null
              try {
                const sel = ctx.agentDefaultModel?.currentSelection?.()
                if (sel?.provider && sel?.model) api = { provider: sel.provider, model: sel.model }
              } catch { /* 未配置 */ }
              return send(200, { latestBatch, api })
            }
            // ---- /rp/build-info（POST 形态）----
            // 前端 rpApi() 恒为 POST，故本路由必须在此**同样**可答（详见 buildInfoPayload 注释）。
            if (subPath === '/rp/build-info') {
              return send(200, await buildInfoPayload())
            }
            // ---- T-27：/rp/update-config —— 更新源配置的读（GET 语义）/写（带 source）----
            // 更新源未决前（GitHub Releases vs 自建静态 JSON）先落骨架：可配置、可留空。
            if (subPath === '/rp/update-config') {
              const hasSource = typeof payload.source === 'string'
              if (!hasSource) {
                const cfg = await readUpdateCfg()
                // 未配置（source 为空）时 kind 也回空 —— 否则会对空串"猜"出 json 这种无意义结论
                const kind = cfg.source === '' ? '' : (cfg.kind === '' ? guessUpdateKind(cfg.source, '') : cfg.kind)
                return send(200, { source: cfg.source, kind })
              }
              const source = String(payload.source ?? '').trim()
              const kindHint = typeof payload.kind === 'string' ? payload.kind : ''
              // 留空 = 清除配置（显式语义，不是"悄悄当没填"）
              if (source === '') {
                await writeUpdateCfg({ source: '', kind: '' })
                logLine('update-config: 更新源已清空')
                return send(200, { ok: true, source: '', kind: '' })
              }
              if (!/^https?:\/\//i.test(source)) {
                return send(400, { error: '更新源必须是 http(s) 绝对地址' })
              }
              const kind = guessUpdateKind(source, kindHint)
              await writeUpdateCfg({ source, kind })
              logLine(`update-config: 已保存更新源（${kind}）`)
              return send(200, { ok: true, source, kind })
            }
            // ---- T-27：/rp/check-update —— 手动检查更新 ----
            // 返回结构恒带 `ok`；失败时带**显式** `reason` + `message`（绝不静默返回"已是最新"）。
            if (subPath === '/rp/check-update') {
              const info = await buildInfoPayload()
              const current = typeof info.appVersion === 'string' ? info.appVersion : null
              const cfg = await readUpdateCfg()
              const overrideUrl = typeof payload.source === 'string' ? payload.source.trim() : ''
              const source = overrideUrl !== '' ? overrideUrl : cfg.source
              const kind = guessUpdateKind(source, overrideUrl !== '' ? (typeof payload.kind === 'string' ? payload.kind : '') : cfg.kind)
              const base = { current, dshVersion: info.dshVersion, sentinel: info.sentinel, source, kind }
              if (source === '') {
                return send(200, { ok: false, reason: 'unconfigured', message: '还没配置更新源——需要先确定发布渠道（GitHub Releases 或自建 JSON）', ...base })
              }
              if (!/^https?:\/\//i.test(source)) {
                return send(200, { ok: false, reason: 'bad-source', message: '更新源必须是 http(s) 绝对地址', ...base })
              }
              if (current === null || parseVersion(current) === null) {
                // PC 验证环境 / 版本号异常：如实说，不假装"已是最新"
                return send(200, { ok: false, reason: 'no-current-version', message: `读不到本机版本号（${current ?? 'null'}），无法比较`, ...base })
              }
              let feed: ReturnType<typeof normalizeUpdateFeed>
              try {
                feed = normalizeUpdateFeed(await fetchJsonWithTimeout(source), kind)
              } catch (e) {
                const msg = (e as Error)?.name === 'AbortError' ? '请求超时（12 秒）' : ((e as Error)?.message ?? '未知错误')
                logLine(`check-update 失败：${msg}`)
                return send(200, { ok: false, reason: 'fetch', message: `拉取更新源失败：${msg}`, ...base })
              }
              const relation = relateVersions(current, feed.version)
              const hasUpdate = relation === 'newer'
              // 资产挑选：按本机 ABI 优先，其次任意 .apk；都没有则退回 release 页面链接
              const abi = typeof info.appAbi === 'string' ? info.appAbi : ''
              const apks = feed.assets.filter(a => a.name.toLowerCase().endsWith('.apk'))
              const picked = pickDownloadAsset(feed.assets, abi)
              const downloadUrl = picked !== null ? picked.url : feed.url
              logLine(`check-update: ${current} → ${feed.version}（${relation}）`)
              return send(200, {
                ok: true,
                ...base,
                latest: { version: feed.version, url: feed.url, notes: feed.notes },
                relation,
                hasUpdate,
                downloadUrl,
                asset: picked,
                apkCount: apks.length,
              })
            }
            // ---- /rp/workspaces：角色工作区清单（扫 $DSH_HOME/rp/*/rp.json）----
            if (sub === '/rp/workspaces') {
              const list: Array<Record<string, unknown>> = []
              try {
                const rpDir = join(dshHome, 'rp')
                const dirs = await readdir(rpDir)
                for (const slug of dirs.sort()) {
                  try {
                    const text = await readFile(join(rpDir, slug, 'rp.json'), 'utf8')
                const o = JSON.parse(text) as {
                  characterName?: string; books?: Array<{ name?: string; lorePath?: string }>; firstMes?: string;
                  outputProtocol?: {
                    actionTags?: string[]; wrapTags?: string[]; statusTags?: string[];
                    collapsibleTags?: string[]; stateUpdateTags?: string[]; reasoningTags?: string[]; foreshadowingTags?: string[]
                  }
                }
                // 备选开场白（PROJECT_PLAN 补全）：rp.json 不落盘备选——归属位是原始卡
                // JSON（card.json）的 data.alternate_greetings（ST V2/V3）或顶层
                // alternate_greetings（V1）。无 card.json 的旧工作区按无备选处理。
                let alternateGreetings: string[] = []
                try {
                  const card = JSON.parse(await readFile(join(rpDir, slug, 'card.json'), 'utf8')) as {
                    data?: { alternate_greetings?: unknown }
                    alternate_greetings?: unknown
                  }
                  const raw = Array.isArray(card.data?.alternate_greetings)
                    ? card.data.alternate_greetings
                    : Array.isArray(card.alternate_greetings) ? card.alternate_greetings : []
                  alternateGreetings = raw.map(g => String(g ?? '').trim()).filter(g => g !== '')
                } catch { /* 无 card.json（旧导入/无源数据）→ 无备选 */ }
                list.push({
                  slug,
                  name: o.characterName ?? slug,
                  bookCount: Array.isArray(o.books) ? o.books.length : 0,
                  books: Array.isArray(o.books)
                    ? o.books.map(b => ({ name: String(b?.name ?? ''), lorePath: String(b?.lorePath ?? '') }))
                    : [],
                  firstMes: o.firstMes ?? '',
                  alternateGreetings,
                  outputProtocol: {
                    actionTags: o.outputProtocol?.actionTags ?? ['a', 'selection'],
                    wrapTags: o.outputProtocol?.wrapTags ?? ['content'],
                    statusTags: o.outputProtocol?.statusTags ?? ['status', 'statusbar', 'StatusBlock'],
                    // T2.10 渲染补差（旧 rp.json 缺字段走默认）
                    collapsibleTags: o.outputProtocol?.collapsibleTags ?? ['details'],
                    stateUpdateTags: o.outputProtocol?.stateUpdateTags ?? ['UpdateVariable'],
                    reasoningTags: o.outputProtocol?.reasoningTags ?? ['Analysis'],
                    foreshadowingTags: o.outputProtocol?.foreshadowingTags ?? ['foreshadowings'],
                  },
                })
                  } catch { /* 坏 rp.json 跳过 */ }
                }
              } catch { /* 无 rp 目录 */ }
              return send(200, { workspaces: list, dshHome })
            }
            // ---- T2.6：世界书后期绑定（ST 允许事后换书；归属位 = RP 启动器角色详情）----
            // /rp/books {} → 库内全部世界书 skill（skills/wb-*/references/lore.json）
            // 增量字段（只读）：entryCount（条目数，管理界面用）+ global（R9 全局书单，rp/global-books.json）
            if (sub === '/rp/books') {
              const books: Array<{ slug: string; name: string; lorePath: string; entryCount: number }> = []
              try {
                const skillsDir = join(dshHome, 'skills')
                for (const dir of (await readdir(skillsDir)).sort()) {
                  const lorePath = `skills/${dir}/references/lore.json`
                  try {
                    const text = await readFile(join(dshHome, lorePath), 'utf8')
                    const parsed = JSON.parse(text) as { name?: string; entries?: unknown }
                    books.push({
                      slug: dir, name: parsed.name ?? dir, lorePath,
                      entryCount: Array.isArray(parsed.entries) ? parsed.entries.length : 0,
                    })
                  } catch { /* 无 lore.json 的目录跳过 */ }
                }
              } catch { /* 无 skills 目录 */ }
              let global: Array<{ name: string; lorePath: string }> = []
              try {
                const g = JSON.parse(await readFile(join(dshHome, 'rp', 'global-books.json'), 'utf8')) as { books?: Array<{ name?: string; lorePath?: string }> }
                global = Array.isArray(g?.books)
                  ? g.books.filter(b => typeof b?.lorePath === 'string').map(b => ({ name: String(b.name ?? b.lorePath), lorePath: String(b.lorePath) }))
                  : []
              } catch { /* 无全局书单 */ }
              return send(200, { books, global })
            }
            // /rp/bind-books {slug, books: [{name, lorePath}]} → 角色工作区重绑世界书（写 rp.json.books）
            if (sub === '/rp/bind-books') {
              const slug = String(payload.slug ?? '')
              if (!slug) return send(400, { error: 'slug required' })
              const rpPath = join(dshHome, 'rp', slug, 'rp.json')
              let rp: RpWorkspace
              try {
                rp = JSON.parse(await readFile(rpPath, 'utf8')) as RpWorkspace
              } catch {
                return send(404, { error: `rp.json not found: ${slug}` })
              }
              const books = Array.isArray(payload.books)
                ? (payload.books as Array<{ name?: string; lorePath?: string }>)
                  .filter(b => typeof b?.lorePath === 'string')
                  .map(b => ({ name: String(b.name ?? b.lorePath), lorePath: String(b.lorePath) }))
                : []
              rp.books = books
              // 任务 1：写前文件快照（归属会话 = payload.sessionId ?? 该 slug 名下会话）
              await snapshotRpFiles(String(payload.sessionId ?? '') || await sessionIdForSlug(slug), [`rp/${slug}/rp.json`])
              await writeFile(rpPath, JSON.stringify(rp, null, 1), 'utf8')
              console.log(`[dsht-rp] bind-books: ${slug} → ${books.length} books`)
              return send(200, { ok: true, count: books.length })
            }
            // ---- /rp/import-card：单卡导入（node 侧解析 + 复合卡拆解 + 落盘 + 欢迎会话摘要）----
            if (sub === '/rp/import-card') {
              const json = String(payload.json ?? '')
              const nameHint = typeof payload.name === 'string' && payload.name ? payload.name : 'imported'
              const card = importCharacterJson(json, nameHint)
              if (!card) return send(400, { error: '无法解析（不是有效的角色卡 JSON）' })
              const files = exportSingleCardFiles(card, dshHome)
              let written = 0
              for (const f of files) {
                const abs = join(dshHome, f.path)
                await mkdir(dirname(abs), { recursive: true })
                await writeFile(abs, f.content, 'utf8')
                written++
              }
              // T2.6 方案 B：导入摘要写进欢迎会话（harness 工作过程在会话里可见）
              try {
                const skillCount = files.filter(f => f.path.startsWith('skills/')).length
                const hasSession = files.some(f => f.path.endsWith('/session.jsonl'))
                const summary = `**导入完成：${card.name}**\n\n- 写入 ${written} 个文件（preset + 工作区${skillCount > 0 ? ` + 内嵌世界书 skill（${skillCount} 文件）` : ''}${hasSession ? ' + 开场白会话' : ''}）\n- 到「🎭 角色扮演」→「角色」页点开「${card.name}」即可开聊。`
                const welcomeSession = ctx.sessions?.get('dsht-welcome')
                if (welcomeSession) {
                  // surfaceOp 必须走对象形态（append(type, data, {surfaceOp})）——
                  // 旧代码传裸字符串，第三参读取 .surfaceOp 为 undefined，消息
                  // 不进 surface（UI 不显示、模型不可见），此为修复。
                  welcomeSession.append('user/message', {
                    id: `dsht-imp-req-${Date.now()}`,
                    role: 'user',
                    content: [{ type: 'text', text: `导入角色卡：${card.name}` }],
                    source: { kind: 'user' },
                  }, { surfaceOp: 'append' })
                  welcomeSession.append('assistant/message', {
                    // settlement 三件套（live 会话必为 v2+，stream 是必需成员）
                    ...assistantSettlement(1, 1),
                    message: {
                      id: `dsht-imp-res-${Date.now()}`,
                      role: 'assistant',
                      content: [{ type: 'text', text: summary }],
                      source: { kind: 'model', provider: 'dsht-import', model: 'import-summary' },
                    },
                  }, { surfaceOp: 'append' })
                  // I8-1：欢迎会话 append 后立即耐久（导入摘要窗口崩溃不丢）
                  try { await flushLiveSession(ctx.sessions, welcomeSession) } catch (e) {
                    console.log(`[dsht-rp] import-card: welcome flush 失败（内存态保留）：${(e as Error).message}`)
                  }
                }
              } catch { /* 摘要失败不影响导入本体 */ }
              console.log(`[dsht-rp] import-card: ${card.name} → ${written} files`)
              return send(200, { ok: true, written, characterName: card.name })
            }
            // ---- T3.1b：/rp/export-card {slug} —— 导出 ST 兼容 PNG 卡 ----
            // 读 rp/<slug>/card.json（原样 ST JSON）+ avatar.png（立绘）；无卡 JSON 则
            // 用 rp.json 还原；无立绘用占位 PNG 兜底。返回 base64 PNG 供前端下载。
            if (sub === '/rp/export-card') {
              const slug = String(payload.slug ?? '')
              if (!slug) return send(400, { error: 'slug required' })
              const wsDir = join(dshHome, 'rp', slug)
              try {
                let json = ''
                try {
                  json = await readFile(join(wsDir, 'card.json'), 'utf8') // 原样 ST JSON
                } catch {
                  // 无 card.json（旧导入/无源数据）→ 用 rp.json 重建 V2
                  const rp = JSON.parse(await readFile(join(wsDir, 'rp.json'), 'utf8')) as RpWorkspace
                  json = buildStV2FromRp(rp).replaceAll('{{char}}', rp.characterName).replaceAll('{{user}}', rp.macros?.user ?? '用户')
                }
                let avatar: Uint8Array | null = null
                try {
                  const b64 = await readFile(join(wsDir, 'avatar.png'), 'base64')
                  avatar = new Uint8Array(Buffer.from(b64, 'base64'))
                } catch { /* 无立绘：占位兜底 */ }
                const base = avatar ?? makePlaceholderPng(rpNameFrom(json))
                const png = writeCardTextChunks(base, json)
                return send(200, {
                  filename: `${rpNameFrom(json)}.png`,
                  base64: bytesToBase64(png),
                  rawJson: json,
                  hadAvatar: !!avatar,
                })
              } catch (e) {
                return send(500, { error: `导出失败：${(e as Error).message}` })
              }
            }
            // ---- T3.1b：/rp/export-bundle {slug} —— 原生卡包目录格式 ----
            // 产出 card.json + worldbook + regex + depth + avatar 的包（base64 列表），
            // 前端打 zip 或逐文件下载。
            if (sub === '/rp/export-bundle') {
              const slug = String(payload.slug ?? '')
              if (!slug) return send(400, { error: 'slug required' })
              const wsDir = join(dshHome, 'rp', slug)
              try {
                const files: Array<{ path: string; content: string; binary?: boolean }> = []
                let json = ''
                try {
                  json = await readFile(join(wsDir, 'card.json'), 'utf8')
                } catch {
                  const rp = JSON.parse(await readFile(join(wsDir, 'rp.json'), 'utf8')) as RpWorkspace
                  json = buildStV2FromRp(rp).replaceAll('{{char}}', rp.characterName).replaceAll('{{user}}', rp.macros?.user ?? '用户')
                }
                files.push({ path: 'card.json', content: json })
                let avatar: Uint8Array | null = null
                try {
                  const b64 = await readFile(join(wsDir, 'avatar.png'), 'base64')
                  avatar = new Uint8Array(Buffer.from(b64, 'base64'))
                } catch { /* 无 */ }
                const fileName = rpNameFrom(json)
                files.push({ path: 'avatar.png', content: bytesToBase64(avatar ?? makePlaceholderPng(fileName)), binary: true })
                return send(200, { files, name: fileName })
              } catch (e) {
                return send(500, { error: `导出失败：${(e as Error).message}` })
              }
            }
            // ---- T2.6 补：/rp/open-chat {slug, sessionId} —— 物化开场白 ----
            // 用户定案（ST 同款语义）：卡的工作区新开 session 必带开场白——firstMes
            // 落成真实的 assistant 消息 turn（oneTurnLog 契约：turn/start →
            // step/start → assistant/message(surface append) → step/end → turn/end），
            // 气泡流可见、参与历史，而非只进 pre-step 快照（快照路径保留给旧工作区
            // 与 DSH 原生新建的 session 兜底）。幂等：surface 已有消息则跳过。
            if (sub === '/rp/open-chat') {
              const slug = String(payload.slug ?? '')
              const sessionId = String(payload.sessionId ?? '')
              if (!slug || !sessionId) return send(400, { error: 'slug and sessionId required' })
              const session = ctx.sessions?.get(sessionId)
              if (!session) return send(404, { error: 'session not live（先经 session.create 创建）' })
              const rp = await loadRpJson(slug, new AbortController().signal)
              if (!rp) return send(404, { error: `rp.json not found: ${slug}` })
              const hasMessages = readSurfaceNodes(session).some(seq => {
                // 0.1.2 坑 #22：eventAt(seq) 替代 .events[seq]（直索引会 TypeError）
                const ev = (session as unknown as { eventAt?: (q: number) => { type?: string } | undefined }).eventAt?.(seq)
                return ev !== undefined && (ev.type === 'user/message' || ev.type === 'assistant/message')
              })
              if (hasMessages) return send(200, { ok: true, note: 'already has messages' })
              // 备选开场白（PROJECT_PLAN 补全）：可选 greeting 覆写——「以此开场重新开始」
              // 复用同一路由物化选中的备选开场白；宏替换/落盘/幂等语义与 firstMes 一致
              const greeting = typeof payload.greeting === 'string' && payload.greeting.trim() !== '' ? payload.greeting.trim() : ''
              const firstMes = greeting || (rp.firstMes ?? '').trim()
              if (!firstMes) return send(200, { ok: true, note: 'no firstMes' })
              // 开场白宏替换 + turn 续接（0.1.2 坑 #22：snapshotEvents() 找最后一个 turn/start，
              // 空白新会话即 1——.events 数组已随 0.1.2 移除）
              // 【wuwa 终验修复 2026-09-05】persona active 优先（与 pre-step/显示期一致）
              const persona = await loadActivePersona(dshHome)
              const userName = persona?.name || (await loadUserProfileCached(dshHome)).name || rp.macros.user || '用户'
              const text = firstMes
                .replaceAll('{{char}}', rp.macros.char || rp.characterName)
                .replaceAll('{{user}}', userName)
              const snap = (session as unknown as { snapshotEvents?: () => readonly { type?: string; data?: { turn?: number } }[] }).snapshotEvents?.() ?? []
              const turn = (snap.findLast?.(ev => ev?.type === 'turn/start')?.data?.turn ?? 0) + 1
              session.append('turn/start', { turn })
              session.append('step/start', { turn, step: 1 })
              session.append('assistant/message', {
                // settlement 三件套（live 会话必为 v2+，stream 是必需成员）
                ...assistantSettlement(turn, 1),
                message: {
                  id: `dsht-open-${randomUUID()}`,
                  role: 'assistant',
                  content: [{ type: 'text', text }],
                  source: { kind: 'model', provider: 'dsht-rp', model: 'first-mes' },
                },
              }, { surfaceOp: 'append' })
              session.append('step/end', { turn, step: 1 })
              session.append('turn/end', { turn, reason: { kind: 'completed' } })
              // 【R49 2026-09-06】同步内核 agent 的 turn 计数：agent 构造时缓存
              // phase.lastTurn（读自 turnBoundary 投影），此后我们直写的 turn/start
              // 事件不会刷新这个缓存 → 内核下一条 prompt 用 turn()=lastTurn+1 重开
              // 同一 turn → 会话日志出现重复 turn/start → 前端 ConversationNodeAssembler
              // 「received more than one start Match」崩溃 → event feed subscriber 死亡，
              // 折叠行/会话流停摆（实机实证，turn 序列 1,1,2..18）。idle 时推进 lastTurn
              // 是安全同步点（无 driver 竞争）。
              const liveAgent = ctx.agents?.get(sessionId)
              if (liveAgent?.phase && liveAgent.phase.kind === 'idle'
                && typeof liveAgent.phase.lastTurn === 'number' && liveAgent.phase.lastTurn < turn) {
                liveAgent.phase.lastTurn = turn
              }
              // 主动 flush：持久化是按需 checkpoint（per-request barrier / idle），
              // 直接 append 不落盘的话进程退出即丢开场白（SessionStore.flush 契约）。
              // I8-1：flush 失败必须显式报告（禁止空吞假成功——用户以为开场白已保存）
              let flushFailed: string | null = null
              try {
                await flushLiveSession(ctx.sessions, session)
              } catch (e) {
                flushFailed = (e as Error).message
                console.log(`[dsht-rp] open-chat: flush 失败（内存态保留）：${flushFailed}`)
              }
              console.log(`[dsht-rp] open-chat: ${slug} session=${sessionId} opening=${text.length}ch turn=${turn}`)
              return send(200, { ok: true, materialized: true, ...(flushFailed !== null ? { flushFailed } : {}) })
            }
            // ---- P3a（2026-09-07）：TH 聊天写路径桥 —— /rp/chat/append + /rp/chat/update ----
            // ST 酒馆助手 createChatMessages / setChatMessages 的后端面（此前记名拒绝，飞讯等
            // 卡脚本的统合记录写不进 → 手机悬浮球「发消息没反应」的根因之一）。
            // - append：insert_before:'end' 语义。idle 时完整 turn 物化（oneTurnLog 契约 +
            //   phase.lastTurn 同步，复刻 open-chat 防 R49 重复 turn/start）；busy 时消息并入
            //   当前 open turn（step 续接，kernel 工具步同构——不越界开新 turn）。
            //   system 角色 → model:'th-system'（facade 导出 role:'system'/is_system；
            //   前端 ST 同款系统楼层）；data 附加字段 → rp/th-floors sidecar（getChatMessages 回读）。
            // - update：message_id → seq 映射与 facade chatMessages 导出同构（user/assistant/
            //   thSystem；snapshot 注入与非 thSystem 空文本跳过），单节点 compaction/prune +            //   replace 官方原语（模型视图与前端投影立即生效，事件留日志零丢失）。
            if (sub === '/rp/chat/append') {
              const sessionId = String(payload.sessionId ?? '')
              if (!sessionId) return send(400, { error: 'sessionId required' })
              const insertBefore = payload.insertBefore ?? payload.insert_before
              if (insertBefore !== undefined && insertBefore !== 'end') {
                return send(400, { error: 'insert_before 仅支持 end（DSH 会话日志 append-only，历史插入会漂移）' })
              }
              const msgs = (Array.isArray(payload.messages) ? payload.messages : []).filter(
                (m): m is Record<string, unknown> => m !== null && typeof m === 'object' && !Array.isArray(m))
              if (msgs.length === 0) return send(400, { error: 'messages required' })
              const live = ctx.sessions?.get(sessionId)
              if (!live) return send(404, { error: 'session not live（先经 session.create 创建）' })
              const agent = ctx.agents?.get(sessionId) as { phase?: { kind?: string; lastTurn?: number } } | undefined
              const idle = agent?.phase?.kind === 'idle'
              const snap = sessionEventsSnapshot(live) as Array<{ type?: string; data?: { turn?: unknown } }>
              // 最后一个 turn 编号（open-chat 同款续接规则）
              let lastTurn = 0
              for (let i = snap.length - 1; i >= 0; i--) {
                if (snap[i]?.type === 'turn/start') { lastTurn = Number(snap[i]?.data?.turn ?? 0) || 0; break }
              }
              // busy 时当前 open turn 的 step 续接数（自最后一个 turn/start 起的 step/start 计数）
              let openSteps = 0
              if (!idle) {
                for (let i = snap.length - 1; i >= 0; i--) {
                  if (snap[i]?.type === 'turn/start') break
                  if (snap[i]?.type === 'step/start') openSteps++
                }
              }
              const appendMessage = (turn: number, step: number, role: string, text: string, data: Record<string, unknown> | null) => {
                // 【内核校验对齐】assistant/message 强制 model source（kind:'model'+provider+model，
                // 实证：plugin source 落盘后整会话 refused to load「message must have model source」）；
                // user 角色走 user/message（plugin source 合法）。
                //
                // 【阶段3 2026-09-10 契约收紧修正】旧写法把 thSystem/thData 当 model source 的
                // 扩展键随行，注释自陈「校验只查 kind/provider/model」——该假设 0.1.2 成立，
                // 0.1.5 的 assertReleasedV0Keys 是**白名单**（多一键即拒）→ 整会话打不开。
                // 现在：thSystem 用 `model:'th-system'` 表达（合法枚举值），
                //        thData 落 $DSH_HOME/rp/th-floors/<sessionId>.json（见 th-floors.ts）。
                const mid = `dsht-th-${randomUUID()}`
                if (data !== null || role === 'system') {
                  upsertThFloors(dshHome, sessionId, {
                    [mid]: { ...(data !== null ? { data } : {}), ...(role === 'system' ? { system: true as const } : {}) },
                  })
                }
                if (role === 'user') {
                  live.append('user/message', {
                    id: mid,
                    role: 'user',
                    content: [{ type: 'text', text }],
                    source: { kind: 'plugin', plugin: 'dsht-tavern-helper' },
                  }, { surfaceOp: 'append' })
                  return
                }
                live.append('assistant/message', {
                  // settlement 三件套（live 会话必为 v2+，stream 是必需成员）
                  ...assistantSettlement(turn, step),
                  message: {
                    id: mid,
                    role: 'assistant',
                    content: [{ type: 'text', text }],
                    source: {
                      kind: 'model', provider: 'dsht-tavern-helper',
                      model: role === 'system' ? 'th-system' : 'th-append',
                    },
                  },
                }, { surfaceOp: 'append' })
              }
              if (idle) {
                const turn = lastTurn + 1
                live.append('turn/start', { turn })
                for (let i = 0; i < msgs.length; i++) {
                  const m = msgs[i]
                  const text = String(m.message ?? '')
                  const data = m.data !== null && typeof m.data === 'object' ? m.data as Record<string, unknown> : null
                  live.append('step/start', { turn, step: i + 1 })
                  appendMessage(turn, i + 1, String(m.role ?? 'system'), text, data)
                  live.append('step/end', { turn, step: i + 1 })
                }
                live.append('turn/end', { turn, reason: { kind: 'completed' } })
                // R49 同步：agent 的 phase.lastTurn 缓存不刷新会让内核重开同一 turn
                if (agent?.phase && typeof agent.phase.lastTurn === 'number' && agent.phase.lastTurn < turn) {
                  agent.phase.lastTurn = turn
                }
                console.log(`[dsht-rp] chat/append: ${sessionId} turn=${turn} n=${msgs.length}（idle 全 turn 物化）`)
              } else {
                const turn = Math.max(lastTurn, 1)
                for (let i = 0; i < msgs.length; i++) {
                  const m = msgs[i]
                  const text = String(m.message ?? '')
                  const data = m.data !== null && typeof m.data === 'object' ? m.data as Record<string, unknown> : null
                  const step = openSteps + i + 1
                  live.append('step/start', { turn, step })
                  appendMessage(turn, step, String(m.role ?? 'system'), text, data)
                  live.append('step/end', { turn, step })
                }
                console.log(`[dsht-rp] chat/append: ${sessionId} turn=${turn} n=${msgs.length}（busy 并入 open turn）`)
              }
              try { await flushLiveSession(ctx.sessions, live) } catch (e) {
                return send(500, { error: `消息已追加但落盘失败：${(e as Error).message}` })
              }
              return send(200, { ok: true, appended: msgs.length })
            }
            if (sub === '/rp/chat/update') {
              const sessionId = String(payload.sessionId ?? '')
              if (!sessionId) return send(400, { error: 'sessionId required' })
              const targets = (Array.isArray(payload.targets) ? payload.targets : []).filter(
                (t): t is Record<string, unknown> => t !== null && typeof t === 'object' && !Array.isArray(t))
              if (targets.length === 0) return send(400, { error: 'targets required' })
              const live = ctx.sessions?.get(sessionId)
              if (!live) return send(404, { error: 'session not live' })
              // 【心跳 47】官方 Session.surface.nodes 是 readonly；W4 起统一走单源
              // OrNull 变体（非数组 ⇒ null ⇒ 409，与原守卫同语义）。
              const view = readSurfaceNodesOrNull(live)
              if (view === null) return send(409, { error: 'session surface unavailable' })
              // 【阶段3 2026-09-10】TH 楼层元数据 sidecar（thData/thSystem 已迁出 source）
              const thFloors = readThFloors(dshHome, sessionId)
              // message_id → {seq, event} 映射：与 facade chatMessages 导出同构
              //（user/assistant/thSystem 计入；snapshot 注入与非 thSystem 空文本跳过；
              // compaction/prune 遮蔽集同步剔除——replace 后旧事件不占编号，与 facade 双遍扫描同语义）
              const snap = sessionEventsSnapshot(live) as Array<{ type?: string; seq?: number; data?: unknown }>
              const shadowedSeqs = new Set<number>()
              for (const ev0 of snap) {
                if (ev0?.type !== 'compaction/prune') continue
                const d0 = ev0.data as { shadowedSeqs?: unknown } | undefined
                if (Array.isArray(d0?.shadowedSeqs)) for (const q of d0.shadowedSeqs) if (typeof q === 'number') shadowedSeqs.add(q)
              }
              const exportSeqs: number[] = []
              for (const ev of snap) {
                if (ev.type !== 'user/message' && ev.type !== 'assistant/message') continue
                if (typeof ev.seq === 'number' && shadowedSeqs.has(ev.seq)) continue
                const d = ev.data as Record<string, unknown> | undefined
                const msg = (ev.type === 'assistant/message' ? d?.message : d) as Record<string, unknown> | undefined
                if (!msg || typeof msg !== 'object') continue
                const source = msg.source as Record<string, unknown> | undefined
                if (source && typeof source === 'object' && source['form'] === 'snapshot') continue
                const content = msg.content
                const text = Array.isArray(content)
                  ? content.filter((b) => b !== null && typeof b === 'object' && (b as { type?: string }).type === 'text')
                    .map((b) => String((b as { text?: unknown }).text ?? '')).join('\n')
                  : typeof content === 'string' ? content : ''
                const isTh = !!(source && typeof source === 'object'
                  && (source['thSystem'] === true || source['model'] === 'th-system'))
                if (!text && !isTh) continue
                if (typeof ev.seq === 'number') exportSeqs.push(ev.seq)
              }
              let updated = 0
              const errors: string[] = []
              // 助手楼层改写先收集（必须延后到 replace 批之后统一 append——
              // assistant/message 只能落在打开的 step 内，且不能作为 replace 节点）
              const pendingAssistantEdits: Array<{ text: string; thSystem: boolean; thData: unknown }> = []
              for (const t of targets) {
                const mid = Number(t.message_id ?? -1)
                const seq = exportSeqs[mid]
                if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) {
                  errors.push(`message_id=${mid} 不存在`)
                  continue
                }
                if (!view.includes(seq)) {
                  errors.push(`message_id=${mid}（seq=${seq}）不在当前视图（可能已被回退/折叠）`)
                  continue
                }
                const oldEv = sessionEventAt(live, seq)
                const oldData = (oldEv?.data ?? {}) as { turn?: number; step?: number; message?: { content?: unknown; source?: Record<string, unknown> } }
                const isUser = oldEv?.type === 'user/message'
                // user/message 的 data 就是 Message 本体；assistant/message 是 {turn, step, message} 包装
                const oldMsg = ((isUser ? oldData : oldData.message) ?? {}) as { content?: unknown; source?: Record<string, unknown> }
                const oldText = Array.isArray(oldMsg.content)
                  ? (oldMsg.content as Array<{ type?: string; text?: string }>).filter(b => b?.type === 'text').map(b => String(b.text ?? '')).join('\n')
                  : ''
                const text = t.message !== undefined ? String(t.message ?? '') : oldText
                const oldSource = (oldMsg.source && typeof oldMsg.source === 'object' ? oldMsg.source : {}) as Record<string, unknown>
                // 【阶段3 2026-09-10】thData 已迁出 source（0.1.5 白名单拒扩展键）：
                // 先读 sidecar，再退回旧 source 键（老会话尚未修复时仍能读到）。
                const oldSidecar = lookupThFloor(thFloors, (oldMsg as { id?: unknown }).id, seq)
                const oldThData = oldSource['thData'] !== undefined ? oldSource['thData']
                  : (oldSidecar?.data !== undefined ? oldSidecar.data : null)
                const data = t.data !== undefined ? t.data : oldThData
                // 计量（core 估价器同款——replace 必须带紧邻 claim）。
                // 【2026-09-08 鲁棒性】shadowedTokenCount 按**被影子化的旧事件**内容计
                // （meter 记账对象 = 移出视图的旧事件，与 session-rollback 路由同口径）——
                // 旧实现用替换后的新文本长度：新文本更短 → meter 少记移出量、更长 → 多记。
                const oldBlocks = Array.isArray(oldMsg.content)
                  ? oldMsg.content as Array<Record<string, unknown>>
                  : []
                let shadowedTokens = oldBlocks.reduce((t2, b) =>
                  t2 + (b && (b['type'] === 'text' || b['type'] === 'reasoning') && typeof b['text'] === 'string'
                    ? Math.ceil((b['text'] as string).length / 4) + 4
                    : 4 + Math.ceil(JSON.stringify(b).length / 4)), 0) + 4
                live.append('compaction/prune', { shadowedRange: { start: seq, end: seq }, shadowedSeqs: [seq], shadowedTokenCount: shadowedTokens })
                if (isUser) {
                  // user 楼层替换：user/message 自己做 replace 合法（0.1.5 允许）。
                  // 【阶段3 2026-09-10】surfaceOp 字段名走 appendReplace 自适应
                  // （0.1.5 起是 startSeq/endSeq，旧 start/end 直接抛 invalid replace surfaceOp）。
                  // thData 走 sidecar（plugin source 也不许挂自定义键）。
                  const newId = `dsht-th-${randomUUID()}`
                  if (data !== null && typeof data === 'object') upsertThFloors(dshHome, sessionId, { [newId]: { data } })
                  appendReplace(live, 'user/message', {
                    id: newId,
                    role: 'user',
                    content: [{ type: 'text', text }],
                    source: { kind: 'plugin', plugin: 'dsht-tavern-helper' },
                  }, { start: seq, end: seq }, [seq])
                } else {
                  // assistant 楼层改写：0.1.5 **禁止 assistant/message 做 replace 节点**
                  // （带 sourceEventSeqs 抛「embeds its source stream」，不带抛「missing shadowed node」
                  // ——官方设计死锁）。改用官方 compaction 同款形态：user 标记把旧楼层移出上下文，
                  // 改写后的新文本作为新 assistant 消息**追加**（落进打开的 step）。
                  const markerSourceObj = markerSource('dsht-tavern-helper', 'surgical',
                    { editedFrom: seq, shadowedSeqs: [seq] })
                  appendReplace(live, 'user/message', {
                    id: `dsht-th-mark-${randomUUID()}`,
                    role: 'user',
                    content: [{ type: 'text', text: '[消息已编辑] 该楼层的原文已从上下文移除，编辑后的内容随后追加。' }],
                    source: markerSourceObj,
                  }, { start: seq, end: seq }, [seq])
                  // 重写的助手楼层延后统一追加（同一 turn 内、顺序稳定，避免 turn 膨胀）
                  pendingAssistantEdits.push({
                    text,
                    thSystem: oldSource['thSystem'] === true || oldSource['model'] === 'th-system'
                      || oldSidecar?.system === true,
                    thData: data,
                  })
                }
                updated++
              }
              // 助手楼层改写：统一在 replace 批之后追加（assistant/message 只能 append 到打开的 step）
              if (pendingAssistantEdits.length > 0) {
                const agent = ctx.agents?.get(sessionId) as { phase?: { kind?: string; lastTurn?: number } } | undefined
                const idle = agent?.phase?.kind === 'idle'
                const plan = planAssistantRewrite(sessionEventsSnapshot(live) as Array<{ type?: unknown; data?: { turn?: unknown } }>, idle)
                if (plan.openTurn) live.append('turn/start', { turn: plan.turn })
                for (let i = 0; i < pendingAssistantEdits.length; i++) {
                  const pe = pendingAssistantEdits[i]
                  const step = plan.step + i
                  live.append('step/start', { turn: plan.turn, step })
                  // 【阶段3 2026-09-10】thSystem → model:'th-system'；thData → sidecar
                  const newId = `dsht-th-${randomUUID()}`
                  if ((pe.thData !== null && typeof pe.thData === 'object') || pe.thSystem) {
                    upsertThFloors(dshHome, sessionId, {
                      [newId]: {
                        ...(pe.thData !== null && typeof pe.thData === 'object' ? { data: pe.thData } : {}),
                        ...(pe.thSystem ? { system: true as const } : {}),
                      },
                    })
                  }
                  live.append('assistant/message', {
                    // settlement 三件套（live 会话必为 v2+，stream 是必需成员）
                    ...assistantSettlement(plan.turn, step),
                    message: {
                      id: newId,
                      role: 'assistant',
                      content: [{ type: 'text', text: pe.text }],
                      source: {
                        kind: 'model', provider: 'dsht-tavern-helper',
                        model: pe.thSystem ? 'th-system' : 'th-edit',
                      },
                    },
                  }, { surfaceOp: 'append' })
                  live.append('step/end', { turn: plan.turn, step })
                }
                if (plan.openTurn) live.append('turn/end', { turn: plan.turn, reason: { kind: 'completed' } })
                // R49 同步：内核 phase.lastTurn 不刷新会让内核重开同一 turn
                if (plan.openTurn && agent?.phase && typeof agent.phase.lastTurn === 'number' && agent.phase.lastTurn < plan.turn) {
                  agent.phase.lastTurn = plan.turn
                }
              }
              if (updated > 0) {
                try { await flushLiveSession(ctx.sessions, live) } catch (e) {
                  return send(500, { error: `改写已应用但落盘失败：${(e as Error).message}` })
                }
              }
              console.log(`[dsht-rp] chat/update: ${sessionId} updated=${updated} errors=${errors.length}`)
              if (errors.length > 0 && updated === 0) return send(400, { error: errors.join('; ') })
              return send(200, { ok: true, updated, ...(errors.length > 0 ? { errors } : {}) })
            }
            // ---- T2.7：RP 预设体系（组装层关注点；session 内随时切换）----
            // /preset/import-st {json, name} → ST completion 预设导入（示例预设等）：
            // prompts/prompt_order → 表层 preset.json；extensions.regex_scripts → 预设作用域 regex.json
            if (sub === '/preset/import-st') {
              const json = String(payload.json ?? '')
              const name = typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim().replace(/\.json$/i, '') : `ST 预设 ${new Date().toISOString().slice(0, 10)}`
              if (!json.trim()) return send(400, { error: 'json required' })
              let imported
              try {
                imported = importStPreset(json, name)
              } catch (e) {
                return send(400, { error: `无法解析（不是有效的 ST 预设 JSON）：${(e as Error).message}` })
              }
              const { preset, regex, skipped, skills } = imported
              // P2#14 受管预设（digest + owner manifest 幂等安装，参考 dsh-agent-rp
              // preset.ts L107，MIT）：同 id 重装时比对 manifest digest——用户没动过
              // 幂等更新（原子换目录），动过/存量无 manifest/用户已保存接管 → 保留
              // 用户版本并在响应与日志如实报告冲突；force=true 显式接管覆盖。
              const presetDir = join(dshHome, 'rp-presets', preset.id)
              const files: PresetContentFile[] = [
                { name: 'preset.json', content: JSON.stringify(preset, null, 1) },
              ]
              if (regex.length > 0) {
                files.push({ name: 'regex.json', content: JSON.stringify({ scripts: regex }, null, 1) })
              }
              const install = await installManagedPreset(presetDir, files, 'dsht-rp:import-st', { force: payload.force === true })
              if (install.outcome === 'conflict') {
                const reasonText = install.reason === 'user-owned'
                  ? '用户已在管理面板保存接管该预设'
                  : install.reason === 'modified'
                    ? '受管内容被本地改动过'
                    : '存量预设无 owner manifest（未知来源，用户可能改过）'
                console.log(`[dsht-rp] preset/import-st: 冲突保留用户版本 rp-presets/${preset.id}（${reasonText}；确认要覆盖请重发带 force:true）`)
                return send(200, {
                  ok: true, install: 'conflict', reason: install.reason,
                  presetId: preset.id, displayName: preset.displayName,
                  note: `已保留现有版本（${reasonText}）。确认要用导入内容覆盖请重发本请求并带 force:true；或先改名导入。`,
                })
              }
              if (install.outcome !== 'unchanged') {
                // 任务 3：agent 编排型预设的模块化内容块 → skills/preset-<id>/<块名>/SKILL.md
                for (const block of skills) {
                  await mkdir(join(dshHome, block.dir), { recursive: true })
                  await writeFile(join(dshHome, block.dir, 'SKILL.md'), renderPresetSkillMd(preset.displayName, block), 'utf8')
                }
                // T3.3 三档归位产物②：内心 OS/思维链 pendingSkills → $DSH_HOME/skills/<slug>/SKILL.md
                // 占位落盘（正文即原 ST 条目内容；skillRef 槽只留引用提示，skill 本体由
                // DSH skill 机制按需读取）
                for (const ps of preset.pendingSkills ?? []) {
                  const dir = pendingSkillDir(ps.name)
                  await mkdir(join(dshHome, dir), { recursive: true })
                  await writeFile(join(dshHome, dir, 'SKILL.md'), renderPendingSkillMd(preset.displayName, ps), 'utf8')
                }
                presetCache.delete(preset.id)
                presetRegexCache.delete(preset.id)
                activeStPresetCache = undefined // 新预设可能正是 ST 激活预设 → 默认绑定重解析
                await syncRpPresetToAgent(preset) // R5：导入即同步 agent preset（st- 前缀；agent 型用 agent 形态 yml）
              }
              console.log(`[dsht-rp] preset/import-st: ${preset.displayName} → ${preset.slots.length} slots, ${regex.length} regex scripts, ${skills.length} skills, pendingSkills ${(preset.pendingSkills ?? []).length}（configExtra ${preset.configSummaryExtra !== undefined ? 1 : 0} / subagentHints ${(preset.subagentHints ?? []).length}）${skipped > 0 ? ` (${skipped} skipped)` : ''} [install:${install.outcome}]`)
              return send(200, {
                ok: true, install: install.outcome, presetId: preset.id, displayName: preset.displayName,
                slots: preset.slots.length, regex: regex.length, skipped,
                path: preset.path, skills: skills.length, skillDirs: skills.map(b => b.dir),
                pendingSkills: (preset.pendingSkills ?? []).length, subagentHints: (preset.subagentHints ?? []).length,
              })
            }
            // /preset/list {} → 全部预设（内置示范 + 用户 rp-presets/*/preset.json）
            // 顺带 R5 回填（幂等、存在即跳过）：rp-presets 若是旁路直写（迁移 agent
            // write-files）而非 import-st 路由产物，.agent-presets/st-* 不会生成——
            // 这里兜底补齐（agent preset 发现是逐次扫盘，写完 agentPreset.list 即可见）。
            if (sub === '/preset/list') {
              await ensureRpPresetSync()
              const presets = await listPresets(new AbortController().signal)
              return send(200, { presets })
            }
            // /preset/save {preset} → 用户预设保存（条目开关写回表层 JSON；内置预设不可改）
            if (sub === '/preset/save') {
              const preset = payload.preset as RPPreset | undefined
              if (!preset || preset.schemaVersion !== 1 || !preset.id) return send(400, { error: 'preset required' })
              if (builtinPresets.some(b => b.id === preset.id)) {
                return send(400, { error: '内置预设不可覆盖（先在管理面板复制为自定义）' })
              }
              await mkdir(join(dshHome, 'rp-presets', preset.id), { recursive: true })
              await writeFile(join(dshHome, 'rp-presets', preset.id, 'preset.json'), JSON.stringify(preset, null, 1), 'utf8')
              // P2#14：用户保存 = 用户接管该预设（owner manifest 标记 user），
              // 之后 import-st 同 id 重装会得到 conflict(user-owned) 而非静默冲掉改动
              await markPresetUserOwned(join(dshHome, 'rp-presets', preset.id))
              presetCache.delete(preset.id)
              await syncRpPresetToAgent(preset) // R5：保存即编译同步 agent preset（st- 前缀）
              console.log(`[dsht-rp] preset/save: ${preset.id}`)
              return send(200, { ok: true })
            }
            // /preset/delete {presetId} → 删除用户预设（rp-presets/<id>/ 整目录；
            // R5：st- 前缀的同步 agent preset 一并删除；内置示范不可删）
            if (sub === '/preset/delete') {
              const presetId = String(payload.presetId ?? '')
              if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(presetId)) return send(400, { error: 'presetId 非法' })
              if (builtinPresets.some(b => b.id === presetId)) return send(400, { error: '内置预设不可删除' })
              await rm(join(dshHome, 'rp-presets', presetId), { recursive: true, force: true })
              await removeRpPresetAgent(presetId)
              presetCache.delete(presetId)
              presetRegexCache.delete(presetId)
              activeStPresetCache = undefined
              console.log(`[dsht-rp] preset/delete: ${presetId}`)
              return send(200, { ok: true })
            }
            // /preset/select {sessionId, presetId|null} → 会话内切换（写会话状态，下一轮生效）
            if (sub === '/preset/select') {
              const sessionId = String(payload.sessionId ?? '')
              const presetId = typeof payload.presetId === 'string' && payload.presetId ? payload.presetId : null
              if (!sessionId) return send(400, { error: 'sessionId required' })
              if (presetId !== null) {
                const preset = await resolvePreset(presetId, new AbortController().signal)
                if (!preset) return send(404, { error: `preset not found: ${presetId}` })
              }
              const st = await loadSessionState(sessionId)
              if (presetId === null) delete st.presetId
              else st.presetId = presetId
              await saveSessionState(sessionId, st)
              console.log(`[dsht-rp] preset/select: session=${sessionId} → ${presetId ?? '(none)'}`)
              return send(200, { ok: true, presetId })
            }
            // /preset/state {sessionId} → 会话有效预设（显式选择 ?? ST 激活预设默认；
            // explicit 字段区分是否用户选过——前端显示用有效值，切换语义不变）
            if (sub === '/preset/state') {
              const sessionId = String(payload.sessionId ?? '')
              if (!sessionId) return send(400, { error: 'sessionId required' })
              const st = await loadSessionState(sessionId)
              const explicit = typeof st.presetId === 'string' && st.presetId ? st.presetId : null
              return send(200, { presetId: explicit ?? await resolveActiveStPresetId(), explicit })
            }
            // ---- L1b：自定义宏注册（ST MacroRegistry.registerMacro 对应物；hook 移植）----
            // /macros/list {} → 字符串模板类自定义宏全表（客户端显示期水合用）
            if (sub === '/macros/list') {
              return send(200, { macros: listCustomMacros() })
            }
            // /macros/register {name, value} → 注册（字符串模板）+ 持久化 rp/macros.json
            // /macros/unregister {name} → 注销 + 持久化
            if (sub === '/macros/register' || sub === '/macros/unregister') {
              const macroName = String(payload.name ?? '').trim().toLowerCase()
              if (!macroName) return send(400, { error: 'name required' })
              // 读改写串行化：探针/脚本爆发式并发注册时防丢更新（配合 atomicWriteFile tmp 去重）
              const result = await (macroWriteChain = macroWriteChain.then(async (): Promise<{ status: number; body: Record<string, unknown> }> => {
                const macrosFile = join(dshHome, 'rp', 'macros.json')
                let disk: Record<string, string> = {}
                try { disk = JSON.parse(await readFile(macrosFile, 'utf8')) as Record<string, string> } catch { /* 无文件 */ }
                try {
                  if (sub === '/macros/register') {
                    const value = String(payload.value ?? '')
                    registerMacro(macroName, value)
                    disk[macroName] = value
                  } else {
                    unregisterMacro(macroName)
                    delete disk[macroName]
                  }
                } catch (e) { return { status: 400, body: { error: (e as Error).message } } }
                await mkdir(join(dshHome, 'rp'), { recursive: true })
                await atomicWriteFile(macrosFile, JSON.stringify(disk, null, 2))
                console.log(`[dsht-rp] macro ${sub === '/macros/register' ? 'registered' : 'unregistered'}: {{${macroName}}}（共 ${Object.keys(disk).length} 个自定义宏）`)
                return { status: 200, body: { ok: true, macros: listCustomMacros() } }
              }).catch((e: unknown): { status: number; body: Record<string, unknown> } => ({ status: 500, body: { error: String(e) } })))
              return send(result.status, result.body)
            }
            // /state {sessionId} → T2.3 MVU 状态树（只读诊断/前端消费；写走自动提取与
            // state_update 工具）。state 键优先，历史扁平文件/variables 键兜底。
            if (sub === '/state') {
              const sessionId = String(payload.sessionId ?? '')
              if (!sessionId) return send(400, { error: 'sessionId required' })
              const st = await loadSessionState(sessionId)
              return send(200, { state: st.state ?? st.variables ?? {} })
            }
            // ---- T2.8：正则管理（三层作用域；ST 正则设置界面的数据面）----
            // /regex/list {slug?, sessionId?} → 全部作用域脚本（global + 指定角色 scoped
            // + 会话有效预设 preset——ST 语义：激活预设的 display/prompt 正则恒生效）
            if (sub === '/regex/list') {
              const global = loadGlobalRegex(new AbortController().signal)
              let scoped: RegexScript[] = []
              const slug = typeof payload.slug === 'string' ? payload.slug : ''
              if (slug) {
                const rp = await loadRpJson(slug, new AbortController().signal)
                scoped = rp?.regex ?? []
              }
              let preset: RegexScript[] = []
              let presetId: string | null = null
              const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : ''
              if (sessionId) {
                presetId = await resolveSessionPresetId(sessionId)
                if (presetId) preset = await loadPresetRegex(presetId, new AbortController().signal)
              }
              return send(200, { global, scoped, preset, presetId, slug: slug || null })
            }
            // /regex/save-global {scripts} → 全局作用域整组保存（管理面板写回）
            if (sub === '/regex/save-global') {
              const scripts = Array.isArray(payload.scripts) ? payload.scripts : []
              await mkdir(join(dshHome, 'rp', 'regex'), { recursive: true })
              // 任务 1：写前文件快照（全局作用域 → 归属最近活跃的 RP 会话；无会话上下文跳过）
              await snapshotRpFiles(String(payload.sessionId ?? '') || await latestRpSessionId(), ['rp/regex/global.json'])
              await writeFile(join(dshHome, 'rp', 'regex', 'global.json'), JSON.stringify({ scripts }, null, 1), 'utf8')
              globalRegexCache = null // 缓存失效，下轮重读
              console.log(`[dsht-rp] regex/save-global: ${scripts.length} scripts`)
              return send(200, { ok: true, count: scripts.length })
            }
            // /regex/save-scoped {slug, scripts} → 角色作用域整组保存（写回 rp.json.regex）
            if (sub === '/regex/save-scoped') {
              const slug = String(payload.slug ?? '')
              const scripts = Array.isArray(payload.scripts) ? payload.scripts : []
              if (!slug) return send(400, { error: 'slug required' })
              const rpPath = join(dshHome, 'rp', slug, 'rp.json')
              let rp: RpWorkspace
              try {
                rp = JSON.parse(await readFile(rpPath, 'utf8')) as RpWorkspace
              } catch {
                return send(404, { error: `rp.json not found: ${slug}` })
              }
              rp.regex = scripts as RegexScript[]
              // 任务 1：写前文件快照（归属会话 = payload.sessionId ?? 该 slug 名下会话）
              await snapshotRpFiles(String(payload.sessionId ?? '') || await sessionIdForSlug(slug), [`rp/${slug}/rp.json`])
              await writeFile(rpPath, JSON.stringify(rp, null, 1), 'utf8')
              console.log(`[dsht-rp] regex/save-scoped: ${slug} → ${scripts.length} scripts`)
              return send(200, { ok: true, count: scripts.length })
            }
            // ---- 批次修复 6：预设作用域正则（rp-presets/<id>/regex.json）----
            // /regex/list-preset {presetId} → 该预设的脚本；/regex/save-preset {presetId, scripts} → 整组保存
            if (sub === '/regex/list-preset') {
              const presetId = String(payload.presetId ?? '')
              if (!presetId) return send(400, { error: 'presetId required' })
              try {
                const text = await readFile(join(dshHome, 'rp-presets', presetId, 'regex.json'), 'utf8')
                const o = JSON.parse(text) as { scripts?: unknown }
                return send(200, { presetId, scripts: Array.isArray(o.scripts) ? o.scripts : [] })
              } catch {
                return send(200, { presetId, scripts: [] })
              }
            }
            if (sub === '/regex/save-preset') {
              const presetId = String(payload.presetId ?? '')
              const scripts = Array.isArray(payload.scripts) ? payload.scripts : []
              if (!presetId) return send(400, { error: 'presetId required' })
              const dir = join(dshHome, 'rp-presets', presetId)
              try { await readdir(dir) } catch { return send(404, { error: `预设不存在：${presetId}` }) }
              // 任务 1：写前文件快照（预设作用域 → 归属最近活跃的 RP 会话；无会话上下文跳过）
              await snapshotRpFiles(String(payload.sessionId ?? '') || await latestRpSessionId(), [`rp-presets/${presetId}/regex.json`])
              await writeFile(join(dir, 'regex.json'), JSON.stringify({ scripts }, null, 1), 'utf8')
              console.log(`[dsht-rp] regex/save-preset: ${presetId} → ${scripts.length} scripts`)
              return send(200, { ok: true, count: scripts.length })
            }
            // /regex/test {script, text, placement?} → 测试器（按脚本自身声明的时机归一——
            // markdownOnly→display / promptOnly→prompt / 其余→permanent；所见即所得）
            if (sub === '/regex/test') {
              const script = payload.script as unknown as RegexScript | undefined
              const text = String(payload.text ?? '')
              if (!script || typeof script.findRegex !== 'string') return send(400, { error: 'script required' })
              const placement = typeof payload.placement === 'number' ? script.placement.includes(payload.placement) ? payload.placement : script.placement[0] : script.placement[0] ?? 2
              const timing = script.markdownOnly ? 'display' : script.promptOnly ? 'prompt' : 'permanent'
              const r = runRegexScripts([script as RegexScript], text, timing, placement, { depth: null })
              return send(200, { ok: true, result: r.text, hits: r.hits.length })
            }
            // ---- T3.2：会话长期记忆路由（存储 $DSH_HOME/rp/memory/<sessionId>.json；
            // 核心逻辑在 ./memory.ts 纯函数层，这里只做参数校验/快照/落盘接线）----
            // /memory/save {sessionId, text, source?} → 追加条目（写前快照 + 去抖 + 200 条淘汰）
            if (sub === '/memory/save') {
              const sid = String(payload.sessionId ?? '')
              if (!isValidMemorySessionId(sid)) return send(400, { error: 'sessionId required（不得含路径分隔符/空白边界）' })
              const text = typeof payload.text === 'string' ? payload.text : ''
              if (!text.trim()) return send(400, { error: 'text required' })
              const source = normalizeMemorySource(payload.source)
              const mem = await loadMemory(dshHome, sid)
              const r = appendMemory(mem, text, source)
              if (!r.ok) return send(400, { error: r.error === 'too-long' ? `text 超过 ${MEMORY_TEXT_MAX} 字上限` : 'text required' })
              // 写前文件快照（归属该会话；无 turn 锚点自动跳过，快照失败不阻塞写）
              await snapshotRpFiles(sid, [memoryRelPath(sid)])
              await saveMemory(dshHome, sid, r.file)
              logLine(`memory/save: ${sid} +1（${r.entry?.id}${r.duplicate ? ' 去抖命中' : ''}，共 ${r.file.entries.length} 条）`)
              console.log(`[dsht-rp] memory/save: ${sid} ${r.entry?.id}${r.duplicate ? '（去抖命中）' : ''}，共 ${r.file.entries.length} 条`)
              return send(200, { ok: true, id: r.entry?.id, duplicate: r.duplicate === true, count: r.file.entries.length })
            }
            // /memory/query {sessionId, query, limit?} → 关键词检索（按空白切词，命中任一词即算，命中数排序）
            if (sub === '/memory/query') {
              const sid = String(payload.sessionId ?? '')
              if (!isValidMemorySessionId(sid)) return send(400, { error: 'sessionId required' })
              const rawLimit = payload.limit
              const limit = typeof rawLimit === 'number' && Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 10
              const { entries } = await loadMemory(dshHome, sid)
              const hits = queryMemory(entries, String(payload.query ?? ''), limit)
              console.log(`[dsht-rp] memory/query: "${String(payload.query ?? '')}" → ${hits.length}/${entries.length} hits (${sid})`)
              return send(200, { query: String(payload.query ?? ''), total: entries.length, count: hits.length, entries: hits })
            }
            // /memory/list {sessionId} → 全量条目
            if (sub === '/memory/list') {
              const sid = String(payload.sessionId ?? '')
              if (!isValidMemorySessionId(sid)) return send(400, { error: 'sessionId required' })
              const { entries } = await loadMemory(dshHome, sid)
              return send(200, { count: entries.length, entries })
            }
            // /memory/delete {sessionId, id} → 删除单条（写前快照，回退可恢复）
            if (sub === '/memory/delete') {
              const sid = String(payload.sessionId ?? '')
              if (!isValidMemorySessionId(sid)) return send(400, { error: 'sessionId required' })
              const id = String(payload.id ?? '')
              if (!id) return send(400, { error: 'id required' })
              const mem = await loadMemory(dshHome, sid)
              const r = deleteMemoryEntry(mem, id)
              if (!r.deleted) return send(404, { error: `entry not found: ${id}` })
              await snapshotRpFiles(sid, [memoryRelPath(sid)])
              await saveMemory(dshHome, sid, r.file)
              console.log(`[dsht-rp] memory/delete: ${sid} -${id}（剩 ${r.file.entries.length} 条）`)
              return send(200, { ok: true, count: r.file.entries.length })
            }
            return send(404, { error: 'unknown endpoint' })
          } catch (e) {
            return send(500, { error: (e as Error).message })
          }
        })()
      },
    })
    console.log('[dsht-rp] data plane on webServer route /dsht-rp/*')
    /**
     * ---- GET /version：ST 的**标准版本端点**（真实缺陷修复，心跳 57）----
     *
     * 路径不在 `/dsht-rp` 命名空间里 —— 因为这是 ST 的约定路径，第三方代码按字面请求它：
     * 卡的宿主注入脚本 `inject.js:2210-2218` 就是
     * `fetch('/version').then(r => r.json()).then(d => window.versionNumber =
     *   +v[0]*10000 + +v[1]*100 + +v[2]).catch(() => window.versionNumber = 10000)`。
     *
     * 实机取证（心跳 57）：`GET /version → 404`（空体、非 JSON）→ 落 `catch` → `versionNumber = 10000`
     * → 该卡脚本内 **20+ 处** `versionNumber >= 11305` 分叉**全部走旧版分支**，其中正则绑定那处
     * 原文注释即「11305+ has built-in regex binding; ST is source of truth, only sync FROM ST」。
     * 于是它去找 ST 旧版正则面板的 DOM（`#saved_regex_scripts` 等 17 个 id），DSH 宿主页一个都没有
     * → 首个异常中断整个 bootstrap（`ChatSquash()` / `MacroNest()` / 工具注册全不执行）。
     *
     * 基准对照：TauriTavern `src/compat-version.js:1` `SILLYTAVERN_COMPAT_VERSION = '1.18.0'`
     * 由其 `/version` 返回（`src/tauri-bridge.js:162-171`）→ 卡得 11800 → 走**新版**路径。
     * 属 L36「跟基准一致**既不能少也不能多**」的「少了」一侧。
     *
     * 信任栅栏沿用 `/dsht-rp/*` 同一 `isTrusted`（loopback Host）；本端点**只读常量、无副作用**。
     */
    const disposeVersion = ctx.webServer.register({
      kind: 'exact',
      path: '/version',
      handler: (rawReq: unknown, rawRes: unknown) => {
        const req = rawReq as { method?: string; headers: Record<string, unknown> }
        const res = rawRes as { writeHead: (code: number, headers?: Record<string, string | number>) => void; end: (b?: string) => void }
        if (req.method !== 'GET' && req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ error: 'GET only' }))
        }
        if (!isTrusted(req)) {
          res.writeHead(403, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ error: 'forbidden' }))
        }
        // no-store：页面 reload 后必须重新取，且不得把版本号钉在旧值上
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify(stVersionPayload()))
      },
    })
    console.log(`[dsht-rp] ST compat /version on webServer route /version (pkgVersion=${SILLYTAVERN_COMPAT_VERSION})`)

    // ---- T-48 / T-63：`/scripts/extensions/**` 与 `/scripts/templates/**` 文件路由 ----
    // 背景：卡的宿主注入脚本调 `ctx.renderExtensionTemplateAsync(ext, id, data)`，基准走
    // XHR 取 `scripts/extensions/<ext>/<id>.html` → Handlebars 编译 → DOMPurify 消毒。
    // 我方原先只有"未移植"的退化门面（点了毫无反应、零线索）。现补上真链路：
    // 文件从 `$DSH_HOME/extensions/**`、`$DSH_HOME/templates/**` 只读挂载（见 ext-asset.ts 头注）。
    // 路径来自**不可信输入** ⇒ 穿越/编码/NUL/非 .html 一律由 `resolveScriptAsset` 判据拒绝。
    const disposeScriptAssets: Array<() => void> = []
    for (const prefix of SCRIPT_ASSET_PREFIXES) {
      disposeScriptAssets.push(ctx.webServer.register({
        kind: 'prefix',
        path: prefix,
        handler: (rawReq: unknown, rawRes: unknown) => {
          void handleScriptAssetRequest(
            {
              method: (rawReq as { method?: string }).method,
              url: (rawReq as { url?: string }).url,
              trusted: isTrusted(rawReq as { headers: Record<string, unknown> }),
            },
            rawRes as {
              writeHead: (code: number, headers?: Record<string, string | number>) => void
              end: (b?: string) => void
            },
            dshHome,
          )
        },
      }))
    }
    console.log(`[dsht-rp] ST compat script assets on webServer: ${SCRIPT_ASSET_PREFIXES.join(', ')}`)
    // 0.1.2 token 落盘（绕行 stdout 静默，2026-09-04 真机实证）：卓易通/鸿蒙上 node
    // 的 stdout 管道可能整段丢失（端口开放、进程活着、stdout 零行）——NodeService 的
    // stdout 捕获链拿不到 launch token，MainActivity 永等。本插件进程内直接把
    // launchToken 写 $DSH_HOME/dsht-token，NodeService 每秒轮询读取。launchToken 每次进程
    // 重启变化（NodeService 启动 node 前删旧文件）。无 connection（<0.1.2）不写。
    const connForToken = (ctx as unknown as { connection?: { browserAuth?: { launchToken?: string } } }).connection
    const launchToken = connForToken?.browserAuth?.launchToken
    if (typeof launchToken === 'string' && launchToken.length > 0) {
      void (async () => {
        try {
          // 【实机复现修复 2026-09-05】启动竞态收口：重装/SIGKILL 后的 seq gap 修复
          // （启动即修）与 token 写入并行赛跑——MainActivity/外部脚本一读到 token 就发
          // 请求，会在 repair 完成前撞上 "corrupt session log: seq gap"。把 repair
          // 完成作为写 token 的前置屏障（repair 自带 8MB 上限与容错，不阻塞太久）。
          try {
            const r = await repairAllSessionSeqs()
            const n = Number((r as { repaired?: unknown }).repaired ?? 0)
            if (n > 0) logLine(`启动即修（token 屏障内）：seq 断号修复 ${n} 个会话`)
          } catch { /* 修复失败不挡启动（与旧路径同语义） */ }
          const tokenFile = join(dshHome, 'dsht-token')
          const existing = await readFile(tokenFile, 'utf8').catch(() => '')
          if (existing.trim() !== launchToken) {
            await mkdir(dirname(tokenFile), { recursive: true })
            await writeFile(tokenFile, launchToken, 'utf8')
            console.log('[dsht-rp] launch token written to dsht-token (stdout-independent channel)')
          }
        } catch { /* 落盘失败不影响启动（stdout 捕获链仍在） */ }
      })()
    }
    // 插件卸载时撤路由（effect disposer）
    const effectFn = (ctx as unknown as { effect?: (fn: () => () => void) => unknown }).effect
    if (typeof effectFn === 'function') {
      effectFn.call(ctx, () => () => {
        dispose(); disposeVersion()
        for (const d of disposeScriptAssets) d()
      })
    }
  }
}
