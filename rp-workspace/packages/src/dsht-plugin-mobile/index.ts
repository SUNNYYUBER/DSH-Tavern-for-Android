/**
 * dsht-plugin-mobile 的 node 侧主入口（空壳）。
 *
 * DSH 双面插件模式：cordis Loader 在 node 侧激活 entry 时 import 本入口；
 * 移动端适配全部在 ./client（lib/client.js wire 契约 bundle，由
 * ClientModuleRegistry 扫 dsh.client 声明进 __DSH_BOOT__，浏览器端激活）。
 * 这里无事可做——本插件无任何 host 侧数据面。
 */

export const name = 'dsht-plugin-mobile'
export const inject: string[] = []

export function apply(_ctx: unknown): void {
  void _ctx
}
