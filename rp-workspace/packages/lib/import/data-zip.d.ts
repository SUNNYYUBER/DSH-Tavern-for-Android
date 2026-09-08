/**
 * DSHTavern data 整包迁移引擎——浏览器版（计划 §4.16.1 六阶段流水线的 M1 分析层）
 *
 * 输入：ST data 文件夹的 zip 压缩包
 * 阶段 0 预检：解包 + 结构识别（data/<user>/ | data/ | 裸文件）+ 清单
 * 阶段 1 资源入库：worlds/characters/presets/chats 全量解析（引擎复用）
 * 阶段 2 关系重建：卡→书引用配对、globalSelect 全局书单、chats 目录→角色归属
 * 阶段 3 逐项分类：跳过（LLM 层，M2）
 * 阶段 4 聊天分析：chat_metadata 提取（变量/绑定书/persona）
 * 阶段 5 全局设置：world_info_settings / persona / tags
 * 阶段 6 报告：全清单 + 配对率 + 待认领 + 警示
 *
 * M1 测试版范围：只分析不入库（持久化在 M2 接后端）。
 */
import JSZip from 'jszip';
import { type LoreBook } from '../lore/entry.ts';
import { type CharacterCard } from './character-card.ts';
export interface DataImportSession {
    zip: JSZip;
    root: string;
    worlds: Map<string, LoreBook>;
    characters: CharacterCard[];
    /** chats/ 下全部 .jsonl 路径（含角色目录名，转换时懒读） */
    chatFiles: Array<{
        path: string;
        ownerDir: string;
    }>;
    report: ZipMigrationReport;
}
/** 取最近一次 analyzeDataZip 的会话缓存（页面刷新即失效；转换前调用） */
export declare function lastDataImport(): DataImportSession | null;
/** R8：从 settings.json power_user 提取的一个用户 persona */
export interface ImportedPersona {
    name: string;
    description: string;
    isDefault: boolean;
    /** power_user.personas 映射的 avatar 文件名（如 user-default.png） */
    avatar: string | null;
}
export interface ZipMigrationReport {
    /** 识别的根路径（如 "data/default-user"） */
    rootPath: string;
    /** 各类资源统计 */
    stats: {
        characters: number;
        charactersFailed: number;
        worldBooks: number;
        loreEntries: number;
        presets: number;
        chats: number;
        chatFilesAnalyzed: number;
        quickReplies: number;
        themes: number;
        backgrounds: number;
        skippedFiles: number;
    };
    /** 关系重建结果 */
    relations: {
        /** 卡→外部书引用，配对成功的 */
        cardWorldPairs: Array<{
            card: string;
            world: string;
        }>;
        /** 卡引用了但 zip 里没有的书 */
        cardWorldMissing: Array<{
            card: string;
            world: string;
        }>;
        /** chats/ 目录名与角色卡对上的 */
        chatOwnerPairs: Array<{
            character: string;
            chatCount: number;
        }>;
        /** 对不上角色的聊天目录（待认领） */
        chatOrphans: Array<{
            dir: string;
            chatCount: number;
        }>;
        /** settings.globalSelect 全局启用书 */
        globalSelectedBooks: string[];
        /** 全局启用但 zip 缺失的书 */
        globalSelectedMissing: string[];
        /** 配对率（0-100） */
        pairingRate: number;
    };
    /** 全局设置提取 */
    settings: {
        scanDepth: number | null;
        budgetPercent: number | null;
        caseSensitive: boolean | null;
        matchWholeWords: boolean | null;
        personaName: string | null;
        /** 用户档案描述（§4.4：personaDescription——组装走 persona 槽位） */
        personaDescription: string | null;
        /** R8：power_user 三处提取的全部 persona（默认 persona 在首位语义由 isDefault 标记） */
        personas: ImportedPersona[];
    };
    /** 复合卡拆解汇总 */
    compositeCards: Array<{
        name: string;
        embeddedBookEntries: number;
        embeddedRegexCount: number;
        hasDepthPrompt: boolean;
        externalWorldRef: string | null;
    }>;
    /** 警示（弃用特性/解析失败） */
    warnings: string[];
}
/**
 * R8：persona 三处读取（真实 ST 实证：persona 在 power_user 下，不在顶层）。
 * - power_user.personas：{avatar文件名: 名字} 映射
 * - power_user.persona_descriptions：{名字: 描述字符串} 或 {名字: {description}}（两种形态兼容）
 * - power_user.default_persona：默认 persona 的 avatar key 或名字（两种形态兼容）
 * 向后兼容：power_user 缺失时回退旧路径（顶层 persona_descriptions[persona_id]）。
 */
export declare function extractPersonas(sj: Record<string, unknown>): ImportedPersona[];
/**
 * 分析 data zip（六阶段的浏览器分析版）。
 * @param zipData zip 二进制
 * @param onProgress 进度回调（阶段号 0-6，描述，总进度百分比 0-100）
 */
export declare function analyzeDataZip(zipData: ArrayBuffer, onProgress?: (stage: number, desc: string, percent: number) => void): Promise<ZipMigrationReport>;
