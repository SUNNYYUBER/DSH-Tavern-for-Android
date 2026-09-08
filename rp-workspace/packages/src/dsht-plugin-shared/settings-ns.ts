/**
 * 任务 C2：设置命名空间注册（让三个预适配插件出现在 设置 → 插件 → 「可配置」tab）。
 *
 * 机制（deepseek-harness ui-settings-plugins tab-store）：「可配置」tab 渲染 =
 * Host settings.describe 服务的命名空间 ∩ 浏览器侧 settings.plugin.item 槽位卡。
 * 本函数负责前者：以插件 fiber 名义注册一个命名空间（空 schema——三个插件的实际
 * 配置走各自的 rp/*.json 文件，不进 settings.yaml；命名空间只做"可辨识"锚点）。
 * 后者（同 key 的极简中文卡）在 dsht-rp-ui 客户端注册。
 *
 * schemastery 与 runtime 同版本（3.18.1）打包进插件 bundle；settings.register
 * 对 schema 是鸭子类型调用（schema(value) + toJSON()），无跨模块 identity 依赖。
 */
import z from '@deepseek-ai/schemastery'
import type { LikePluginContext } from './http.ts'

interface LikeSettings {
  register: (ns: string, schema: unknown, options?: { base?: unknown }) => unknown
}

/** 注册空设置命名空间；失败只告警，绝不影响插件本体（路由/引擎照常）。 */
export function registerSettingsNamespace(ctx: LikePluginContext, ns: string, logTag: string): void {
  const settings = (ctx as LikePluginContext & { settings?: LikeSettings }).settings
  if (!settings || typeof settings.register !== 'function') return
  try {
    settings.register(ns, z.object({}), { base: {} })
    console.log(`[${logTag}] settings namespace registered: ${ns}`)
  } catch (e) {
    console.warn(`[${logTag}] settings namespace ${ns} 注册失败（不影响插件本体）：${(e as Error).message}`)
  }
}
