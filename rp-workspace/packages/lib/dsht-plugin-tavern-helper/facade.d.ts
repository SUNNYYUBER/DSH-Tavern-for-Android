/**
 * 酒馆助手 API 服务端门面路由——数据面真路由实现（原记名拒绝项的落地）。
 *
 * 纯函数族设计：resolveDshHome 的 $DSH_HOME 环境变量不可按调用注入，故所有
 * 处理函数显式接收 dshHome 首参（index.ts 闭包传入），IO 之外的转换逻辑全可单测。
 *
 * 数据面（$DSH_HOME 布局）：
 * - 预设：rp-presets/<id>/preset.json（RPPreset：slots + toggles + sampling 等；id/displayName）
 * - 正则：global = rp/regex/global.json（{scripts:[]}）；character = rp/<slug>/rp.json 的 regex 键；
 *   preset = rp-presets/<id>/regex.json（{scripts:[]}）——脚本对象即 ST RegexScript 形状
 * - 世界书：skills 下 wb-* 目录的 references/lore.json（LoreBook）+ rp/global-books.json（{books:[{name,lorePath}]}）
 * - 会话状态：rp/state/<sessionId>.json（presetId 键；历史扁平 MVU 裸树兼容）
 * - 会话消息：sessions/<projectKey>/<sid>/session.jsonl（首行 header + {type,seq,data} 事件行）
 *
 * 写文件前统一走 snapshotBeforeWrite 快照（归属会话尽量解析——有 sessionId 才记；
 * 解析不到 turn 锚点/快照失败都不阻塞写）。
 *
 * 诚实边界：扩展管理/importRaw*、persona/character CRUD、聊天消息写路径等不做——
 * index.ts 维持记名拒绝（404），不在本文件实现。generate/generateRaw 不在本文件（C9：
 * index.ts 的 /generate loopback 转发 dsh-plugin /dsht-rp/llm/classify）。
 */
import { type RPPreset } from '../preset/schema.ts';
import { type LoreEntry } from '../lore/entry.ts';
/** ST 预设条目（chatCompletionSettings.prompts 元素；ST OpenAI Settings prompts 形状） */
export interface StPrompt {
    identifier: string;
    name: string;
    role: string;
    content: string;
    system_prompt: boolean;
    marker: boolean;
    injection_position: number;
    injection_depth: number;
}
/** ST prompt_order（character_id 100001 = 通用档） */
export interface StPromptOrder {
    character_id: number;
    order: Array<{
        identifier: string;
        enabled: boolean;
    }>;
}
/** ST 聊天消息（getChatMessages 形态） */
export interface StMessage {
    message_id: number;
    /** L1a：事件 seq（TH 事件桥楼层解析锚 + P3a setChatMessages replace 目标定位；可选——老版本导出没有） */
    seq?: number;
    name: string;
    /** P3a：TH 写桥系统楼层（source.thSystem）导出为 'system' */
    role: 'user' | 'assistant' | 'system';
    message: string;
    is_system: boolean;
    /** P3a：楼层附加数据（source.thData）——卡脚本回读（飞讯 is_feixun_record 等靠它定位） */
    data?: unknown;
}
/** 世界书清单条目 */
export interface WorldbookListItem {
    name: string;
    lorePath: string;
}
/** 门面处理结果（index.ts 统一 sendJson(r.status, r.body)） */
export interface FacadeResult {
    status: number;
    body: Record<string, unknown>;
}
/**
 * RPPreset → ST 预设视图 { prompts, prompt_order }：
 * - slots → StPrompt（depth 有值 = injection_position 1 绝对深度注入；marker 槽 system_prompt=false）
 * - toggles 每个 option → `toggle-<group>-<option>` 条目（system 注入位）
 * - prompt_order 单档 character_id 100001，按上面顺序全量列出：
 *   enabled = slot.enabled / option.selected（选一组里非 selected 的也列出 enabled:false）
 */
export declare function buildStPromptView(preset: RPPreset): {
    prompts: StPrompt[];
    prompt_order: StPromptOrder[];
};
/** rp-presets 清单项 */
export interface PresetFileEntry {
    id: string;
    displayName: string;
    preset: RPPreset;
}
/** rp-presets/<id>/preset.json 清单（坏 preset.json 跳过；按 id 排序稳定输出） */
export declare function listPresets(dshHome: string): Promise<PresetFileEntry[]>;
/**
 * 会话有效预设解析（与 index.ts /scripts/for-session 同款语义）：
 * rp/state/<sid>.json 的 presetId 键（presetIdFromStateFile，历史扁平 MVU 裸树 = 无 presetId）
 * → 缺省回落最近 rp-import 批次 settings.json 的 ST 激活预设名，按 displayName 匹配 rp-presets。
 */
