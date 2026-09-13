/**
 * ./scripts/utils.js —— ST 标准工具模块的**兼容实现**（T-63）
 * ============================================================================
 * 【为什么有这个文件】第三方卡的宿主注入脚本用 ES 静态 import 取这两个符号
 * （卡的取用面实测：`tmp/t37-inject.js:2232-2235` 只要
 *   `equalsIgnoreCaseAndAccents` / `getSanitizedFilename`）。
 * 静态 import 是原子的：任一符号取不到，整段 module 脚本不执行。
 *
 * 【实现性质】**接口对齐 + 独立实现**。
 *   导出名与调用契约（参数、返回、边界行为）按互操作需要对齐 ST 的公开 API；
 *   函数体为本项目自行编写，未复制上游实现文本。
 *   `utils` 的完整导出面**未全量实现**——只按实测取用面补齐，不做无据扩展（LEARNINGS L31）。
 *
 * 【契约说明（对外可观测行为，是兼容面的真正内容）】
 *   - 大小写/音标不敏感比较：先做 Unicode 组合字符分解（NFD）并剥除组合音标，
 *     再统一小写，最后交给调用方给定的比较函数。
 *     任一入参为假值（'' / null / undefined）时不做归一，直接交比较函数
 *     —— 这是调用方依赖的边界语义（例如「空名不参与比较」）。
 *   - `getSanitizedFilename`：把文件名净化为可安全落盘的形式；
 *     净化后为空则**抛错**（不静默返回空串）。
 */

/** Unicode 组合用变音符号区间（NFD 分解后出现，剥掉即得"无音标"形） */
const COMBINING_DIACRITICS = /[\u0300-\u036f]/g

/**
 * 归一化到"大小写与音标均不敏感"的可比较形式。
 * 单源：所有同族比较函数都经此，避免多处各写一遍归一化。
 */
function foldForComparison(value) {
  return String(value).normalize('NFD').replace(COMBINING_DIACRITICS, '').toLowerCase()
}

/**
 * 以调用方给定的比较函数比较两个字符串，比较前先做大小写/音标折叠。
 * 任一入参为假值则跳过折叠（保真边界，见文件头契约说明）。
 */
export function compareIgnoreCaseAndAccents(a, b, comparisonFunction) {
  if (!a || !b) return comparisonFunction(a, b)
  return comparisonFunction(foldForComparison(a), foldForComparison(b))
}

/** 相等判定（折叠后严格相等） */
export function equalsIgnoreCaseAndAccents(a, b) {
  return compareIgnoreCaseAndAccents(a, b, (x, y) => x === y)
}

/** 排序用比较（折叠后按本地化顺序；空值按 0 处理） */
export function sortIgnoreCaseAndAccents(a, b) {
  return compareIgnoreCaseAndAccents(a, b, (x, y) => (x == null ? 0 : x.localeCompare(y)))
}

/** 子串包含判定（折叠后包含） */
export function includesIgnoreCaseAndAccents(text, searchTerm) {
  if (!text || !searchTerm) return String(text ?? '').includes(String(searchTerm ?? ''))
  return compareIgnoreCaseAndAccents(text, searchTerm, (x, y) => x.includes(y))
}

/**
 * 文件名词净化规则（本项目自定的实现，行为对齐 `sanitize-filename` 的公开语义）：
 * 替换路径分隔符与保留字符、剔除控制字符、拒绝纯点名、避开 Windows 保留设备名、
 * 去掉结尾的点与空格、限长 255。
 */
const FILENAME_FORBIDDEN = /[\/\?<>\\:\*\|"]/g
const FILENAME_CONTROL = /[\x00-\x1f\x80-\x9f]/g
const FILENAME_ONLY_DOTS = /^\.+$/
const FILENAME_DEVICE_NAMES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i
const FILENAME_TRAILING = /[\. ]+$/

export function sanitizeFileName(input, replacement = '') {
  const repl = String(replacement ?? '')
  const sanitized = String(input ?? '')
    .replace(FILENAME_FORBIDDEN, repl)
    .replace(FILENAME_CONTROL, repl)
    .replace(FILENAME_ONLY_DOTS, repl)
    .replace(FILENAME_DEVICE_NAMES, repl)
    .replace(FILENAME_TRAILING, repl)
  return sanitized.slice(0, 255)
}

/**
 * 净化文件名；净化后为空 ⇒ **reject**（调用方按 Promise 失败处理，不静默给空串）。
 */
export async function getSanitizedFilename(fileName) {
  const result = sanitizeFileName(fileName, '_')
  if (!result) {
    const err = new Error('Could not sanitize fileName')
    console.error('[dsht-st-module] Could not sanitize fileName', err)
    throw err
  }
  return result
}
