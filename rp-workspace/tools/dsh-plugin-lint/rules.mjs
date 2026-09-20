/**
 * rules.mjs —— dsh-plugin-lint 规则表（SSOT）
 * ============================================================================
 * 每条规则 = { id, severity, face, typology?, title, why }
 *   severity: 'fail'（崩溃/装不上级）| 'risk'（实测踩雷形态）| 'info'（建议）
 *   face:     'host'（加载完整性）| 'android'（Android 适配预判）| 'stability'
 *             （跨版本稳定风险）——verdict 分面呈现，人工实测结论的对账粒度（见
 *             golden-replay：session-pin 主功能走契约面 ✅ 但增强面带防御地用
 *             了非契约投影 ⇒ host=pass + stability=risk 并存，两者不矛盾）
 *   typology: 冲突类型学编号（⑧⑨…），必须与 docs/PLUGIN-COMPAT.md §5.3 的
 *             编号**一一对账**（tools 测试里有机器对账——防两份真相漂移）。
 *
 * 规则来源：全部来自真实实测案例（PLUGIN-COMPAT §5.2/§5.3），不写想象中的规则。
 * 金标准回放（test/golden-replay.mjs）：
 *   session-pin ✅ / better-stats ✅ / turn-index ⚠(⑧) / outline ⚠(⑧) / zhipu ❌(⑨)
 */
export const RULES = [
  // ---- 静态面（打包/安装完整性）----
  {
    id: 'S1-closure', severity: 'fail', face: 'host', typology: '⑨',
    title: 'import 闭包缺文件',
    why: '入口可达的相对 import 解析不到包内文件 ⇒ 加载即 ERR_MODULE_NOT_FOUND ⇒ cordis 插件树加载失败连带宿主 crash-loop（zhipu-toolkit 0.2.1 实测）',
  },
  {
    id: 'S2-bare-undeclared', severity: 'fail', face: 'host',
    title: 'bare import 未声明 dependencies',
    why: 'host 侧 import 第三方包但 package.json 未声明 ⇒ 安装器不装依赖 ⇒ 加载即崩（DSH 运行时提供 cordis / @deepseek-ai/* / node 内建，其余必须自声明）',
  },
  {
    id: 'S3-plugin-manifest', severity: 'fail', face: 'host',
    title: '缺插件清单（cordis.patch.yml 与 dsh.plugin.json 均无）',
    why: '两种注册形态都没有 ⇒ dsh plugin add 无法识别该包（装不上）',
  },
  {
    id: 'S4-engines-dsh', severity: 'info', face: 'host',
    title: '未声明 engines.dsh 兼容窗口',
    why: '没有窗口声明 ⇒ 用户无法预判升级 DSH 后是否还兼容；建议钉法 ">=0.1.5-rc.1 <0.1.6" 形态',
  },
  {
    id: 'S5-files-exist', severity: 'fail', face: 'host',
    title: 'files 清单项不存在',
    why: 'files 列了不存在的路径 ⇒ npm publish 后包内容缺斤短两（与 ⑨ 同族）',
  },
  {
    id: 'S6-required-fields', severity: 'fail', face: 'host',
    title: 'package.json 缺必备字段（name/version/main/description/license）',
    why: 'npm 发布与 cordis 加载的最低要求',
  },
  // ---- 嗅探面（client face 依赖 = 类型学 ⑧）----
  {
    id: 'N1-client-face', severity: 'risk', face: 'stability', typology: '⑧',
    title: 'client 侧依赖 client face 内部投影形态',
    why: 'sessions.binding()/getSnapshot().chat/snapshot.nodes 这类投影不在 cordis 契约面内，DSH 版本升级后形态可能变——turn-index（条目恒空）与 outline（snapshot.nodes is not iterable → slot 崩溃隔离 → UI 不现身）双案实测',
  },
  // ---- Android 约束预判 ----
  {
    id: 'A1-native-module', severity: 'fail', face: 'android',
    title: 'host 侧依赖原生模块（Android 不可用）',
    why: 'sharp/koffi/node-pty/better-sqlite3 等原生模块在 Android bionic 无法加载（DSHTavern 以 stub 替换，调用即抛受控错误）',
  },
  {
    id: 'A2-subprocess-tool', severity: 'info', face: 'android',
    title: 'host 侧 spawn 系统工具',
    why: 'bash/rg/git/zstd 已被 DSHTavern P1 能力包内置（可用）；ffmpeg/docker/python 等其余工具在 Android 不存在——确认你的命令在白名单内',
  },
]

/** 类型学编号 → 文档锚点（报告面链接用） */
export const TYPOLOGY_DOC = 'docs/PLUGIN-COMPAT.md'
