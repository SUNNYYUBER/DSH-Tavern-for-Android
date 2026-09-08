import type { LikePluginContext } from './http.ts';
/** 注册空设置命名空间；失败只告警，绝不影响插件本体（路由/引擎照常）。 */
export declare function registerSettingsNamespace(ctx: LikePluginContext, ns: string, logTag: string): void;
