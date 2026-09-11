#!/usr/bin/env node
/**
 * t46-surface-gap.mjs — T-46 三项分档的**静态取证**工具（零风险：只读文件，不改任何东西）
 * ====================================================================================
 * 【为什么需要它】
 *   `audit-card-context-surface.mjs` 量的是「**卡的访问路径** vs 我方门面」，判据是并集
 *   （宿主面 ∪ iframe 面）→ 宿主面无缺口即报「缺口 0」。这在「卡到底在哪个帧取 ctx」
 *   未定性时是对的（保守），但它**遮住了 T-46 的真问题**：
 *   **iframe 面单独拿出来，比基准少多少？**
 *
 * 【基准（第一取证源，非推断）】
 *   真 TH `src/iframe/predefine.js`（TT 对照数据）：
 *
 *     Object.defineProperty(window, 'SillyTavern', {
 *       get: () => {
 *         const SillyTavern = _.get(window.parent, 'SillyTavern');       // ← 同源直取父页
 *         const getContext = () => ({ ...SillyTavern.getContext(), writeExtensionField: … });
 *         return { ...getContext(), getContext };                        // ← 顶层 ≡ getContext() 展开
 *       },
 *     });
 *
 *   ⇒ **基准里 iframe 面没有独立实现、也没有 postMessage 桥**；它就是父页门面的一张投影。
 *   ⇒ 因此「必须同步 / 可桥 / 需注入式装配」这个三分法**在基准形态下不成立**：
 *     同步成员同样可达（同源 + getter 直取），不需要桥，也不需要注入式装配。
 *
 * 本工具把三个口径**同时**量出来并做差：
 *   ① 真 ST `st-context.js:getContext()` 顶层（权威面，基准投影的上游）
 *   ② 我方宿主页 `host-vendor.ts:buildHostStContext()`（= 投影的**可用源**）
 *   ③ 我方 iframe 顶层 `th-shim.ts:window.SillyTavern`（现状）
 *   ④ 我方 iframe `th-shim.ts:buildStContextFacade()`（现状，getContext 口径）
 *
 * 用法：node scripts/audit-iframe-surface-gap.mjs [--card <card.js>] [--md]
 *（T-46 分档工具；初版落在 `stage3-device/hb63/t46-surface-gap.mjs`，因是**可复用审计器**故移入本目录）
 * 退出码：0 = 三口径均无缺口；1 = 有缺口（正常，T-46 待拍板）；2 = 解析失败
 */
import fs from 'node:fs'
import process from 'node:process'
import {
  objectMembers,
  topLevelReturnBrace,
  readStSurface,
  readOurSurface,
  readScriptAccesses,
} from './audit-card-context-surface.mjs'

const UI = 'D:/DSH RolePlay/rp-workspace/packages/src/dsht-rp-ui/src/client'
const TH_SHIM = `${UI}/th-shim.ts`
const HOST_VENDOR = `${UI}/host-vendor.ts`
const TH_PREDEFINE =
  'D:/DSH RolePlay/tmp/tt-data/data/default-user/extensions/JS-Slash-Runner/src/iframe/predefine.js'

/** 真 TH iframe 内联脚本（对照形态取证用） */
const TH_PRELOADERS = [
  'src/iframe/predefine.js',
  'src/iframe/parent_jquery.js',
  'src/iframe/adjust_iframe_height.js',
  'src/iframe/cleanup_protector.js',
].map(p => `D:/DSH RolePlay/tmp/tt-data/data/default-user/extensions/JS-Slash-Runner/${p}`)

// ---------------------------------------------------------------- 解析器

/**
 * 取 `Object.defineProperty(window, '<name>', { get: function () { … return { … } } })`
 * 那个 getter 里**顶层 return 体**的成员名。
 *
 * 为什么要专门找 getter 而不是 marker 后首个 `return {`：defineProperty 的 descriptor
 * 对象里还有 `set:` / `configurable:` 等兄弟键，且 getter 体内可能有内层 `return {}`
 * （本文件上一版解析器就踩过「内层 return 抢先命中」的坑，见 audit-card-context-surface
 * 的 topLevelReturnBrace 注释）。故先定位 `get:` 的函数体起点，再交给 topLevelReturnBrace。
 */
