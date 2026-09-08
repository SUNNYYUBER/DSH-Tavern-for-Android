/**
 * DSHTavern 提示词模板插件（Cordis 插件，挂 DSH web profile 全局层）——R10 插件 3。
 *
 * SillyTavern ST-Prompt-Template（extension_settings.EjsTemplate）的意图级移植：
 * - EJS 子集渲染器（./ejs.ts：纯函数解释执行，不 eval；支持 {{}} 宏、<%=%>/<%-%> 输出、
 *   if/else if/else、for-of、const 赋值与常用表达式语法）——默认引擎；
 * - EJS 沙箱渲染器（./sandbox.ts：Node vm 隔离域执行完整 EJS，timeout 硬中断、
 *   输出上限、确定性防护、失败分类不含模板源码）——engine:'sandbox' 显式启用；
 * - 独立 prompt 注入 store（./injection-store.ts：injectPrompt/getPromptsInjected/
 *   hasPromptsInjected，per-request 生命周期，沙箱经 __host* 桥读写）。
 * - HTTP 数据面 POST /dsht-prompt-template/render {template, context, engine?} → {result}；
 *   带 messages 时按 is_ejs_processed 标记跳过已处理历史消息（ST 同款语义）。
 *
 * 路由前缀 /dsht-prompt-template（避开 /dsht-rp）。
 */
import { type LikePluginContext } from '../dsht-plugin-shared/http.ts';
export declare const name = "dsht-plugin-prompt-template";
export declare const inject: string[];
export declare function apply(ctx: LikePluginContext, _config: unknown): void;
