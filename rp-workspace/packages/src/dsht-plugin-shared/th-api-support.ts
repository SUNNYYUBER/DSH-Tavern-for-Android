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

  // ===========================================================================
  // 【W3 · 2026-09-15】真 TH 裸全局面里**此前从未覆盖**的名字（21 项）
  //
  // ## 为什么必须补（本轮根因，见 docs/L5-BARE-GLOBAL-TH-API-GAP.md 的 W3 补充节）
  // 真 TH 的裸全局机制（`JS-Slash-Runner/src/iframe/predefine.js:11-19`）把**父页
  // TavernHelper 对象的全部键**合并进脚本 iframe 的 window。那些名字在真 TH 里**存在**，
  // 而我方 shim 的静态清单里**没有** ⇒ 在 DSH 里它们是 `undefined`。
  // 脚本对它们几乎总写 `typeof X !== 'undefined'` 守卫 ⇒ **静默走 else 分支、零留痕**
  //（症状 =「这张卡的某个功能没反应」，🧩 面板里什么都没有）= 违反 B3。
  //
  // ## 取证（判据落在「真 TH 产物」而非声明面）
  // `@types/function/*.d.ts` 给出真 TH 面（141 项，逐个到 `dist/index.js` 核实运行时键）；
  // 真跑我方 shim 并枚举沙箱 window ⇒ 差集 **25 项**。其中 4 项本轮实现（见下方注释），
  // 其余 21 项**明确记名拒绝**（不再静默缺席）——「实现不了」与「假装没有」是两件事。
  //
  // ## 逐项理由（刻意按能力分类，不写空话）
  // —— 人设（DSH 无独立 persona 存储，见 facade.ts 头注的诚实边界）——
  // 注：`getPersonaIds` / `getCurrentPersonaId` / `getCurrentPersonaName` / `getPersonaAvatarPath`
  // 是**同步**返回 ⇒ 不在此清单（见下方 TH_FACE_VALUE_NAMES 的完整口径说明）。
  // —— 角色卡原始数据（DSH 的卡数据在宿主侧只读投影里，无「按名取卡」的桥面）——
  // 注：`getCharData` / `getCharAvatarPath` 同样是同步返回 ⇒ 见 TH_FACE_VALUE_NAMES。
  // —— 世界书**新代 API**（我方实现的是老代 Lorebook 面 + 部分 Worldbook 面；
  //    下列为**异步**面（返回 Promise）⇒ 挂函数 stub 与真 TH 的 typeof 形态一致 ——
  //    注：`getChatWorldbookName` 是**同步**返回 string|null ⇒ 见 TH_FACE_VALUE_NAMES。
  'rebindChatWorldbook',
  'createWorldbook', 'createOrReplaceWorldbook', 'deleteWorldbook', 'replaceWorldbook',
  'createWorldbookEntries', 'deleteWorldbookEntries',
  // —— 人设写面（真 TH = Promise<Persona>；DSH 无独立 persona 存储）——
  'updatePersonaWith',
  // —— 扩展自述（异步：真 TH 返回 Promise<ExtensionInstallationInfo|null>）——
  'getExtensionStatus',
] as const

/**
 * 【W3 · 2026-09-15】**同步**缺失名 —— 它们不能挂函数 stub，只能挂「读出声道具」。
 *
 * ## 为什么必须与 TH_UNSUPPORTED_APIS 分开（这里有一个**会改变行为**的陷阱）
 * `unsupportedStub` 返回的是一个**函数**（调用时 `Promise.reject`）。这个形态只对
 * 真 TH 里 `typeof X === 'function'` 且**返回 Promise** 的 API 是正确的。
 * 但对下面两类名字，挂函数 stub 会让**脚本走一条它本来不会走的路**：
 *
 *  ① **值型**：`default_preset`（真 TH = `Preset` 对象）/ `builtin_prompt_default_order`
 *     （真 TH = `PlaceholderPrompt[]`）。挂函数 ⇒ `typeof` 从 `'undefined'` 变 `'function'`
 *     ⇒ 守卫通过 ⇒ 脚本读 `default_preset.prompts` ⇒ undefined ⇒ **静默错误**。
 *  ② **同步函数型**：`getPersonaIds(): string[]` / `getCurrentPersonaName(): string | null` /
 *     `getCharData(): v1CharData | null` / `getWorldbookNames(): string[]` / `getMessageId(): number` …
 *     （返回值都是**同步值**，见各自的 @types）。挂 stub 后 `typeof === 'function'` ⇒ 守卫通过
 *     ⇒ 脚本 `getPersonaIds().map(…)` 拿到的是 **Promise** ⇒ `TypeError` **抛错**。
 *     —— 这比原状（走 else 分支静默降级）**更坏**：把「没用上」变成「整段崩」。
 *
 * ## 处置：挂 getter，**首次读取即出声**，返回值仍是 `undefined`
 * 行为与「不存在」**逐字相同**（`typeof X === 'undefined'`、脚本仍走 else、零语义变化），
 * 但**我方知道了**（console.warn + `th:'missing'` 信标 + 🧩 面板「缺 API」清单）。
 *
 * ## 为什么这才符合 B3（判据依据）
 * B3 要的是「未覆盖的调用**必须记名上报**，不允许静默 undefined」。本清单给的是
 * 「**保持 undefined 语义 + 记名上报**」——两半都满足；而挂函数 stub 只满足后一半，
 * 前一半会被破坏。⇒ 分类的判据是**真 TH 的返回类型**（同步/值 vs 异步函数），
 * 不是「哪个清单更方便」。
 */
export const TH_FACE_VALUE_NAMES: readonly string[] = [
  // 值型（真 TH 是对象/数组）
  'default_preset', 'builtin_prompt_default_order',
  // 同步函数型（真 TH 返回同步值，挂 stub 会因返回 Promise 而抛 TypeError）
  'getPersonaIds', 'getCurrentPersonaId', 'getCurrentPersonaName', 'getPersonaAvatarPath',
  'getCharData', 'getCharAvatarPath', 'RawCharacter',
  'getWorldbookNames', 'getGlobalWorldbookNames', 'getChatWorldbookName', 'getMessageId',
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
