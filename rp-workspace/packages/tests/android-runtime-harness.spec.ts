/**
 * L4 运行时与平台层静态护栏（2026-09-14 轨道 A / L4 穷举第三轮）。
 *
 * ## 为什么这组测试存在
 * L4 穷举（M1 静态扫描）发现两个**只有读 Kotlin 源码才能发现**的缺口：
 *
 * ### 缺口一：renderer 被 LMK 杀死后无自愈路径（P-3 静默失败 / P-7 能力对等）
 * - `onRenderProcessGone` 全仓缺失（只有文档里写着「已修」，代码里没有）。
 * - renderer 被杀时主框架**不会**走 `onReceivedError`（页面是「已加载」状态，只是渲染进程没了）
 *   ⇒ 既有的 T-45 重载分支（`reloadNeeded`）**永不触发** ⇒ 用户只看到**整页白屏**。
 * - renderer 崩溃后 WebView 实例本身已失效，`loadUrl` 是空操作 ⇒ 必须 `recreate()`。
 *
 * ### 缺口二：降级状态不出声（P-3）
 * - `lastAbnormalExit`（上次被 LMK/ANR 杀）只赋值、从不暴露给 UI，
 *   而 `docs/B-DEVICE-VERIFY-CHECKLIST.md` 却声称等待屏已显示它（R7 文档与代码不一致）。
 * - proot/busybox 缺失时降级为「无进程隔离」只在 logcat 出声，用户在「隔离已失效」
 *   的状态下使用而不自知。
 *
 * ## 测试的性质（诚实说明）
 * 这是**结构护栏**（源码级字符串/形态断言），不是行为测试——Kotlin UI 行为需要
 * M5/M6（模拟器/真机）验证，本机 `adb devices` 可达模拟器但 renderer OOM 难以按需触发。
 * 护栏的作用是：**任何人删掉 onRenderProcessGone 或这两个字段的暴露，测试立刻变红**
 * ——把「静默缺陷」变成「可回归信号」。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ANDROID_SRC = join(
  import.meta.dirname, '..', '..', 'android', 'app', 'src', 'main', 'java', 'com', 'dshtavern', 'app',
)
const read = (name: string): string => readFileSync(join(ANDROID_SRC, name), 'utf8')

describe('L4 内存压力自愈：renderer 被杀必须有重建路径（P-3/P-7）', () => {
  const main = read('MainActivity.kt')

  it('✅ 覆写 onRenderProcessGone（判据：此前全仓缺失 ⇒ 白屏零自愈）', () => {
    expect(main).toMatch(/override\s+fun\s+onRenderProcessGone\s*\(/)
  })

  it('返回 true —— 声明「已自行处理」，否则系统会连 App 一起杀', () => {
    const i = main.indexOf('override fun onRenderProcessGone')
    expect(i, '未找到 onRenderProcessGone').toBeGreaterThan(-1)
    const body = main.slice(i, i + 2200)
    expect(body).toMatch(/return\s+true/)
  })

  it('✅ 重建走 recreate()（配置单源：不手写第二份 WebView 配置，避免 P-1b 漂移）', () => {
    expect(main).toMatch(/private\s+fun\s+rebuildWebView\s*\(\s*\)/)
    const i = main.indexOf('private fun rebuildWebView')
    const body = main.slice(i, i + 700)
    expect(body).toContain('recreate()')
    // 先 destroy 旧实例（失效 WebView 应释放，避免 JavascriptInterface 悬挂）
    expect(body).toContain('webView.destroy()')
  })

  it('✅ 预算落 prefs（跨 Activity 重建有效）—— 否则「崩→建→崩」无限循环', () => {
    // 若用内存字段，recreate() 即归零 ⇒ 每次都是「第 1 次」⇒ 无上限
    expect(main).toMatch(/private\s+var\s+rendererRebuilds\s*:\s*Int/)
    expect(main).toContain('prefs.getInt(KEY_RENDERER_REBUILDS')
    expect(main).toContain('prefs.edit().putInt(KEY_RENDERER_REBUILDS')
    expect(main).toMatch(/RENDERER_REBUILD_MAX\s*=\s*\d+/)
  })

  it('✅ 超预算**出声**停在等待屏（R8：不许静默兜底 / 不许无限重建）', () => {
    const i = main.indexOf('override fun onRenderProcessGone')
    const body = main.slice(i, i + 2200)
    expect(body).toMatch(/n\s*>\s*RENDERER_REBUILD_MAX/)
    // 出声：logcat 有记录 + 回到等待屏
    expect(body).toContain('android.util.Log.e')
    expect(body).toContain('showBoot()')
  })

  it('✅ 预算在自愈成功时归零（端口 0→1）—— 否则偶发 OOM 会累积到误触上限', () => {
    expect(main).toMatch(/if\s*\(portNow\s*&&\s*!lastPortState\)\s*\{[\s\S]{0,400}rendererRebuilds\s*=\s*0/)
  })

  it('与 T-45 既有自愈不冲突（onReceivedError/HttpError 的 reloadNeeded 仍在）', () => {
    expect(main).toContain('reloadNeeded = true')
    expect(main).toMatch(/override\s+fun\s+onReceivedError\s*\(/)
    expect(main).toMatch(/override\s+fun\s+onReceivedHttpError\s*\(/)
  })
})

describe('L4 出声：降级状态必须进等待屏（P-3，R8）', () => {
  const node = read('NodeService.kt')
  const main = read('MainActivity.kt')

  it('✅ diagJson 暴露 lastAbnormalExit（此前只赋值不暴露，文档却声称已显示）', () => {
    expect(node).toContain('o.put("lastAbnormalExit"')
    // 声明 + 赋值都要在（防「暴露了一个恒 false 的字段」）
    expect(node).toMatch(/@Volatile\s+var\s+lastAbnormalExit\s*:\s*Boolean/)
  })

  it('✅ diagJson 暴露 sandboxFallback（proot 降级不再只落 logcat）', () => {
    expect(node).toContain('o.put("sandboxFallback"')
    expect(node).toMatch(/@Volatile\s+var\s+sandboxFallback\s*:\s*String\?/)
  })

  it('两个降级点都要赋值 sandboxFallback（proot 缺失 / rootfs 搭建失败）', () => {
    const hits = node.match(/sandboxFallback\s*=\s*"/g) ?? []
    expect(hits.length, `降级点应恰好 2 处（实际 ${hits.length}）——少一处就是漏了一条降级路径`).toBe(2)
    expect(node).toContain('"proot-missing"')
    expect(node).toContain('"rootfs-failed"')
  })

  it('✅ 等待屏真的渲染这两项（字段暴露了但 UI 不读 = 仍是静默）', () => {
    expect(main).toContain('o.optBoolean("lastAbnormalExit"')
    expect(main).toContain('o.isNull("sandboxFallback")')
    // 用户可读文案（不是把内部 key 直接显示出去）
    expect(main).toContain('无进程隔离')
  })

  it('不出声的兜底必须收敛：NodeService 里 catch 后要么出声要么记 sandboxFallback', () => {
    // 反例检查：ensureProotRootfs 的 catch 必须留下 sandboxFallback（不许静默吞）
    const i = node.indexOf('private fun ensureProotRootfs')
    expect(i, '未找到 ensureProotRootfs').toBeGreaterThan(-1)
    const body = node.slice(i, i + 2600)
    expect(body).toMatch(/catch\s*\(t:\s*Throwable\)\s*\{[\s\S]{0,300}sandboxFallback\s*=\s*"rootfs-failed"/)
  })
})

/**
 * 【F3 2026-09-14】滚动截屏：**hint 不等于接通**。
 *
 * ## 这一组护栏为什么存在
 * 上一版把「已接通」的判据定为「源码里有 `scrollCaptureHint = SCROLL_CAPTURE_HINT_INCLUDE`」
 * —— 那是**不充分的**：设 hint 只是把本 View 声明为**候选**，系统取「下一屏」时调的是
 * `View.getScrollCaptureCallback()`，而 `View` 基类默认返回 **null**
 * （官方文档：`If no callback is set, the system may provide an implementation.`）。
 * 于是「✅ 已接通」这个结论**没有任何证据**（只靠 dex marker 命中）⇒ R7 违规。
 *
 * 本组护栏把判据钉成两条：
 *   ① 必须**读回** `getScrollCaptureCallback()` 与 hint（运行期事实，不是源码意图）；
 *   ② 必须把读回值**暴露**给探针（否则设备端仍然「不可读 ⇒ 恒 SKIP ⇒ 伪装成未覆盖」）。
 *
 * 也钉住「**不**手写 ScrollCaptureCallback」这条决策：官方文档明确
 * 「Any value provided here takes precedence over a system version」——
 * 自研实现会**覆盖**本来可能可用的系统实现（净负收益），故只允许设 hint + 探测。
 */
