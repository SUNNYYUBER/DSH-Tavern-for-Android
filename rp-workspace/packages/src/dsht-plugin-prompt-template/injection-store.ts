/**
 * 生成期 prompt 注入暂存区（per-generation prompt injection store）。
 *
 * ## 它解决什么问题
 * 扩展模板（EJS）需要往当前这次生成里塞入额外提示词，并在同一趟里再读回来。
 * 模板跑在隔离沙箱内，不能直接持有宿主对象，只能通过 `__host*` 桥调用本模块。
 * 于是「暂存区」必须活**沙箱之外**的宿主侧，且生命周期严格等于一次生成 pass。
 *
 * ## 语义契约（对外三个动作）
 * - `inject(key, prompt, order?, sticky?, uid?)` 写入一条。同 `(key, uid)` 视为同一条，
 *   后写覆盖前写（uid 省略时每次调用都是独立条目）。
 * - `get(key, postprocess?)` 把该 key 下的条目**按 order 升序**（同 order 按写入先后）
 *   用换行拼成一段文本；可选 postprocess 是 `{search, replace}` 列表，按序做整串替换。
 * - `has(key)` 该 key 是否已有条目。
 *
 * ## 三条硬约束
 * ① **不持久化**：本 store 只活一次 pass，不落盘、不跨请求残留。
 * ② **有界**：key 长度、单条正文长度、条目总数都有上限，防止模板把内存写爆
 *    （模板内容来自角色卡/世界书，属不可信输入）。
 * ③ **越界静默丢弃**：超限不抛错——模板渲染不该因为塞了太多东西而整趟失败，
 *    丢掉超限部分并让渲染继续。
 */

/** 对外暴露的注入暂存区接口（沙箱桥与宿主侧共用同一形状） */
export interface PromptInjectionStore {
  inject(key: string, prompt: string, order?: number, sticky?: number, uid?: string): void
  get(key: string, postprocess?: unknown): string
  has(key: string): boolean
}

interface StoredInjection {
  readonly key: string
  readonly prompt: string
  readonly order: number
  readonly sticky: number
  readonly uid: string
  /** 写入序号：order 相同时用它保持「先写的在前」的稳定顺序 */
  readonly seq: number
}

// ---- 上限（越限静默丢弃，见文件头约束 ③）----
/** key 最长字符数（超出视为调用方出错/恶意，直接不记） */
const MAX_KEY_CHARS = 256
/** 单条注入正文最长字符数 */
const MAX_PROMPT_CHARS = 256 * 1024
/** 单次 pass 内最多条目数（超出后新条目不再接收；同 uid 的覆盖不受此限） */
const MAX_ENTRIES = 512

/** 宽松转字符串：非字符串输入按 ST 侧惯例 stringify，null/undefined → 空串 */
function toText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  return String(value)
}

/** 应用 postprocess：`[{search, replace}, …]` 按序整串替换；形状不对的条目跳过 */
function applyPostprocess(value: string, postprocess: unknown): string {
  if (!Array.isArray(postprocess)) return value
  let out = value
  for (const item of postprocess) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const rec = item as { search?: unknown; replace?: unknown }
    if (typeof rec.search !== 'string' || typeof rec.replace !== 'string') continue
    if (rec.search === '') continue // 空搜索串会让 replaceAll 无限插入，必须挡掉
    out = out.replaceAll(rec.search, rec.replace)
  }
  return out
}

/** 创建一个只活一次生成 pass 的注入暂存区 */
export function createPromptInjectionStore(): PromptInjectionStore {
  const items: StoredInjection[] = []
  let nextSeq = 0

  const normKey = (key: unknown): string => toText(key).trim()

  return {
    inject(key, prompt, order = 100, sticky = 0, uid = '') {
      const k = normKey(key)
      if (k === '' || k.length > MAX_KEY_CHARS) return
      const text = toText(prompt)
      if (text.length > MAX_PROMPT_CHARS) return
      const ord = Number.isFinite(order) ? Math.trunc(order) : 100
      const stk = Number.isFinite(sticky) ? Math.max(0, Math.trunc(sticky)) : 0
      const id = toText(uid)

      // 有 uid ⇒ 视为「同一条的更新」：保留原写入序号（不因更新而改变同 order 下的相对位次）
      if (id !== '') {
        const at = items.findIndex(it => it.key === k && it.uid === id)
        if (at >= 0) {
          items[at] = { key: k, prompt: text, order: ord, sticky: stk, uid: id, seq: items[at]!.seq }
          return
        }
      }
      if (items.length >= MAX_ENTRIES) return
      items.push({ key: k, prompt: text, order: ord, sticky: stk, uid: id, seq: nextSeq++ })
    },

    get(key, postprocess) {
      const k = normKey(key)
      const joined = items
        .filter(it => it.key === k)
        .sort((a, b) => (a.order - b.order) || (a.seq - b.seq))
        .map(it => it.prompt)
        .join('\n')
      return applyPostprocess(joined, postprocess)
    },

    has(key) {
      const k = normKey(key)
      return items.some(it => it.key === k)
    },
  }
}
