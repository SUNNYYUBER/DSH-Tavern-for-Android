/**
 * session.jsonl 手术刀（共享模块）——从 dsh-plugin/index.ts 抽出，供
 * dsht-rp-plugin 与独立通用插件 dsht-plugin-undo 共同消费（esbuild 各自内联，
 * 零运行时依赖）。
 *
 * 契约：
 * - session.jsonl 首行 = session header（type:'session'），后续每行一个事件（seq 递增）。
 * - 回退/重新生成 = 原地截断事件流（绝不开新分支/新 session）：header 保留，
 *   事件只留 seq <= keepThroughSeq；被截事件参与的 replace 链随截断消失
 *   （后续事件的 replace 引用若指向被截 seq 属越界用法，由调用方保证锚点落在链尾）。
 * - 会话定位：扫 $DSH_HOME/sessions/<projectKey>/<sid>/ 的**当前世代**日志首行 header.id
 *   （0.1.5 起当前世代可能是 `session.vN.jsonl`，见 `pickCurrentSessionFilename`；
 *   拿到 `SessionHeaderHit` 后一律读 `hit.file`，不要自己拼 `session.jsonl`）。
 */

import { open, readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'

// @adapt contract:persistence.format
/**
 * 会话回退（纯函数）：截断 session.jsonl 到 keepThroughSeq（含）——
 * header 保留，事件只留 seq <= keepThroughSeq 的；被截事件参与的 replace 链
 * 随截断消失（后续事件的 replace 引用若指向被截 seq 属越界用法，由调用方保证
 * keepThroughSeq 落在链尾）。
 */
export function truncateSessionJsonl(content: string, keepThroughSeq: number): { content: string; kept: number; dropped: number; error?: string } {
  const lines = content.split('\n')
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
  if (lines.length === 0) return { content, kept: 0, dropped: 0, error: '空文件' }
  let header: Record<string, unknown>
  try { header = JSON.parse(lines[0]) as Record<string, unknown> } catch {
    return { content, kept: 0, dropped: 0, error: 'header 不是合法 JSON' }
  }
  if (header?.type !== 'session') return { content, kept: 0, dropped: 0, error: '首行不是 session header' }
  const kept: string[] = []
  let dropped = 0
  for (let i = 1; i < lines.length; i++) {
    let ev: { seq?: unknown }
    try { ev = JSON.parse(lines[i]) as { seq?: unknown } } catch {
      return { content, kept: 0, dropped: 0, error: `第 ${i + 1} 行不是合法 JSON` }
    }
    if (typeof ev?.seq === 'number' && ev.seq <= keepThroughSeq) kept.push(lines[i])
    else dropped++
  }
  return { content: [lines[0], ...kept].join('\n') + '\n', kept: kept.length, dropped }
}

/**
 * 快照消息角色归一化（纯函数）：把 user/message 事件里 role==='system' 的历史快照
 * 改写为 role:'user'。
 *
 * 根因（真机实测，DSH 0.1.0-rc.8 冷启动校验）：assertMessageEventShape 要求
 * user/message 的 data.role === 'user'（'message must have role "user"'）——RP 侧
 * pre-step 快照注入（persona/世界书/预设/状态/记忆，source.form='snapshot'）历史
 * 写的是 role:'system'，写盘时进程内不校验、冷启动全量校验即炸
 * SessionPersistenceCorruptionError，会话整个打不开。注入器已改写 role:'user'（对
 * 模型语义不变：system 提示本就以用户深度注入等效），本函数修复存量日志。
 * 其余事件行原样透传；非 JSON 行原样保留（与 truncate 的严格策略不同——归一化
 * 要尽量少动文件）。
 */
export function normalizeSnapshotMessageRoles(content: string): { content: string; changed: number } {
  const lines = content.split('\n')
  let changed = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.includes('"user/message"')) continue
    if (!line.includes('"role":"system"') && !line.includes('"form":"snapshot"')) continue
    try {
      const ev = JSON.parse(line) as {
        type?: string
        data?: { role?: string; source?: { form?: string }; content?: Array<{ type?: string; text?: string }> }
      }
      if (ev?.type !== 'user/message') continue
      const isSnapshot = ev.data?.source?.form === 'snapshot'
      let touched = false
      if (ev.data?.role === 'system') { ev.data.role = 'user'; touched = true }
      // 快照消息里的残留 ASCII 宏（未知宏如 {{trim}}/{{lastUserMessage}} 组装层不展开、
      // 原样透传）→ 全角化：DSH 插值器对 persona 段消息扫 '{{'，未知引用直接抛
      // "malformed prompt variable reference"，turn 炸（真机实测 turn 38）。
      if (isSnapshot && Array.isArray(ev.data?.content)) {
        for (const block of ev.data.content) {
          if (block?.type === 'text' && typeof block.text === 'string' && block.text.includes('{{')) {
            block.text = block.text.split('{{').join('｛｛').split('}}').join('｝｝')
            touched = true
          }
        }
      }
      // source.sections[].text 同样中性化（插值器连 sections 一起扫——真机实测 turn 38：
      // content 已净但 sections.text 带原始宏照样炸）
      const secs = (ev.data?.source as { sections?: Array<{ text?: string }> } | undefined)?.sections
      if (isSnapshot && Array.isArray(secs)) {
        for (const s of secs) {
          if (s && typeof s.text === 'string' && s.text.includes('{{')) {
            s.text = s.text.split('{{').join('｛｛').split('}}').join('｝｝')
            touched = true
          }
        }
      }
      if (touched) { lines[i] = JSON.stringify(ev); changed++ }
    } catch { /* 坏行原样保留 */ }
  }
  return { content: lines.join('\n'), changed }
}

