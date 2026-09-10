/**
 * th-floors.ts — TH 楼层附加数据的会话级 sidecar 存储
 * ============================================================
 * ## 为什么需要它（2026-09-10 阶段 3 实证）
 *
 * 0.1.5 的 `assertReleasedV0Keys` 是**白名单**语义：事件 `source` 上多一个键就整会话拒绝。
 * 而 `source` 的合法键是**闭集**：
 *   · model source → `{kind, provider, model, replayState}`（**没有任何结构化扩展位**）
 *   · plugin source → `{kind, plugin, form, sections, summary, compactionId, sourceCommandId}`
 *   · user source → `{kind, rpcId, clientTimeZone}`
 *   · tool source → `{kind, callId}`
 *
 * 我方历史上把 TH 楼层元数据（`thData` 卡脚本附加数据、`thSystem` 系统楼层标记）
 * 直接挂在 `source` 上（`dsh-plugin/index.ts` 的 P3a 写路径）。0.1.2 的校验只查
 * kind/provider/model，所以一路静默写到今天；0.1.5 起这些会话**整体打不开**。
 *
 * ## 为什么不能塞进 sections
 * `plugin source` 的 `form:'snapshot' + sections` 确实是合法载体，但：
 *   1. `assistant/message` 必须是 **model source** —— 没有 sections 位；
 *   2. 前端导出（`facade.chatMessages`）把 `form === 'snapshot'` 的事件当作
 *      「内部工作过程」**跳过**，塞进去反而读不回来。
 *
 * ## 结论（对应 LEARNINGS L12）
 * TH 楼层元数据必须**迁出官方结构**，存到自有 sidecar：
 *   `$DSH_HOME/rp/th-floors/<sessionId>.json`
 *   → `{ "<messageId>": { data?: unknown, system?: true } }`
 *
 * 用 message `id` 作主键而非 `seq`：seq 会被 seq 修复/迁移重编号，id 不会。
 * 找不到 id 时退回 `seq:<n>` 键（导出侧按同一优先级查）。
 *
 * 语义边界：`data` / `system` 只对**我方写入的 TH 楼层**有意义；
 * 模型自己生成的普通助手楼层本来就没有这两项，sidecar 里也不会出现。
 *
 * @module dsht-plugin-shared/th-floors
 */

// @adapt contract:session.source-key-whitelist

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** 单个楼层的 TH 附加数据 */
export interface ThFloorRecord {
  /** 卡脚本附加数据（ST `createChatMessages` 的 `data` 字段原样回读） */
  data?: unknown
  /** TH 系统楼层标记（前端导出 role:'system' / is_system:true） */
  system?: true
  /**
   * 从 `source` 上救回来的其它自定义键（键名 → 原值）。
   * 用途：0.1.5 白名单收紧后 `source` 不许挂非契约键，修复器把它们搬到这里，
   * **不再静默丢弃**。读侧目前不使用，但保证数据可追溯、可复原。
   */
  legacy?: Record<string, unknown>
}

/** messageId → 楼层附加数据 */
export type ThFloorTable = Record<string, ThFloorRecord>

/** sidecar 文件绝对路径 */
export function thFloorsFile(dshHome: string, sessionId: string): string {
  return join(dshHome, 'rp', 'th-floors', `${sessionId}.json`)
}

/** 读 sidecar（容错：缺失/损坏一律当空表；本函数**不抛**） */
export function readThFloors(dshHome: string, sessionId: string): ThFloorTable {
  try {
    const raw = readFileSync(thFloorsFile(dshHome, sessionId), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: ThFloorTable = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) continue
      const r = v as { data?: unknown; system?: unknown; legacy?: unknown }
      const rec: ThFloorRecord = {}
      if (r.data !== undefined) rec.data = r.data
      if (r.system === true) rec.system = true
      if (r.legacy !== null && typeof r.legacy === 'object' && !Array.isArray(r.legacy)) {
        rec.legacy = r.legacy as Record<string, unknown>
      }
      if (rec.data !== undefined || rec.system !== undefined || rec.legacy !== undefined) out[k] = rec
    }
    return out
  } catch { return {} }
}

/** 原子覆盖写 sidecar（先写 .tmp 再 rename；mkdir -p） */
export function writeThFloors(dshHome: string, sessionId: string, table: ThFloorTable): void {
  const file = thFloorsFile(dshHome, sessionId)
  try {
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(table), 'utf8')
    renameSync(tmp, file)
  } catch { /* sidecar 是增强面：写失败不能阻断聊天写入 */ }
}

/** 单条记录合并（legacy 逐键合并，避免后写覆盖先写救回的另一类键） */
function mergeRecord(prev: ThFloorRecord | undefined, next: ThFloorRecord): ThFloorRecord {
  const out: ThFloorRecord = { ...prev, ...next }
  if (prev?.legacy !== undefined || next.legacy !== undefined) {
    out.legacy = { ...(prev?.legacy ?? {}), ...(next.legacy ?? {}) }
  }
  return out
}

/** 合并写入（读-改-写；只覆盖传进来的键） */
export function upsertThFloors(
  dshHome: string, sessionId: string, entries: Record<string, ThFloorRecord>,
): void {
  const keys = Object.keys(entries)
  if (keys.length === 0) return
  const table = readThFloors(dshHome, sessionId)
  for (const k of keys) table[k] = mergeRecord(table[k], entries[k])
  writeThFloors(dshHome, sessionId, table)
}

/** 成批合并（salvage 恢复路径用；与 upsert 同语义，命名区分调用点意图） */
export function mergeSalvagedThFloors(
  dshHome: string, sessionId: string, entries: Record<string, ThFloorRecord>,
): number {
  const n = Object.keys(entries).length
  if (n === 0) return 0
  const table = readThFloors(dshHome, sessionId)
  for (const [k, v] of Object.entries(entries)) table[k] = mergeRecord(table[k], v)
  writeThFloors(dshHome, sessionId, table)
  return n
}

/**
 * 查楼层：优先 messageId，其次 `seq:<n>`。
 * @param id  事件里的 message id（assistant/message 在 `data.message.id`，user/message 在 `data.id`）
 * @param seq 事件 seq（id 缺失或查不到时的兜底）
 */
export function lookupThFloor(
  table: ThFloorTable, id: unknown, seq: unknown,
): ThFloorRecord | undefined {
  if (typeof id === 'string' && id !== '') {
    const hit = table[id]
    if (hit !== undefined) return hit
  }
  if (typeof seq === 'number') return table[`seq:${seq}`]
  return undefined
}

/**
 * 从事件数据推断 sidecar 键（写侧与 salvage 侧共用，保证两侧键一致）。
 * 返回 null 表示这条事件不该进 sidecar。
 */
export function thFloorKeyOf(data: Record<string, unknown> | undefined, seq: number): string | null {
  if (data === undefined) return null
  const msg = data.message
  if (msg !== null && typeof msg === 'object' && !Array.isArray(msg)) {
    const id = (msg as { id?: unknown }).id
    if (typeof id === 'string' && id !== '') return id
  }
  const id = data.id
  if (typeof id === 'string' && id !== '') return id
  return Number.isInteger(seq) && seq >= 0 ? `seq:${seq}` : null
}
