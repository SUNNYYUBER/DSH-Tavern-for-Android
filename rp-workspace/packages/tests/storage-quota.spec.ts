/**
 * L3 存储配额：`dsht-float-<sessionId>` 会话位置键的**孤儿清理**护栏。
 *
 * ## 为什么这组测试存在
 * L3 必测项「存储配额：长期使用下 localStorage / 文件不无限增长」。
 * 穷举结论（2026-09-14）：全仓**零 localStorage 清理机制**（无 `localStorage.key()`、
 * 无 TTL、无条数上限），而 `savePos` 按 `dsht-float-<sessionId>` **每会话写一条且从不删**
 * ⇒ 长期使用必然累积孤儿键（已删会话、一次性会话）。累积到写失败时，
 * `savePos` 的 `catch {}` 是空的 ⇒ **静默失效**（浮球位置不再被记住，用户无任何线索）——
 * 属 P-3（静默失败）族，违反 R8。
 *
 * 判据（正控 + 负控 + 边界）：
 *   ① 超出上限时真的开始删（正控：写 60 个 → 总数不超上限）；
 *   ② **global 兜底键永不被删**（负控：它是所有新会话的继承源，删了会让位置丢失）；
 *   ③ **当前会话的键永不被删**（边界：正在用的那条必须在保留集里）；
 *   ④ 未超上限时**一个都不删**（零控：不能「顺手清理」把用户的位置记忆清掉）。
 *
 * 局限（诚实边界）：本测试驱动的是清理**函数**的行为，不覆盖「真实 WebView 的
 * localStorage 遍历顺序」——后者属 M5/M6。但「有上限」这一判据与顺序无关。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { POS_KEY_GLOBAL, posKeyOf, savePos } from '../src/dsht-rp-ui/src/client/RpStateFloat.tsx'

/** 假 localStorage：保序 Map + length/key() 面（与真实 API 同形） */
function installFakeStorage(): Map<string, string> {
  const store = new Map<string, string>()
  const fake = {
    get length() { return store.size },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => { store.clear() },
  }
  ;(globalThis as { localStorage?: unknown }).localStorage = fake
  return store
}

let store: Map<string, string>
beforeEach(() => { store = installFakeStorage() })

/** 造 N 个「会话位置键」 */
function seedSessions(n: number, prefix = 'dsht-float-sess-'): void {
  for (let i = 0; i < n; i += 1) savePos(`${prefix}${i}`, { x: 0.5, y: 0.5 })
}

describe('L3 存储配额：会话位置键有上限（正控）', () => {
  it('✅ 写 60 个会话键 → 总数被压到上限内（不再无界增长）', () => {
    seedSessions(60)
    // 会话键数（排除 global 与其它非本前缀键）
    const sessionKeys = Array.from(store.keys()).filter(k => k.startsWith('dsht-float-') && k !== POS_KEY_GLOBAL)
    expect(sessionKeys.length).toBeLessThanOrEqual(50)
    expect(sessionKeys.length).toBeGreaterThan(0)
  })

  it('✅ 上限是「稳定的」：继续写不继续涨（反复写同一批也不膨胀）', () => {
    seedSessions(60)
    const after1 = Array.from(store.keys()).filter(k => k.startsWith('dsht-float-') && k !== POS_KEY_GLOBAL).length
    seedSessions(60, 'dsht-float-more-')
    const after2 = Array.from(store.keys()).filter(k => k.startsWith('dsht-float-') && k !== POS_KEY_GLOBAL).length
    expect(after2).toBeLessThanOrEqual(after1)
  })
})

describe('L3 存储配额：不得误删（负控 / 边界 / 零控）', () => {
  it('负控：global 兜底键**永不被删**（新会话的位置继承源）', () => {
    seedSessions(60)
    expect(store.has(POS_KEY_GLOBAL)).toBe(true)
    // 且它的值仍合法（未被清成空）
    expect(store.get(POS_KEY_GLOBAL)).toContain('"x"')
  })

  it('边界：当前会话的键**必须在保留集里**（正在用的不能被清理掉）', () => {
    seedSessions(60)
    const current = 'dsht-float-current-session'
    savePos(current, { x: 0.11, y: 0.22 })
    expect(store.has(current)).toBe(true)
    // 且是最后一次写入的值
    expect(store.get(current)).toContain('0.11')
  })

  it('零控：未超上限时**一个都不删**（不能顺手清掉用户的位置记忆）', () => {
    seedSessions(10)
    const keys = Array.from(store.keys()).filter(k => k.startsWith('dsht-float-') && k !== POS_KEY_GLOBAL)
    expect(keys.length).toBe(10)   // 10 < 50，全保留
    for (let i = 0; i < 10; i += 1) expect(store.has(`dsht-float-sess-${i}`)).toBe(true)
  })

  it('不误伤无关键（非本前缀的键一律不碰）', () => {
    store.set('dsh.workspace.view.v5', '{}')
    store.set('__dsht_extension_settings', '{}')
    seedSessions(60)
    expect(store.has('dsh.workspace.view.v5')).toBe(true)
    expect(store.has('__dsht_extension_settings')).toBe(true)
  })
})

describe('L3 posKeyOf：键名契约（清理判据依赖它）', () => {
  it('有 sessionId → dsht-float-<id>；无 → global 兜底键', () => {
    expect(posKeyOf('abc')).toBe('dsht-float-abc')
    expect(posKeyOf('')).toBe(POS_KEY_GLOBAL)
  })

  it('global 兜底键自身匹配会话键前缀（所以清理必须显式排除它）', () => {
    // 这正是 prunesPosKeys 里 `k !== POS_KEY_GLOBAL` 的存在理由
    expect(POS_KEY_GLOBAL.startsWith('dsht-float-')).toBe(true)
  })
})
