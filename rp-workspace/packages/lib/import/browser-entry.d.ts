/**
 * 浏览器端入口：导入中心 WebView 页面的引擎桥
 * esbuild --format=iife --global-name=DSHT 打包后暴露 window.DSHT
 */
export { importCharacterPng, importCharacterJson, summarizeBundle } from './character-card.ts';
export { importLoreBook } from '../lore/entry.ts';
export { triggerWorldInfo, DEFAULT_TRIGGER_CONFIG } from '../lore/trigger.ts';
export { analyzeDataZip, lastDataImport } from './data-zip.ts';
export { exportToDshFiles, exportLoreBookSkill, cardPromptPersona, convertChatFile, exportSingleCardFiles, buildRpJsonContent, dshSlug, encodeSegment, sessionFilePath, chatSessionId, } from './dsh-export.ts';
export { writeCardTextChunks, exportCardBundleFiles, buildStV2Json, bytesToBase64, makePlaceholderPng, } from './card-export.ts';
export type { CharacterCard, CardBundle } from './character-card.ts';
export type { LoreBook, LoreEntry } from '../lore/entry.ts';
export type { TriggerResult, TriggerConfig } from '../lore/trigger.ts';
export type { ZipMigrationReport, DataImportSession } from './data-zip.ts';
export type { DshFile, ExportResult, ExportToDshOptions } from './dsh-export.ts';
/** 服务端 scanImportPreview 产出的分类预览（前端消费面；与服务端字段对齐） */
export interface ImportPreviewPayload {
    kind: 'st-data' | 'single-card' | 'single-book' | 'unknown';
    stRoot: string | null;
    cards: Array<{
        name: string;
        avatar: boolean;
        regexCount: number;
        hasEmbeddedWorldInfo: boolean;
        alternateGreetings: number;
        target: '新工作区' | '已存在(同名)';
        slug: string;
        sourceFile: string;
        ejs: boolean;
    }>;
    books: Array<{
        name: string;
        entryCount: number;
        target: '新 skill' | '已绑定';
        boundBy?: string[];
        sourceFile: string;
        ejsEntries: number;
    }>;
    chats: Array<{
        name: string;
        messageCount: number;
        approx: boolean;
        targetSessionId?: string;
        orphan: boolean;
        sourceFile: string;
    }>;
    presets: Array<{
        displayName: string;
        promptCount: number;
        targetPresetId?: string;
        sourceFile: string;
        ejs: boolean;
    }>;
    dropped: Array<{
        path: string;
        reason: string;
    }>;
    ejsTemplates: number;
}
/** checkpoint 摘要（/rp/import-batches 与 kickoff resumeFrom 响应同形态） */
export interface CheckpointSummary {
    stages: string[];
    doneCount: number;
    updatedAt: string;
}
/** 进度类目（GET /rp/import-progress 的 progress.categories 元素；服务端算好，前端只渲染） */
export interface ImportProgressCategory {
    name: string;
    total: number;
    done: number;
    /** 0..1；total=0 且 done>0 → 1（checkpoint 有数、manifest 没计数，前端按「N done」展示） */
    ratio: number;
}
/** 批次进度（GET /rp/import-progress?batchId= 响应的 progress 字段；
 * 与 index.ts 路由注释 / import-preview.ts buildBatchProgress 一一对应） */
export interface ImportProgressPayload {
    /** 当前类目 = 第一个未完成的适用类目；全部完成 = 'done'；无适用类目 = 'pending' */
    stage: string;
    kind: string;
    categories: ImportProgressCategory[];
    overall: {
        total: number;
        done: number;
        ratio: number;
    };
    /** 已 kickoff 但 agent 尚未回写任何 done——诚实标注，不拿 0% 假装精确 */
    uncertain: boolean;
    /** 预估剩余分钟（null = 数据不足，前端显示「—」不编数字） */
    etaMinutes: number | null;
    startedAt: string;
    updatedAt: string;
    /** 待认领清单（孤儿聊天/同名卡版本更新/agent claim 标记） */
    claims: Array<{
        kind: string;
        name: string;
        detail: string;
    }>;
}
/**
 * 拉批次 diff 预览（POST /rp/import-preview {batchId}）——只读不改，
 * 服务端扫 rp-import/<batchId>/unpacked 产出分类清单。
 */
export declare function fetchImportPreview(batchId: string): Promise<{
    batchId: string;
    preview: ImportPreviewPayload;
}>;
/** 读迁移 checkpoint（GET /rp/import-checkpoint?batchId=）——无进度返回 checkpoint: null */
export declare function fetchImportCheckpoint(batchId: string): Promise<{
    batchId: string;
    checkpoint: unknown | null;
    summary: CheckpointSummary;
}>;
/**
 * 拉批次进度（GET /rp/import-progress?batchId=）——§4.16.1 屏5 执行/屏6 报告的进度模型。
 * 数据源 = meta.json manifest 计数（total）× checkpoint 逐类目 done + 预估剩余时间 +
 * 待认领清单；服务端算好，前端只渲染（30s 轮询由页面侧节流）。
 */
export declare function fetchImportProgress(batchId: string): Promise<{
    batchId: string;
    progress: ImportProgressPayload;
}>;
/**
 * 开工导入（POST /rp/import-kickoff）。
 * @param opts.resumeFrom 断点续跑：checkpoint 里有 done 类目时，开工/续跑消息会指示
 *   agent 跳过已完成类目、只补缺失类目（消费契约在 SKILL.md「断点续跑（必做）」）
 */
export interface KickoffResult {
    batchId: string;
    sessionId: string;
    reused?: boolean;
    resumed?: boolean;
    checkpoint?: CheckpointSummary;
}
export declare function kickoffImport(batchId: string, opts?: {
    resumeFrom?: boolean;
}): Promise<KickoffResult>;
