/**
 * DSHTavern 卡包导出对称（M3 / T3.1b，计划文档 §4.8.1 导出对称性）
 *
 * 目标：「进得来 ST 生态，出得去 ST 生态」。导入时把原始 ST JSON 原样存为
 * card.rawJson + 立绘 card.avatar（见 character-card.ts / data-zip.ts），
 * 导出时：
 *  - ST PNG 卡：以立绘（或占位 PNG）为载体，重打 tEXt chunk（char/ccv3 关键字
 *    = base64(原始 ST JSON)），CRC32 重算——ST 1.16 可直接导入，内容无损。
 *  - 原生卡包目录：card.json + worldbook.json + regex.json + depth.txt + avatar.png
 *    的目录形态（本项目原生分享格式）。
 *
 * PNG tEXt 写入是 extractCardJsonFromPng（character-card.ts）的逆向：
 * 在保留图像 chunk（IHDR/IDAT/IEND）的同时，把 keyword=json 的 tEXt chunk
 * 写入/替换到 IEND 之前。ST 读取时扫 tEXt 的 char/ccv3 关键字即可还原。
 */
import type { CharacterCard } from './character-card.ts';
import type { LoreBook } from '../lore/entry.ts';
/**
 * 在 PNG 字节流写入/替换 char(+ccv3) tEXt chunk（ST 卡格式）。
 * 保留所有图像 chunk（IHDR/PLTE/IDAT/IEND），tEXt 插入到 IEND 之前。
 * 若已有同关键字 tEXt（ST 卡自带），先删除旧 chunk 再写新（避免重复）。
 */
export declare function writeCardTextChunks(png: Uint8Array, jsonText: string): Uint8Array;
/** 导出的一个文件（path 为包内相对路径；content 文本 / base64 二进制） */
export interface ExportCardFile {
    path: string;
    content: string;
    binary?: boolean;
}
/** 立绘 PNG 字节 → base64（供二进制落盘/下载） */
export declare function bytesToBase64(bytes: Uint8Array): string;
/**
 * 把角色卡拆成原生卡包目录形态（本项目分享格式）：
 * card.json（完整 ST JSON，原样）+ worldbook.json（内嵌书）+ regex.json（内嵌正则）
 * + depth.txt（深度提示）+ avatar.png（立绘，无则占位）。
 * @param card 角色卡（rawJson 为原样 ST JSON；无则用归一结构重建 V2）
 */
export declare function exportCardBundleFiles(card: CharacterCard, avatar: Uint8Array | null): ExportCardFile[];
/** 由归一 CharacterCard 重建 ST chara_card_v2 JSON（无损字段覆盖，缺失字段给空串） */
export declare function buildStV2Json(card: CharacterCard): string;
/** LoreBook → ST world 对象（character_book 字段；与 importLoreBook 逆向） */
export declare function loreBookToStWorld(book: LoreBook): Record<string, unknown>;
/** 生成一张纯色 + 简单图形的占位 PNG（tEXt 载体用；ST 需图像 chunk） */
export declare function makePlaceholderPng(name: string): Uint8Array;
