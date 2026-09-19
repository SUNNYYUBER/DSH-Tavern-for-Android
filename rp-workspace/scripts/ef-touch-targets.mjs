#!/usr/bin/env node
/**
 * ef-touch-targets.mjs —— 设备侧探针：**我方全部可点元素**的触控目标尺寸穷举。
 *
 * ## 为什么要有这个探针（而不是只靠 perf-audit 面 7）
 *
 * 第十九轮（L2「字号与缩放」格）踩到一个**静态护栏全绿而功能失效**的坑：
 * `.dsht-rp-import-dock` 的 `height: 44px !important` **规则命中**（CDP
 * `getMatchedStylesForNode` 确证），渲染高度却是 **19.45px** —— 真因是它作为
 * flex item 被 `flex-shrink` 把 height 压回（⇒ 判据 **P-25**）。
 *
 * 这一次暴露了 `perf-audit.mjs` 面 7 的**三个覆盖盲区**（本探针的存在理由）：
 *   ① 它只查 `button[class*="dsht-"], [class*="dsht-rp"] button, [class*="dsht-npc"] button`
 *      —— `[role=button]` 的 div（如 `MigrationStatusPanel` 的折叠头）、`<label>`、
 *      自定义可点 div **全都不查**；
 *   ② 它对 `::after` 放大层做了补偿（`min-width/min-height`），这在**判断**上是对的，
 *      但它读的是 `getBoundingClientRect()`（**渲染结果**）—— 这点是对的，
 *      然而**没有任何"成因诊断"**：报红了也不知道是规则没写、被层叠压回、还是被 flex 压回；
 *   ③ 它是 `perf-audit.mjs` 的一个"面"（整脚本要跑帧率/内存等重活），
 *      **不能单独快速跑**，所以日常不会被当作判据使用。
 *
 * 本探针只做一件事：**穷举我方可点元素 → 测渲染尺寸 → 对不达标项自动归因**。
 *
 * ## 判据口径（与 §二 L1 一致，单源）
 *   底线 **38×38**（P1 阻塞） / 目标 **44×44**（P2 择期）
 *   —— 本探针按 **38** 判 PASS/FAIL（底线），不达标项里再分「<38 阻塞」与「38~43 未达目标」。
 *
 * ## 判据自身的纪律（历史坑，逐条对应）
 *   · **P-24**：判据落在**渲染结果**（`getBoundingClientRect`），不落「规则是否写了」。
 *   · **P-17**：测不出来 ≠ 事实否定 —— 页面未就绪 ⇒ SKIP，不记 FAIL。
 *   · **R17**：判据范围 = **责任边界**，**只取我方**（宿主 composer 按钮属 B6，不纳入）。
 *     归属判定用**选择器/命名空间**（`.dsht-rp-*` / `[data-dsht-*]` / `.dsht-npc-*`），
 *     不靠名字猜。
 *   · **R16**：禁止固定 sleep 充当就绪，必须轮询到连续两次签名一致。
 *   · 归因必须用**决定性实验**（逐条单独施加 inline `!important` 对照），
 *     而不是读层叠规则猜（第十九轮的教训：读规则会误判）。
 *
 * 用法：node scripts/ef-touch-targets.mjs [--state <态名>]
 *   不带参数 ⇒ 跨态穷举全部态（W2）；--state base ⇒ 只跑单个态（调试/复测）。
 * 退出码：0 全 PASS / 1 有 FAIL / 2 探针自身失败 / 3 找不到 adb / 4 无 page target
 */
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { makeEv } from './cdp-eval.mjs'

