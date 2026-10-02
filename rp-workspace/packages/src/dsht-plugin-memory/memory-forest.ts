/**
 * memory-forest.ts —— dsht-plugin-memory v2 数据层（M1 切片）
 *
 * 【设计来源】2026-10-02 记忆引擎两阶段架构（计划书 constantine-wally-west-beast-boy.md）。
 * 思路参考柏宝书（ST-BaiBai-Book）公开 README 描述的**行为语义**：每 AI 楼自动摘要、
 * 五本台账、时间锚点、番外标记、带记忆开新对话。⚠️ 版权红线：柏宝书无 LICENSE ⇒
 * 本文件零行源码/提示词来自它，全部数据结构与文案自研；仅借鉴思想（合规，思想不受版权保护）。
 *
 * 【数据层职责】（对应计划书 M1 切片）
 * - sidecar 布局：$DSH_HOME/rp/memory-forest/<sid>/{manifest.json, leaves/*.json, ledger.json}
 * - 叶子（Leaf）：每 AI 楼的摘要单元 {floor, timeTag, text, delta, edited?}
 * - delta 协议：摘要 LLM 一次调用的结构化产出（items/npcs/scenes/plans/protagonist + timeTag）
 * - 台账（LedgerState）：derive(全部叶子 delta) 纯函数重放折叠 —— 可随时从叶子重建（自愈）
 * - 回退安全：cursor 回退 ⇒ 落叶裁剪 dropLeavesAfter + 台账重算（与既有 memory 本第 7 条同语义）
 *
 * 【纯函数纪律】本模块除 sidecar IO 外全部纯函数（与 dsh-plugin/memory.ts 同范式），
 * vitest 正负控覆盖回退场景（tests/memory-forest.spec.ts）。
 */

import { join } from 'node:path'
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises'

// ---------------------------------------------------------------------------
// 类型（delta 协议）
// ---------------------------------------------------------------------------

/** 物品台账条目（谁拥有/存放何物 + 变动日志） */
export interface LedgerItem {
  name: string
  /** 持有者：角色名 / 'scene'（场景内无主物）/ 'lost'（已遗失） */
  owner: string
  /** 位置：'carried'（随身）/ 具体地点名 */
  location: string
  /** 简述（≤60 字） */
  note: string
  /** 最后变动楼层（追踪溯源） */
  lastFloor: number
}

/** NPC 台账条目 */
export interface LedgerNpc {
  name: string
  /** 身份一句话（≤40 字） */
  role: string
  /** 当前状态：在场/离场/死亡/未知 */
  status: 'present' | 'away' | 'dead' | 'unknown'
  /** 外在状态速记（穿着/伤势/情绪，≤60 字） */
  state: string
  /** 首次登场楼层 */
  firstFloor: number
  /** 最后变动楼层 */
  lastFloor: number
}

/** 场景台账：地点树节点（由大到小层级组织） */
export interface LedgerScene {
  name: string
  /** 父地点（'' = 世界级根节点） */
  parent: string
  /** 首次到达楼层 */
  firstFloor: number
}

/** 悬念/计划条目 */
export interface LedgerPlan {
  text: string
  /** 立下楼层 */
  createdFloor: number
  /** 了结楼层（未了结为 null） */
  resolvedFloor: number | null
  /** 了结方式（一句话） */
  resolution?: string
}

/** 主角档案（覆盖型：每 delta 全量替换） */
export interface LedgerProtagonist {
  /** 当前客观状态速记（位置/身份/目标，≤120 字） */
  status: string
  lastFloor: number
}

/** 单楼 delta（摘要 LLM 的结构化产出；数组条目按 name 匹配合并） */
export interface LeafDelta {
  items?: Array<Partial<LedgerItem> & { name: string }>
  npcs?: Array<Partial<LedgerNpc> & { name: string }>
  scenes?: Array<Partial<LedgerScene> & { name: string }>
  /** 新增/更新悬念（resolved 在 delta 里表达为 resolution 非空） */
  plans?: Array<Partial<LedgerPlan> & { text: string }>
  /** 全量替换主角档案（有则替换，无则保留） */
  protagonist?: Partial<LedgerProtagonist>
  /** 时间推进（故事内时间锚点；空串 = 无推进） */
  timeTag?: string
}

