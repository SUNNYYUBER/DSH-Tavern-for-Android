/**
 * 独立 prompt 注入 store（per-generation）——ST-Prompt-Template 的
 * injectPrompt / getPromptsInjected / hasPromptsInjected 三件套语义移植。
 *
 * 出处：agent-loop-rp（2428139739pregnant-web/agent-loop-rp）src/ejs-template.ts
 * L70-175 `createEjsTemplatePromptInjectionStore`，MIT 许可，特此致谢。
 *
 * 设计要点（与参考一致）：
 * - store 驻留在沙箱之外的宿主侧：模板在隔离域内只能通过 __host* 桥读写，
 *   嵌套模板/批量消息渲染共享同一份 store，但宿主对象本身不暴露给沙箱；
 * - 生命周期 = 一次 prompt 生成/渲染 pass（本插件中 = 一次 /render 请求），
 *   不持久化、不跨请求泄漏；
 * - 有界：key ≤ 256 字符、单条 ≤ 256KB、总数 ≤ 512（参考实现同款上限）。
 */
export interface PromptInjectionStore {
    inject(key: string, prompt: string, order?: number, sticky?: number, uid?: string): void;
    get(key: string, postprocess?: unknown): string;
    has(key: string): boolean;
}
/** 创建一次生成 pass 共享的有界 store。 */
export declare function createPromptInjectionStore(): PromptInjectionStore;
