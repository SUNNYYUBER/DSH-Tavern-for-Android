/**
 * DSHTavern MVU 插件（Cordis 插件，挂 DSH web profile 全局层）——R10 插件 1。
 *
 * SillyTavern MVU 扩展（extension_settings.mvu_settings）的意图级移植：
 * MVU 引擎本体（<UpdateVariable> 提取 / JSONPatch 应用 / 状态摘要渲染）已在
 * packages/src/state/mvu.ts 并由 dsh-plugin 的组装层消费——本插件做"收口"：
 *
 * a) 全局 MVU 设置存取：$DSH_HOME/rp/mvu-settings.json（GET/PUT）。
 *    迁移时 extension_settings.mvu_settings 子树原样存为该文件（raw 保留全部键）；
 *    常用子集字段（更新方式/自动清理变量/通知/额外模型解析配置/兼容性/statusbar）
 *    原样透传，插件不做字段级裁剪——ST 端配置语义不失真。
 *    （rp/state/<sessionId>.json 的读写 dsh-plugin 已有 /dsht-rp/state 路由，不重复造。）
 * b) 状态栏渲染配置存取：mvu-settings.json 内 statusbar 键（GET/PUT /dsht-mvu/statusbar）。
 * c) 变量 schema 注册：迁移 skill 把 chat_metadata.variables 写进 rp/state/<sessionId>.json
 *    的 variables 键（POST /dsht-mvu/variables/register，深合并不覆盖既有键，replace 可整组换）；
 *    POST /dsht-mvu/variables/patch 复用 state/mvu.ts 的 applyStatePatches 做 JSONPatch 增量。
 *
 * 路由前缀 /dsht-mvu（避开 /dsht-rp）。
 */
import { type LikePluginContext } from '../dsht-plugin-shared/http.ts';
export declare const name = "dsht-plugin-mvu";
export declare const inject: string[];
/** 深合并（incoming 覆盖 existing 的叶值；对象递归；数组/标量直接替换） */
export declare function deepMerge(existing: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown>;
/** 会话 RP 状态文件形状（与 dsh-plugin 共享 rp/state/<sessionId>.json；各键分权：presetId/state 归 dsh-plugin，variables/variableSchema 归本插件） */
export interface SessionRpStateFile {
    presetId?: string;
    state?: Record<string, unknown>;
    variables?: Record<string, unknown>;
    variableSchema?: unknown;
    [key: string]: unknown;
}
/**
 * 变量注册（chat_metadata.variables 迁移落点）。
 * replace=false：与现有 variables 深合并（incoming 赢）；replace=true：整组替换。
 * 返回合并后的新文件内容（纯函数，IO 在调用侧）。
 */
export declare function registerVariables(file: SessionRpStateFile, variables: Record<string, unknown>, schema: unknown, replace: boolean): SessionRpStateFile;
/**
 * 任务 5：状态栏模板渲染（<StatusPlaceHolderImpl/> 占位符的数据源）。
 * 两阶段：1) 宏引擎求值已知宏（{{getvar::…}}/{{time}} 等）；2) 剩余 {{path}} 视为
 * MVU 变量引用（状态栏模板形态）。输出安全文本段：全部 HTML 转义，换行 → <br>。
 */
export declare function renderStatusbarHtml(template: string, lookup: (path: string) => unknown): string;
/**
 * 任务 5 兜底：statusbar 无配置模板时的默认两栏（时间/地点/好感度——只渲染
 * 变量树里真实存在的键；常见落点 root 与 stat_data 都查）。一个都没有返回空串。
 *
 * 键名兼容（真实卡实测）：时间=时间|当前时间；地点=地点|所在地点|当前地点；
 * 好感度=root/stat_data 直键，否则往「女性角色/<角色>/好感度」这类一层子树里找首个。
 */
export declare function renderDefaultStatusbarHtml(lookup: (path: string) => unknown, tree?: Record<string, unknown>): string;
export declare function apply(ctx: LikePluginContext, _config: unknown): void;
