/**
 * 消息搜索纯逻辑（PROJECT_PLAN §4.15「消息搜索：虚拟列表配套」数据面）。
 *
 * 数据源：POST /dsht-tavern-helper/chat/messages {sessionId} → { messages } 全量拉
 * 一次后本地过滤（facade.ts chatMessages：session.jsonl 流式投影出
 * {message_id, name, role, message}）。本文件不碰网络，只做可单测的纯函数：
 * - 大小写不敏感包含匹配（toLowerCase 折叠；中英文皆可）；
 * - 命中片段：第一个命中位置前后各 ~40 字（码点对齐，不切坏 emoji 代理对）；
 * - 全文高亮分段：展开完整消息时把命中词全部标出；
 * - 结果上限 50 条防长会话卡顿。
 *
 * 说明：toLowerCase 对个别字符（如土耳其 İ）可能改变字符串长度，此时 lower
 * 版本的 indexOf 偏移在原文上近似成立——片段边界可能差一个码元，可接受。
 */
/** 可搜索消息（chat/messages 投影的最小面；与 th-shim ThChatMessage 同形但解耦） */
export interface SearchableMessage {
    message_id: number;
    name: string;
    role: 'user' | 'assistant';
    message: string;
}
/** 命中片段：命中词前的上下文 + 命中词 + 命中词后的上下文（顺序拼接即原文一段） */
export interface SearchSnippet {
    before: string;
    match: string;
    after: string;
    /** 命中前的上下文被裁剪时为 true（UI 显示省略号） */
    headCut: boolean;
    /** 命中后的上下文被裁剪时为 true */
    tailCut: boolean;
}
/** 一条搜索结果：楼层号（message_id）+ 角色名 + 片段 */
export interface SearchHit {
    messageId: number;
    name: string;
    role: 'user' | 'assistant';
    snippet: SearchSnippet;
}
/** 结果上限（防长会话渲染卡顿，PROJECT_PLAN「上限 50 条」） */
export declare const SEARCH_RESULT_LIMIT = 50;
/** 命中片段：命中词前后各取的字符数（UTF-16 码元，中文字≈汉字数） */
export declare const SNIPPET_RADIUS = 40;
/** 大小写不敏感地找第一个命中位置（码元级）；未命中返回 -1 */
export declare function firstHitIndex(text: string, lowerQuery: string): number;
/**
 * 命中位置 → 前后各 ~radius 字的片段。
 * hitIndex/matchLen 按 lower 版本计算，切点在原文上做码点对齐。
 */
export declare function extractSnippet(text: string, hitIndex: number, matchLen: number, radius?: number): SearchSnippet;
/**
 * 全量消息过滤：query 大小写不敏感匹配消息文本，按楼层序产出片段，上限 limit。
 * query 为空（未输入）返回 []——面板空态由组件按「无输入 / 无结果」区分。
 */
export declare function searchMessages(messages: readonly SearchableMessage[] | undefined, query: string, limit?: number): SearchHit[];
/** 全文高亮分段（展开完整消息用）：顺序拼接各段的 t 即原文；hit 段套高亮样式 */
export declare function splitHighlight(text: string, query: string): Array<{
    t: string;
    hit: boolean;
}>;