export declare function resolveSessionPresetId(dshHome: string, sessionId: string): Promise<string | null>;
/** displayName 精确匹配 → presetId（matchPresetByDisplayName 语义；null = 未匹配） */
export declare function presetIdByName(dshHome: string, name: string): Promise<string | null>;
/** 预设名 → 新建 preset id（[a-z0-9][a-z0-9-]*，与既有 preset id / rp-import 批次约定一致） */
export declare function slugifyPresetId(name: string): string;
export declare function context(dshHome: string, body: Record<string, unknown>): Promise<FacadeResult>;
/** POST /preset/names {sessionId?} → { names, loaded } */
export declare function presetNames(dshHome: string, body: Record<string, unknown>): Promise<FacadeResult>;
/** POST /preset/get {name, sessionId?} → { found, preset: { name, prompts, prompt_order } } */
export declare function presetGet(dshHome: string, body: Record<string, unknown>): Promise<FacadeResult>;
/**
 * POST /preset/export {name, sessionId?} → { name, json }（预设分享导出）。
 * json = ST「OpenAI Settings」兼容视图（prompts/prompt_order 走 /context 同款
 * buildStPromptView；预设作用域正则还原为 ST extensions.regex_scripts——字段一一
 * 对应，可直接经「导入 ST 预设」回灌，分享闭环）。
 */
export declare function presetExport(dshHome: string, body: Record<string, unknown>): Promise<FacadeResult>;
/**
 * POST /preset/put {name, prompts, prompt_order, create?, sessionId?} → identifier 锚定合并。
 * 不整体覆盖（保住 knowledge/budget/model/sampling/skill 槽），逐 StPrompt 归位：
 * 1. identifier 精确匹配现有 slot.id → 更新 content/enabled/depth/role（marker 槽只动 enabled）；
 * 2. `toggle-<group>-<option>` → 更新 option.content / option.selected(=enabled)；
 * 3. name 字段匹配 marker 槽位也认（ST marker identifier 与我方槽位名不一致时靠 name 对上）；
 * 4. 都没匹配上的非 marker 条目 → 追加新 system 槽（id 去重化）。
 */
export declare function presetPut(dshHome: string, body: Record<string, unknown>): Promise<FacadeResult>;
/** POST /preset/delete {name} → 删 rp-presets/<id> 目录 → {ok} */
export declare function presetDelete(dshHome: string, body: Record<string, unknown>): Promise<FacadeResult>;
/** POST /preset/rename {name, newName} → 改 displayName → {ok} */
export declare function presetRename(dshHome: string, body: Record<string, unknown>): Promise<FacadeResult>;
/**
 * POST /preset/load {sessionId, name} → 解析 id，写 rp/state/<sid>.json 的 presetId（保留其他键）。
 * 历史扁平 MVU 裸树兼容：文件没有任何保留键且非空 = 整树是 variables（MVU 裸树），
 * 包成 { variables: 原树 } 再写 presetId（与 dsh-plugin STATE_RESERVED_KEYS 逻辑对齐）。
 */
export declare function presetLoad(dshHome: string, body: Record<string, unknown>): Promise<FacadeResult>;
/**
 * 会话消息 → StMessage[]（只读）：
 * scanSessionHeaders 定位 session.jsonl → readline 流式逐行（大日志不整读），
 * 解析 user/message / assistant/message 事件（data 形状见 session-surgery findLastUserMessage：
 * user = Message 本体，assistant = {turn, step, message}）；快照注入不进导出。
 * 【P3a 2026-09-07】TH 写桥消息：source.thSystem → role:'system'/is_system:true/name:'System'
 * （ST createChatMessages 系统楼层同形）；source.thData → data 字段（卡脚本回读楼层附加数据，
 * 飞讯统合记录靠它定位 is_feixun_record）。thSystem 空文本保留（isHide 隐藏楼层数据仍需回读）；
 * 非 thSystem 空文本跳过。编号与 dsh-plugin /rp/chat/update 的 message_id→seq 映射同构（两处
 * 过滤规则必须一致，改动需同步）。
 */
export declare function chatMessages(dshHome: string, body: Record<string, unknown>): Promise<FacadeResult>;
/** POST /regexes/get {slug?, sessionId?} → 三源合并 { regexes, presetId, slug }（global → character → preset） */
export declare function regexesGet(dshHome: string, body: Record<string, unknown>): Promise<FacadeResult>;
/**
 * POST /regexes/replace {regexes, scope, slug?, sessionId?, presetId?} → 整组替换语义。
 * global → rp/regex/global.json；character → rp/<slug>/rp.json 的 regex 键；
 * preset → rp-presets/<presetId>/regex.json（presetId 缺省时从 sessionId 解析会话有效预设）。
 */
export declare function regexesReplace(dshHome: string, body: Record<string, unknown>): Promise<FacadeResult>;
/** 扫 skills 下 wb-* 目录的 references/lore.json + rp/global-books.json（lorePath 去重） */
export declare function worldbookList(dshHome: string, _body: Record<string, unknown>): Promise<FacadeResult>;
/** LoreEntry → ST World Info entry 形状（uid = 数组下标，entry-put 锚定用）。
 * 附带 TH LorebookEntry 别名：name（= comment，卡脚本读 e.name 找 [initvar]/[opening]）、
 * enabled（TH 读面字段）；key/keysecondary 恒为数组（源文件可能缺 keys 字段）。 */
