/**
 * EJS 沙箱渲染器（隔离执行完整 EJS，含任意 JS 表达式求值）——P1#9。
 *
 * 方案选型：Android node 不能编译原生模块，隔离域二选一——
 * ① Node 内建 vm（vm.Script + vm.createContext + timeout）：零新依赖、
 *    Android node 原生可用、同步执行可用 timeout 硬性中断（while(true) 必死）；
 * ② quickjs-emscripten（参考实现 dsh-agent-rp/agent-loop-rp 的
 *    @jitl/quickjs-singlefile-mjs-release-sync 变体）：纯 JS/WASM 虽可跑，
 *    但引入 ~1MB base64 WASM 依赖、esbuild 打包体积膨胀，且每次渲染
 *    newRuntime 的 WASM 实例化成本高于 vm context。
 * 结论：采用 ①。vm 不是 V8 级安全边界（官方明示），但模板渲染的威胁模型是
 * 「角色卡/世界书里的不可信文本不得触碰宿主 require/process/fs 与事件循环」，
 * vm 隔离域 + 无宿主全局 + timeout + 输出上限已覆盖；记忆上限以输出上限兜底。
 *
 * 参考（MIT 许可，特此致谢）：
 * - dsh-agent-rp（hewzhew/dsh-agent-rp）src/ejs-template.ts L588-679
 *   EjsTemplateEngine：每渲染全新 runtime/context、资源上限、失败分类
 *   EjsTemplateFailureKind（错误信息不含模板源码）、确定性防护
 *   （Date=undefined / Math.random 抛错）；
 * - agent-loop-rp（2428139739pregnant-web/agent-loop-rp）src/ejs-template.ts
 *   L328-378 segments() 切分（<%_/%%>/-%> 空白裁剪）、L1154-1158 注入桥接。
 *
 * 与 ejs.ts（解释子集）的关系：子集引擎保留为默认（零依赖、行为已冻结）；
 * 本沙箱引擎由 /render 的 engine:'sandbox' 显式启用，路由契约不变。
 */
import { type LikeStMessage } from './ejs.ts';
import { type PromptInjectionStore } from './injection-store.ts';
/** 稳定失败分类（对照参考 EjsTemplateFailureKind；错误不含模板源码）。 */
export type SandboxFailureKind = 'source-limit' | 'syntax-error' | 'runtime-error' | 'execution-limit' | 'output-limit';
export type SandboxRenderResult = {
    readonly ok: true;
    readonly text: string;
} | {
    readonly ok: false;
    readonly kind: SandboxFailureKind;
};
export type SandboxMessagesResult = {
    readonly ok: true;
    readonly messages: LikeStMessage[];
    readonly rendered: number;
    readonly skipped: number;
} | {
    readonly ok: false;
    readonly kind: SandboxFailureKind;
};
export interface SandboxRenderOptions {
    /** 同步执行硬超时（ms），默认 200，clamp 到 [10, 5000]。 */
    readonly timeoutMs?: number;
    /** 外部共享的注入 store；缺省每次渲染独立（per-render）。 */
    readonly injections?: PromptInjectionStore;
}
/**
 * 沙箱渲染入口：template + context → SandboxRenderResult。
 * 每次渲染创建全新 vm 隔离域：无 require/process/module/fetch/计时器，
 * Date 置 undefined、Math.random 抛错（确定性防护）；timeout 硬中断。
 */
export declare function renderEjsSandbox(template: string, context: Record<string, unknown>, options?: SandboxRenderOptions): SandboxRenderResult;
/**
 * 批量渲染历史消息（沙箱引擎版 renderMessages）：is_ejs_processed 跳过；
 * 整批共享一份注入 store（= 一次生成 pass），任一消息失败即整体失败。
 */
export declare function renderMessagesSandbox(template: string, context: Record<string, unknown>, messages: LikeStMessage[], options?: SandboxRenderOptions): SandboxMessagesResult;