/**
 * 会话重新生成定位（纯函数）：最后一条**真用户** user/message 的 seq 与其文本。
 * 找不到返回 null。事件形态：user/message 的 data = {role, content}（LikeMessage 直存）。
 * 【鲁棒轮 2026-09-09】排除 source.kind === 'plugin'（live 回退/重新生成后的 marker
 * 「[已回退] …」原实现会被当锚 → lastUserText = marker 文案 → 前端把系统文案当输入重发；
 * live 路径同口径）。kind 缺失（存量旧数据）视为真用户消息——不破坏旧会话兼容。
 */
export function findLastUserMessage(events: Array<{ type: string; seq: number; data?: unknown }>): { seq: number; text: string } | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]
    if (ev?.type !== 'user/message') continue
    const d = ev.data as { content?: Array<{ type: string; text?: string }>; source?: { kind?: unknown } } | undefined
    if (d?.source?.kind === 'plugin') continue
    const text = (d?.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('\n')
    return { seq: ev.seq, text }
  }
  return null
}

// ---------------------------------------------------------------------------
// 【心跳 58 · T-58】「非 live 才允许文件手术」的唯一判据（单源）
//
// 回退 / 编辑 / 重新生成三个动作各有两条路径：
//   · **live**（会话正 attach 在 `ctx.sessions` 里）→ 走官方 replace 原语做**逻辑**回退
//     （事件留在日志，立即生效，可再回退）；
//   · **非 live**（会话没打开）→ 走**物理截断** session.jsonl（`truncateSessionJsonl` + `.bak`）。
//
// 为什么 live 必须拒收截盘（**内存态权威**）：live 会话的内存事件树才是权威副本，
// 落盘文件随后会被 `flush` 用内存态覆盖 —— 此时改盘 = 改动被静默回滚，且可能与
// 后续 append 的 seq 产生错位。故 live 一律 409，提示先关闭会话。
//
// ⚠️ 本判据此前在 **6 处**逐字复制（`dsh-plugin/index.ts` 的 rollback/edit/regenerate
// 各一处 + `dsht-plugin-undo/index.ts` 的三处），而单测**只覆盖了 undo 那份**。
// 后果正是心跳 57 对 T-58 的误判：看到「对未挂载会话能截断」就以为缺少门槛，
// 实际三处 RP 侧**都已有 409 守卫**，只是没有测试与单源把这条不变量钉住（L61 同族）。
//
// 收敛为单源后：改一处即两插件同步；单测钉在纯函数上，两侧都受保护。
// ---------------------------------------------------------------------------

/** 三个动作的文案用词（保持既有逐字文案，避免用户可见文案漂移） */
export type SurgeryAction = 'rollback' | 'edit' | 'regenerate'

/**
 * sessionId 是否**安全**用作文件名/路径段（路径穿越防护；**安全判据**）。
 *
 * ## 为什么下沉到共享层（P-1b）
 * 这条判据此前被**逐字复制**在两处：
 *   · `dsh-plugin/memory.ts` 的 `isValidMemorySessionId`（工具记忆落 `rp/memory/<sid>.json`）
 *   · `dsht-plugin-memory/tables.ts` 的 `isValidTablesSessionId`（表格落同族路径）
 * 两者条件集完全一致，但**没有任何机制保证它们继续一致**——安全判据只在一侧收紧，
 * 另一侧就留洞（路径穿越：`../` 或绝对路径写出去）。属「复制即必然漂移」的典型，
 * 且漂移后果是**安全**而非体验，故必须单源。
 *
 * ## 判据口径（保持既有行为，逐条沿用）
 * - 非空、长度 ≤120（防超长文件名）；
 * - 不含 `/`、`\`（路径分隔符）；
 * - 不含 `..`（相对上跳）；
 * - 不等于 `.`（当前目录）；
 * - 首尾无空白（`trim()` 不变，防「看起来同名实则不同」）。
 *
 * @returns 安全 → true
 */