export function readDefinePropertyGetter(text, propName) {
  const dp = text.indexOf(`Object.defineProperty(window, '${propName}'`)
  if (dp < 0) throw new Error(`找不到 Object.defineProperty(window, '${propName}')`)
  // getter 可能写成 `get: function ()` 或 `get: () =>`（本次真 TH 是后者）
  const fnRe = /\bget\s*:\s*(?:function\s*)?\(/g
  fnRe.lastIndex = dp
  const m = fnRe.exec(text)
  if (m === null) throw new Error(`defineProperty('${propName}') 内找不到 getter`)
  const brace = topLevelReturnBrace(text, m.index)
  if (brace < 0) throw new Error(`defineProperty('${propName}') getter 内找不到顶层 return {`)
  return objectMembers(text, brace).map(x => x.name)
}

const diff = (a, b) => [...a].filter(x => !b.has(x))

// ---------------------------------------------------------------- 主流程

function main() {
  const argv = process.argv.slice(2)
  let card = null
  let md = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--card') card = argv[++i]
    else if (argv[i] === '--md') md = true
  }

  const stKeys = readStSurface()
  const hostKeys = readOurSurface(HOST_VENDOR, 'export function buildHostStContext')
  const shimText = fs.readFileSync(TH_SHIM, 'utf8')
  const iframeTopKeys = readDefinePropertyGetter(shimText, 'SillyTavern')
  const iframeCtxKeys = readOurSurface(TH_SHIM, 'function buildStContextFacade')

  const st = new Set(stKeys)
  const host = new Set(hostKeys)
  const top = new Set(iframeTopKeys)
  const ctx = new Set(iframeCtxKeys)

  // L44 兜底：任一解析出空壳 → 拒绝给结论（宁可炸也不要假绿）
  if (iframeTopKeys.length < 5) {
    console.error(`[T-46] FATAL iframe 顶层只解析出 ${iframeTopKeys.length} 个成员 —— 解析口径失效`)
    process.exit(2)
  }

  const topGap = diff(st, top)
  const ctxGap = diff(st, ctx)
  const hostGap = diff(st, host)

  console.log('[T-46] 四口径成员数')
  console.log(`  ① 真 ST st-context.js:getContext()      ${stKeys.length}`)
  console.log(`  ② 宿主页 buildHostStContext()           ${hostKeys.length}`)
  console.log(`  ③ iframe 顶层 window.SillyTavern        ${iframeTopKeys.length}`)
  console.log(`  ④ iframe buildStContextFacade()         ${iframeCtxKeys.length}`)
  console.log('')
  console.log(`[T-46] 缺口（真 ST 有、我方该口径没有）`)
  console.log(`  ③ iframe 顶层缺 ${topGap.length}：${topGap.join(', ') || '—'}`)
  console.log(`  ④ iframe getContext 缺 ${ctxGap.length}：${ctxGap.join(', ') || '—'}`)
  console.log(`  ② 宿主面缺 ${hostGap.length}：${hostGap.join(', ') || '—'}`)
  console.log('')

  // —— 三档分类（对 iframe 顶层缺口逐个体检"投影源头是否已就绪"）——
  const projA = topGap.filter(k => host.has(k)) // 源头已具备 → 直接投影即可
  const projB = topGap.filter(k => !host.has(k)) // 源头也没有 → 真缺口
  console.log('[T-46] iframe 顶层缺口分档（判据：宿主面是否已有该成员）')
  console.log(`  A 类 · 宿主面已具备 ⇒ 基准形态（投影）即可覆盖：${projA.length}`)
  console.log(`      ${projA.join(', ') || '—'}`)
  console.log(`  B 类 · 宿主面也没有 ⇒ 真缺口（需先补宿主面）：${projB.length}`)
  console.log(`      ${projB.join(', ') || '—'}`)
  console.log('')

  // —— 落地风险清单：iframe 自建独有的成员（投影后会「丢」的那些）——
  // 这是 T-46 若采纳投影方案时**唯一需要人工逐个核对**的清单：投影 = iframe 顶层变成
  // 「宿主面 + getContext」，凡自建有、宿主面没有的成员都会消失。要么在宿主面补上，
  // 要么显式登记为差异（不能静默丢）。
  const selfOnly = diff(top, host)
  console.log('[T-46] iframe 自建独有（投影后会丢 ⇒ 必须逐个核对）')
  console.log(`  ${selfOnly.length} 个：${selfOnly.join(', ') || '—'}`)
  console.log(`  宿主 ∩ iframe 顶层 = ${[...host].filter(k => top.has(k)).length} 个（投影可无缝继承）`)
  console.log('')

  // —— 基准形态取证：真 TH predefine.js 逐字 ——
  if (fs.existsSync(TH_PREDEFINE)) {
    const pre = fs.readFileSync(TH_PREDEFINE, 'utf8')
    const readsParent = /window\.parent/.test(pre)
    const projectsSt = /_.get\(window\.parent,\s*'SillyTavern'\)/.test(pre)
    const mergesCtx = /\.\.\.getContext\(\)/.test(pre)
    // ⚠️ 首版正则写的是 /TavernHelper\)._bind/ —— 真 TH 实际写法是
    // `_.get(window.parent, 'TavernHelper')._bind`，中间隔着 `'` 与 `)`，故**假阴性**。
    // 这正是「枚举器自身必须先过正控」要防的失败模式（L44）：判据写错 → 打出"基准也没做"的假结论。
    const bindsBind = /\._bind\b/.test(pre)
    const sharesLodash = /window\._ = window\.parent\._/.test(pre)
    console.log('[T-46] 基准形态取证（真 TH src/iframe/predefine.js）')
    console.log(`  读 window.parent              : ${readsParent ? 'YES' : 'NO'}`)
    console.log(`  SillyTavern ← parent.SillyTavern : ${projectsSt ? 'YES' : 'NO'}`)
    console.log(`  顶层 ≡ ...getContext()        : ${mergesCtx ? 'YES' : 'NO'}`)
    console.log(`  TavernHelper._bind 去下划线挂载 : ${bindsBind ? 'YES' : 'NO'}`)
    console.log(`  window._ = parent._（lodash 共享）: ${sharesLodash ? 'YES' : 'NO'}`)
    console.log('')
  } else {
    console.log('[T-46] ⚠ 未找到真 TH predefine.js 对照源，基准形态取证跳过')
    console.log('')
  }

  // —— 卡访问面（可选）：卡的 19 个成员分别在三个口径里有没有 ——
  if (card !== null) {
    const { aliases, paths } = readScriptAccesses(card)
    console.log(`[T-46] 卡样本 ${card}`)
    console.log(`  绑定别名：${aliases.join(', ') || '—'}；访问路径 ${paths.size} 条`)
    for (const [entry, lines] of paths) {
      const root = entry.split('.')[0]
      const at = st.has(root)
        ? `ST:${host.has(root) ? 'H' : '-'}${top.has(root) ? 'T' : '-'}${ctx.has(root) ? 'C' : '-'}`
        : 'ST-out-of-scope'
      console.log(`  ${root.padEnd(28)} ${at}   (${lines.length} 处)`)
    }
    console.log('  图例 ST: 宿主面 / 顶层 / getContext —— H=有 T=有 C=有, -=缺')
    console.log('')
  }

  if (md) {
    console.log('<!-- 供 TASK-LIST 引用 -->')
    console.log(`| 口径 | 成员数 | 缺口 |`)
    console.log(`|---|---|---|`)
    console.log(`| 真 ST st-context.js:getContext() | ${stKeys.length} | — |`)
    console.log(`| 宿主页 buildHostStContext() | ${hostKeys.length} | ${hostGap.length} |`)
    console.log(`| iframe 顶层 window.SillyTavern | ${iframeTopKeys.length} | ${topGap.length} |`)
    console.log(`| iframe buildStContextFacade() | ${iframeCtxKeys.length} | ${ctxGap.length} |`)
  }

  process.exit(topGap.length > 0 || ctxGap.length > 0 || hostGap.length > 0 ? 1 : 0)
}

main()
