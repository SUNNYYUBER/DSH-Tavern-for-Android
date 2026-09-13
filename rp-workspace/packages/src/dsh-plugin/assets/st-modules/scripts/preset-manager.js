/**
 * ./scripts/preset-manager.js —— ST 预设管理器接口的**兼容实现**（T-63）
 * ============================================================================
 * 卡的取用面（tmp/t37-inject.js:2228-2231 + `:539-560`）只 import 一个符号：
 *   `getPresetManager`，并调用它的：
 *     `manager.getCompletionPresetByName(name)`  → 取预设对象（卡按它做改名判定）
 *     `manager.getAllPresets()`                → 全部预设
 *     `manager.getSelectedPresetName()`        → 当前选中预设名
 *     `manager.savePreset(name, preset, {skipUpdate})`
 *     `manager.deletePreset(name)`
 *     `manager.updateList(name, preset)`
 * 数据源 = 我方既有 TH 数据面（`/dsht-tavern-helper/preset/*`），**复用既有实现、不另写一份**
 * （纪律：同一语义多副本 = 假修；预设读写早已由 facade 落地，本模块只做**契约适配**）。
 *
 * 【实现性质】接口对齐 + 独立实现：方法名与调用契约按互操作需要对齐 ST 公开面，
 * 实现为本项目自行编写（内部只是对既有 HD 数据面的 HTTP 适配）。
 *
 * 【可观测契约】`getPresetManager(apiId)` 返回 **per-api 单例**（同一 apiId 恒返回同一实例）；
 * 本项目只服务 `'openai'`（聊天补全）——其余 apiId 返回 `undefined`
 * （与"未注册的 api 上没有 manager"的语义一致）。
 */

const DSHT_TAVERN_HELPER = '/dsht-tavern-helper'

/** 会话 id（ST 脚本语境里"当前会话"= 载入的 RP 工作区）；取不到则空串（facade 会兜底活跃预设） */
function currentSessionId() {
  try {
    const ctx = globalThis.SillyTavern && globalThis.SillyTavern.getContext
      ? globalThis.SillyTavern.getContext()
      : null
    const v = ctx && (ctx.getCurrentChatId ? ctx.getCurrentChatId() : ctx.chatId)
    return typeof v === 'string' ? v : ''
  } catch { return '' }
}

async function call(path, payload) {
  const res = await fetch(`${DSHT_TAVERN_HELPER}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await res.json()
  if (body && body.error) throw new Error(String(body.error))
  return body
}

/**
 * 预设名 → presetId（facade 侧 `/preset/get` 已内含 `'in_use'` 哨兵与 displayName 精确匹配）。
 * 取不到返回 null（**不抛**——卡的调用点全带 `?.` 与 `if (!manager) return` 守卫，
 * 抛错反而会打断 `finishRename` 的 await 链）。
 */
async function presetIdOf(name) {
  try {
    const r = await call('preset/get', { name, sessionId: currentSessionId() })
    if (!r || r.found !== true) return null
    const listed = await call('preset/names', { sessionId: currentSessionId() })
    void listed
    return typeof r.presetId === 'string' ? r.presetId : (r.preset && r.preset.identifier) || null
  } catch { return null }
}

/** 把 facade 的 `{name, prompts, prompt_order}` 还原成 ST 预设对象形状（卡按字段名读取） */
function toStPreset(name, view) {
  const preset = {
    name,
    prompts: Array.isArray(view && view.prompts) ? view.prompts : [],
    prompt_order: Array.isArray(view && view.prompt_order) ? view.prompt_order : [],
  }
  return preset
}

class PresetManager {
  constructor(apiId) {
    this.apiId = apiId
    this._cache = null
  }

  /** 基准 `:376` 同义：全部预设（name → 预设对象） */
  async getAllPresets() {
    try {
      const names = await call('preset/names', { sessionId: currentSessionId() })
      const list = Array.isArray(names && names.names) ? names.names : []
      const out = {}
      for (const n of list) {
        const one = await this.getCompletionPresetByName(n)
        if (one) out[n] = one
      }
      return out
    } catch (e) {
      console.warn('[dsht-st-module] getAllPresets 失败：', e && e.message)
      return {}
    }
  }

  /** 基准 `:750` 同义：按名取预设对象；不存在返回 null */
  async getCompletionPresetByName(name) {
    try {
      const r = await call('preset/get', { name, sessionId: currentSessionId() })
      if (!r || r.found !== true || !r.preset) return null
      return toStPreset(r.preset.name != null ? r.preset.name : name, r.preset)
    } catch (e) {
      console.warn('[dsht-st-module] getCompletionPresetByName 失败：', e && e.message)
      return null
    }
  }

  /** 基准 `:403`：当前选中预设名 */
  async getSelectedPresetName() {
    try {
      const r = await call('preset/names', { sessionId: currentSessionId() })
      return typeof (r && r.loaded) === 'string' ? r.loaded : ''
    } catch { return '' }
  }

  /** 基准 `:395`：当前选中预设对象 */
  async getSelectedPreset() {
    const n = await this.getSelectedPresetName()
    return n ? this.getCompletionPresetByName(n) : null
  }

  /** 基准 `:466`：保存预设（我方走 facade 的 identifier 锚定合并） */
  async savePreset(name, settings, _options = {}) {
    const preset = settings && typeof settings === 'object' ? settings : {}
    await call('preset/put', {
      name,
      prompts: Array.isArray(preset.prompts) ? preset.prompts : [],
      prompt_order: Array.isArray(preset.prompt_order) ? preset.prompt_order : [],
      create: true,
      sessionId: currentSessionId(),
    })
    return true
  }

  /** 基准 `:778`：删除预设 */
  async deletePreset(name) {
    await call('preset/delete', { name, sessionId: currentSessionId() })
    return true
  }

  /** 基准 `:602`：把预设并入列表缓存（我方无本地缓存，仅按 savePreset 落盘） */
  async updateList(name, preset) {
    await this.savePreset(name, preset, { skipUpdate: true })
    return true
  }
}

/** 基准 `:83` 同款：按 apiId 记忆化（同一 apiId 恒返回同一实例） */
const managers = new Map()
export function getPresetManager(apiId = '') {
  // 基准只对已注册 api 返回 manager；'openai' 之外本项目无对应后端（与 DSHT_MAIN_API 单源一致）
  if (apiId !== 'openai') return undefined
  if (!managers.has(apiId)) managers.set(apiId, new PresetManager(apiId))
  return managers.get(apiId)
}

/** 基准 `:986` registerPresetManagers 的等价物（本项目只有 openai；提供以满足可能的调用） */
export function registerPresetManagers() {
  getPresetManager('openai')
}
