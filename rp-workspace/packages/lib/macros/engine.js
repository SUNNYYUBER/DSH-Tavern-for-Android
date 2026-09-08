"use strict";
/**
 * DSHTavern 宏引擎（M1 / T1.1，计划文档 §4.1.1）——P0-4 统一后：
 * 本类是 dsht-plugin-shared/macros.ts 的 expandTavernMacros 的**薄包装**（单一引擎、
 * 语义一致），保留 class 形态仅为兼容既有调用面（assembly/pipeline.ts 与 dsh-plugin 的
 * processActivatedEntries）。行为分叉（缺 addvar/incvar/decvar/datetime/weekday/isotime/
 * isodate/noop、getvar 无 setvar 顺序求值）自此消灭——这些宏由 expandTavernMacros 统一提供。
 *
 * 统一方向参考 dsh-agent-rp 的 roleplay-macro.ts（ReplayableRoleplayMacros 单引擎设计；
 * MIT © hewzhew，见 REF_PROJECTS_COMPARISON.md 领域四与致谢表）。
 *
 * 语义要点（全部由 expandTavernMacros 继承）：
 * - random：每次求值真随机重掷；pick：稳定选择（种子 = stableSeed + 原文哈希 + 位置偏移）
 * - roll/dice：骰子公式（纯数字视为 1dN）
 * - getvar/setvar/addvar/incvar/decvar：顺序求值（同文本内后序 getvar 看得到先行 setvar）；
 *   本包装不传 setVar 回调 → writes 只进返回值（TavernMacroResult.writes 由底层累积，
 *   组装期调用方不落盘，setvar 求值后从文本消失而非保留原文）
 * - 未识别宏：保留原文 + 记入 unknownMacros（ST 同语义，不吞不报错）；
 *   插件注册宏（register）对未知宏有接管优先权
 * - 兼容别名：get_message_variable / format_message_variable（MVU 宏形态）已由底层引擎
 *   原生注册（C2 类宏：scopeGet chat 作用域读取；scopeGet 缺省回落 getvar——本包装不传
 *   scopeGet，语义与旧版"别名重写为 getvar"等价，故不再做前置重写）
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MacroEngine = void 0;
const macros_ts_1 = require("../dsht-plugin-shared/macros.ts");
class MacroEngine {
    handlers = new Map();
    /** 插件宏注册（返回注销器） */
    register(handler) {
        this.handlers.set(handler.name, handler);
        return () => this.handlers.delete(handler.name);
    }
    /**
     * 组装期宏求值：展开文本中的全部宏（委托 expandTavernMacros）。
     * 未知宏先交插件注册 handler 接管；无人接管则保留原文并记录（吞内容 = 静默丢数据，违背 P5）。
     */
    evaluate(text, ctx) {
        const r = (0, macros_ts_1.expandTavernMacros)(text, {
            user: ctx.user,
            char: ctx.char,
            persona: ctx.personaDescription,
            getVar: ctx.getState ? path => ctx.getState(path) : undefined,
            stableSeed: ctx.stableSeed,
        });
        if (this.handlers.size === 0 || r.unknownMacros.length === 0) {
            return { text: r.text, unknownMacros: r.unknownMacros };
        }
        // 插件注册宏接管未知宏（Engram 式扩展点）
        let out = r.text;
        const unknownMacros = [];
        for (const raw of r.unknownMacros) {
            const body = raw.slice(2, -2);
            const sep = body.indexOf('::') >= 0 ? '::' : ':';
            const sepAt = body.indexOf(sep);
            const name = (sepAt >= 0 ? body.slice(0, sepAt) : body).trim();
            const args = sepAt >= 0 ? body.slice(sepAt + sep.length) : '';
            const handler = this.handlers.get(name);
            const replacement = handler?.replace(args, ctx);
            if (replacement == null) {
                unknownMacros.push(raw);
                continue;
            }
            out = out.split(raw).join(replacement);
        }
        return { text: out, unknownMacros };
    }
}
exports.MacroEngine = MacroEngine;
