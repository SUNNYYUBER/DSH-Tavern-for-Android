/**
 * I4 显示期宏展开（display-time macro expansion，纯函数、零依赖）。
 *
 * 语义来源（SillyTavern 宏 + MVU 变量宏的意图级移植）：
 * - 核心宏 {{user}}/{{char}}/{{persona}}：身份面（数据源 GET /dsht-rp/identity）；
 * - 时间宏 {{time}}/{{date}}/{{weekday}}/{{datetime}}：渲染当下时刻（浏览器时区）；
 * - {{random:a,b,c}}：每次渲染重掷（ST 同语义，窗口化回渲会变——按任务定案）；
 * - {{pick:a,b,c}}：稳定取一——以「宏原文 + 全文」做 FNV-1a 哈希选种子，同一楼层
 *   重渲染（窗口化/流式重排）结果不变，不同楼层各自独立；
 * - {{roll:X}} 掷 1..X；{{roll:X,N}} 掷 N 次逐个列出；
 * - 类宏 {{getvar::p}}/{{get_message_variable::p}}/{{get_chat_variable::p}}：从传入
 *   variables 树取值（/dsht-mvu/variables 单树；message/chat 双宏同源），路径点号
 *   与 JSONPointer（/a/b）双兼容；取不到返回空串（ST getvar 缺失同语义）；
 * - {{setvar::p::v}}：显示期不落盘，只透传空串（写变量归聊天/MVU 管线）。
 * - 未知宏原样保留（不吞不报）。
 *
 * 纯同步纯函数：异步数据（identity/variables）由 display-compiler.ts 的模块级缓存
 * （每 slug/session 5s TTL）加载后经 ctx 传入；ctx 为 null 时原文透传。
 */
/** 显示期宏上下文（identity + variables 的已加载快照） */
export interface DisplayMacroCtx {
    /** {{user}}：persona 优先，rp.json macros.user 兜底（服务端 identity 路由裁决） */
    readonly user: string;
    /** {{char}}：rp.json macros.char / characterName */
    readonly char: string;
    /** {{persona}}：persona 描述（可选，缺省空串 = 宏展开为空） */
    readonly persona?: string;
    /** MVU 变量树（/dsht-mvu/variables 的 variables 字段） */
    readonly variables: Readonly<Record<string, unknown>>;
}
/**
 * 展开 display 期宏。ctx 为 null（identity/variables 拉取失败或未就绪）时原文透传；
 * 类宏在 ctx.variables 缺失时按空树处理（getvar 取不到 → 空串）。
 */
export declare function expandDisplayMacros(text: string, ctx: DisplayMacroCtx | null): string;
