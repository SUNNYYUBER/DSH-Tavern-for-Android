"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makePlaceholderPng = exports.bytesToBase64 = exports.buildStV2Json = exports.exportCardBundleFiles = exports.writeCardTextChunks = exports.chatSessionId = exports.sessionFilePath = exports.encodeSegment = exports.dshSlug = exports.buildRpJsonContent = exports.exportSingleCardFiles = exports.convertChatFile = exports.cardPromptPersona = exports.exportLoreBookSkill = exports.exportToDshFiles = exports.lastDataImport = exports.analyzeDataZip = exports.DEFAULT_TRIGGER_CONFIG = exports.triggerWorldInfo = exports.importLoreBook = exports.summarizeBundle = exports.importCharacterJson = exports.importCharacterPng = void 0;
exports.fetchImportPreview = fetchImportPreview;
exports.fetchImportCheckpoint = fetchImportCheckpoint;
exports.fetchImportProgress = fetchImportProgress;
exports.kickoffImport = kickoffImport;
/**
 * 浏览器端入口：导入中心 WebView 页面的引擎桥
 * esbuild --format=iife --global-name=DSHT 打包后暴露 window.DSHT
 */
var character_card_ts_1 = require("./character-card.ts");
Object.defineProperty(exports, "importCharacterPng", { enumerable: true, get: function () { return character_card_ts_1.importCharacterPng; } });
Object.defineProperty(exports, "importCharacterJson", { enumerable: true, get: function () { return character_card_ts_1.importCharacterJson; } });
Object.defineProperty(exports, "summarizeBundle", { enumerable: true, get: function () { return character_card_ts_1.summarizeBundle; } });
var entry_ts_1 = require("../lore/entry.ts");
Object.defineProperty(exports, "importLoreBook", { enumerable: true, get: function () { return entry_ts_1.importLoreBook; } });
var trigger_ts_1 = require("../lore/trigger.ts");
Object.defineProperty(exports, "triggerWorldInfo", { enumerable: true, get: function () { return trigger_ts_1.triggerWorldInfo; } });
Object.defineProperty(exports, "DEFAULT_TRIGGER_CONFIG", { enumerable: true, get: function () { return trigger_ts_1.DEFAULT_TRIGGER_CONFIG; } });
var data_zip_ts_1 = require("./data-zip.ts");
Object.defineProperty(exports, "analyzeDataZip", { enumerable: true, get: function () { return data_zip_ts_1.analyzeDataZip; } });
Object.defineProperty(exports, "lastDataImport", { enumerable: true, get: function () { return data_zip_ts_1.lastDataImport; } });
var dsh_export_ts_1 = require("./dsh-export.ts");
Object.defineProperty(exports, "exportToDshFiles", { enumerable: true, get: function () { return dsh_export_ts_1.exportToDshFiles; } });
Object.defineProperty(exports, "exportLoreBookSkill", { enumerable: true, get: function () { return dsh_export_ts_1.exportLoreBookSkill; } });
Object.defineProperty(exports, "cardPromptPersona", { enumerable: true, get: function () { return dsh_export_ts_1.cardPromptPersona; } });
Object.defineProperty(exports, "convertChatFile", { enumerable: true, get: function () { return dsh_export_ts_1.convertChatFile; } });
Object.defineProperty(exports, "exportSingleCardFiles", { enumerable: true, get: function () { return dsh_export_ts_1.exportSingleCardFiles; } });
Object.defineProperty(exports, "buildRpJsonContent", { enumerable: true, get: function () { return dsh_export_ts_1.buildRpJsonContent; } });
Object.defineProperty(exports, "dshSlug", { enumerable: true, get: function () { return dsh_export_ts_1.dshSlug; } });
Object.defineProperty(exports, "encodeSegment", { enumerable: true, get: function () { return dsh_export_ts_1.encodeSegment; } });
Object.defineProperty(exports, "sessionFilePath", { enumerable: true, get: function () { return dsh_export_ts_1.sessionFilePath; } });
Object.defineProperty(exports, "chatSessionId", { enumerable: true, get: function () { return dsh_export_ts_1.chatSessionId; } });
var card_export_ts_1 = require("./card-export.ts");
Object.defineProperty(exports, "writeCardTextChunks", { enumerable: true, get: function () { return card_export_ts_1.writeCardTextChunks; } });
Object.defineProperty(exports, "exportCardBundleFiles", { enumerable: true, get: function () { return card_export_ts_1.exportCardBundleFiles; } });
Object.defineProperty(exports, "buildStV2Json", { enumerable: true, get: function () { return card_export_ts_1.buildStV2Json; } });
Object.defineProperty(exports, "bytesToBase64", { enumerable: true, get: function () { return card_export_ts_1.bytesToBase64; } });
Object.defineProperty(exports, "makePlaceholderPng", { enumerable: true, get: function () { return card_export_ts_1.makePlaceholderPng; } });
/** 数据面 POST（与页面内 postJson 同前缀；错误以 Error 抛出） */
async function rpPost(path, body) {
    const resp = await fetch('/dsht-rp' + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || json.error)
        throw new Error(String(json.error ?? `HTTP ${resp.status}`));
    return json;
}
/** 数据面 GET（query 由调用方拼好；错误以 Error 抛出） */
async function rpGet(path) {
    const resp = await fetch('/dsht-rp' + path);
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || json.error)
        throw new Error(String(json.error ?? `HTTP ${resp.status}`));
    return json;
}
/**
 * 拉批次 diff 预览（POST /rp/import-preview {batchId}）——只读不改，
 * 服务端扫 rp-import/<batchId>/unpacked 产出分类清单。
 */
async function fetchImportPreview(batchId) {
    return await rpPost('/rp/import-preview', { batchId });
}
/** 读迁移 checkpoint（GET /rp/import-checkpoint?batchId=）——无进度返回 checkpoint: null */
async function fetchImportCheckpoint(batchId) {
    return await rpGet(`/rp/import-checkpoint?batchId=${encodeURIComponent(batchId)}`);
}
/**
 * 拉批次进度（GET /rp/import-progress?batchId=）——§4.16.1 屏5 执行/屏6 报告的进度模型。
 * 数据源 = meta.json manifest 计数（total）× checkpoint 逐类目 done + 预估剩余时间 +
 * 待认领清单；服务端算好，前端只渲染（30s 轮询由页面侧节流）。
 */
async function fetchImportProgress(batchId) {
    return await rpGet(`/rp/import-progress?batchId=${encodeURIComponent(batchId)}`);
}
async function kickoffImport(batchId, opts = {}) {
    return await rpPost('/rp/import-kickoff', { batchId, ...(opts.resumeFrom ? { resumeFrom: true } : {}) });
}
