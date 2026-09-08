/**
 * 输出协议纯逻辑（T1.12 → T2.5a 迁移；T2.10 扩展为有序段落模型）。
 *
 * 标签类别（rp.json outputProtocol，全部可配）：
 * - statusTags → 状态栏卡片；actionTags → 行动选项按钮；wrapTags → 剥壳显示内文
 * - collapsibleTags（默认 details）→ 原生折叠块（ST 高频：实时总结/当前伏笔）
 * - stateUpdateTags（默认 UpdateVariable + MVU 两代标记 VariableInsert/VariableUpdate）
 *   → 状态更新块（内含 Analysis/JSONPatch 分体渲染，MVU §4.4.1）；块内容是裸 JSON
 *   （VariableInsert/VariableUpdate 形态）时渲染为「变量更新 · N 键」折叠块
 * - reasoningTags（默认 Analysis）→ 独立思维链标签 → 折叠行
 * - foreshadowingTags（默认 foreshadowings）→ 伏笔登记册面板
 * - statusbar/status 代码块 → 状态栏卡片（不显示原始代码）
 * 纯函数零依赖（UI 挂载见 RpNativeChat.tsx；单测见 tests/output-protocol.spec.ts）。
 */
export interface OutputProtocol {
    actionTags: string[];
    wrapTags: string[];
    statusTags: string[];
    /** T2.10：折叠块标签（<details><summary>标题</summary>内容</details>） */
    collapsibleTags: string[];
    /** T2.10：状态更新块标签（MVU UpdateVariable——内含 Analysis/JSONPatch） */
    stateUpdateTags: string[];
    /** T2.10：独立思维链标签 */
    reasoningTags: string[];
    /** T2.10：伏笔登记册标签 */
    foreshadowingTags: string[];
}
export declare const PROTO_DEFAULT: OutputProtocol;
export interface ProtocolResult {
    /** 剥壳/提取后的正文（协议块已剥离） */
    display: string;
    /** 行动选项按钮文案（顺序保留；渲染于消息尾部——ST 同形态） */
    actions: string[];
    /** 状态栏卡片内容（顺序保留） */
    status: string[];
}
/**
 * 输出协议处理（兼容形态：actions/status 全局收集、其余块从正文剥离）。
 * 分段形态用 applyOutputProtocolSegments（T2.10 有序段落模型）。
 * streaming 态额外剥离尾部悬空开标签（闭合前不闪原始标签）。
 */
export declare function applyOutputProtocol(text: string, proto: OutputProtocol, streaming?: boolean): ProtocolResult;
export type ProtocolSegment = {
    kind: 'text';
    content: string;
} | {
    kind: 'action';
    text: string;
    color?: string;
} | {
    kind: 'status';
    content: string;
} | {
    kind: 'collapsible';
    title: string;
    content: string;
} | {
    kind: 'state-update';
    analysis: string | null;
    patches: string | null;
    raw: string;
} | {
    kind: 'reasoning';
    content: string;
} | {
    kind: 'foreshadowing';
    content: string;
}
/** MVU 状态栏占位符（<StatusPlaceHolderImpl/>）→ 渲染层替换为 MVU 状态栏组件 */
 | {
    kind: 'statusbar-placeholder';
};
/** UpdateVariable 块内部结构解析：Analysis 子块 + JSONPatch 子块 */
export declare function parseStateUpdateBlock(inner: string): {
    analysis: string | null;
    patches: string | null;
};
/** JSONPatch 数组解析（RFC 6902：op/path/value 行）——失败返回 null（原文兜底显示） */
export declare function parseJsonPatches(jsonText: string): Array<{
    op: string;
    path: string;
    value?: string;
}> | null;
/** 剧情选项按钮（label + 可选文字颜色——<font color="#hex"> 剥壳产物） */
export interface ActionOption {
    label: string;
    color?: string;
}
/**
 * 剧情选项拆分 + font 颜色剥壳（批次修复：真机翻车形态——一个按钮里塞了
 * 4 个选项、<font color="#xxx"> 原样裸露）。
 * - 块内多行各自以【…】/（…）/(…) 开头的 → 每行（组）一个独立按钮；
 *   非标记续行并入上一组；前导非标记行并入首个标记组（不产出杂物按钮）
 * - <font color="#hex">文字</font> → 颜色提到 color（渲染层 inline style），标签不裸露
 */
