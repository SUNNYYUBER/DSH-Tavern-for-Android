/**
 * ./script.js —— ST 主模块的**兼容实现**（单源静态资产，T-63）
 * ============================================================================
 * 【为什么必须有】第三方卡的宿主注入脚本用 ES 静态 import 取本模块：
 *   `import { displayVersion } from "./script.js"`
 *   （卡的加载器 `importFromModule`，原文见 tmp/t37-inject.js:103-127 / 调用点 :2219-2243）
 * 静态 import 是**原子**的：任一条取不到即整段 `<script type="module">` 不执行
 * → `module_imported` 不发射 → 卡的 patch 段与四段核心功能（RegexBinding / ChatSquash /
 * MacroNest / syncSPresetToolRegistrations）全不执行。
 *
 * 【实现性质】接口对齐 + 独立实现：导出名与取值语义按互操作需要对齐 ST 公开面，
 * 实现为本项目自行编写。
 *
 * 【可观测契约】
 *  - `displayVersion`：字符串。初值为品牌名；会话启动后取本机 `/version` 的
 *    `pkgVersion` 组合成人类可读版本串（含 git 分支/修订时追加）。
 *  - `streamingProcessor`：**保持 `null` 初值**。该对象在 ST 里由前端生成栈在每轮生成时替换；
 *    本项目生成在 **node 侧**、浏览器侧不存在该对象 ⇒ 如实保持初值，
 *    不伪造一个假处理器（伪造 = 把「静默缺失」换成「错误地看起来能用」）。
 *    卡侧取用面本就带 null 兜底（`inject.js:1345-1347` `|| getContext()?.streamingProcessor || null`）。
 */

/** 版本串初值（取到 /version 后改写） */
export let displayVersion = 'SillyTavern'

/** 生成流处理器占位（见文件头契约说明：本项目无浏览器侧生成栈） */
export let streamingProcessor = null

/** 模块加载即取真实版本（失败保持初值；**出声**，不静默） */
export const versionReady = (async () => {
  try {
    const res = await fetch('/version', { method: 'GET' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const pkg = String(data?.pkgVersion ?? '')
    if (!pkg) throw new Error('pkgVersion missing')
    displayVersion = `SillyTavern ${pkg}`
    // 基准 :510：仅在响应确有 gitBranch/gitRevision 时追加（我方 /version 两者为 null → 不追加）
    const branch = data?.gitBranch
    const rev = data?.gitRevision
    if (branch != null && rev != null) displayVersion += ` '${branch}' (${rev})`
    return { ok: true, displayVersion }
  } catch (e) {
    // L42：降级必须出声且可定位
    console.warn('[dsht-st-module] /version 取版本失败，displayVersion 保持初值：', e && e.message)
    return { ok: false, displayVersion }
  }
})()