describe('F3 滚动截屏：hint 只是候选，必须探测 callback（P-3/P-9/P-11/R7）', () => {
  const main = read('MainActivity.kt')
  /**
   * 剥离注释后再做**反例**断言。
   *
   * 为什么必须剥：本仓习惯把「踩过的坑与错法」写进注释（对后来者极有价值），
   * 于是注释里会**原文出现**被禁止的写法。若不剥，反例断言会因「注释里提到了旧写法」
   * 而误红 —— 这正是 P-11「判据写错会把好代码判成坏代码」的形态（上轮 F4 已踩过一次，
   * 同一类错误在本轮复现 ⇒ 说明这不是偶发，而是**必须固化的判据写法**）。
   */
  const code = main
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')

  it('✅ 必须读回滚动捕获能力（判据：只设 hint 不构成「已接通」）', () => {
    // 【踩坑史 · 四次设备实测，四次结论都不同 —— 全部源于「假设 API 形态」】
    //   ① Kotlin 合成属性 `webView.scrollCaptureCallback`          → 编译期 Unresolved
    //   ② 显式 getter `webView.getScrollCaptureCallback()`          → **同样**编译期 Unresolved
    //   ③ 反射 `getMethod("getScrollCaptureCallback")`              → 编译过，**运行期**
    //      NoSuchMethodException（设备 sdk=35 实证）
    //   ④ 反射 `getMethod("onScrollCaptureSearch", Signal, Consumer)` → 方法名存在但
    //      **签名不对** ⇒ 又一次 NoSuchMethodException（异常列出的是**我传的**类型）
    //   ⑤ 枚举真实签名后真相：`[dispatchScrollCaptureSearch, getScrollCaptureHint,
    //      onScrollCaptureSearch, setScrollCaptureCallback, setScrollCaptureHint]`
    //      —— **只有 setter 与内部 dispatch，没有读回 callback 的 getter**。
    // ⇒ 正解 = **不猜任何东西**：枚举真实签名（含参数类型），只有当调用形态能从枚举
    //    结果**动态推出**时才探测；推不出来就如实报未知。（P-17）
    expect(main).toContain('parameterTypes')
    expect(main).toContain('java.lang.reflect.Proxy.newProxyInstance')
    // 且必须有字段承载（否则探测即丢，探针仍拿不到）
    expect(main).toMatch(/private\s+var\s+scrollCaptureHasCallback\s*:\s*Boolean/)
    expect(main).toMatch(/private\s+var\s+scrollCaptureSearchResult\s*:\s*String/)
    // 反例（剥注释后判）：三种「硬编码 API 形态」的错法都不许回来
    expect(code).not.toMatch(/webView\.scrollCaptureCallback\b/)
    expect(code).not.toContain('webView.getScrollCaptureCallback()')
    expect(code).not.toContain('getMethod("getScrollCaptureCallback")')
    // 硬编码签名（第三个错法）也不许回来 —— 必须从 parameterTypes 动态推
    expect(code).not.toMatch(/getMethod\(\s*"onScrollCaptureSearch"\s*,/)
  })

  it('✅ 必须读回 hint 实际值（确认「我们的声明真的生效」而不是被忽略）', () => {
    expect(main).toMatch(/private\s+var\s+scrollCaptureHintValue\s*:\s*Int/)
    expect(main).toMatch(/webView\.scrollCaptureHint\b/)
  })

  it('✅ 【关键】必须如实报「未知」而非给 supported 一个布尔值', () => {
    // 五条探测路径全部失败（详见 MainActivity 注释），且唯一「成功」的那条在无 callback 时
    // **本就返回空** ⇒ 结果无区分力。既不能证真也不能证伪 ⇒ 只能报未知。
    // 给 false 会是「用不可靠判据支撑确定结论」——正是 F3 上一版「✅ 已接通」的错误。
    expect(main).toMatch(/o\.put\("supported",\s*JSONObject\.NULL\)/)
    expect(main).toContain('"verdict"')
    // 唯一确定的事实（hint 是否声明）必须单独给出，且**不冒充**结论
    expect(main).toContain('"declared"')
  })

  it('✅ 等待屏必须**只陈述事实、不下结论**（不下结论比下错结论好）', () => {
    expect(main).toContain('系统是否提供捕获实现本机测不出')
    // 反例：不许把「测不出」写成「已接通」或「不支持」的断言
    expect(main).not.toContain('长截图不可用')
  })

  it('✅ 探测必须**按需可重放**（onCreate 时 WebView 是空的 ⇒ 那次结果不可作结论）', () => {
    // 这是本判据最后一个坑：探测语义是「询问**当前**滚动内容尺寸」，而 onCreate 时
    // 页面尚未加载 ⇒ 必然 no-callback。若把那次结果当结论，会得出「不支持」的假结论。
    // ⇒ 必须抽成可重放函数，且在 query 时重探。
    // （参数名用 phase 不用 when —— `when` 是 Kotlin 关键字，实测编译失败。）
    expect(main).toMatch(/private\s+fun\s+probeScrollCapture\s*\(\s*phase\s*:\s*String\s*\)/)
    expect(main).toMatch(/probeScrollCapture\("query"\)/)
  })

  it('✅ 桥方法必须**同步等待**主线程探测完成（否则返回的是上一次的旧值）', () => {
    // JS 桥跑在 JavaBridge 线程，View 访问须在主线程。只 post 不等待 ⇒ 序列化的是
    // 上一次的字段值（竞态）⇒ 又一种「看起来对、实际是旧数据」的假结论。
    expect(main).toContain('CountDownLatch')
    expect(main).toMatch(/latch\.await\(/)
  })

  it('✅ 必须按行为探测而非版本号判定（版本号判据在 OEM 上不可靠）', () => {
    // 一开始想用 `SDK_INT >= 31` 分支 —— 但设备实证 sdk=35 仍读不到 getter，
    // 说明「版本号 ≥ 31」**既不充分也不必要**（OEM 可裁剪）。
    // 正解是**不猜**：枚举真实签名 → 动态推调用形态 → 推不出就报未知。
    // 判据只看「是否从 parameterTypes 动态推」，不看版本号。
    expect(main).toMatch(/scrollCaptureProbeAvailable\s*=\s*searchMethod\s*!=\s*null/)
  })

  it('✅ 必须暴露给探针（读回了但不暴露 = 设备端仍不可读 ⇒ 恒 SKIP）', () => {
    expect(main).toContain('fun scrollCaptureStatus()')
    expect(main).toContain('"hasCallback"')
    expect(main).toContain('"searchResult"')
    expect(main).toContain('"declared"')
  })

  it('✅ 【关键】探测手段可用性必须与事实分开（不得用 hasCallback=false 冒充「不支持」）', () => {
    // 背景（设备实测 sdk=35）：五条探测路径全部失败。此时「系统没有实现」与
    // 「我们的探测手段失效」是**两件事**，混为一谈会得出假结论。
    expect(main).toMatch(/private\s+var\s+scrollCaptureProbeAvailable\s*:\s*Boolean/)
    expect(main).toContain('"probeAvailable"')
    // supported 恒为未知（不给布尔值）——见下一条
  })

  it('✅ 必须枚举 View 上真实的 ScrollCapture* 方法（不许硬编码假定方法名）', () => {
    // 三次实测三种结论的核心教训：不要先假定「方法叫 getScrollCaptureCallback」，
    // 必须先枚举实际存在的方法名（设备实证：框架只有 setter 没有 getter），
    // 否则探针会静默失效。
    expect(main).toMatch(/it\.name\.contains\("ScrollCapture"\)/)
    expect(main).toMatch(/private\s+var\s+scrollCaptureMethods\s*:\s*String/)
    // 且枚举结果要落 logcat（OEM 差异时这是唯一线索）
    expect(main).toContain('methods=[$scrollCaptureMethods]')
  })

  it('【反例】不得手写 setScrollCaptureCallback（会覆盖系统实现，净负收益）', () => {
    // 只允许读（`scrollCaptureCallback != null`），不许写（`= ScrollCaptureCallback`）
    expect(main).not.toMatch(/scrollCaptureCallback\s*=\s*(?!null)/)
    expect(main).not.toContain('setScrollCaptureCallback(')
  })

  it('✅ 能力状态必须出声（但是**陈述事实**，不许下结论 —— R8 + R7）', () => {
    // 既要出声（用户遇到问题时有线索），又不能把「测不出」写成确定结论。
    expect(main).toContain('滚动截屏：')
    expect(main).toContain('hint=INCLUDE')
  })

  it('两个事实都要落 logcat（含**探测时机**，排障时能看到是哪个时机探的）', () => {
    expect(main).toMatch(/scrollCapture\[\$phase\]:\s*sdk=/)
  })
})

describe('L2/A1 软键盘遮挡：必须消费 IME insets（P-7 能力对等 / P-20 判据自带杠杆）', () => {
  const main = read('MainActivity.kt')

  it('✅ 必须消费 WindowInsetsCompat.Type.ime()（判据：此前只读 systemBars ⇒ 键盘不避让）', () => {
    // 设备实测（scripts/ef-keyboard-inset.mjs）：键盘弹出时 composerBottom=785css
    // 而 IME 顶边=594css ⇒ 被盖 191css。根因是本监听只消费 systemBars()。
    expect(main).toMatch(/WindowInsetsCompat\.Type\.ime\(\)/)
  })

  it('✅ 必须取 max(ime, bars) 而不是简单相加（否则键盘弹起时双重避让）', () => {
    // `systemBars().bottom`（导航栏）与 `ime().bottom`（键盘）在键盘弹起时是同一块屏幕
    // 区域的两种视角 ⇒ 相加会多留一条导航栏高度。
    expect(main).toMatch(/if\s*\(\s*ime\.bottom\s*>\s*bars\.bottom\s*\)\s*ime\.bottom\s+else\s+bars\.bottom/)
  })

  it('✅ 键盘收起时必须自动回落（不许留状态机 ⇒ 收起后仍留一条键盘高度的空白）', () => {
    // 这里的「自动回落」靠 ime().bottom == 0 天然成立 —— 断言不得出现「手上记住键盘曾开过」的
    // 持久状态字段参与 padding 计算（那会让收起后仍留白）。
    expect(main).not.toMatch(/keyboardWasOpen|imeWasVisible|lastImeBottom\s*>/) 
  })

  it('✅ 运行期读回必须存在且含**独立来源**（不只信自己记的值 —— P-11 产物即事实）', () => {
    expect(main).toMatch(/private\s+var\s+insetImeBottomPx\s*:\s*Int/)
    expect(main).toMatch(/private\s+var\s+insetAppliedBottomPx\s*:\s*Int/)
    // 直接读视图的实际值 = 独立来源 ⇒ 能发现「我们以为写了但视图没接受」
    expect(main).toContain('webView.paddingBottom')
    expect(main).toContain('lp.bottomMargin')
    expect(main).toContain('listenerInstalled')
  })

  it('✅ 【关键】避让必须走 margin 通道，不得只 setPadding（实测 padding 不改变页面视口）', () => {
    // 设备实测（2026-09-14）：`setPadding(...,767)` 后 `webView.paddingBottom==767`（视图接受了）
    // 但 `documentElement.clientHeight` 恒 873 ⇒ **padding 只裁剪绘制区，不改变 Chromium 视口**
    // ⇒ 上一版修法无效（写进视图 ≠ 生效）。margin 走布局尺寸通道 ⇒ 视口真的收缩。
    expect(main).toMatch(/lp\.bottomMargin\s*=\s*bottom/)
    expect(main).toMatch(/v\.layoutParams\s*=\s*lp/)
    // 且必须记录实际用了哪条通道（诊断用；否则将来有人改回 padding 时无痕迹）
    expect(main).toMatch(/insetChannel\s*=\s*"margin"/)
  })

  it('✅ 必须暴露给 JS 桥（读回了但不暴露 = 设备端不可断言 ⇒ 恒 SKIP）', () => {
    expect(main).toMatch(/fun\s+keyboardInsetStatus\s*\(\s*\)\s*:\s*String/)
    expect(main).toMatch(/@JavascriptInterface\s*\n\s*fun\s+keyboardInsetStatus/)
  })

  it('【反例】不得把 visualViewport 当修法（本环境它不反映键盘 ⇒ 判据会恒真）', () => {
    // 设备实测：键盘弹出前后 innerHeight / visualViewport.height / clientHeight **全部不变**
    // ⇒ 任何基于它们的 CSS/JS 判据在此环境恒真（P-20 违规）。修法必须在原生侧。
    // 只禁代码用法（`window.visualViewport` / `.visualViewport.`），注释里描述该 API 不算。
    expect(main).not.toMatch(/window\.visualViewport|\.visualViewport\s*\./)
  })
})