/** 叶子：单 AI 楼的摘要记录 */
export interface Leaf {
  /** 楼层号（用户口径：1 输入=1 楼，同 turn 多 assistant 消息合并为 1 楼——与既有 memory 同口径） */
  floor: number
  /** 故事内时间标签（落楼时刻的故事内时间） */
  timeTag: string
  /** 摘要正文（markdown，目标 60-200 字，随详细/精简档） */
  text: string
  /** 结构化 delta（台账重放输入） */
  delta: LeafDelta
  /** 用户手工编辑过（自动摘要不得覆盖） */
  edited?: boolean
  /** 番外标记（被记忆系统整体忽略的楼层——小剧场/番外篇） */
  omake?: boolean
}

/** 台账重放终态（derive 的输出；全量可从叶子重建） */
export interface LedgerState {
  items: LedgerItem[]
  npcs: LedgerNpc[]
  scenes: LedgerScene[]
  /** 未了结悬念（resolvedFloor=null） */
  openPlans: LedgerPlan[]
  /** 已了结悬念（最近在前，供「防重复记录」） */
  resolvedPlans: LedgerPlan[]
  protagonist: LedgerProtagonist
  /** 最后一个叶子携带的时间标签（当前故事内时间） */
  currentTime: string
  /** 重放到的楼层 */
  throughFloor: number
}

/** manifest（memory-forest 根元数据） */
export interface ForestManifest {
  version: 1
  /** 已摘要到的楼层（cursor 口径） */
  lastSummarizedFloor: number
  /** 番外楼层集合（omake 标记；这些楼层不进摘要也不进台账） */
  omakeFloors: number[]
}

// ---------------------------------------------------------------------------
// 纯函数：delta 重放（台账 derive）
// ---------------------------------------------------------------------------

/** 空台账 */
export function emptyLedger(): LedgerState {
  return { items: [], npcs: [], scenes: [], openPlans: [], resolvedPlans: [], protagonist: { status: '', lastFloor: 0 }, currentTime: '', throughFloor: 0 }
}

const byName = <T extends { name: string }>(list: T[], name: string): T | undefined => list.find(x => x.name === name)

/** 应用一条 delta 到台账（不可变：返回新对象；源数组不被修改） */
export function applyDelta(state: LedgerState, delta: LeafDelta, floor: number): LedgerState {
  const s: LedgerState = {
    ...state,
    items: [...state.items], npcs: [...state.npcs], scenes: [...state.scenes],
    openPlans: [...state.openPlans], resolvedPlans: [...state.resolvedPlans],
    protagonist: { ...state.protagonist },
  }
  if (delta.timeTag) s.currentTime = delta.timeTag

  // 物品：按 name 匹配合并；owner/location/note 变化即更新；带 owner='lost' 表示遗失
  for (const it of delta.items ?? []) {
    const found = byName(s.items, it.name)
    if (found) {
      const idx = s.items.indexOf(found)
      s.items[idx] = { ...found, ...it, lastFloor: floor }
    } else {
      s.items.push({ owner: 'scene', location: 'unknown', note: '', lastFloor: floor, ...it } as LedgerItem)
    }
  }
  // NPC：按 name 匹配；死亡/离场转状态；重复登场刷新 state
  for (const n of delta.npcs ?? []) {
    const found = byName(s.npcs, n.name)
    if (found) {
      const idx = s.npcs.indexOf(found)
      s.npcs[idx] = { ...found, ...n, lastFloor: floor }
    } else {
      s.npcs.push({ role: '', status: 'present', state: '', firstFloor: floor, lastFloor: floor, ...n } as LedgerNpc)
    }
  }
  // 场景：树节点幂等注册（重访不重复）
  for (const sc of delta.scenes ?? []) {
    const found = byName(s.scenes, sc.name)
    if (!found) s.scenes.push({ parent: '', firstFloor: floor, ...sc } as LedgerScene)
  }
  // 悬念：delta 中带 resolution ⇒ 核销 openPlans 中同文条目；否则新增/刷新
  for (const p of delta.plans ?? []) {
    const idx = s.openPlans.findIndex(x => x.text === p.text)
    if (p.resolution) {
      if (idx >= 0) {
        const [done] = s.openPlans.splice(idx, 1)
        s.resolvedPlans.unshift({ ...done, resolvedFloor: floor, resolution: p.resolution })
      }
      // openPlans 中不存在的 resolution 条目忽略（幂等核销）
    } else if (idx < 0) {
      s.openPlans.push({ text: p.text, createdFloor: floor, resolvedFloor: null })
    }
  }
  // 主角档案：覆盖型
  if (delta.protagonist?.status) {
    s.protagonist = { status: delta.protagonist.status, lastFloor: floor }
  }
  s.throughFloor = Math.max(state.throughFloor, floor)
  return s
}