export function isSafeSessionId(sessionId: unknown): boolean {
  return typeof sessionId === 'string'
    && sessionId.length > 0
    && sessionId.length <= 120
    && !sessionId.includes('/')
    && !sessionId.includes('\\')
    && !sessionId.includes('..')
    && sessionId !== '.'
    && sessionId.trim() === sessionId
}

const ACTION_LABEL: Record<SurgeryAction, string> = {
  rollback: '回退',
  edit: '编辑',
  regenerate: '重新生成',
}

/**
 * 会话是否**允许**做物理文件手术（截断 session.jsonl）。
 *
 * @param isLive 该 sessionId 当前是否 attach 在宿主会话注册表里（`ctx.sessions.get(id) !== undefined`）
 * @returns `{ allowed: true }` 或 `{ allowed: false, error }`（error = 直接回给客户端的 409 文案）
 */
export function canSurgicallyTruncate(
  isLive: boolean,
  action: SurgeryAction,
): { allowed: true } | { allowed: false; error: string } {
  if (!isLive) return { allowed: true }
  return {
    allowed: false,
    error: `session live（内存态权威）：先在 DSH 里关闭该会话再${ACTION_LABEL[action]}`,
  }
}

/**
 * 重复 turn/start 检测与修复（纯函数，R49 存量数据修复）。
 *
 * 根因（实机实证，turn 序列 1,1,2..18）：open-chat 物化直写 turn/start 事件不刷新
 * 内核 agent 构造时缓存的 phase.lastTurn → 内核下一条 prompt 重开同一 turn →
 * session.jsonl 出现两条 data.turn 相同的 turn/start → 前端 ConversationNodeAssembler
 * 全量重放抛「received more than one start Match」→ event feed subscriber 死亡，
 * 折叠行（turn-process 节点）/会话流停摆。
 *
 * 修复策略：第二次出现的 turn/start（其 turn 已闭合过）连同其配对 turn/end 的
 * 整段，把段内所有 data.turn === 旧编号的事件重编号为 maxTurn+1。保留首段
 * （物化开场白 = 楼层 1 语义）；重编号段的时间顺序在楼层分组里按 seq 排，无影响。
 * 事件 seq 与行结构不动；坏行原样保留（与 normalizeSnapshotMessageRoles 同策略）。
 */
export function repairDuplicateTurnStarts(content: string): { content: string; renumberedTurns: number; eventsRewritten: number } {
  const lines = content.split('\n')
  const events: Array<{ type: string; turn?: number } | null> = lines.map(l => {
    try {
      const ev = JSON.parse(l) as { type?: string; data?: { turn?: unknown } }
      if (typeof ev?.type !== 'string') return null
      const turn = typeof ev.data?.turn === 'number' ? ev.data.turn : undefined
      return { type: ev.type, turn }
    } catch { return null }
  })
  const closed = new Set<number>()
  let maxTurn = 0
  let renumberedTurns = 0
  let eventsRewritten = 0
  // 先扫一遍确定 maxTurn（重编号目标 = max+1）
  for (const ev of events) {
    if (ev?.type === 'turn/start' && typeof ev.turn === 'number') maxTurn = Math.max(maxTurn, ev.turn)
  }
  // 逐事件状态机：closed 里已有的 turn 又开 start → 该段重编号
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]
    if (ev?.type !== 'turn/start' || typeof ev.turn !== 'number') continue
    if (!closed.has(ev.turn)) {
      closed.add(ev.turn)
      continue
    }
    // 重复段：从本行到配对 turn/end（data.turn 相同）
    const oldTurn = ev.turn
    const newTurn = ++maxTurn
    renumberedTurns++
    for (let j = i; j < events.length; j++) {
      const line = lines[j]
      if (!line.includes('"turn"') || !line.trim()) continue
      try {
        const parsed = JSON.parse(line) as { data?: { turn?: unknown } }
        if (parsed?.data?.turn === oldTurn) {
          parsed.data.turn = newTurn
          lines[j] = JSON.stringify(parsed)
          events[j] = { type: events[j]?.type ?? '', turn: newTurn }
          eventsRewritten++
          if (events[j]?.type === 'turn/end') break
        }
      } catch { /* 坏行不动 */ }
    }
    // 重编号后的 turn 视为闭合（继续扫后续）
    closed.add(newTurn)
  }
  if (eventsRewritten === 0) return { content, renumberedTurns: 0, eventsRewritten: 0 }
  return { content: lines.join('\n'), renumberedTurns, eventsRewritten }
}