export declare function splitActionOptions(text: string): ActionOption[];
/**
 * display 正则产出 / 消息内联允许按 HTML 渲染的标签白名单。
 * SVG 系列照抄 agent-loop-rp card-display-compiler.ts HTML_DISPLAY_TAGS L35-49（MIT），
 * 另补 text/tspan（SVG 文本）。
 * 注意：含 position 等布局属性的产出在 sanitizeDisplayHtml 返回 null，
 * 渲染层（RpNativeChat）把整块转进沙箱 iframe（P0-2 三段编译），不再回退纯文本。
 */
export declare const HTML_DISPLAY_TAGS: ReadonlySet<string>;
/** 文本里是否存在成对的白名单 HTML 标签（决定是否走 HTML 渲染分支） */
export declare function containsPairedHtml(text: string): boolean;
/**
 * 零依赖白名单 sanitize（约 20 行，不引依赖）：
 * - 白名单外标签（script/style/iframe 等）→ 返回 null（调用方转沙箱 iframe 渲染）
 * - 属性仅保留 class（去引号/尖括号）与 font 的 color（#hex）与 style；
 *   style 逐声明过滤，白名单外属性（position:fixed 等）→ 返回 null；
 *   值含 url(/expression( 的声明丢弃。事件处理器等其它属性全部丢弃。
 * - SVG 标签（svg/g/path/circle 等）：呈现属性走 SVG_ATTRS 白名单
 *   （viewBox/d/cx/cy/r/x/y/x1/y1/x2/y2/points/fill/stroke/stroke-width）。
 */
export declare function sanitizeDisplayHtml(html: string): string | null;
/**
 * 有序段落切分（T2.10 核心）：按协议标签逐块提取，正文按位置保留。
 * 处理顺序（每类标签全串扫描，嵌套块内容不再二次切分——由渲染层递归消费）：
 * statusbar-placeholder → stateUpdate → foreshadowing → collapsible → reasoning
 * → status → action → wrap（剥壳）→ 未知标签兜底（批次修复）
 */
export declare function applyOutputProtocolSegments(text: string, proto: OutputProtocol, streaming?: boolean): ProtocolSegment[];
export type TextSegment = {
    type: 'text';
    content: string;
} | {
    type: 'statusbar';
    content: string;
};
/**
 * statusbar / status 代码块切分（渲染为组件，不显示原始代码）。
 * 其余文本段交给 MarkdownText；普通代码块留在文本段内正常渲染。
 */
export declare function splitStatusbarBlocks(text: string): TextSegment[];
export type StatusRow = [string, string];
/**
 * status-bar 内容三档解析：JSON 对象 → 键值行；冒号/全角冒号分隔行 → 键值行；原文。
 */
export declare function parseStatusBarRows(content: string): StatusRow[];
/** cwd（会话工作区根，如 …/.dsh/rp/<slug>，Windows 反斜杠兼容）→ 工作区 slug */
export declare function slugFromCwd(cwd: string | undefined): string | null;
/** 旧 rp.json 协议配置缺字段时默认值补齐（T2.10 新字段对旧工作区向后兼容） */
export declare function withDefaults(p: Partial<OutputProtocol> | undefined): OutputProtocol;
/**
 * MVU 裸 JSON 变量块（VariableInsert/VariableUpdate）前端解析：
 * 顶层键计数 + 美化打印（渲染「变量更新 · N 键」折叠块用）。
 * 注意：这只是显示层解析——引擎侧 parseUpdateVariable（state/mvu.ts）是否消费
 * 这两个标记由引擎任务负责，本函数不影响状态写入链路。
 * @returns 解析失败（非 JSON / 非对象）返回 null，调用方回退原文展示
 */
export declare function parseVariableJson(raw: string): {
    keys: number;
    pretty: string;
} | null;
