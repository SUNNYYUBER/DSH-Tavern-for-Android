/**
 * DSHTavern 角色卡导入（M1 / T1.15，计划文档 §4.8 + §4.8.1）
 *
 * ST 角色卡 V1/V2/V3 解析：PNG tEXt chunk（char / ccv3 双关键字，base64 JSON）
 * + JSON 文件直读。复合卡拆解：内嵌世界书/正则/深度提示/scope 绑定（§4.8.1）。
 */
import { type LoreBook } from '../lore/entry.ts';
import { type RegexScript } from '../regex/engine.ts';
/** 角色卡解析结果（V1 顶层 + V2 data 归一） */
export interface CharacterCard {
    spec: 'chara_card_v1' | 'chara_card_v2' | 'chara_card_v3';
    name: string;
    description: string;
    personality: string;
    scenario: string;
    firstMes: string;
    alternateGreetings: string[];
    mesExample: string;
    creatorNotes: string;
    systemPrompt: string;
    postHistoryInstructions: string;
    tags: string[];
    creator: string;
    characterVersion: string;
    /** 复合卡拆解产物 */
    embeddedBook: LoreBook | null;
    embeddedRegex: RegexScript[];
    depthPrompt: {
        prompt: string;
        depth: number;
        role: 'system' | 'user' | 'assistant';
    } | null;
    /** 外部世界书引用（extensions.world——绑定关系，不复制内容） */
    externalWorldRef: string | null;
    importWarnings: string[];
    /** T3.1b 导出对称：导入时的原始 ST JSON 文本（原样保留，无损重打包 tEXt 用） */
    rawJson?: string;
    /** T3.1b 导出对称：立绘 PNG 字节（JSON 卡的配对 avatar.png；无则导出时占位兜底） */
    avatar?: Uint8Array;
    /** R2：卡来源文件名（去扩展名；chats/<目录名> 与它同名——三键匹配的第二键） */
    sourceFileName?: string;
}
/** 从 PNG 字节流解出 tEXt chunk 的 char/ccv3 关键字数据（base64 → JSON 字符串） */
export declare function extractCardJsonFromPng(bytes: Uint8Array): string | null;
/** 解析角色卡 JSON（V1 顶层字段 / V2 data 对象）为归一形态 + 复合卡拆解 */
export declare function parseCharacterCard(json: string, sourceName: string): CharacterCard | null;
/** 便捷入口：PNG 字节 → CharacterCard（T3.1b：PNG 自身即立绘，保留为 avatar） */
export declare function importCharacterPng(bytes: Uint8Array, sourceName: string): CharacterCard | null;
/** JSON 文件入口（.json 角色卡直读；无立绘——由调用方经 avatar 关联，或导出时占位兜底） */
export declare function importCharacterJson(json: string, sourceName: string): CharacterCard | null;
export interface CardBundle {
    card: CharacterCard;
    /** bundle 清单（导入中心 diff 视图直接渲染） */
    manifest: {
        character: string;
        embeddedBook: {
            name: string;
            entryCount: number;
        } | null;
        embeddedRegexCount: number;
        depthPrompt: boolean;
        externalWorldRef: string | null;
    };
}
export declare function summarizeBundle(card: CharacterCard): CardBundle;