export declare function loreEntryToSt(entry: LoreEntry, uid: number): Record<string, unknown>;
export declare function stEntryToLore(st: Record<string, unknown>, bookName: string, id: string): LoreEntry;
export declare function worldbookGet(dshHome: string, body: Record<string, unknown>): Promise<FacadeResult>;
export declare function flushEntryPuts(dshHome: string, lorePath: string): Promise<void>;
export declare function worldbookEntryPut(dshHome: string, body: Record<string, unknown>): Promise<FacadeResult>;
/**
 * 端点 14：POST /variables/merge {sessionId, variables} → 变量深合并写入（C7：
 * shim insertOrAssignVariables chat 作用域的服务端语义——incoming 覆盖既有叶值，对象递归）。
 * 整树 variableSchema 存在时先做 D7 最小子集校验（422 {error, issues} 不落盘不记 undo）；
 * 内容变化时写前 undo 日志 + 文件快照（与 /dsht-mvu/variables/register 同款收口）。
 */
export declare function variablesMerge(dshHome: string, body: Record<string, unknown>): Promise<FacadeResult>;
/**
 * 端点 15：POST /variables/schema {sessionId, name?, variableSchema} → C7 registerVariableSchema
 * 数据面：zod 风格 schema（shim 侧经 zod v4 toJSONSchema 转换后过桥）落 rp/state 的 variableSchema。
 * name 给出 = 逐名子 schema（合成 {type:'object', properties:{[name]:…}} 并入既有整树 schema，
 * 使 D7 对后续写入自然生效）；name 空 = 整树 schema 直接替换。注册即校验既有值（不匹配 422；
 * 该键尚未写入时不拦——允许先立 schema 后补值）。
 */
export declare function variableSchemaRegister(dshHome: string, body: Record<string, unknown>): Promise<FacadeResult>;
/**
 * 端点 16：POST /worldbook/replace-entries {name, entries, sessionId?} → 世界书条目整表替换
 * （replaceLorebookEntries 数据面）：ST World Info entry 形状数组逐条 stEntryToLore 反转换
 * 后整体覆盖 lore.json 的 entries（与 entry-put 的锚定合并不同——这是整表替换语义）。
 */
export declare function worldbookReplaceEntries(dshHome: string, body: Record<string, unknown>): Promise<FacadeResult>;
/**
 * 端点 17：POST /worldbook/rebind-global {books: name[], sessionId?} → 全局激活书单整组重绑
 * （rebindGlobalWorldbooks 数据面）：书名逐个定位后整组替换 rp/global-books.json 的 books。
 */
export declare function worldbookRebindGlobal(dshHome: string, body: Record<string, unknown>): Promise<FacadeResult>;
/**
 * 端点 18：POST /worldbook/rebind-char {slug, books: name[], sessionId?} → 角色工作区书单整组重绑
 * （rebindCharWorldbooks 数据面）：rp/<slug>/rp.json 的 books 数组整组替换（保留其余键）。
 */
export declare function worldbookRebindChar(dshHome: string, body: Record<string, unknown>): Promise<FacadeResult>;
/**
 * 端点 19：POST /worldbook/chat-get-or-create {sessionId} → 会话绑定世界书缺则建
 * （getOrCreateChatWorldbook 数据面）：确定性命名 chat-<sessionId>，文件落在
 * rp/chat-worldbooks/<sessionId>.json（LoreBook；locateBook 已扩展按名定位）——
 * 幂等：已存在直接返回 {name, created:false}。
 */
export declare function worldbookChatGetOrCreate(dshHome: string, body: Record<string, unknown>): Promise<FacadeResult>;
/** 世界书激活（ST 简化语义）：enabled +（constant 蓝灯 OR keys 扫描命中）。
 * 扫描文本 = 近段聊天 + user_input；条目 scanDepth 覆盖扫描窗（ST scan_depth 语义）。
 * 返回 before（position=BEFORE）与 after（其余位置）两段，条内按 insertionOrder 降序。 */
export declare function activateWorldInfo(entries: LoreEntry[], historyText: string, userInput: string): {
    before: string[];
    after: string[];
};
/**
 * generateRaw 装配：ordered_prompts 条目 → 段落文本（ST story string 语义，'\n' 连接）。
 * - 字符串标识符：world_info_before / persona_description / char_description /
 *   char_personality / scenario / world_info_after / dialogue_examples / chat_history /
 *   user_input（未知标识跳过——诚实缺失，不投毒 prompt）
 * - {role, content} 字面块：content 原样
 * - injects [{role?, content, depth?}]：按 depth 插入聊天历史行（depth 从历史尾部计，
 *   0 = 历史末尾；缺省 4，ST injection depth 语义）
 * - max_chat_history：历史条数上限（缺省全量）
 */
export declare function assembleGenerateRawPrompt(dshHome: string, body: Record<string, unknown>): Promise<{
    system: string;
    prompt: string;
    missing: string[];
}>;
