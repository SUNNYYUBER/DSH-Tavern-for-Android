/**
 * 独立 prompt 注入 store（per-generation）——ST-Prompt-Template 的
 * injectPrompt / getPromptsInjected / hasPromptsInjected 三件套语义移植。
 *
 * 出处：agent-loop-rp（2428139739pregnant-web/agent-loop-rp）src/ejs-template.ts
 * L70-175 `createEjsTemplatePromptInjectionStore`，MIT 许可，特此致谢。
 *
 * 设计要点（与参考一致）：
 * - store 驻留在沙箱之外的宿主侧：模板在隔离域内只能通过 __host* 桥读写，
 *   嵌套模板/批量消息渲染共享同一份 store，但宿主对象本身不暴露给沙箱；
 * - 生命周期 = 一次 prompt 生成/渲染 pass（本插件中 = 一次 /render 请求），
 *   不持久化、不跨请求泄漏；
 * - 有界：key ≤ 256 字符、单条 ≤ 256KB、总数 ≤ 512（参考实现同款上限）。
 */

export interface PromptInjectionStore {
  inject(key: string, prompt: string, order?: number, sticky?: number, uid?: string): void
  get(key: string, postprocess?: unknown): string
  has(key: string): boolean
}

interface StoredPromptInjection {
  readonly key: string
  readonly prompt: string
  readonly order: number
  readonly sticky: number
  readonly uid: string
  readonly sequence: number
}

const MAX_PROMPT_INJECTION_KEY_CHARS = 256
const MAX_PROMPT_INJECTION_CHARS = 256 * 1024
const MAX_PROMPT_INJECTIONS = 512

function injectionText(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '')
}

function applyPromptInjectionPostprocess(value: string, postprocess: unknown): string {
  if (!Array.isArray(postprocess)) return value
  let result = value
  for (const item of postprocess) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const search = record.search
    const replace = record.replace
    if (typeof search !== 'string' || typeof replace !== 'string' || search === '') continue
    result = result.replaceAll(search, replace)
  }
  return result
}

/** 创建一次生成 pass 共享的有界 store。 */
export function createPromptInjectionStore(): PromptInjectionStore {
  const entries: StoredPromptInjection[] = []
  let sequence = 0
  return {
    inject(key, prompt, order = 100, sticky = 0, uid = '') {
      const normalizedKey = injectionText(key).trim()
      if (normalizedKey === '' || normalizedKey.length > MAX_PROMPT_INJECTION_KEY_CHARS) return
      const normalizedPrompt = injectionText(prompt)
      if (normalizedPrompt.length > MAX_PROMPT_INJECTION_CHARS) return
      const normalizedOrder = Number.isFinite(order) ? Math.trunc(order) : 100
      const normalizedSticky = Number.isFinite(sticky) ? Math.max(0, Math.trunc(sticky)) : 0
      const normalizedUid = injectionText(uid)
      // 官方 uid 形态：同 key+uid 更新已有注入；无 uid 的调用保持独立条目，
      // get 时按 order 排序拼接（扩展的分组注入行为）。
      if (normalizedUid !== '') {
        const existing = entries.findIndex(item => item.key === normalizedKey && item.uid === normalizedUid)
        if (existing >= 0) {
          entries[existing] = {
            key: normalizedKey,
            prompt: normalizedPrompt,
            order: normalizedOrder,
            sticky: normalizedSticky,
            uid: normalizedUid,
            sequence: entries[existing]!.sequence,
          }
          return
        }
      }
      if (entries.length >= MAX_PROMPT_INJECTIONS) return
      entries.push({
        key: normalizedKey,
        prompt: normalizedPrompt,
        order: normalizedOrder,
        sticky: normalizedSticky,
        uid: normalizedUid,
        sequence: sequence++,
      })
    },
    get(key, postprocess) {
      const normalizedKey = injectionText(key).trim()
      const combined = entries
        .filter(item => item.key === normalizedKey)
        .sort((left, right) => left.order - right.order || left.sequence - right.sequence)
        .map(item => item.prompt)
        .join('\n')
      return applyPromptInjectionPostprocess(combined, postprocess)
    },
    has(key) {
      const normalizedKey = injectionText(key).trim()
      return entries.some(item => item.key === normalizedKey)
    },
  }
}
