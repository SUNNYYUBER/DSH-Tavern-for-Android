/**
 * DSHTavern 酒馆助手插件（Cordis 插件，挂 DSH web profile 全局层）——R10 插件 2。
 *
 * SillyTavern 酒馆助手（extension_settings.tavern_helper）的意图级移植：
 * - 变量作用域子系统：global（rp/variables/global.json）/ character（rp/<slug>/variables.json）/
 *   chat（rp/state/<sessionId>.json 的 variables 键）三级 GET/PUT/DELETE + 合并视图（chat>character>global）
 * - 脚本执行沙箱：JSON 描述的脚本注册表 + 白名单 action 执行器（不 eval 任意 JS）
 *
 * 路由前缀 /dsht-tavern-helper（避开 /dsht-rp）。
 */
import { type LikePluginContext } from '../dsht-plugin-shared/http.ts';
export declare const name = "dsht-plugin-tavern-helper";
export declare const inject: string[];
export declare function apply(ctx: LikePluginContext, _config: unknown): void;