function resolveAdb() {
  const cands = [
    process.env.DSHT_ADB, process.env.ADB_PATH,
    process.env.ANDROID_HOME && `${process.env.ANDROID_HOME}/platform-tools/adb.exe`,
    process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}/Android/Sdk/platform-tools/adb.exe`,
    process.env.USERPROFILE && `${process.env.USERPROFILE}/.android/sdk/platform-tools/adb.exe`,
    'adb',
  ].filter(Boolean)
  for (const c of cands) { if (c === 'adb') return c; if (existsSync(c)) return c }
  return null
}
const ADB = resolveAdb()
if (!ADB) { console.error('[FATAL] 找不到 adb（DSHT_ADB / ANDROID_HOME / ~/.android/sdk）'); process.exit(3) }

const PORT = process.env.CDP_PORT || '9333'
const PKG = 'com.dshtavern.app'
const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * 把 adb 的 CDP 转发**重新指向当前**应用的 webview_devtools socket。
 *
 * 【为什么必须有这一步 —— R15 的第二次现身】
 * `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>` 里的 `<pid>`
 * 在**应用被重启/被杀后就会失效**（新进程新 pid）。此时转发仍在，但指向的 socket
 * 已不存在 ⇒ `fetch(http://127.0.0.1:9333/json)` 直接 ECONNREFUSED / 传输错误。
 *
 * 上一轮 W2 实测就撞上了：我 `am force-stop` + relaunch 推送新产物后，
 * 探针 12 个态**全部**「快照失败」——看起来像「产品坏了」，实际是**测具没自愈**。
 * （R15 原话：「测具不得假设连接/目标身份稳定」。这条当时只写进纪律，未落到测具实现 ⇒
 *   本轮把它**实现**出来：探针开工前先按实时 pid 重设转发，失败则如实报错并退出代码 3。）
 *
 * 纪律：本步骤**不改变设备状态**（只改本机 adb 转发表），对被测系统零副作用。
 */
function resetForward () {
  try {
    const pid = String(execFileSync(ADB, ['shell', 'pidof', PKG], { encoding: 'utf8', timeout: 15000 })).trim().split(/\s+/)[0]
    if (!pid || !/^\d+$/.test(pid)) return { ok: false, reason: `取不到 ${PKG} 的 pid（应用没在跑？）` }
    try { execFileSync(ADB, ['forward', '--remove-all'], { timeout: 10000, stdio: 'ignore' }) } catch { /* 无转发时也报错，忽略 */ }
    execFileSync(ADB, ['forward', `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`], { encoding: 'utf8', timeout: 15000 })
    return { ok: true, pid }
  } catch (e) {
    return { ok: false, reason: String(e.message).slice(0, 120) }
  }
}

const fw = resetForward()
if (!fw.ok) {
  console.error(`[FATAL] 无法建立 CDP 转发：${fw.reason}`)
  console.error('        （先确认应用在跑：adb shell monkey -p com.dshtavern.app -c android.intent.category.LAUNCHER 1）')
  process.exit(3)
}
console.log(`[ef-touch-targets] CDP 转发已指向当前进程 pid=${fw.pid}（R15：每次开工重设，避免指向已失效的旧 socket）`)

/**
 * CDP 求值 —— **走单源模块**（P-1）。
 *
 * 【为什么改成 import】本文件的 `ev()` 与 `ef-font-scale.mjs` 里那段曾是
 * **逐字同构的两份拷贝**（连「`tries/gap` 只在抛异常时重试」这个缺陷都一模一样）
 * ⇒ 修一处**不会**传导到另一处（W30 实测抓到的 P-1 违例）。
 * 项目的「同一功能多实现」门禁只扫 `packages/src`、**不扫 `scripts/`**
 * ⇒ 这处重复它**结构性看不见**（P-11 元级）⇒ 收口到 `cdp-eval.mjs`。
 *
 * ⚠️ 语义提醒（W30 抓到的那一层）：`ev` 的 `tries/gap` 是**连接级**重试 ——
 * 表达式**正常返回 `false` 不会重试**。要「等业务条件成立」必须用外层 `while` 轮询
 * （本文件的态生效校验与 `snapStable` 都是这么做的）。
 */
const ev = makeEv({ port: PORT })

/**
 * 穷举我方可点元素 + 归因。
 *
 * 归属判据（R17，**只取我方**）：
 *   · 选择器命中 `.dsht-rp-overlay` / `[data-dsht-mobile]` 之内，或
 *   · 元素自身/祖先带 `dsht-` 命名空间类（我方的命名空间约定），或
 *   · 带 `data-dsht-` 属性
 * 明确**排除**宿主（`uV2eYG_*` 等哈希类名不带 `dsht-` 前缀）。
 */
const SNAP = `(async () => {
  const de = document.documentElement
  const MIN = 38, TARGET = 44
  const sleep = (ms) => new Promise(r => setTimeout(r, ms))

  // ---- 就绪判定（R16：不靠 sleep）----
  const overlay = document.querySelector('.dsht-rp-overlay')
  const composer = document.querySelector('[data-composer-input]')
  const editable = document.querySelector('.dsht-rp-overlay [contenteditable="true"]') || document.querySelector('[contenteditable="true"]')
  const ready = !!editable && (de.scrollWidth > 0)

  // ---- 我方归属判定（R17：判据范围 = 责任边界）----
  //
  // 【踩坑记录 · 本轮两次修正，值得记住】
  //   第 43 次：首版把 [data-dsht-rp-active] 当「我方容器」并用 host.contains(el) 判定 ——
  //     而那个属性挂在 **body** 上 ⇒ contains 对**所有**宿主元素成立 ⇒ 宿主按钮全被吞进来。
  //   第 44 次：改用「带 data-dsht-* 属性」判定 —— **仍然错**，因为
  //     anchors.ts 会给我方选中的**宿主元素**打 data-dsht-mobile 标记
  //     （见 dsht-plugin-mobile/client/style.ts 头注：「本文件只消费
  //      [data-dsht-mobile="<anchor>"]（anchors.ts 运行时打标）」）
  //     ⇒ 宿主元素**也**带该类属性 ⇒ 再次把宿主算成我方。
  //
  // ⇒ **唯一准确的判据是「类名前缀」**：我方自有组件的类名一律以 dsht- 开头；
  //   宿主类名是构建期哈希（hHd-Xa_* / wSkVaW_* / xzv4MW_* 等），不带该前缀。
  //   这也是 perf-audit 面 7 用的口径（button[class*="dsht-"] 等），本处用正则
  //   更严谨（要求 dsht- 出现在类名段的开头，避免 xxx-dsht-y 误判）。
  // 注意：本文件在模板串内，注释里**不能出现反引号**（A11 闸门）。
  const MINE_CLS = /(^|\s)dsht-/
  const isMine = (el) => {
    let e = el
    while (e && e !== document.body && e !== document.documentElement) {
      if (MINE_CLS.test(String(e.className || ''))) return true
      e = e.parentElement
    }
    return false
  }

  // ---- 可点判定（比 perf-audit 面 7 宽：补 role=button / label / 自定义可点 div）----
  //
  // 【第二十轮续三 · 口径补强】原写法只查 'label[for]'（**显式** label），
  //   而本仓正则面板的开关是 **implicit label**（.rx-toggle 用 label 包住 input，
  //   没有 for 属性）—— 它同样可点（点它切换 checkbox），却**扫不到**
  //   ⇒ 判据只覆盖一半的 label 形态（P-19 同族：判据自身的覆盖缺口）。
  //   ⇒ 改用 'label:has(input), label:has(select)' 把 implicit label 纳入；
  //     ':has()' 在设备 WebView 上可用（mobile 包已用 'body:has(...)'，实测有效）。
  const CLICKABLE = [
    'button', 'a[href]', '[role="button"]', 'label[for]', 'label:has(input)', 'label:has(select)',
    'input[type="checkbox"]', 'input[type="radio"]',
    '[onclick]', '[tabindex]:not([tabindex="-1"])',
  ].join(',')
  const looksClickable = (el) => {
    if (el.disabled) return false
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false
    if (cs.pointerEvents === 'none') return false
    return true
  }

  const seenEls = new Set()      // ★ 按**元素身份**去重（滚动扫描必需，见下）
  const seenRect = new Set()     // 按 rect 去重（同一元素在不同滚动位会变 rect）
  const items = []
  const skippedOutOfView = []
  const coveredByLabel = []   // 被 implicit label 代表的原生控件（出声用）

  /** 采一遍**当前视口**。滚动扫描会多次调用它（见文件末尾的滚动段）。 */
  const collectPass = () => {
  for (const el of document.querySelectorAll(CLICKABLE)) {
    if (seenEls.has(el)) continue              // 已采过（滚动前后同一元素）
    if (!isMine(el)) continue                 // R17：只取我方
    if (!looksClickable(el)) continue

    // ---- 原生 checkbox/radio 被 implicit label 包住 ⇒ 不重复计数 ----
    //
    // 【第二十轮续三 · P-23 同族（集合元素选错）】
    //   drawer 态实测：同一处可点区域被算了**两次** ——
    //     label.rx-check（353×37，点它即切换）与 input[type=checkbox]（16×16）。
    //   16×16 报出来是**假 P1**：用户点的是 label，原生控件只是它的内部装饰，
    //   把它单独拿来判「触控目标」等于**把同一个目标拆成两条读数**
    //   ⇒ 产出「要放大原生 checkbox」这种**方向错误的修复建议**（历史踩坑 43~45 同族）。
    //   正确口径：**被 label 包住的原生控件，其有效触控区 = label 的 rect** ⇒
    //   以 label 为代表（label 已在 CLICKABLE 里），input 自身跳过**并出声**（P-3 不许静默）。
    if ((el.tagName === 'INPUT') && (el.type === 'checkbox' || el.type === 'radio')) {
      const lb = typeof el.closest === 'function' ? el.closest('label') : null
      if (lb) {
        const lr = lb.getBoundingClientRect()
        coveredByLabel.push({ ctrl: 'input[type=' + el.type + ']', by: 'label.' + String(lb.className || '').split(/\\s+/)[0], labelRect: [Math.round(lr.width), Math.round(lr.height)] })
        continue
      }
    }

    const b = el.getBoundingClientRect()
    if (b.width < 1 || b.height < 1) continue

    // ---- 视口内判定（必须四边都判，且要判「真实可点」）----
    //
    // 【第 45 次坑 · 本轮踩到】首版只排除「上下」超出（bottom < -50 / top > innerH + 50），
    //   于是把**被折叠侧栏推到视口左外**的 .dsht-rp-sidebar-btn（rect.left = **-288**）
    //   也算作「不达标触控目标」。但它根本不是「太小」—— 而是**当前用户看不到、点不到**
    //   （侧栏 collapsed，祖先 overflow:hidden 已裁掉）。
    //   ⇒ 判据必须锚定「**当前可被用户触碰**」这一前提，否则会产出**虚假的 P1 告警**，
    //     逼人去修一个「折叠状态下本来就不该点」的控件（P-17：测不出来 ≠ 事实否定；
    //     P-24：判据要落在真正的用户可观测结果上）。
    //
    // 正确口径：**用 elementFromPoint 反查「这一点到底能不能点到这个元素」**。
    //   能反查到（自身或后代）才算「真实可点」；否则说明它被裁掉/被盖住/在视口外 ⇒ 跳过。
    const cx = b.left + b.width / 2
    const cy = b.top + b.height / 2
    let hit = null
    try { hit = document.elementFromPoint(cx, cy) } catch { hit = null }
    const reallyClickable = !!hit && (hit === el || el.contains(hit))
    if (!reallyClickable) {
      skippedOutOfView.push({ sel: el.className, rect: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)] })
      continue
    }

    const k = Math.round(b.x) + ',' + Math.round(b.y) + ',' + Math.round(b.width) + ',' + Math.round(b.height)
    if (seenRect.has(k)) continue; seenRect.add(k)
    seenEls.add(el)

    const cls = String(el.className || '').slice(0, 60)
    const cs = getComputedStyle(el)
    const item = {
      tag: el.tagName, cls, w: Math.round(b.width), h: Math.round(b.height),
      txt: (el.textContent || '').trim().slice(0, 16),
      // 基础定位串（可能不唯一 —— 循环结束后统一加序号，见下方 P-23 处理）
      baseSel: (() => {
        if (el.id) return '#' + el.id
        const c = cls.split(/\\s+/).filter(Boolean).slice(0, 2).join('.')
        const t = el.tagName.toLowerCase()
        if (c) return t + '.' + c
        const ty = el.getAttribute('type')
        return ty ? t + '[type="' + ty + '"]' : t
      })(),
      display: cs.display, heightCss: cs.height, minHeightCss: cs.minHeight,
      flexShrink: cs.flexShrink, flexBasis: cs.flexBasis,
      parentDisplay: el.parentElement ? getComputedStyle(el.parentElement).display : null,
      parentFlexDir: el.parentElement ? getComputedStyle(el.parentElement).flexDirection : null,
      alignSelf: cs.alignSelf,
    }
    items.push(item)
  }
  }

  // ---- 采集：先视口，再**滚动扫描**（W30 新增）----
  //
  // 【为什么必须滚（P-20：判据必须自带杠杆）】
  //  设置卡是**长滚动面板**：宿主 .VOzbGW_options 的 scrollHeight **2613** / clientHeight **669**
  //  ⇒ 只扫视口时，一张展开的设置卡里 **28 个我方可点元素只有 2 个在视口内**。
  //  实测读数：host-settings-card-open 首版只报 2 个元素 ——
  //  而那 2 个之外还有 **17 个 .dsht-npc-switch（实测 36×44，宽 36 < 38 底线 = 真 P1）**
  //  以及 select / range / input / save / discard 全在视口下方 ⇒ **整张卡的交互面等于没测**。
  //  ⇒ 这不是「面板太长」的小事：**判据的覆盖面缺口**本身就是 P-20 说的「覆盖空洞」
  //    （长期显示 ✓，真出问题也不会红）。滚一遍即可覆盖（R16：不靠固定 sleep）。
  //
  // 【口径】把每个「**含有我方元素的**可滚动面」（R17：不含我方元素的是宿主自己的列表，
  //  与我方判据无关）按 clientHeight 的 0.6 为步长走一遍，每档采一次；
  //  采完把 scrollTop **还原**（不留副作用 —— 后续 collectState 的 elementFromPoint
  //  依赖「用户真实可见的位置」，改了就不对了）。
  const scrollers = []
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el)
    if (!/(auto|scroll|overlay)/.test(cs.overflowY)) continue
    if (!(el.scrollHeight > el.clientHeight + 8)) continue
    let hasMine = false
    for (const c of el.querySelectorAll(CLICKABLE)) {
      let p = c
      while (p && p !== el.parentElement) { if (MINE_CLS.test(String(p.className || ''))) { hasMine = true; break } p = p.parentElement }
      if (hasMine) break
    }
    if (hasMine) scrollers.push(el)
  }

  collectPass()
  let scrollPasses = 0
  for (const sc of scrollers.slice(0, 4)) {
    const orig = sc.scrollTop
    const max = sc.scrollHeight - sc.clientHeight
    const step = Math.max(120, Math.floor(sc.clientHeight * 0.6))
    for (let y = 0; y <= max; y += step) {
      sc.scrollTop = y
      await sleep(80)
      collectPass()
      scrollPasses++
    }
    sc.scrollTop = max            // 收尾必采最后一档
    await sleep(80)
    collectPass()
    scrollPasses++
    sc.scrollTop = orig
    await sleep(80)
  }

  // ---- 定位串唯一化（P-23：集合元素必须是「标识」不是「内容」）----
  //  同名元素（如 26 行世界书勾选都是 label.rx-check）若共用同一 sel，
  //  跨态并集会把它们**折叠成一条**（26 报成 1），且复现脚本只能命中第一个。
  //  ⇒ 仅当同名出现 >1 次时统一追加 '@@N'（N 从 0 起）；单例保持简洁。
  //  该后缀**不是合法 CSS** ⇒ querySelector 会抛错 ⇒ 强制调用方走解析路径（fail-closed），
  //  不会出现「悄悄只测第一个」的静默错误。
  const cnt = new Map()
  for (const it of items) cnt.set(it.baseSel, (cnt.get(it.baseSel) || 0) + 1)
  const seenIdx = new Map()
  for (const it of items) {
    if (cnt.get(it.baseSel) > 1) {
      const n = seenIdx.get(it.baseSel) || 0
      seenIdx.set(it.baseSel, n + 1)
      it.sel = it.baseSel + '@@' + n
    } else {
      it.sel = it.baseSel
    }
    delete it.baseSel
  }

  return JSON.stringify({
    ready,
    hasOverlay: !!overlay, hasComposer: !!composer,
    innerW: window.innerWidth, innerH: window.innerHeight,
    count: items.length,
    // 【W30 出声】滚动扫描的战果：扫了几个滚动面 / 多采了几遍
    //  （P-3 不许静默：读者要能看出「这次读数包含滚动扫描」，否则无法判断覆盖面）
    scrollersFound: scrollers.length,
    scrollPasses,
    skippedOutOfView: skippedOutOfView.slice(0, 10),
    skippedCount: skippedOutOfView.length,
    // 被 implicit label 代表的原生控件（**出声**记录：这些不是"漏扫"，而是"已由 label 代表"）
    coveredByLabel: coveredByLabel.slice(0, 10),
    coveredByLabelCount: coveredByLabel.length,
    // 全量定位串（用于跨态「新增覆盖」统计 —— 证明该态真的带来了基线态没有的元素，
    // 否则该态是**无效覆盖**，必须出声，不能算作已覆盖。见 P-20「判据必须自带杠杆」）
    //
    // 【第二十轮续三 · P-23 同族】定位串必须**唯一**，否则跨态并集会**折叠**不同元素：
    //   drawer 态实测 26 个 P1 全是 'label.rx-check' / 无 class 的 input（退化成裸标签名）
    //   ⇒ 并集里只剩 2 条，且 states 数组重复 13 次。两条后果都不好：
    //     ① 并集数字**低估**（26 报成 2）；② 复现脚本拿 sel 去 querySelector 只命中**第一个**。
    //   ⇒ 定位串带回**序号唯一性**：同名元素追加 '@@<i>'（本探针自定义的检索约定，
    //     由 elExpr() 解析 ⇒ qsa[i]，保证「报出的东西能被独立复现」）。
    sels: items.map(i => i.sel),
    // 只回传"疑似不达标"的（<44，含 <38 阻塞 + 38~43 未达目标）；达标的不占体积
    bad: items.filter(i => i.w < TARGET || i.h < TARGET),
    blocking: items.filter(i => i.w < MIN || i.h < MIN),
  })
})()`

/**
 * 把带序号的定位串解析成「取第 N 个匹配元素」的 JS 片段。
 *
 * 【为什么需要】快照对**同名**元素追加了 `@@N`（见 SNAP 里的 P-23 处理）。
 *  `'label.rx-check@@3'` 不是合法 CSS（querySelector 直接抛 DOMException），
 *  但**恰恰必须如此** —— 它强制归因路径显式处理「取第几个」，
 *  而不是静默地只测第一个（那正是 26 个 P1 被折叠成 2 条的原因）。
 */
function elExpr (sel) {
  const m = /^(.*)@@(\d+)$/.exec(sel)
  if (!m) return `document.querySelector(${JSON.stringify(sel)})`
  return `document.querySelectorAll(${JSON.stringify(m[1])})[${m[2]}]`
}

/**
 * 归因：对单个选择器做**决定性实验**（P-25 的实证手法）。
 * 逐条单独施加 inline `!important`，看渲染尺寸是否真的变 —— 比读层叠规则更准。
 *
 * 【实现口径】四次试验拆成**四次独立求值**（而不是一次求值里连做四次）：
 *   ① 每次试验真正独立（不共享中间状态，不怕上一次没清干净）；
 *   ② 返回值是简单数组，不依赖复杂对象的序列化；
 *   ③ 出错时能定位到**具体是哪一条**属性试验失败。
 * 每次试验后**立即清除**，并在末尾回读「还原值」做副作用校验。
 */
async function trial(sel, props) {
  const expr = `(() => {
    const el = ${elExpr(sel)}
    if (!el) return 'no-el'
    const keys = ${JSON.stringify(Object.keys(props))}
    for (const k of keys) el.style.removeProperty(k)
    for (const [k, v] of ${JSON.stringify(Object.entries(props))}) el.style.setProperty(k, v, 'important')
    void el.offsetHeight
    const r = el.getBoundingClientRect()
    const out = [Math.round(r.width), Math.round(r.height)]
    for (const k of keys) el.style.removeProperty(k)
    void el.offsetHeight
    return out.join('x')
  })()`
  const v = await ev(expr)
  if (v === 'no-el') return null
  return String(v).split('x').map(Number)
}

async function diagnose(sel) {
  const base = await ev(`(() => {
    const el = ${elExpr(sel)}
    if (!el) return 'no-el'
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    const p = el.parentElement ? getComputedStyle(el.parentElement) : null
    return JSON.stringify({
      wh: [Math.round(r.width), Math.round(r.height)],
      h: cs.height, minH: cs.minHeight, flexShrink: cs.flexShrink, disp: cs.display,
      w: cs.width, minW: cs.minWidth, box: cs.boxSizing,
      pDisp: p ? p.display : null, pDir: p ? p.flexDirection : null,
    })
  })()`)
  if (base === 'no-el') return { sel, err: 'not-found' }
  const b = JSON.parse(base)

  const onlyHeight = await trial(sel, { height: '44px' })
  const onlyMinH = await trial(sel, { 'min-height': '44px' })
  const heightNoShr = await trial(sel, { height: '44px', 'flex-shrink': '0' })
  const minHNoShr = await trial(sel, { 'min-height': '44px', 'flex-shrink': '0' })
  // ★ 宽度维度（W30 补）—— 原版只做高度，于是「宽 36 不足」会被误报成 height-effective。
  //  实测案例：.dsht-npc-switch 实测 **36×44**（宽 < 38 底线、高已达标），
  //  而原归因给出 `真因=height-effective` + `onlyHeight=36×44`（读数为 36 却判「高度有效」）
  //  ⇒ 证据串与结论矛盾 = 判据缺陷的强信号（P-29）。补宽度试验后归因才正确。
  const onlyWidth = await trial(sel, { width: '44px' })
  const onlyMinW = await trial(sel, { 'min-width': '44px' })
  const widthNoShr = await trial(sel, { width: '44px', 'flex-shrink': '0' })

  // 副作用校验：全部清除后必须回到原值，否则实验本身污染了页面（P-21 同族）
  const restored = await ev(`(() => {
    const el = ${elExpr(sel)}
    if (!el) return 'no-el'
    const r = el.getBoundingClientRect()
    return [Math.round(r.width), Math.round(r.height)].join('x')
  })()`)
  const restoredWH = restored === 'no-el' ? null : String(restored).split('x').map(Number)

  // 归因（决定性实验的唯一解读）：
  //   onlyHeight 就有效                        ⇒ 该元素当前没有压制（可能是新出现的项）
  //   onlyHeight 无效 + heightNoShrink 有效    ⇒ flex-shrink 压回（P-25 典型形态）
  //   onlyHeight 无效 + onlyMinH 有效          ⇒ 需要 min-* 撑尺寸下限
  //   全都无效                                 ⇒ 另有约束（尺寸由内容 / aspect-ratio 等决定，须人工查）
  const ge = (a, i) => Array.isArray(a) && a[i] >= 44
  // 先按**哪个维度真的不足**分流（W30）：两个维度都可能不足，必须分开归因，
  //  否则会给出方向错误的修复建议（「去改高度」而实际该改宽度）。
  const needW = b.wh[0] < MIN, needH = b.wh[1] < MIN
  let cause
  if (!needW && !needH) cause = 'none-needed'      // 实测已达标（不该出现在 P1 列表里）
  else if (needH && ge(onlyHeight, 1)) cause = 'height-effective'
  else if (needH && ge(heightNoShr, 1) && !ge(onlyMinH, 1)) cause = 'flex-shrink'
  else if (needH && ge(onlyMinH, 1) && ge(heightNoShr, 1)) cause = 'flex-shrink-or-min-size'
  else if (needH && ge(onlyMinH, 1)) cause = 'min-size-required'
  else if (needW && ge(onlyWidth, 0)) cause = 'width-effective'
  else if (needW && ge(widthNoShr, 0) && !ge(onlyMinW, 0)) cause = 'flex-shrink-width'
  else if (needW && ge(onlyMinW, 0)) cause = 'min-width-required'
  else cause = 'unknown'

  return {
    sel, before: b.wh, cause, needsFix: { width: needW, height: needH },
    trials: { onlyHeight, onlyMinH, heightNoShr, minHNoShr, onlyWidth, onlyMinW, widthNoShr },
    computed: b, restored: restoredWH,
  }
}

// ---- 就绪轮询（R16）----
/**
 * 跨态穷举（W2 复核）。
 *
 * ## 为什么必须跨态（而不是只测一个态）
 *
 * 单态穷举只能看到「当前可见」的我方可点元素 —— 其余被 `elementFromPoint` 反查
 * 判为「当前点不到」而按 P-17 跳过。**跳过的那些恰恰是各面板/浮层里的元素**，
 * 而它们正是历史上出问题最多的地方（`.dsht-rp-back` 32px、`.dsht-rp-card-gear` 26px
 * 都是在抽屉/顶栏里被测出来的）。⇒ 必须**逐个把面板打开**再穷举一遍。
 *
 * ## 纪律
 *   · 每态都从**同一中性基线（RESET）**出发 ⇒ 态与态之间不互相污染（P-8 幂等）；
 *   · 进态脚本**幂等**：已在该态不重复点击（侧栏 toggle 是翻转语义，重复点会关回去）；
 *   · 进态失败（缺元素/不适用）⇒ 记 **SKIP 并出声**，**不算已覆盖**（P-17/P-20）；
 *   · 每态都统计「**相对基线的新增定位串**」—— 若某态新增为 0，说明它**没带来新覆盖**，
 *     必须出声（可能是进态没生效 = 假覆盖；P-20「判据必须自带杠杆」）。
 *   · 本段内**不得出现反引号**（A11 闸门把本文件列入 TARGETS）。
 */
const PRE = `const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const click = (s) => { const e = document.querySelector(s); if (!e) return false; e.click(); return true };`

/** 中性基线：关掉所有我方浮层 + 收起侧栏（幂等，无 return）。 */
const RESET_BODY = `
  { const c = document.querySelector('.kmc-root .kmc-close');
    if (c) { c.click(); await sleep(400) } }
  // 【W30 新增 · 必须第一位】关掉**宿主设置面板**（全屏遮罩 .VOzbGW_overlay）。
  //  它是唯一会盖住**整个宿主 UI**的浮层 —— 不关掉，后续每态 elementFromPoint 全命不中我方元素
  //  ⇒ 又会回到 W2 那个「零覆盖冒充通过」的假绿（见 OCCLUSION 注释）。
  //  ★ 关闭按钮实测为 .VOzbGW_close（文案 "Close"）；.VOzbGW_trigger 二次点击**不管用**（实测面板仍开）。
  { const p = document.querySelector('.VOzbGW_panel');
    if (p) {
      const c = p.querySelector('.VOzbGW_close');
      if (c) { c.click(); await sleep(600) }
      if (document.querySelector('.VOzbGW_panel')) {
        for (const type of ['keyDown', 'keyUp']) {
          document.dispatchEvent(new KeyboardEvent(type, { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }))
        }
        await sleep(600)
      }
      for (let i = 0; i < 8; i++) { if (!document.querySelector('.VOzbGW_panel')) break; await sleep(250) }
    } }
  click('.dsht-rp-drawer-head .dsht-rp-back'); await sleep(150);
  click('.dsht-rp-ctx-panel .cp-close'); await sleep(150);
  { const a = document.querySelectorAll('.dsht-rp-stateview .sv-head-actions .sf-btn');
    if (a.length > 0) { a[a.length - 1].click(); await sleep(200) } }
  { const a = document.querySelectorAll('.dsht-rp-searchview .sf-head-actions .sf-btn, .dsht-rp-searchview .sf-btn');
    if (a.length > 0) { a[a.length - 1].click(); await sleep(200) } }
  click('.dsht-rp-statefloat-panel [aria-label="关闭状态面板"]'); await sleep(150);
  { const a = document.querySelectorAll('.dsht-rp-script-panel .sf-head-actions .sf-btn');
    if (a.length > 0) { a[a.length - 1].click(); await sleep(150) } }
  { const b = document.querySelector('.dsht-rp-overlay .dsht-rp-back[aria-label="关闭 RP 启动器"]');
    if (b) { b.click(); await sleep(500) } }
  { const f = document.querySelector('[data-dsht-mobile="app-frame"]');
    if (f && !f.hasAttribute('data-sidebar-collapsed')) {
      const h = document.querySelector('.dsht-mobile-hamburger');
      if (h) { h.click(); await sleep(500) } } }
`

/**
 * 遮挡侦测（P-17：测不出来 ≠ 事实否定）。
 *
 * 【W2 实测踩到 · 假绿的最深一层】
 *  第二轮跨态跑时 11 个态**全部**扫到 0 个我方元素，而探针判 **PASS** ——
 *  因为判据力前提只查「所有态累计 > 0」（base 态有 6 个就通过）。
 *  真因有两条：
 *    ① `.dsht-rp-stateview` 的 RESET 选错了按钮（`.sf-btn` 的第一个是「刷新」而非 ✕）
 *       ⇒ 它的全屏 mask（z-index 10052）**残留** ⇒ 盖住整个屏幕
 *       ⇒ 后续所有态的 elementFromPoint 全部命不中我方元素 ⇒ 判「不可点」跳过。
 *    ② 卡脚本自己弹出的模态（本仓实测为 `.kmc-root`，z-index 10050）同样全屏覆盖 ——
 *       那是**卡脚本行为**（我方按设计不干预，属边界 B2/B3），但会让探针测不出东西。
 *  ⇒ 判据必须**区分**「我方真的没有可点元素」与「被别的浮层挡住了」——
 *    否则最危险的形态（**零覆盖冒充通过**）会静默发生。
 */
const OCCLUSION = `(() => {
  const ov = document.querySelector('.dsht-rp-overlay')
  if (!ov) return 'no-overlay'
  const r = ov.getBoundingClientRect()
  const pts = [[r.left + 60, r.top + 40], [r.left + r.width / 2, r.top + 120], [r.left + r.width / 2, r.top + r.height / 2]]
  for (const [x, y] of pts) {
    const hit = document.elementFromPoint(x, y)
    if (!hit) continue
    if (hit === ov || ov.contains(hit)) return 'ok'
    let e = hit, top = hit
    while (e && e !== document.body) { if (String(e.className || '').indexOf('dsht-') >= 0) return 'ok'; e = e.parentElement }
    return 'blocked-by:' + String(top.className || top.tagName).slice(0, 60)
  }
  return 'unknown'
})()`

const OPEN_OVERLAY = `
  window.dispatchEvent(new CustomEvent('dsht-rp-ui:open', { detail: { tab: 'chars' } }));
  for (let i = 0; i < 20; i++) { if (document.querySelector('.dsht-rp-overlay')) break; await sleep(250) }
  await sleep(400);
`

/** 按文案点 overlay 顶栏 tab（tab 无事件通道，只能点）。 */
const clickTab = (label) => `
  { const t = [...document.querySelectorAll('.dsht-rp-topbar .dsht-rp-tab')].find(x => (x.textContent || '').trim() === ${JSON.stringify(label)});
    if (!t) return 'no-tab'; t.click(); await sleep(800) }
`

function mkEnter(extra) { return `(async () => { ${PRE} ${RESET_BODY} ${extra || ''} return 'ok' })()` }

/**
 * 每态声明「进态生效的**可见证据**」（expect）—— 进态脚本不抛错**不等于**进了这个态。
 *
 * 【为什么必须加（P-24：判据落在结果不落机制）】
 *  进态脚本返回 'ok' 只证明「点击/派发这个动作执行了」——那是**机制**；
 *  真正的判据是「该态的界面**出现了**」——那是**结果**。
 *  本轮实测踩到过：`overlay-drawer` 首版进态脚本按 `.dsht-rp-card`（卡片按钮本身）
 *  找齿轮 ⇒ 找不到 ⇒ 返回 'no-gear'，但**当时没把它当失败**，
 *  于是那一态的读数（50 个元素）其实是**上一个态（chars）的读数**被冒名顶替。
 *  ⇒ 每态都必须给出 expect；采集时先验 expect，不成立即记「进态未生效」（P-17 如实登记）。
 *  expect 为 null ⇒ 该态无额外可见证据要求（如 base 态）。
 */
const STATES = [
  { name: 'base', desc: '会话视图 · overlay 关闭 · 侧栏折叠', enter: mkEnter(''), expect: null },
  {
    name: 'sidebar-expanded', desc: '宿主侧栏展开（我方 📥/🎭 席位在侧栏底部）',
    enter: mkEnter(`
      { const f = document.querySelector('[data-dsht-mobile="app-frame"]');
        if (!f) return 'no-frame';
        const h = document.querySelector('.dsht-mobile-hamburger');
        if (f.hasAttribute('data-sidebar-collapsed')) {
          if (!h) return 'no-hamburger';
          h.click(); await sleep(900) } }`),
    // 侧栏展开的可见证据：侧栏列不再被推到视口外（left ≥ 0）
    expect: `(() => { const s = document.querySelector('[data-dsht-mobile="sidebar-col"]'); if (!s) return false; return s.getBoundingClientRect().left > -1 })()`,
  },
  { name: 'overlay-chars', desc: 'RP overlay · 角色 tab', enter: mkEnter(OPEN_OVERLAY), expect: `!!document.querySelector('.dsht-rp-overlay .dsht-rp-grid')` },
  { name: 'overlay-preset', desc: 'RP overlay · 预设 tab', enter: mkEnter(OPEN_OVERLAY + clickTab('预设')), expect: `!!document.querySelector('.dsht-rp-overlay .dsht-rp-preset')` },
  { name: 'overlay-regex', desc: 'RP overlay · 正则 tab', enter: mkEnter(OPEN_OVERLAY + clickTab('正则')), expect: `!!document.querySelector('.dsht-rp-overlay .dsht-rp-regex')` },
  { name: 'overlay-books', desc: 'RP overlay · 世界书 tab', enter: mkEnter(OPEN_OVERLAY + clickTab('世界书')), expect: `!!document.querySelector('.dsht-rp-overlay .dsht-rp-books')` },
  { name: 'overlay-sessions', desc: 'RP overlay · 会话 tab', enter: mkEnter(OPEN_OVERLAY + clickTab('会话')), expect: `!!document.querySelector('.dsht-rp-overlay .dsht-rp-import')` },
  {
    name: 'overlay-drawer', desc: 'RP overlay · 角色卡抽屉（⚙ 详情）',
    enter: mkEnter(OPEN_OVERLAY + `
      { const wraps = [...document.querySelectorAll('.dsht-rp-card-wrap')];
        if (wraps.length === 0) return 'no-card';
        const g = [...wraps[0].querySelectorAll('.dsht-rp-card-gear')].filter(x => (x.getAttribute('aria-label') || '').includes('详情'));
        if (g.length === 0) return 'no-gear';
        g[0].click(); await sleep(900) }`),
    expect: `!!document.querySelector('.dsht-rp-overlay .dsht-rp-drawer')`,
  },
  {
    name: 'ctx-panel', desc: '上下文调节面板（token 计量条点击）',
    enter: mkEnter(`
      const h = document.querySelector('.dsht-rp-tokenmeter .tm-hit');
      if (!h) return 'no-meter';
      h.click(); await sleep(700);`),
    expect: `!!document.querySelector('.dsht-rp-ctx-panel')`,
  },
  {
    name: 'script-panel', desc: '卡脚本浮窗（🧩 脚本球）',
    enter: mkEnter(`
      const b = document.querySelector('.dsht-rp-scriptball');
      if (!b) return 'no-scriptball';
      b.click(); await sleep(700);`),
    expect: `!!document.querySelector('.dsht-rp-script-panel')`,
  },
  // ---------- 卡脚本面板的内部 tab 态（W30 补：§6.14h 登记的最后一项 W2 残余） ----------
  //
  // 【为什么要单列】`.dsht-rp-script-panel` 的日志 / 变量抽屉是**条件渲染**
  //  （`{tab === 'logs' && …}` / `{tab === 'vars' && …}`，见 `RpScriptHost.tsx`）
  //  ⇒ 只测 `script-panel` 基本态 = **漏掉两个抽屉里的全部可点元素**（P-20 覆盖空洞）。
  //  另：变量抽屉里的 `<pre>` 只读，但日志抽屉**自身可滚动**（maxHeight 240）——
  //  滚动扫描会自动覆盖（W30 快照已支持）。
  {
    name: 'script-panel-logs', desc: '卡脚本浮窗 · 日志抽屉',
    enter: mkEnter(`
      const b = document.querySelector('.dsht-rp-scriptball');
      if (!b) return 'no-scriptball';
      b.click(); await sleep(700);
      for (let i = 0; i < 10; i++) { if (document.querySelector('.dsht-rp-script-panel')) break; await sleep(250) }
      { const t = [...document.querySelectorAll('.dsht-rp-script-panel .sf-head-actions .sf-btn')]
          .find(x => (x.textContent || '').trim() === '日志');
        if (!t) return 'no-logs-btn';
        if (!document.querySelector('.dsht-rp-script-panel .th-toolbox')) t.click();
        await sleep(600) }`),
    // 可见证据取**抽屉真的开了**（`.th-toolbox` 只在 tab 命中时渲染），而不是「面板开着」
    expect: `!!document.querySelector('.dsht-rp-script-panel .th-toolbox')`,
  },
  {
    name: 'script-panel-vars', desc: '卡脚本浮窗 · 变量查看器',
    enter: mkEnter(`
      const b = document.querySelector('.dsht-rp-scriptball');
      if (!b) return 'no-scriptball';
      b.click(); await sleep(700);
      for (let i = 0; i < 10; i++) { if (document.querySelector('.dsht-rp-script-panel')) break; await sleep(250) }
      { const t = [...document.querySelectorAll('.dsht-rp-script-panel .sf-head-actions .sf-btn')]
          .find(x => (x.textContent || '').trim() === '变量');
        if (!t) return 'no-vars-btn';
        if (!document.querySelector('.dsht-rp-script-panel .th-toolbox')) t.click();
        await sleep(600) }`),
    expect: `!!document.querySelector('.dsht-rp-script-panel .th-toolbox')`,
  },
  {
    name: 'statefloat', desc: '状态浮窗面板（🌌 浮球）',
    enter: mkEnter(`
      const b = document.querySelector('.dsht-rp-statefloat-ball');
      if (!b) return 'no-ball';
      b.click(); await sleep(800);`),
    expect: `!!document.querySelector('.dsht-rp-statefloat-panel')`,
  },
  {
    name: 'stateview', desc: '状态查看模态（浮窗内「查看状态」）',
    enter: mkEnter(`
      const b = document.querySelector('.dsht-rp-statefloat-ball');
      if (!b) return 'no-ball';
      b.click(); await sleep(800);
      { const v = [...document.querySelectorAll('.dsht-rp-statefloat-panel .sf-btn')].find(x => (x.textContent || '').trim() === '查看状态');
        if (!v) return 'no-view-btn'; v.click(); await sleep(900) }`),
    // 【P-19 · 判据自身写错】首版写成 '.dsht-rp-stateview[aria-label="状态查看"]' ——
    //  而 aria-label 挂在**外层 mask**（.dsht-rp-stateview-mask）上，内层 panel 没有。
    //  ⇒ 实测该态其实**已生效**（扫到 5 个元素），却因选择器错被判「态未生效」。
    //  教训与 §6.x 记录的同类：expect 也是判据，也会写错 ⇒ 一律用**确实存在的**锚点。
    expect: `!!document.querySelector('.dsht-rp-stateview')`,
  },
  // ---------- 宿主设置页（W30 补：§6.14h「W2 残余 · 设置面板态」收口） ----------
  //
  // 【为什么此前没纳入】W2 原有的 11 个态**全是我方自建浮层**（overlay / 抽屉 / 各浮窗），
  //  而宿主设置页是**宿主原生 UI** —— 进态要跨出我方 DOM。§6.14h 把它登记为「仍未收口」。
  //
  // 【为什么现在敢写】P-19 明令「选择器/类名必须**设备实测**确认，不许凭命名习惯猜」——
  //  ⇒ 本轮先用临时探针 `tmp/w30-settings-explore.mjs` 在**真设备**上逐层取证，拿到：
  //     · 设置入口 = `.VOzbGW_trigger`（aria-label="Settings"）
  //     · 「插件」tab = `.VOzbGW_navCell`，其**实测文案是英文 `Plugins`**
  //       ★ 我原本按中文「插件」匹配 —— 实测**一个都匹配不到**（P-19 说的正是这个坑）
  //     · 面板根 = `.VOzbGW_panel`；遮罩 = `.VOzbGW_overlay`
  //     · 关闭 = `.VOzbGW_close`（文案 "Close"）；★ `.VOzbGW_trigger` 二次点击**不管用**（实测面板仍开）
  //     · 我方 4 张设置卡（`.dsht-npc-card`）确实渲染；首张卡**默认已展开**
  //       （实测：点它反而**收起** body，aria-expanded true→false）
  //
  // 【为什么放列表末尾】这两个态会打开**全屏遮罩**（`.VOzbGW_overlay`）。
  //  这正是 W2 踩过最深的坑：遮罩残留 ⇒ 后续每态 elementFromPoint 全命不中我方元素
  //  ⇒ 「零覆盖冒充通过」（见 OCCLUSION 注释）。⇒ ① 放末尾；② 进 RESET 主动关掉。
  {
    name: 'host-settings-plugins', desc: '宿主设置页 · Plugins tab（我方 4 张设置卡列表）',
    enter: mkEnter(`
      { const t = document.querySelector('.VOzbGW_trigger');
        if (!t) return 'no-settings-trigger';
        if (!document.querySelector('.VOzbGW_panel')) { t.click(); await sleep(900) }
        for (let i = 0; i < 12; i++) { if (document.querySelector('.VOzbGW_panel')) break; await sleep(250) }
        const c = [...document.querySelectorAll('.VOzbGW_navCell')].find(x => /插件|Plugins/i.test(x.textContent || ''));
        if (!c) return 'no-plugins-tab';
        if (!c.classList.contains('VOzbGW_active')) c.click();
        await sleep(800);
        for (let i = 0; i < 12; i++) { if (document.querySelector('.dsht-npc-card')) break; await sleep(250) } }`),
    // 可见证据取「**我方卡片真的在**」而非「面板开了」——面板开着但槽位没渲染是两件事（R20）
    expect: `document.querySelectorAll('.dsht-npc-card').length > 0`,
  },
  {
    // 【为什么要单列展开态】卡片的**可点元素只在展开后存在**（`.dsht-npc-body` 里的
    //  switch/select/range/input 与 footer 的 save/discard 全是 `{open && …}` 条件渲染）。
    //  ⇒ 只测收起态 = 漏掉整张卡的真实交互面（P-20：判据必须自带杠杆）。
    //  ★ 实测坑：首卡**默认已展开**，无条件 `h.click()` 会把它**收起** ⇒ 必须读 aria-expanded 再决定。
    name: 'host-settings-card-open', desc: '宿主设置页 · 首张设置卡展开态（switch / select / range / save / discard）',
    enter: mkEnter(`
      { const t = document.querySelector('.VOzbGW_trigger');
        if (!t) return 'no-settings-trigger';
        if (!document.querySelector('.VOzbGW_panel')) { t.click(); await sleep(900) }
        for (let i = 0; i < 12; i++) { if (document.querySelector('.VOzbGW_panel')) break; await sleep(250) }
        const c = [...document.querySelectorAll('.VOzbGW_navCell')].find(x => /插件|Plugins/i.test(x.textContent || ''));
        if (!c) return 'no-plugins-tab';
        if (!c.classList.contains('VOzbGW_active')) c.click();
        await sleep(800);
        for (let i = 0; i < 12; i++) { if (document.querySelector('.dsht-npc-card')) break; await sleep(250) }
        const h = document.querySelector('.dsht-npc-card .dsht-npc-header');
        if (!h) return 'no-card-header';
        if (h.getAttribute('aria-expanded') !== 'true') { h.click(); await sleep(600) }
        for (let i = 0; i < 12; i++) { if (document.querySelector('.dsht-npc-card .dsht-npc-body')) break; await sleep(250) } }`),
    expect: `!!document.querySelector('.dsht-npc-card .dsht-npc-body')`,
  },
]

/** 采集一次快照并等它稳定（R16：连续两次签名一致才算就绪）。 */
async function snapStable(budgetMs = 30000) {
  let snap = null, lastSig = null, hits = 0
  const t0 = Date.now()
  while (Date.now() - t0 < budgetMs) {
    try {
      const s = JSON.parse(await ev(SNAP, 2, 800))
      const sig = `${s.ready}|${s.hasOverlay}|${s.count}|${s.innerW}|${s.innerH}`
      if (sig === lastSig) hits++; else hits = 0
      lastSig = sig
      snap = s
      if (hits >= 1 && s.ready === true) break
    } catch { /* 重建中 */ }
    await sleep(900)
  }
  return snap
}

// ==================== 主流程：跨态穷举（W2） ====================
const MIN = 38, TARGET = 44

const stateArgIdx = process.argv.indexOf('--state')
const STATE_ONLY = stateArgIdx >= 0 ? process.argv[stateArgIdx + 1] : null

/** 采集一个态：进态 → **验态真的生效** → 等稳定 → （有 P1 则）当场归因。 */
async function collectState(st) {
  let enterRes = null
  try { enterRes = String((await ev(st.enter, 2, 1200)) ?? 'null') } catch (e) { enterRes = 'enter-error: ' + String(e.message).slice(0, 70) }

  // ---- 态生效校验（P-24：判据落「结果」而非「机制」）----
  //  进态脚本返回 ok 只说明动作执行了；这里再验「该态的可见证据是否真的出现」。
  //  不成立 ⇒ 记 not-entered（**如实登记，不算已覆盖**），绝不把上一个态的读数冒名顶替。
  //
  // 【W30 修 · 为什么必须**轮询**而不是查一次】
  //  原先写的是 `await ev(st.expect, 2, 900)` —— 而 `ev()` 的 `tries/gap` **只在抛异常时**
  //  才重试；expect 返回 `false`（不抛）时会**立刻**返回 false ⇒ **等于只查一次**。
  //  实测症状：全量 16 态跑时 `host-settings-card-open` 偶发报「态未生效」
  //  （而单跑同一态稳定 ok）—— 那是**就绪竞态**（宿主设置面板懒挂载 + 首次渲染慢），
  //  不是产品缺陷，也不是进态脚本写错（`tmp/w30-cardopen-trace.mjs` 逐步留痕显示
  //  进态各步都对、最终 `body=true`）。
  //  ⇒ 按 R16「禁止固定 sleep 当已就绪；必须**轮询到**就绪」改为轮询；
  //    仍不成立才记 not-entered（**如实登记，不冒充已覆盖**）。
  let entered = null
  if (st.expect) {
    const t0 = Date.now()
    while (Date.now() - t0 < 30000) {
      try {
        if ((await ev(st.expect, 1, 300)) === true) { entered = true; break }
      } catch { /* 页面重建中，继续轮询 */ }
      entered = false
      await sleep(700)
    }
    if (entered === null) entered = false
  } else { entered = true }

  const s = await snapStable(40000)
  let occ = null
  try { occ = String(await ev(OCCLUSION, 2, 1000)) } catch { occ = 'occ-error' }
  const blocking = (s?.blocking) || []
  const diagnosed = []
  for (const i of blocking.slice(0, 6)) {
    try { diagnosed.push(await diagnose(i.sel)) } catch (e) { diagnosed.push({ sel: i.sel, err: String(e.message).slice(0, 60) }) }
  }
  return { st, enterRes, entered, snap: s, occ, blocking, diagnosed }
}

const list = STATE_ONLY ? STATES.filter(s => s.name === STATE_ONLY) : STATES
if (list.length === 0) {
  console.error(`[FATAL] 未知态名：${STATE_ONLY}（可用：${STATES.map(s => s.name).join(' / ')}）`)
  process.exit(2)
}

console.log(`[ef-touch-targets] 跨态穷举：${list.length} 个态（每态都从同一中性基线 RESET 出发）`)

// ---- 先跑基线态（用于「新增定位串」统计的参照）----
const results = []
for (const st of list) {
  process.stdout.write(`  · ${st.name} …`)
  const r = await collectState(st)
  results.push(r)
  if (!r.snap) console.log(' 快照失败')
  else console.log(` ${r.snap.count} 个可点元素 / P1=${r.blocking.length}（进态=${r.enterRes} 遮挡=${r.occ}）`)
}

const base = results.find(r => r.st.name === 'base')
const baseSels = new Set(base?.snap?.sels || [])

const bad0 = results.filter(r => !r.snap)
if (bad0.length > 0) {
  console.log(`\n[FATAL] ${bad0.length} 个态取不到快照（CDP 不可达）：${bad0.map(r => r.st.name).join(' / ')}`)
  process.exit(2)
}

// ---- 汇总表 ----
console.log(`\n[1] 跨态覆盖（视口 ${results[0].snap.innerW}×${results[0].snap.innerH}）`)
console.log('    态                       生效  元素  新增  P1  P2  遮挡')
const uncovered = []
const blockedStates = []
for (const r of results) {
  const sels = new Set(r.snap.sels || [])
  const fresh = r.st.name === 'base' ? sels.size : [...sels].filter(x => !baseSels.has(x)).length
  const p1 = r.blocking.length
  const p2 = (r.snap.bad?.length || 0) - p1
  const ok = r.entered === true
  console.log(`    ${r.st.name.padEnd(24)} ${(ok ? 'ok' : 'NO').padEnd(5)} ${String(r.snap.count).padStart(4)} ${String(fresh).padStart(5)} ${String(p1).padStart(3)} ${String(p2).padStart(3)}  ${r.occ}`)
  // 「态未生效」= 该态的界面根本没出现 ⇒ 读数不可信，**不算已覆盖**（这是本轮踩到的假覆盖）
  if (!ok) uncovered.push(`${r.st.name}（态未生效：expect 不成立${r.enterRes !== 'ok' ? '，进态=' + r.enterRes : ''}）`)
  // 「进态 ok 但零新增」= 该态没有带来新覆盖面（可能是进态没生效 = 假覆盖，也可能元素已在基线可见）
  if (r.st.name !== 'base' && ok && fresh === 0) uncovered.push(r.st.name)
  // 「进态失败」= 该面板在本环境下不可达 ⇒ 如实记未覆盖（P-17）
  if (r.enterRes !== 'ok') uncovered.push(`${r.st.name}（进态=${r.enterRes}）`)
  // 「零元素」= 本态**测不出任何东西** ⇒ 绝不允许冒充覆盖（这是本轮踩到的假绿）
  if (r.snap.count === 0) {
    const why = String(r.occ || '').startsWith('blocked-by') ? `被遮挡（${r.occ}）` : `无我方元素可见（遮挡判定=${r.occ}）`
    blockedStates.push(`${r.st.name}：${why}`)
    if (!uncovered.includes(r.st.name)) uncovered.push(`${r.st.name}（零元素：${why}）`)
  }
}

// ---- 判据力前提（P-17/P-19/P-20/P-24）----
const totalMine = results.reduce((n, r) => n + (r.snap.sels?.length || 0), 0)
if (totalMine === 0) {
  console.log('\n[FATAL] 所有态都扫到 0 个我方可点元素 —— 判据力前提不成立（会退化成恒真）。')
  console.log('        这属**探针自身缺陷**（归属选择器与页面结构不匹配），不是产品结论。')
  process.exit(2)
}

// ---- 「零覆盖冒充通过」护栏（本轮实测踩到的假绿形态）----
//  判据：若**除 base 外**的态里，有 ≥80% 是「零元素」，说明本轮**根本没有取得跨态覆盖**
//  （典型诱因：某个全屏浮层残留挡住一切，或进态脚本整片失效）。
//  此时报 PASS 是**最危险的形态**（看起来全绿，实际什么都没测）。
//  ⇒ 一律以退出码 2 报「探针/环境问题」，且**明确说不是产品结论**（P-17）。
const nonBase = results.filter(r => r.st.name !== 'base')
const zeroStates = nonBase.filter(r => r.snap.count === 0)
if (nonBase.length > 0 && zeroStates.length / nonBase.length >= 0.8) {
  console.log(`\n[FATAL] ${zeroStates.length}/${nonBase.length} 个非基线态**扫到 0 个我方元素** —— 本轮未取得跨态覆盖。`)
  console.log('        这不是「产品没有问题」，而是**测具此刻测不出东西**（P-17：测不出来 ≠ 事实否定）。')
  if (blockedStates.length > 0) {
    console.log('        各态原因：')
    for (const b of blockedStates.slice(0, 6)) console.log(`          - ${b}`)
  }
  console.log('        ⇒ 先解决遮挡/进态（如关闭残留的全屏浮层），再重跑；不据此判定产品缺陷。')
  process.exit(2)
}

// ---- P1 并集（按定位串去重；同一元素在多个态出现只报一次）----
const p1Map = new Map()
for (const r of results) {
  for (const i of r.blocking) {
    const key = i.sel
    if (!p1Map.has(key)) p1Map.set(key, { ...i, states: [r.st.name] })
    else p1Map.get(key).states.push(r.st.name)
  }
}
const p1 = [...p1Map.values()]
const p2All = new Map()
for (const r of results) {
  for (const i of (r.snap.bad || [])) {
    if ((i.w < MIN || i.h < MIN)) continue
    if (!p2All.has(i.sel)) p2All.set(i.sel, { ...i, states: [r.st.name] })
    else p2All.get(i.sel).states.push(r.st.name)
  }
}
const p2 = [...p2All.values()]

console.log(`\n[2] P1 阻塞项（<${MIN}px）并集：${p1.length} 个`)
for (const i of p1) {
  console.log(`    [P1] ${i.sel}  ${i.w}×${i.h}  "${i.txt}"  态=${i.states.join(',')}`)
  console.log(`          computedH=${i.heightCss} minH=${i.minHeightCss} flexShrink=${i.flexShrink} parent=${i.parentDisplay}/${i.parentFlexDir}`)
}
console.log(`\n[3] P2 未达目标（${MIN}~${TARGET - 1}px）并集：${p2.length} 个`)
for (const i of p2.slice(0, 20)) {
  console.log(`    [P2] ${i.sel}  ${i.w}×${i.h}  "${i.txt}"  态=${i.states.join(',')}`)
}

// ---- P1 归因（决定性实验，P-25 的实证手法）----
const dx = results.flatMap(r => r.diagnosed || []).filter(d => d && !d.err)
if (dx.length > 0) {
  console.log(`\n[4] P1 自动归因（决定性实验：逐条单独施加 inline !important）`)
  for (const d of dx) {
    const fmt = (a) => Array.isArray(a) ? a.join('×') : '(null)'
    console.log(`    ${d.sel}  实测 ${fmt(d.before)}  真因=${d.cause}`)
    console.log(`        对照 onlyHeight=${fmt(d.trials.onlyHeight)} onlyMinH=${fmt(d.trials.onlyMinH)} heightNoShrink=${fmt(d.trials.heightNoShr)} minHNoShrink=${fmt(d.trials.minHNoShr)}`)
    console.log(`        还原校验=${fmt(d.restored)}（应等于实测值，否则实验本身有副作用）`)
  }
}

// ---- 覆盖诚实性（P-17：未覆盖就说未覆盖，不许含糊成「已覆盖」）----
if (uncovered.length > 0) {
  console.log(`\n[!] 以下态**未取得有效覆盖**（如实登记，不算已覆盖）：`)
  for (const u of uncovered) console.log(`    - ${u}`)
}

const fails = p1.length
console.log(`\n[ef-touch-targets] ${list.length} 态穷举：我方元素累计去重 ${new Set(results.flatMap(r => r.snap.sels || [])).size} 个 · `
  + `${fails === 0 ? `PASS（无 P1 阻塞项；${p2.length} 个 P2 未达目标，择期）` : `FAIL: ${fails} 个 P1 阻塞项（<${MIN}px）`}`)
process.exit(fails === 0 ? 0 : 1)

