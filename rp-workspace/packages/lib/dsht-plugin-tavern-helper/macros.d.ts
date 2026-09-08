/**
 * 酒馆助手宏引擎的路由侧胶水（/dsht-tavern-helper/macros/expand）。
 * 引擎本体是纯函数（../dsht-plugin-shared/macros.ts，dsh-plugin pre-step 同款内联）；
 * 本模块负责：身份解析（rp.json macros + rp/persona.json active）、三级作用域合并视图、
 * setvar 落盘（含 undo 日志）。
 */
export type MacroScope = 'global' | 'character' | 'chat';
/** 身份来源：rp.json macros（char/user）+ rp/persona.json active 条目（user 名与描述） */
export interface MacroIdentity {
    user: string;
    char: string;
    persona: string;
}
/** 读 rp/persona.json 的 active 条目（无文件/无 active → 空） */
export declare function loadActivePersona(dshHome: string): Promise<{
    name: string;
    description: string;
} | null>;
/** 解析宏身份：char 取 rp/<slug>/rp.json 的 macros.char；user 优先 persona.json active，回落 rp.json macros.user */
export declare function resolveIdentity(dshHome: string, slug: string): Promise<MacroIdentity>;
export interface ExpandRouteDeps {
    dshHome: string;
    /** 三级作用域读取（index.ts 的 loadScope） */
    loadScope: (scope: MacroScope, slug: string, sessionId: string) => Promise<Record<string, unknown>>;
    /** 三级作用域写入（index.ts 的 saveScope） */
    saveScope: (scope: MacroScope, slug: string, sessionId: string, tree: Record<string, unknown>) => Promise<void>;
    /** 写前钩子（任务 1：文件快照；index.ts 注入，可空） */
    beforeSave?: (scope: MacroScope, slug: string, sessionId: string) => Promise<void>;
}
/**
 * /macros/expand 的执行体：{text, slug?, sessionId?} → {result, writes}。
 * setvar 落盘作用域：chat（有 sessionId）> character（有 slug）> global。
 * 写前把旧值追加进 per-session undo 日志（有 sessionId 时；任务 4 回滚联动）。
 */
export declare function runMacroExpand(deps: ExpandRouteDeps, input: {
    text: string;
    slug?: string;
    sessionId?: string;
}): Promise<{
    result: string;
    writes: Array<{
        path: string;
        value: string;
    }>;
    unknownMacros: string[];
}>;
