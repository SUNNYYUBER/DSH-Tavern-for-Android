/**
 * F4-C1 真根因单测（2026-09-14 设备实测）：
 *  ① `/rp/model-capability` 的 pi-ai 目录读取在真机上**恒失败**
 *     （`createRequire().resolve('@earendil-works/pi-ai/dist/providers/data/x.json')`
 *      被 package `exports` 白名单拒绝 → ERR_PACKAGE_PATH_NOT_EXPORTED）
 *     ⇒ contextWindow 恒 null ⇒ 前端只能落到「预算未知」占位值
 *     ⇒ **「优先取模型真实能力」这条从未生效**，而 HTTP 200 + null 是「合法返回值」
 *     ⇒ 典型静默降级（P-3 / P-11）。
 *  ② `RpTokenMeter` 的 `useMemo` 写在条件早退**之后** ⇒ hook 数随语义变化
 *     ⇒ React error #310 ⇒ 被宿主 SlotErrorBoundary 吞成空 div
 *     ⇒ 进度条**在真机上从未渲染过**（P-15：hook 不得在早退之后）。
 *
 * 本文件同时守两条：**行为判据**（真读 pi-ai 目录，PC 上应拿得到真值）
 * 与**结构护栏**（源码里不许再出现这两类形态）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { findUpPackageDir, readPiAiCatalogCapability } from '../src/dsh-plugin/index.ts'

const PKG_SRC = join(import.meta.dirname, '..', 'src')
const read = (rel: string): string => readFileSync(join(PKG_SRC, rel), 'utf8')

/**
 * 剥离注释后再做结构断言。
 *
 * 为什么必须剥：本仓的工程习惯是「把缺陷成因与修法写进头注」（这对后来者极有价值），
 * 于是注释里会**原文引用**被禁止的旧写法（如 `createRequire(...).resolve(...)`）。
 * 若不剥注释，护栏会因「注释里提到了旧写法」而误红 —— 这正是 P-11 里
 * 「判据写错会把好代码判成坏代码」的形态。故：判据只看**活代码**。
 */