/** 台账 = derive(全部非番外叶子 delta)（按楼层序重放；随时可重建＝自愈） */
export function deriveLedger(leaves: Leaf[], omakeFloors: ReadonlySet<number> = new Set()): LedgerState {
  let s = emptyLedger()
  for (const leaf of [...leaves].sort((a, b) => a.floor - b.floor)) {
    if (omakeFloors.has(leaf.floor) || leaf.omake) continue // 番外楼层不进台账
    s = applyDelta(s, leaf.delta, leaf.floor)
  }
  return s
}

// ---------------------------------------------------------------------------
// 纯函数：回退安全（cursor 回退 ⇒ 裁叶 + 重放）
// ---------------------------------------------------------------------------

/** cursor 回退到 toFloor：删除 > toFloor 的叶子（返回保留叶子与被删楼层） */
export function dropLeavesAfter(leaves: Leaf[], toFloor: number): { kept: Leaf[]; dropped: number[] } {
  const kept = leaves.filter(l => l.floor <= toFloor)
  const dropped = leaves.filter(l => l.floor > toFloor).map(l => l.floor)
  return { kept, dropped }
}

/** 手工编辑保护：被标记 edited 的叶子在自动重摘要时必须跳过 */
export function needsResummary(leaf: Leaf | undefined): boolean {
  return !leaf || (!leaf.edited && leaf.text === '')
}

// ---------------------------------------------------------------------------
// sidecar IO（$DSH_HOME/rp/memory-forest/<sid>/）
// ---------------------------------------------------------------------------

export function forestDir(dshHome: string, sid: string): string {
  return join(dshHome, 'rp', 'memory-forest', sid)
}

export async function readManifest(dir: string): Promise<ForestManifest> {
  try {
    return JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as ForestManifest
  } catch {
    return { version: 1, lastSummarizedFloor: 0, omakeFloors: [] }
  }
}

export async function writeManifest(dir: string, m: ForestManifest): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(m, null, 1), 'utf8')
}

export async function readLeaves(dir: string): Promise<Leaf[]> {
  let files: string[]
  try { files = await readdir(join(dir, 'leaves')) } catch { return [] }
  const leaves: Leaf[] = []
  for (const f of files.filter(f => f.endsWith('.json'))) {
    try { leaves.push(JSON.parse(await readFile(join(dir, 'leaves', f), 'utf8')) as Leaf) } catch { /* 坏叶跳过（自愈） */ }
  }
  return leaves
}

export async function writeLeaf(dir: string, leaf: Leaf): Promise<void> {
  const d = join(dir, 'leaves')
  await mkdir(d, { recursive: true })
  await writeFile(join(d, `${leaf.floor}.json`), JSON.stringify(leaf, null, 1), 'utf8')
}

export async function dropLeaf(dir: string, floor: number): Promise<void> {
  await rm(join(dir, 'leaves', `${floor}.json`), { force: true })
}

/** 台账落盘（derive 结果缓存；损坏时由叶子重放自愈，读取方 catch 后走 deriveLedger） */
export async function writeLedger(dir: string, state: LedgerState): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'ledger.json'), JSON.stringify(state, null, 1), 'utf8')
}

export async function readLedger(dir: string, leaves: Leaf[], omake: ReadonlySet<number>): Promise<LedgerState> {
  try {
    const cached = JSON.parse(await readFile(join(dir, 'ledger.json'), 'utf8')) as LedgerState
    // 缓存与叶子楼层一致才可信；否则重放（自愈）
    const maxLeaf = Math.max(0, ...leaves.filter(l => !omake.has(l.floor) && !l.omake).map(l => l.floor))
    if (cached.throughFloor === maxLeaf) return cached
  } catch { /* 无缓存/坏缓存 */ }
  return deriveLedger(leaves, omake)
}
