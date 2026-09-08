/**
 * DSHTavern RP 组装器（M1 / T1.3 + T1.4，计划文档 §4.1 管线）
 *
 * 输入：编译后的预设槽位 + 角色卡字段 + 世界书激活结果 + 聊天历史 + 会话状态
 *   ↓ 1. 正则引擎·prompt 时机（改聊天历史与世界书内容）
 *   ↓ 2. 世界书触发（产出激活条目集——由调用方先行执行，结果传入）
 *   ↓ 3. 预设骨架落位（槽位顺序 + 深度注入 splice 进消息数组）
 *   ↓ 4. 宏引擎（统一求值）
 *   ↓ 5. token 预算裁剪（历史从旧到新丢弃）
 * 输出：messages[]（发给 LLM 的最终形态）+ 组装 trace
 */
import { type MacroContext } from '../macros/engine.ts';
import { type RegexScript } from '../regex/engine.ts';
import type { CompiledSlot } from '../preset/schema.ts';
import type { ActivatedEntry } from '../lore/trigger.ts';
/** 组装输入的聊天消息（ST messages 对应物，§4.15 字段映射） */
export interface AssemblyMessage {
    role: 'user' | 'assistant' | 'system';
    name?: string;
    content: string;
    /** 系统备注：导入保留、组装排除（§4.15） */
    isSystemNote?: boolean;
}
/** 角色卡字段（§4.8 映射表的组装消费面） */
export interface CharacterFields {
    name: string;
    description: string;
    personality: string;
    scenario: string;
    personaDescription: string;
    /** 角色深度提示（data.extensions.depth_prompt） */
    depthPrompt?: {
        prompt: string;
        depth: number;
        role: 'system' | 'user' | 'assistant';
    };
}
/** 组装配置 */
export interface AssemblyConfig {
    maxContextTokens: number;
    reserveReplyTokens: number;
    /** 估算器（默认 字符/4） */
    estimateTokens?: (s: string) => number;
}
/** 组装 trace（session log 落盘 + 前端"这条消息怎么被生成的"消费） */
export interface AssemblyTrace {
    finalMessages: Array<{
        role: string;
        content: string;
    }>;
    regexHits: Array<{
        scriptName: string;
        count: number;
    }>;
    activatedEntries: Array<{
        comment: string;
        reason: string;
        book: string;
    }>;
    unknownMacros: string[];
    tokenEstimate: {
        prompt: number;
        droppedMessages: number;
    };
}
export interface AssembleResult {
    messages: AssemblyMessage[];
    trace: AssemblyTrace;
}
/**
 * RP 组装主流程。
 *
 * @param slots 编译期展开的槽位（compileSlots 产物）
 * @param character 角色卡字段（已宏替换前置处理由内部完成）
 * @param wiActivated 世界书激活结果（triggerWorldInfo 产物）
 * @param history 聊天历史（旧→新；prompt 正则已由内部应用）
 * @param state 会话状态树（getvar/状态摘要源）
 * @param regexScripts 正则脚本（GLOBAL/PRESET/SCOPED 三源合并后的全集）
 * @param macroCtx 宏上下文
 * @param config 预算配置
 */
export declare function assemble(slots: CompiledSlot[], character: CharacterFields, wiActivated: ActivatedEntry[], history: AssemblyMessage[], state: unknown, regexScripts: RegexScript[], macroCtx: Omit<MacroContext, 'getState'> & {
    getState: (path: string) => unknown;
}, config: AssemblyConfig): AssembleResult;
