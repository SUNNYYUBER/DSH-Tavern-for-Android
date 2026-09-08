/**
 * EJS 子集渲染器（ST-Prompt-Template 插件意图级移植的核心）——纯函数，可单测。
 *
 * 支持（常用子集，解释执行，不 eval/new Function）：
 * - {{ path.to.var }}              宏插值（raw 输出）
 * - <%= expr %> / <%- expr %>      EJS 输出（escaped / raw）
 * - <% if (expr) { %> <% } else if (expr) { %> <% } else { %> <% } %>
 * - <% for (const item of expr) { %> / <% for (const item, i of expr) { %>
 * - <% const x = expr %>           局部赋值（let/var 同义）
 * - <%# comment %>                 注释（丢弃）
 * 表达式：字面量（数字/字符串/true/false/null/undefined）、点路径、下标、
 * 一元 !/-、二元 + - * / % == != === !== < <= > >= && ||、括号、三元 ?:。
 * 不支持：函数调用、箭头函数、模板字符串、正则字面量——遇到即抛渲染错误。
 */
type Expr = {
    k: 'lit';
    v: unknown;
} | {
    k: 'ref';
    name: string;
} | {
    k: 'get';
    obj: Expr;
    key: Expr | string;
} | {
    k: 'un';
    op: string;
    a: Expr;
} | {
    k: 'bin';
    op: string;
    a: Expr;
    b: Expr;
} | {
    k: 'cond';
    c: Expr;
    a: Expr;
    b: Expr;
};
export declare function parseExpr(src: string): Expr;
/** 作用域链（context + 局部帧） */
type Scope = Record<string, unknown>;
export declare function evalExpr(e: Expr, scopes: Scope[]): unknown;
type Seg = {
    t: 'text';
    s: string;
} | {
    t: 'out';
    expr: string;
    escaped: boolean;
} | {
    t: 'code';
    s: string;
};
/** 模板 → 段序列（文本 / 输出 / 代码）；<%# %> 注释丢弃，<%% → 字面 <% */
export declare function lexTemplate(template: string): Seg[];
type Node = {
    k: 'text';
    s: string;
} | {
    k: 'out';
    expr: Expr;
    escaped: boolean;
} | {
    k: 'if';
    branches: Array<{
        cond: Expr | null;
        body: Node[];
    }>;
} | {
    k: 'for';
    varName: string;
    indexVar: string | null;
    iter: Expr;
    body: Node[];
} | {
    k: 'set';
    name: string;
    expr: Expr;
};
export declare function parseTemplate(template: string): Node[];
export interface EjsCacheConfig {
    enabled: 0 | 1 | 2;
    size: number;
    hasher: 'h32ToString' | 'h64ToString';
}
/** /render 路由加载设置后调用（cacheEnabled 1=启用 2=仅世界书——本渲染器统一按模板缓存） */
export declare function configureEjsCache(cfg: Partial<EjsCacheConfig>): void;
/** 提取 <pre>…</pre> 段替换为占位符（渲染后 restorePreBlocks 还原）。 */
export declare function protectPreBlocks(text: string): {
    text: string;
    blocks: string[];
};
export declare function restorePreBlocks(text: string, blocks: string[]): string;
/** 渲染入口：template + context → string。语法错误/不支持语句抛 Error（带 [dsht-ejs] 前缀）。 */
export declare function renderEjsSubset(template: string, context: Record<string, unknown>): string;
export interface LikeStMessage {
    mes?: string;
    is_ejs_processed?: unknown;
    extra?: {
        is_ejs_processed?: unknown;
    };
    [key: string]: unknown;
}
/** ST 端标记形态实测有两种：布尔 true 与 [true]（jsonl 迁移产物）。 */
export declare function isEjsProcessed(msg: LikeStMessage): boolean;
/** B7 选项：protectPre=true 时消息里的 <pre> 块不做模板求值（ST code_blocks 关同语义） */
export interface RenderMessagesOptions {
    protectPre?: boolean;
}
/**
 * 批量渲染历史消息：is_ejs_processed 的跳过（保留原 mes），未处理的按
 * template 渲染（context 叠加 {message} 供模板引用当前消息字段），并打上已处理标记。
 */
export declare function renderMessages(template: string, context: Record<string, unknown>, messages: LikeStMessage[], options?: RenderMessagesOptions): {
    messages: LikeStMessage[];
    rendered: number;
    skipped: number;
};
export {};