function stripComments(src: string): string {
  // 先去掉块注释，再去行注释（顺序不能反：反了会把块注释里的 // 当成行注释起点）
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

// ---------------------------------------------------------------------------
// 1. 行为判据：pi-ai 目录读取必须真的能拿到值
// ---------------------------------------------------------------------------

describe('readPiAiCatalogCapability：pi-ai 内建目录能力读取（F4-C1）', () => {
  it('【正控】PC 环境下 deepseek/deepseek-v4-flash 必须读到真实 contextWindow', async () => {
    const cw = await readPiAiCatalogCapability('deepseek', 'deepseek-v4-flash', 'contextWindow')
    // pi-ai 目录里该模型声明 1M 上下文（node_modules/@earendil-works/pi-ai/dist/providers/data/deepseek.json）
    expect(cw, 'pi-ai 目录读取失效（曾因 exports 白名单恒 null ⇒ 预算口径整体失效）').toBe(1_000_000)
  })

  it('【正控】maxTokens 同样可读（与 contextWindow 同源不同字段）', async () => {
    const mt = await readPiAiCatalogCapability('deepseek', 'deepseek-v4-flash', 'maxTokens')
    expect(mt).toBe(384_000)
  })

  it('【负控】不存在的 model → null（不是 0、不是抛错）', async () => {
    const cw = await readPiAiCatalogCapability('deepseek', 'no-such-model-xyz', 'contextWindow')
    expect(cw).toBeNull()
  })

  it('【负控】不存在的 provider → null（目录文件不存在）', async () => {
    const cw = await readPiAiCatalogCapability('no-such-provider-xyz', 'deepseek-v4-flash', 'contextWindow')
    expect(cw).toBeNull()
  })

  it('【安全】provider 名做路径穿越防御（不许拼出 ../ 出去）', async () => {
    for (const bad of ['../../../etc/passwd', '..', 'a/b', 'a\\b', '']) {
      expect(await readPiAiCatalogCapability(bad, 'deepseek-v4-flash', 'contextWindow')).toBeNull()
    }
  })

  it('【边界】空 model / 空 provider → null（不抛）', async () => {
    expect(await readPiAiCatalogCapability('', 'x', 'contextWindow')).toBeNull()
    expect(await readPiAiCatalogCapability('deepseek', '', 'contextWindow')).toBeNull()
  })
})

describe('findUpPackageDir：包定位（真 node 与 vite 转换环境都成立）', () => {
  it('【正控】能从本测试文件所在目录向上找到 pi-ai', () => {
    const dir = findUpPackageDir(import.meta.dirname, '@earendil-works/pi-ai')
    expect(dir, '向上遍历未命中——目录布局变了？').not.toBeNull()
    expect(dir!.replace(/\\/g, '/')).toMatch(/node_modules\/@earendil-works\/pi-ai$/)
  })

  it('【负控】不存在的包名 → null（不抛、不死循环）', () => {
    expect(findUpPackageDir(import.meta.dirname, '@no-such-scope/no-such-pkg-xyz')).toBeNull()
  })

  it('【边界】从盘根出发 → null（dirname 到达根时稳定终止）', () => {
    expect(findUpPackageDir('D:/', '@no-such-scope/no-such-pkg-xyz')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 2. 结构护栏：旧写法不许回来
// ---------------------------------------------------------------------------

describe('F4-C1 结构护栏：不许再用 CJS resolve 猜 pi-ai 子路径', () => {
  const code = stripComments(read('dsh-plugin/index.ts'))

  it('【反例】活代码里不得用 createRequire 解析 pi-ai（exports 会拒绝）', () => {
    expect(code).not.toMatch(/createRequire[\s\S]{0,200}@earendil-works\/pi-ai/)
    expect(code).not.toMatch(/\.resolve\(\s*[`'"]@earendil-works\/pi-ai\//)
  })

  it('【正控】必须走「包定位 + 磁盘布局」两步（不依赖 exports 白名单）', () => {
    expect(code).toContain('findUpPackageDir(')
    expect(code).toContain("'dist', 'providers', 'data'")
  })

  it('model-capability 路由确实调用了共享读取函数（而不是又内联一份）', () => {
    expect(code).toContain('readPiAiCatalogCapability(provider, model,')
  })
})

describe('P-15 结构护栏：hook 调用不得位于条件早退之后', () => {
  it('【回归】RpTokenMeter：useMemo 必须在早退之前', () => {
    const src = read('dsht-rp-ui/src/client/RpTokenMeter.tsx')
    const memoIdx = src.indexOf('const reading = useMemo(')
    const bailIdx = src.indexOf('if (!slug || !sessionId || blank) return null')
    expect(memoIdx, '未找到 useMemo').toBeGreaterThan(-1)
    expect(bailIdx, '未找到早退语句').toBeGreaterThan(-1)
    expect(memoIdx, 'useMemo 在条件早退之后 ⇒ React error #310（hook 数变化）').toBeLessThan(bailIdx)
  })

  it('【通用反例】RpTokenMeter 里早退之后不得再出现任何顶层 hook 调用', () => {
    const src = read('dsht-rp-ui/src/client/RpTokenMeter.tsx')
    const bailIdx = src.indexOf('if (!slug || !sessionId || blank) return null')
    const tail = src.slice(bailIdx)
    // 早退后的代码里不许再出现 `= useXxx(` 形态的顶层 hook 赋值
    const offenders = tail.match(/^\s{2}(?:const|let)\s+\[?[A-Za-z_$][\w$]*\]?\s*=\s*use[A-Z]\w*\(/gm) ?? []
    expect(offenders, `早退后有顶层 hook：${offenders.join(' | ')}`).toHaveLength(0)
  })
})