/** 读文件首行（session.jsonl header；大聊天日志不整读） */
export async function readFirstLine(path: string): Promise<string | null> {
  let handle: import('node:fs/promises').FileHandle | null = null
  try {
    handle = await open(path, 'r')
    const buf = Buffer.alloc(8192)
    const { bytesRead } = await handle.read(buf, 0, 8192, 0)
    if (bytesRead === 0) return null
    const chunk = buf.subarray(0, bytesRead).toString('utf8')
    const nl = chunk.indexOf('\n')
    return nl === -1 ? chunk : chunk.slice(0, nl)
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => { /* 关闭失败无碍 */ })
  }
}

export interface SessionHeaderHit {
  sessionId: string
  cwd?: string
  project: string
  sdir: string
  firstLine: string
  /** 【0.1.5 世代】当前世代的会话日志绝对路径（读侧一律用这个，不要自己拼 session.jsonl）。
   *  v0 会话 = `…/session.jsonl`；已被核心迁移过的会话 = `…/session.vN.jsonl`（v0 文件
   *  作为历史世代被冻结保留，继续读它 = 读到迁移那一刻的死数据）。 */
  file: string
}

/** 目录内条目 → 当前世代会话日志文件名（纯函数，便于单测）。
 *
 *  规则（官方 `generationLogFilename`，dsh-session-persistence-jsonl/lib/index.js:753-760）：
 *  v0 保留无版本后缀的 `session.jsonl`；v1+ 为 `session.v<version>.jsonl`。
 *  取**最高版本号**的文件；一个都没有则回落到 `session.jsonl`。
 */
export function pickCurrentSessionFilename(entries: readonly string[]): string {
  let best: string | null = null
  let bestVersion = -1
  for (const name of entries) {
    const m = /^session\.v(\d+)\.jsonl$/.exec(name)
    if (m === null) continue
    const v = Number(m[1])
    if (v > bestVersion) { bestVersion = v; best = name }
  }
  return best ?? 'session.jsonl'
}

/** 解析某个会话目录的当前世代日志路径（列表页/审计等拿不到 header 时用）。 */
export async function currentSessionLogPath(dshHome: string, project: string, sdir: string): Promise<string> {
  const dir = join(dshHome, 'sessions', project, sdir)
  const entries = await readdir(dir).catch(() => [] as string[])
  return join(dir, pickCurrentSessionFilename(entries))
}

/** 会话目录**搬迁到另一个 projectKey** 后的当前世代日志路径（纯函数）。
 *
 *  搬迁只换父目录，日志文件名不变 ⇒ 从扫描结果 `SessionHeaderHit.file` 取 basename 即可，
 *  **绝不可重拼 `session.jsonl`**：0.1.5 世代下该文件不存在，重拼 = ENOENT。
 *
 *  为什么单独抽成函数（心跳 61）：设备实测的严重缺陷正是内联重拼造成的 ——
 *  `repairSessionCwds` 先 `rename` 目录、再按硬编码 `'session.jsonl'` 读文件 ⇒ 抛 ENOENT
 *  被外层 catch 吞成 `errors=1` ⇒ **目录已搬走、header.cwd 没改** ⇒
 *  目录名 ≠ projectKey(header.cwd)，违反官方 `assertStoredIdentity` 强不变量（会话打不开）。
 *  抽出来是为了让这条约束**可单测**，而不是只活在注释里。
 */
export function relocatedSessionLogPath(root: string, targetProject: string, sdir: string, sourceFile: string): string {
  return join(root, targetProject, sdir, basename(sourceFile))
}

/** 扫 $DSH_HOME/sessions/<projectKey>/<sid>/ 当前世代日志首行 header（只读首行，大日志无压力） */
export async function scanSessionHeaders(dshHome: string): Promise<SessionHeaderHit[]> {
  const root = join(dshHome, 'sessions')
  const out: SessionHeaderHit[] = []
  let projects: string[] = []
  try { projects = await readdir(root) } catch { return out }
  for (const project of projects) {
    let sdirs: string[] = []
    try { sdirs = await readdir(join(root, project)) } catch { continue }
    for (const sdir of sdirs) {
      // 【0.1.5 世代】按目录内容选当前世代文件；旧实现硬编码 session.jsonl，
      // 迁移过的会话从此读到冻结的 v0 世代（80 个真实会话里只有 1 个已迁移，
      // 但那 1 个正是用户正在用的那个）。
      let entries: string[] = []
      try { entries = await readdir(join(root, project, sdir)) } catch { continue }
      const file = join(root, project, sdir, pickCurrentSessionFilename(entries))
      const firstLine = await readFirstLine(file)
      if (firstLine === null) continue
      try {
        const header = JSON.parse(firstLine) as { type?: unknown; id?: unknown; cwd?: unknown }
        if (header?.type !== 'session' || typeof header.id !== 'string') continue
        out.push({
          sessionId: header.id,
          cwd: typeof header.cwd === 'string' ? header.cwd : undefined,
          project, sdir, firstLine, file,
        })
      } catch { /* 非 JSON 首行 */ }
    }
  }
  return out
}
