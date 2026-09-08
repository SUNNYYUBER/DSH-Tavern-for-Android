/**
 * 酒馆助手脚本库 → 会话执行清单——纯逻辑（可单测）。
 *
 * 数据形态（ST 酒馆助手预设/角色脚本库导出，backfill-assets 落盘）：
 *   rp/<slug>/tavern-helper-scripts.json          卡（character）作用域
 *   rp-presets/<presetId>/tavern-helper-scripts.json 预设作用域
 *   { scripts: [ Script | ScriptFolder ] }
 *   Script       = { type:'script', id, name, enabled, content, info?, button:{enabled, buttons:[{name,visible}]}, data }
 *   ScriptFolder = { type:'folder', id, name, enabled, scripts: Script[] }
 *
 * 会话有效预设解析（与 dsh-plugin resolveSessionPresetId 同款语义）：
 *   rp/state/<sid>.json 的 presetId 键（历史扁平 MVU 裸树兼容：无保留键 = 无 presetId）
 *   → 缺省回落最近 rp-import 批次 settings.json 的 oai_settings.preset_settings_openai
 *     按 displayName 匹配 rp-presets（ST 激活预设全局生效语义）。
 */
/** state 文件形状保留键（与 dsh-plugin STATE_RESERVED_KEYS 对齐） */
export declare const STATE_RESERVED_KEYS: Set<string>;
/** 脚本库条目（原始形态，宽松） */
export interface RawScriptEntry {
    type?: unknown;
    id?: unknown;
    name?: unknown;
    enabled?: unknown;
    content?: unknown;
    info?: unknown;
    button?: unknown;
    data?: unknown;
    scripts?: unknown;
}
/** 归一后的可执行脚本（for-session 响应元素） */
export interface SessionScript {
    id: string;
    name: string;
    content: string;
    /** button.enabled === true */
    buttonEnabled: boolean;
    buttons: Array<{
        name: string;
        visible: boolean;
    }>;
    /** 脚本私有变量树（script 作用域种子） */
    data: Record<string, unknown>;
    source: 'preset' | 'character';
}
/**
 * 摊平脚本库（folder 递归一层语义；ST 导出只嵌一层 folder）。
 * 仅收 enabled !== false 的脚本（disabled 不执行）；folder disabled = 整组禁用。
 */
export declare function flattenScriptLibrary(raw: unknown, source: SessionScript['source']): SessionScript[];
/**
 * 合并预设 + 卡两作用域（ST 顺序：预设脚本先执行，角色脚本后执行）。
 * id 冲突时后源（character）覆盖前源（preset）——与酒馆助手 id 唯一化语义一致。
 */
export declare function mergeSessionScripts(presetRaw: unknown, characterRaw: unknown): SessionScript[];
/**
 * 从 rp/state/<sid>.json 文件对象提取 presetId。
 * 历史扁平 MVU 裸树（无保留键）= 无 presetId（整树是 variables，不含会话元信息）。
 */
export declare function presetIdFromStateFile(file: unknown): string | null;
/**
 * 批次 settings.json → ST 激活预设名（oai_settings.preset_settings_openai）。
 * 返回 null = 该批次无有效激活预设名。
 */
export declare function activePresetNameFromSettings(raw: unknown): string | null;
/** rp-presets 清单（{id, displayName}）按 ST 激活预设名匹配 → presetId（null = 未匹配） */
export declare function matchPresetByDisplayName(presets: Array<{
    id: string;
    displayName?: unknown;
}>, activeName: string | null): string | null;
/** lodash 风格变量路径（a.b[0].c / a["b"]）→ JSONPointer（/a/b/0/c） */
export declare function lodashPathToPointer(path: string): string;
