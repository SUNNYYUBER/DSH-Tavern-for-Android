/**
 * TH API 支持状态清单（**单一权威**）——【D1 2026-09-13】
 *
 * 用途：让「这张卡能不能跑」在**导入预览阶段**就能告知用户，而不是等脚本跑起来后
 * 才在 🧩 面板看到「缺 API」。
 *
 * 为什么放在 shared 层：清单需要被**两侧**消费 ——
 *   · `dsht-rp-ui/th-shim.ts`（客户端 shim，决定运行时拒绝哪些 API）
 *   · `dsh-plugin/import-preview.ts`（node 侧导入预览，静态扫卡内脚本做预检）
 * 放这里可避免「同一语义第二份实现」（项目铁律）。
 *
 * ⚠️ 此处是**唯一权威**：`th-shim.ts` 从本文件再导出（`UNSUPPORTED_APIS`），不再自持副本。
 * 消费方（客户端 shim + node 侧导入预览）都指向本文件，故不存在漂移，无需另设一致性判据。
 */

/**
 * 记名拒绝的 TH API（调用即 reject + 出声）。
 * 分类见各段注释；来源 = `dsht-rp-ui/th-shim.ts` 的 UNSUPPORTED_APIS（已同步）。
 */
export const TH_UNSUPPORTED_APIS = [
  // 生成控制（钩 ST 生成管线；一次性补全除外）
  'stopAllGeneration', 'stopGenerationById', 'getModelList', 'getProxyPresetNames',
  // 聊天消息写路径（改/删/轮转仍记名拒绝；append/update 已走会话写桥）
  'setChatMessage', 'deleteChatMessages', 'rotateChatMessages',
  'formatAsDisplayedMessage', 'retrieveDisplayedMessage', 'refreshOneMessage',
  // 世界书写 API（读路径与世界书写面桥已支持）
  'getLorebooks', 'getCharLorebooks', 'getChatLorebook', 'getOrCreateChatLorebook', 'setChatLorebook',
  'createLorebook', 'deleteLorebook', 'getLorebookSettings', 'setLorebookSettings', 'setCurrentCharLorebooks',
  'createLorebookEntry', 'createLorebookEntries', 'deleteLorebookEntry',
  'deleteLorebookEntries', 'setLorebookEntries', 'updateLorebookEntriesWith',
  // 角色卡 / 人设 CRUD
  'getCharacterNames', 'getCharacterIds', 'getCharacter', 'getCurrentCharacterId', 'getCurrentCharacterName',
  'createCharacter', 'createOrReplaceCharacter', 'deleteCharacter', 'replaceCharacter', 'updateCharacterWith',
  'getPersonaNames', 'getPersona', 'createPersona', 'createOrReplacePersona', 'deletePersona', 'replacePersona',
  // 宏（类宏注册）
  'registerMacroLike', 'unregisterMacroLike',
  // 音频清单/播放器控制面（audio.bgm/ambient 基础播放已实现）
  'getAudioList', 'appendAudioList', 'replaceAudioList', 'playAudio', 'pauseAudio', 'getCurrentAudio',
  'getAudioSettings', 'setAudioSettings',
  // 扩展管理 / 导入 / 杂项
  'isAdmin', 'installExtension', 'uninstallExtension', 'updateExtension', 'reinstallExtension',
  'isInstalledExtension', 'getExtensionType', 'getExtensionInstallationInfo',
  'importRawCharacter', 'importRawChat', 'importRawPreset', 'importRawTavernRegex', 'importRawWorldbook',
  'getScriptTrees', 'replaceScriptTrees', 'updateScriptTreesWith',
  'getAllEnabledScriptButtons', 'writeExtensionField', 'updateTavernHelper',
] as const

const UNSUPPORTED_SET = new Set<string>(TH_UNSUPPORTED_APIS)

/** 单个 API 的预检结果 */
export interface ThApiUsage {
  /** API 名（如 getLorebooks） */
  api: string
  /** 该卡在几处用到（出现次数） */
  count: number
  /** 是否支持（false = 会记名拒绝） */
  supported: boolean
}

/**
 * 从一段脚本文本中提取「用到的 TH API」并标注支持状态。
 *
 * 判据（保守，宁可少报不误报）：
 *  - 只认**明确的调用形态**：`apiName(` 或 `TavernHelper.apiName(` 或 `TH.apiName(`
 *  - 只统计已知 API（内置清单 = UNSUPPORTED + 常见已支持面），避免把用户自定义函数名当 API
 *
 * 为什么不解析 AST：卡内脚本可能是任意 JS（含 ES2020+ 语法、被压缩过的代码），
 * 引入 parser 会显著增加体积与失败面；正则匹配对「预检提示」这个用途已足够。
 */
export function scanThApiUsage(scriptText: string): ThApiUsage[] {
  if (typeof scriptText !== 'string' || scriptText.length === 0) return []
  const counts = new Map<string, number>()
  // 匹配 `名称(` 形态；名称限定为字母开头的标识符
  const re = /(?:TavernHelper|TH|SillyTavern)?\.?([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(scriptText)) !== null) {
    const name = m[1]
    if (KNOWN_TH_APIS.has(name)) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return [...counts.entries()].map(([api, count]) => ({ api, count, supported: !UNSUPPORTED_SET.has(api) }))
    .sort((a, b) => (a.supported === b.supported ? a.api.localeCompare(b.api) : a.supported ? 1 : -1))
}

/** 已知 TH API 全集（不支持 + 常见支持面）——用于降低误报 */
const KNOWN_TH_APIS: ReadonlySet<string> = new Set<string>([
  ...TH_UNSUPPORTED_APIS,
  // 常见**已支持**面（自 th-shim 的 SHIM_LOCAL_APIS / SHIM_BRIDGE_APIS 摘取高频项）
  'getContext', 'getChatMessages', 'setChatMessages', 'createChatMessages',
  'getVariables', 'replaceVariables', 'insertOrAssignVariables', 'deleteVariable',
  'getWorldbook', 'getLorebookEntries', 'replaceLorebookEntries',
  'generate', 'generateRaw', 'triggerSlash', 'substitudeMacros',
  'eventOn', 'eventOnce', 'eventEmit', 'eventRemoveListener', 'eventSource',
  'getTavernRegexes', 'replaceTavernRegexes', 'formatAsTavernRegexedString',
  'getPresetNames', 'getPreset', 'createOrReplacePreset', 'deletePreset',
  'getCharWorldbookNames', 'rebindCharWorldbooks', 'rebindGlobalWorldbooks',
  'getAudioSettings', 'playAudio',
  'toastr', 'getRequestHeaders', 'getTokenCountAsync',
])
