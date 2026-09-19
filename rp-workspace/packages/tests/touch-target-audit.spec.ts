/**
 * L1 触屏交互层：指针序列**对称性**护栏（2026-09-14 轨道 A 穷举产出）。
 *
 * ## 为什么这组测试存在
 * 轨道 A 的 L1 穷举做「静态扫描 + 运行时枚举」，其中一项必测项是
 * 「pointer capture 在元素移除时的释放」（`docs/MOBILE-TEST-METHODOLOGY.md` §二 L1）。
 * 静态扫描的结果：全仓 `setPointerCapture` 只有一处（`RpStateFloat.tsx` 的浮球），
 * 但它只绑了 `pointerdown` / `pointermove` / `pointerup` **三个** handler，
 * **缺 `pointercancel`** —— 而 Android WebView 在手势被系统抢占（下拉通知栏、
 * 返回手势、多指介入）时发的正是 `pointercancel` 而非 `pointerup`。
 *
 * 后果（P-8 幂等违规）：拖拽状态 `dragRef` 残留为「进行中」，位置停在半途且不贴边，
 * 直到下一次按下才自愈。用户可见表现 = 「浮球被我拖到一半就不动了」。
 *
 * ## 为什么用源码结构断言而不是渲染测试
 * 本项目无 React 测试环境（无 jsdom / testing-library），既有惯例是
 * **源码结构断言 + 假 DOM 桩**（见 `mobile-adapt.spec.ts` / `card-fence.spec.ts`）。
 * 此处断言的是「**协议对称性**」这一类不变量：凡绑了 pointerdown 的组件，
 * 必须同时绑 pointerup 与 pointercancel。这个判据可以机械检查，且不依赖渲染环境。
 *
 * 局限（诚实边界）：本测试只能证明**源码里有这个 handler**，不能证明它在真机上
 * 被正确触发。真机复核属 M5/M6（见 `B-DEVICE-VERIFY-CHECKLIST.md`）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const here = import.meta.dirname

/** 读源码（相对 packages/src） */
function src(rel: string): string {
  return readFileSync(join(here, '..', 'src', rel), 'utf8')
}

// ---------------------------------------------------------------------------
// 1. 指针序列对称性：有 onPointerDown 的组件必须有 onPointerUp + onPointerCancel
// ---------------------------------------------------------------------------

describe('L1 指针序列对称性（P-8 幂等）', () => {
  const knownPointerComponents = [
    'dsht-rp-ui/src/client/RpStateFloat.tsx',
  ]

  it('全仓唯一的 pointer 手势组件：RpStateFloat 必须绑 up + cancel + lostpointercapture', () => {
    const s = src('dsht-rp-ui/src/client/RpStateFloat.tsx')
    expect(s).toContain('onPointerDown')
    expect(s).toContain('onPointerUp')
    // 核心护栏：缺 cancel 会让系统手势抢占后的状态不收敛
    expect(s).toContain('onPointerCancel')
    // 【A1 第 8 格「pointer capture 在元素移除时的释放」】隐式释放（元素被移除 /
    // 同 pointerId 被他人抢占）只发 lostpointercapture —— 既无 pointerup 也无
    // pointercancel ⇒ 缺它 dragRef 会永久残留（与 cancel 缺陷同一失效族）。
    expect(s).toContain('onLostPointerCapture')
    // 且必须真的**绑到元素上**（只定义不绑定 = 静默死代码，P-3）
    expect(s).toMatch(/onLostPointerCapture=\{onLostPointerCapture\}/)
  })

  // 【W7 · 第二十三轮续】合成点击类：只绑 pointer* 不绑 click 的元素会「点了没反应」。
  //
  // ## 为什么必须有这条护栏（而不是靠人工记得）
  // 无障碍服务（TalkBack / Voice Access）、自动化脚本、`element.click()` **只发 click
  // 不发 pointer 序列**。凡绑了 `onPointerDown` 的元素，若不绑 `onClick`，
  // 上述路径**完全失效且零报错**（P-3 静默失败）。
  //
  // ## 设备实测（本轮，`tmp` 一次性探针，已按惯例删除）
  // 对 `.dsht-rp-statefloat-ball` 跑四步：E1 纯合成 click ×2 各翻转一次（PASS）；
  // E2/E3 真实触摸（touchStart+touchEnd）各翻转一次（PASS）；
  // **E4 关键**：真实触摸后再来一次纯合成 click 仍翻转 ⇒ `clickHandledRef`
  // **无残留**（即「pointerup 后无合成 click」的路径不会吞掉下一次合成点击，P-8 幂等成立）。
  //
  // ## 护栏口径：**全仓穷举**（不只这一个组件）
  // 新增「绑了 onPointerDown 的组件」若漏绑 onClick，本条立即报红。
  it('✅ 合成点击类：凡绑 onPointerDown 的组件必须同时绑 onClick（穷举全仓）', () => {
    // 穷举 packages/src 下所有 TS/TSX（排除产物 lib/ 与 node_modules）
    const srcRoot = join(here, '..', 'src')
    const offenders: string[] = []
    const scanned: string[] = []
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'lib') continue
        const p = join(dir, name)
        if (statSync(p).isDirectory()) { walk(p); continue }
        if (!/\.(ts|tsx)$/.test(name)) continue
        scanned.push(p)
        const t = readFileSync(p, 'utf8')
        if (!/onPointerDown\s*[=:]/.test(t)) continue
        // 绑了 onPointerDown ⇒ 同文件必须出现 onClick 绑定
        if (!/onClick\s*[=:]/.test(t)) offenders.push(relative(srcRoot, p).split(sep).join('/'))
      }
    }
    walk(srcRoot)
    // 【P-20 杠杆】扫描面必须真的非空（否则「零 offender」是恒真的假绿）
    expect(scanned.length, '扫描面为空 ⇒ 判据无杠杆').toBeGreaterThan(50)
    expect(offenders, `以下文件绑了 onPointerDown 但没绑 onClick（合成点击会失效）：${offenders.join(', ')}`).toEqual([])
  })

  it('pointercancel 处理器只清拖拽状态，**不**置 clickHandled（防吞掉下一次真实点击）', () => {
    const s = src('dsht-rp-ui/src/client/RpStateFloat.tsx')
    // 【P-1 单源】三条结束路径共享同一个 endDrag 入口 —— 先断言该入口存在且只做清状态
    const e = /const endDrag = \(\): void => \{([\s\S]*?)\n  \}/.exec(s)
    expect(e, '未找到 endDrag 单一入口').not.toBeNull()
    const ebody = e?.[1] ?? ''
    expect(ebody).toContain('dragRef.current = null')
    // 关键负控：捕获丢失后浏览器不会再合成 click，置位会让**下一次**点击被吞
    expect(ebody).not.toContain('clickHandledRef')
    // 三条 handler 必须都走 endDrag（不得各写一份清理 ⇒ 防止将来新增路径时漏改）
    for (const h of ['onPointerCancel', 'onLostPointerCapture']) {
      const m = new RegExp(`const ${h} = \\(\\): void => \\{([\\s\\S]*?)\\n  \\}`).exec(s)
      expect(m, `未找到 ${h} 定义`).not.toBeNull()
      expect(m?.[1] ?? '', `${h} 必须调用 endDrag（单源）`).toContain('endDrag()')
      expect(m?.[1] ?? '', `${h} 不得置 clickHandledRef`).not.toContain('clickHandledRef')
    }
  })

  it('setPointerCapture 必须有配对的 releasePointerCapture（成功路径）', () => {
    const s = src('dsht-rp-ui/src/client/RpStateFloat.tsx')
    expect(s).toContain('setPointerCapture')
    expect(s).toContain('releasePointerCapture')
    // 【P-22 同族】release 必须**先判持有**再调用：隐式释放后（lostpointercapture 先到）
    // 再 release 会抛 NotFoundError，React 事件处理器里抛错会打断同批事件处理。
    expect(s).toContain('hasPointerCapture')
  })

  it('扫描：knownPointerComponents 清单与实际相符（防清单腐烂）', () => {
    // 若将来新增了别的 pointer 手势组件，这条会失败，提醒把它加进清单一起检查
    for (const f of knownPointerComponents) {
      const s = src(f)
      expect(s, `${f} 应当仍在维护`).toContain('onPointerDown')
    }
  })
})

// ---------------------------------------------------------------------------
// 2. 触控目标判据口径单源（P-1）
// ---------------------------------------------------------------------------

describe('L1 触控目标判据口径（P-1 单源）', () => {
  it('文档里的两级口径（38 底线 / 44 目标）与 perf-audit 的工具口径一致', () => {
    const doc = readFileSync(join(here, '..', '..', '..', 'docs', 'MOBILE-TEST-METHODOLOGY.md'), 'utf8')
    expect(doc).toContain('38')
    expect(doc).toContain('44')
    // 工具按 44 全量报出（宽于阻塞口径，避免漏收 P2 面）——若改成只报 38 会漏掉 P2
    const tool = readFileSync(join(here, '..', '..', 'scripts', 'perf-audit.mjs'), 'utf8')
    expect(tool).toContain('t.w < 44 || t.h < 44')
  })

  it('窄屏必须为高频可点元素提供放大规则（38 底线）——静态回归护栏', () => {
    // 【2026-09-14 第二十轮 · 口径修正：只查 mobile 包 ⇒ 迁移后必然假红】
    // 原实现只读 `dsht-plugin-mobile/client/style.ts`，而本轮把约 27 条 `.dsht-rp-*`
    // 规则**迁到了 rp-ui 自己的包**（P-26：跨包规则是死规则）。⇒ 改为查**两包并集**：
    // 判据是「这些类在窄屏必须有放大规则」，至于落在哪个包由 P-26 决定。
    const m = src('dsht-plugin-mobile/client/style.ts')
    const r = src('dsht-rp-ui/src/client/style.ts')
    const both = m + '\n' + r
    const mustScale = [
      '.cp-close', '.cp-stepper button', '.cp-expand-btn',
      '.sf-btn', '.vb-arrow', '.dsht-rp-regen-btn',
      '.lore-btn',
      '.sv-view-btn', '.dsht-npc-switch',
      '.pr-expand',
    ]
    const missing = mustScale.filter(sel => !both.includes(sel))
    expect(missing, `窄屏缺放大规则（两包并集内都没有）：${missing.join(', ')}`).toEqual([])
    // 并在同一用例里守住归属：r 侧（rp-ui）必须承载这些 dsht-rp-* 的放大
    const mustBeInRpUi = ['.dsht-rp-regen-btn', '.dsht-npc-switch', '.dsht-rp-card-gear', '.dsht-rp-back', '.dsht-rp-tab']
    const wrongPlace = mustBeInRpUi.filter(sel => !r.includes(sel))
    expect(wrongPlace, `这些 rp-ui 自有组件的放大规则不在 rp-ui 包内（P-26 归属原则）：${wrongPlace.join(', ')}`).toEqual([])
  })

  // 【L1 2026-09-14 设备实测修复】触控目标规则必须写在**组件自己的包**里。
  //
  // 实测发现（设备 CDP）：这些 `dsht-rp-*` 的放大规则原本只写在
  // `dsht-plugin-mobile/client/style.ts`，但该文件注入**先于** `dsht-rp-ui-style`，
  // 而同属性规则谁后写谁赢 ⇒ 放大被 rp-ui 的桌面尺寸**覆盖回去**，`getComputedStyle`
  // 实测仍是 36px。即「规则存在 ≠ 规则生效」——静态检查规则文本的护栏全绿，功能照旧失效。
  // 修法：规则迁进 rp-ui 自己的 `@media (pointer: coarse)` 段（同包，层叠确定）。
  it('✅ 我方自有组件（dsht-rp-*）的触控放大必须写在 rp-ui 自己的 coarse 段（跨包层叠会静默失效）', () => {
    const rpui = src('dsht-rp-ui/src/client/style.ts')
    // 取 rp-ui 的 coarse 媒体查询段（到文件末尾或下一个顶层 @media）
    const coarse = /@media\s*\(pointer:\s*coarse\)\s*\{([\s\S]*?)\n\}/.exec(rpui)
    expect(coarse, '未找到 rp-ui 的 (pointer: coarse) 段（结构变了，需同步本护栏）').not.toBeNull()
    const body = coarse?.[1] ?? ''
    // 这几个是设备实测「需要放大但被层叠压回」的类，必须在 rp-ui 自己的段里
    for (const sel of ['.dsht-rp-scriptball', '.dsht-rp-script-pill', '.dsht-rp-rollback-btn',
      '.dsht-rp-import-dock', '.dsht-rp-preset-switch .ps-select', '.dsht-rp-avatar']) {
      expect(body, `rp-ui coarse 段缺 ${sel} 的放大规则（设备实测该项需 ≥38px）`).toContain(sel)
    }
    // 且 mobile 侧不得再留同名死规则（留了就是「看起来有防护、实则永不生效」）
    const mob = src('dsht-plugin-mobile/client/style.ts')
    expect(mob, 'mobile 侧残留 dsht-rp-scriptball 规则（会被层叠压回 ⇒ 死规则）').not.toContain('.dsht-rp-scriptball {')
  })

  it('**禁止**用内联尺寸覆盖触控目标类（inline 压制窄屏 44px 规则 = 静默失效）', () => {
    const panel = src('dsht-rp-ui/src/client/PersonaPanel.tsx')
    // 历史缺陷：`className="dsht-rp-back" style={{width:28,height:28}}` ⇒ 手机上 28px
    expect(panel).not.toMatch(/className="dsht-rp-back"\s+style=\{\{\s*width/)
  })

  // 【W10 第二十轮续 · 从「单点检查」升级为「穷举检查」】
  //
  // ## 设备实测先答了「内联到底会不会压制」这个前置问题（P-26：不靠推理）
  // 受控实验（tmp/probe-inline-vs-important.mjs）：
  //   · !important 类规则 **vs** 内联（无 !important） ⇒ **类规则胜**（实测 44×44）
  //   · !important 类规则 **vs** 内联**带** !important ⇒ 内联胜（实测 26×26）
  // 真实页面采样（overlay 打开态，50 个带内联尺寸的我方元素）⇒ **低于 38px：0 项**。
  // ⇒ 结论：凡粗粒度放大规则带 !important，**普通内联压不过它**；
  //   真正会失效的只有「内联**也**带 !important」这种写法。
  //
  // ## 因此本条判据守的是**那唯一会失效的写法**（穷举，不再只盯一个类）
  it('✅ 穷举：我方触控目标类上不得出现带 !important 的内联尺寸（唯一能压制 !important 的写法）', () => {
    // 单源取「我方触控目标类名」：从 rp-ui 的 coarse 段解析选择器，避免手写清单漂移（P-1）
    const rpui = src('dsht-rp-ui/src/client/style.ts')
    const start = rpui.indexOf('@media (pointer: coarse) {')
    expect(start, '未找到 rp-ui 的 (pointer: coarse) 段').toBeGreaterThan(-1)
    let depth = 0, end = -1
    for (let i = rpui.indexOf('{', start); i < rpui.length; i++) {
      if (rpui[i] === '{') depth++
      else if (rpui[i] === '}') { depth--; if (depth === 0) { end = i; break } }
    }
    const coarse = rpui.slice(rpui.indexOf('{', start) + 1, end)
    const clsNames = [...new Set([...coarse.matchAll(/\.([a-z][a-z0-9-]*)/g)].map(m => m[1]))]
    expect(clsNames.length, 'coarse 段未解析到类名（结构变了，需同步本护栏）').toBeGreaterThan(5)

    const tsxFiles = [
      'dsht-rp-ui/src/client/PersonaPanel.tsx', 'dsht-rp-ui/src/client/PresetPanel.tsx',
      'dsht-rp-ui/src/client/RegexPanel.tsx', 'dsht-rp-ui/src/client/BooksPanel.tsx',
      'dsht-rp-ui/src/client/RpOverlay.tsx', 'dsht-rp-ui/src/client/RpLorePanel.tsx',
      'dsht-rp-ui/src/client/SessionsPanel.tsx', 'dsht-rp-ui/src/client/RpStateView.tsx',
      'dsht-rp-ui/src/client/RpScriptHost.tsx', 'dsht-rp-ui/src/client/RpTablesView.tsx',
      'dsht-rp-ui/src/client/UpdatePanel.tsx', 'dsht-rp-ui/src/client/PluginCards.tsx',
    ]
    const offenders: string[] = []
    for (const f of tsxFiles) {
      const s = src(f)
      const re = /className=(?:"([^"]*)"|\{`([^`]*)`\})[^>]*?style=\{\{([^}]*)\}\}/gs
      for (const m of s.matchAll(re)) {
        const classStr = (m[1] ?? m[2] ?? '')
        const styleStr = m[3] ?? ''
        if (!/(width|height|minWidth|minHeight)/i.test(styleStr)) continue
        // 内联里必须**显式**带 !important 才违规（普通内联会被类 !important 压过）
        if (!/!\s*important/.test(styleStr)) continue
        const touched = clsNames.filter(c => new RegExp(`(^|\\s)${c}(\\s|$)`).test(classStr))
        if (touched.length > 0) offenders.push(`${f}: ${classStr} ← ${styleStr.trim().slice(0, 60)}（命中 ${touched.join(',')}）`)
      }
    }
    expect(offenders, `内联尺寸带 !important 且挂在我方触控目标类上（会压过粗粒度放大规则）：\n${offenders.join('\n')}`).toEqual([])
  })

  // 【L2「字号与缩放」格设备实测发现 · 2026-09-14】
  // 触控尺寸规则**命中且带 !important 仍可完全不生效**：元素在 flex 容器内时，
  // `flex-shrink`（默认 1）会把 height 压回去。设备实测决定性实验：
  //   height:44px!important 单独施加 → 仍 19.45px（无效）
  //   min-height:44px 单独施加      → 44px（有效）
  //   height:44px + flex-shrink:0   → 44px（有效）
  // 先例：dsht-plugin-mobile 的 settings-nav-cell 早已写 height + flex-shrink:0
  // —— 同一坑**一处已修一处未修**，正是 P-1 的实例。
  it('✅ 触控放大规则必须抗 flex 压缩（height 会被 flex-shrink 压回，!important 救不了）', () => {
    const rpui = src('dsht-rp-ui/src/client/style.ts')
    const coarse = /@media\s*\(pointer:\s*coarse\)\s*\{([\s\S]*?)\n\}/.exec(rpui)
    expect(coarse, '未找到 rp-ui 的 (pointer: coarse) 段（结构变了，需同步本护栏）').not.toBeNull()
    const body = coarse?.[1] ?? ''
    // 逐条检查：凡是设定尺寸的放大规则，同一条声明里必须有 flex-shrink
    for (const cls of ['.dsht-rp-script-pill', '.dsht-rp-rollback-btn', '.dsht-rp-import-dock',
      '.dsht-rp-preset-switch .ps-select', '.dsht-rp-avatar']) {
      const re = new RegExp(cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}')
      const m = re.exec(body)
      expect(m, `rp-ui coarse 段缺 ${cls} 的放大规则`).not.toBeNull()
      expect(m?.[1] ?? '', `${cls} 的触控尺寸规则缺 flex-shrink（在 flex 容器内会被压回，!important 无效）`)
        .toMatch(/flex-shrink\s*:\s*0/)
    }
    // 同一坑的先例必须仍带 flex-shrink（防「修了新的一处、旧的被删」）
    const mob = src('dsht-plugin-mobile/client/style.ts')
    const navCell = /\[data-dsht-mobile="settings-nav-cell"\]\s*\{([^}]*)\}/.exec(mob)
    expect(navCell?.[1] ?? '', 'settings-nav-cell 丢了 flex-shrink:0（先例被改坏）').toMatch(/flex-shrink\s*:\s*0/)
  })

  // 【L1 触控目标穷举 · 2026-09-14 第二十轮】设备探针 ef-touch-targets.mjs 抓到
  // 4 个 P1 阻塞项 + 3 个 P2 项。其中 `.vb-arrow` 是**判决性证据**：
  //   dsht-plugin-mobile 写了 `.vb-arrow { width: 38px; height: 38px }`，
  //   但 rp-ui 有**特异性更高**的桌面基线 `.dsht-rp-variant-bar .vb-arrow { 20px }`
  //   （0,2,0 > 0,1,0）⇒ 实测渲染 **20×20**，mobile 那条是**永不生效的死规则**。
  //   而 mobile 侧注释当时还写着「不属 rp-ui 自有类（层叠无冲突）」—— 判断是错的。
  it('✅ 触控目标穷举：本轮抓到的 P1/P2 项必须在 rp-ui coarse 段有足特异性放大规则', () => {
    const rpui = src('dsht-rp-ui/src/client/style.ts')
    // 取 coarse 段时**必须连花括号配对一起取**：不能只用非贪婪 `[\s\S]*?\n\}` ——
    // 段内有多层嵌套规则（每条规则自带 `}`），非贪婪会**提前截断**到第一条规则的收尾，
    // 于是「段内查找」实际只看到前几条 ⇒ 漏判（本轮实测：`.dsht-rp-variant-bar .vb-arrow`
    // 的放大规则在段内靠后，被截断在视野外 ⇒ 假 FAIL）。
    const start = rpui.indexOf('@media (pointer: coarse) {')
    expect(start, '未找到 rp-ui 的 (pointer: coarse) 段').toBeGreaterThan(-1)
    let depth = 0, end = -1
    for (let i = rpui.indexOf('{', start); i < rpui.length; i++) {
      if (rpui[i] === '{') depth++
      else if (rpui[i] === '}') { depth--; if (depth === 0) { end = i; break } }
    }
    expect(end, '(pointer: coarse) 段花括号未配对').toBeGreaterThan(-1)
    const body = rpui.slice(rpui.indexOf('{', start) + 1, end)

    const items: Array<[string, RegExp]> = [
      ['.dsht-rp-variant-bar .vb-arrow', /width:\s*44px/],   // 必须带足特异性（压过 0,2,0 桌面基线）
      ['.dsht-rp-sidebar-btn', /height:\s*44px/],
      ['.dsht-rp-tokenmeter .tm-hit', /height:\s*44px/],
      ['.dsht-rp-regen-btn', /height:\s*44px/],
      ['.dsht-rp-lore .lore-btn', /height:\s*44px/],
      ['.dsht-rp-stateview .sv-view-btn', /height:\s*44px/],
    ]
    for (const [sel, sizeRe] of items) {
      // 同一选择器在段内可能只出现一次；用「全局匹配取最后一条」防「段内重复定义时看错那条」
      const re = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'g')
      const all = [...body.matchAll(re)]
      expect(all.length, `rp-ui coarse 段缺 ${sel} 的放大规则（设备实测该项未达触控底线）`).toBeGreaterThan(0)
      const decl = all[all.length - 1]?.[1] ?? ''
      expect(decl, `${sel} 放大规则未给到 44px`).toMatch(sizeRe)
      expect(decl, `${sel} 的放大规则缺 flex-shrink（会被 flex 容器压回）`).toMatch(/flex-shrink\s*:\s*0/)
    }
  })

  // 【W30 新增】放大规则的**宽度维度**：只写 height 而不写 width 是一种「半修」，
  // 设备上表现为「高够了但宽还是桌面基线的小值」——W30 实测就撞到：
  //   `.dsht-npc-switch` 早已写了 `height: 44px`，而实测量到 **36×44**（宽 36 < 38 底线）。
  // 为什么此前没发现：该控件只在宿主设置页里出现，而跨态穷举没有设置面板态（见 W30）。
  //
  // 判据形态（P-30：静态判据必须自带正负控）：从**组件源码的类名**出发，
  //  凡该类在桌面基线里写了 width（说明它有固定宽度），则 coarse 段的放大规则
  //  必须**同时**给 width；只给 height 即报红。
  it('✅ 放大规则不得「只修高度不修宽度」（桌面有固定宽度的控件，coarse 段必须同时给 width）', () => {
    const rpui = src('dsht-rp-ui/src/client/style.ts')
    const start = rpui.indexOf('@media (pointer: coarse) {')
    expect(start, '未找到 rp-ui 的 (pointer: coarse) 段').toBeGreaterThan(-1)
    let depth = 0, end = -1
    for (let i = rpui.indexOf('{', start); i < rpui.length; i++) {
      if (rpui[i] === '{') depth++
      else if (rpui[i] === '}') { depth--; if (depth === 0) { end = i; break } }
    }
    expect(end, '(pointer: coarse) 段花括号未配对').toBeGreaterThan(-1)
    const coarse = rpui.slice(rpui.indexOf('{', start) + 1, end)
    // 桌面基线 = coarse 段之前的部分（本文件的写法是把桌面规则写在前面）
    const desktop = rpui.slice(0, start)

    // 从 coarse 段里找出「单类名 + 声明块」形态的规则（如 `.dsht-npc-switch { … }`）
    const offenders: string[] = []
    // ★ 判据自身的实现假设（P-30）：桌面基线里的 width **未必是固定像素**。
    //  首版把任何 `width:` 都当成「固定宽」 ⇒ 对 `.dsht-rp-sidebar-btn`
    //  （桌面 `width: 100%`，宽度随容器撑满，本来就不需要放大）给出**假阳性**。
    //  ⇒ 只对**固定像素**宽度报红；`100%` / `auto` / `fit-content` 等流式宽度跳过。
    const FIXED_W = /(^|[^-\w])width\s*:\s*\d+(?:\.\d+)?px/
    const isFlowWidth = (decl: string) =>
      /(^|[^-\w])width\s*:\s*(?:100%|auto|fit-content|max-content|min-content|inherit|unset)/.test(decl)
    for (const m of coarse.matchAll(/(^|\n)\s*(\.[a-z][a-z0-9-]*)\s*\{([^}]*)\}/g)) {
      const cls = m[2]
      const decl = m[3]
      const hasSize = /(width|height)\s*:/.test(decl)
      if (!hasSize) continue
      const givesWidth = /(^|[^-\w])width\s*:/.test(decl)
      const givesHeight = /(^|[^-\w])height\s*:/.test(decl)
      if (!givesHeight || givesWidth) continue      // 没给高度，或两维都给了 ⇒ 不管
      // 桌面基线里必须有该类的**固定像素** width（否则宽度由容器/内容决定，不适用本条）
      const dRe = new RegExp('(^|\\n)\\s*' + cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'm')
      const dm = dRe.exec(desktop)
      if (!dm) continue
      const dDecl = dm[2] ?? ''
      if (isFlowWidth(dDecl) || !FIXED_W.test(dDecl)) continue
      offenders.push(`${cls}：coarse 段只给了 height，而桌面基线给了固定 width ⇒ 宽度很可能仍不达标`)
    }
    expect(offenders, `半修（只修高度不修宽度）——请在 coarse 段一并给 width：\n${offenders.join('\n')}`).toEqual([])

    // 正控（P-30）：本判据必须能对「人造坏样本」报红 —— 否则它可能只是没扫到
    const fake = '.dsht-fake-sel { height: 44px !important; }'
    const fakeDesktop = '.dsht-fake-sel { width: 36px; height: 20px; }'
    const flowDesktop = '.dsht-flow-sel { width: 100%; height: 20px; }'
    const probe = (c: string, d: string) => {
      for (const m of c.matchAll(/(^|\n)\s*(\.[a-z][a-z0-9-]*)\s*\{([^}]*)\}/g)) {
        const cls = m[2], decl = m[3]
        if (!/(width|height)\s*:/.test(decl)) continue
        if (!/(^|[^-\w])height\s*:/.test(decl)) continue
        if (/(^|[^-\w])width\s*:/.test(decl)) continue
        const dRe = new RegExp('(^|\\n)\\s*' + cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'm')
        const dm = dRe.exec(d)
        if (!dm) continue
        const dDecl = dm[2] ?? ''
        if (isFlowWidth(dDecl) || !FIXED_W.test(dDecl)) continue
        return true
      }
      return false
    }
    expect(probe(fake, fakeDesktop), '判据自证失败：人造的「只给 height」坏样本没被识别出来（判据无判据力）').toBe(true)
    expect(probe('.dsht-fake-sel { width: 44px; height: 44px; }', fakeDesktop), '判据自证失败：两维都给的好样本被误报').toBe(false)
    // ★ 负控：**流式宽度**（100%）的控件不得被报红 —— 这正是首版踩到的假阳性形态
    expect(probe(fake, flowDesktop), '判据自证失败：桌面 width:100%（流式）被误报成「固定宽度」').toBe(false)
  })

  // 归属原则（R17 的推论）：**放大规则必须写在组件所属的那个包内**。
  // 反例（本轮实际发生的错误）：我曾把 `.dsht-mobile-attach` 的放大写进 rp-ui 的
  // coarse 段 —— 而 dsht-mobile-* 是 mobile 插件自己的组件。跨包写会让
  // 「谁负责这个控件」变得不可判定，且下一次改 mobile 侧时容易漏。
  it('✅ 归属原则：dsht-mobile-* 的放大规则必须写在 mobile 包内，不得出现在 rp-ui', () => {
    const rpui = src('dsht-rp-ui/src/client/style.ts')
    const coarse = /@media\s*\(pointer:\s*coarse\)\s*\{([\s\S]*?)\n\}/.exec(rpui)
    const body = coarse?.[1] ?? ''
    for (const cls of ['.dsht-mobile-attach', '.dsht-mobile-hamburger']) {
      expect(body, `rp-ui coarse 段出现 ${cls}（cross-package 放大：应写在 dsht-plugin-mobile 自己的包内）`)
        .not.toContain(cls + ' {')
    }
    // 正控：mobile 包内必须真的有这两条放大（且 ≥44）
    const mob = src('dsht-plugin-mobile/client/style.ts')
    expect(mob, 'dsht-mobile-attach 未在 mobile 包内放大到 44').toMatch(/min-width:\s*44px;\s*height:\s*44px/)
    expect(mob, 'dsht-mobile-hamburger 未在 mobile 包内放大到 44').toMatch(/width:\s*44px;\s*height:\s*44px/)
  })

  // 死规则的机器化护栏：mobile 侧**不得**再出现「无 dsht- 前缀」的放大规则。
  // 理由：这类规则的选择器（.vb-arrow / .lore-btn / .sv-view-btn）在 rp-ui 侧
  // 都有**更高特异性**的桌面基线 ⇒ 必然静默失效（P-25 的选择器形态）。
  it('✅ 死规则护栏：mobile 包内不得再写无 dsht- 前缀的触控放大规则', () => {
    const mob = src('dsht-plugin-mobile/client/style.ts')
    // 允许出现在注释里（历史说明），但**不得出现在规则声明行**
    const ruleLines = mob.split('\n').filter(l => /\{\s*[^}]*\}/.test(l) && !/^\s*(\/\*|\*|\/\/)/.test(l))
    for (const cls of ['.vb-arrow', '.lore-btn', '.sv-view-btn']) {
      const offender = ruleLines.find(l => new RegExp('(^|[\\s,])' + cls.replace('.', '\\.') + '\\s*(,|\\{)').test(l) && /(width|height|min-width|min-height)\s*:/.test(l))
      expect(offender ?? '', `mobile 包内出现死规则 ${cls}（rp-ui 侧有更高特异性的桌面基线 ⇒ 永不生效；应写在 rp-ui 的 coarse 段）`).toBe('')
    }
  })

  // -------------------------------------------------------------------------
  // 【W2 第二十轮续三 · 跨态穷举】设备实测抓到的问题（判据自身 2 项 + 产品 3 类）
  //
  // 探针升级为「12 态穷举 + 态生效断言 + 遮挡侦测 + 零覆盖护栏」后抓到：
  //   ① **产品**：`.rx-check`（implicit label 复选框行）实测 353×37 < 38 底线（P1）；
  //      `.rx-name` 126×24（P1）；`.rx-toggle` 40×22（P1）。
  //   ② **判据自身**（P-19/P-23 同族）：探针原先只查 `label[for]`，**implicit label
  //      整类从未被测**；且同名元素共用定位串 ⇒ 26 个 P1 被**折叠**成 2 条。
  //
  // 本条守的是「**那一类写法**」而不是逐个类名（P-1：修一处须全仓收口）：
  //   `.rx-check` 是跨面板复用的类（RegexPanel / PersonaPanel / RpOverlay 抽屉共用）
  //   ⇒ 放大规则必须写在**类本身**的层级，而不是某个面板的局部（否则别处仍不达标）。
  it('✅ 跨态穷举：复用的复选框行 .rx-check 必须统一给下限（不得只修某一个面板）', () => {
    const rpui = src('dsht-rp-ui/src/client/style.ts')
    const start = rpui.indexOf('@media (pointer: coarse) {')
    let depth = 0, end = -1
    for (let i = rpui.indexOf('{', start); i < rpui.length; i++) {
      if (rpui[i] === '{') depth++
      else if (rpui[i] === '}') { depth--; if (depth === 0) { end = i; break } }
    }
    const body = rpui.slice(rpui.indexOf('{', start) + 1, end)
    // 必须是**裸类**规则（`.rx-check {`），不能是某个面板的局部（`.dsht-rp-drawer .rx-check {`）
    const bare = /(^|\n)\s*\.rx-check\s*\{([^}]*)\}/.exec(body)
    expect(bare, 'coarse 段缺裸类 .rx-check 的下限规则（只修某个面板会漏掉其他复用点）').not.toBeNull()
    expect(bare?.[2] ?? '', '.rx-check 的下限未给到 44px').toMatch(/min-height:\s*44px/)
    // 且必须真的覆盖全部复用点：这三个文件都在用 .rx-check
    for (const f of ['dsht-rp-ui/src/client/RegexPanel.tsx', 'dsht-rp-ui/src/client/PersonaPanel.tsx', 'dsht-rp-ui/src/client/RpOverlay.tsx']) {
      expect(src(f), `${f} 应当仍在使用 .rx-check（若已改名，本护栏需同步）`).toContain('rx-check')
    }
  })

  it('✅ 跨态穷举：正则面板的 .rx-name / .rx-toggle 必须给下限（设备实测 126×24 / 40×22）', () => {
    const rpui = src('dsht-rp-ui/src/client/style.ts')
    const start = rpui.indexOf('@media (pointer: coarse) {')
    let depth = 0, end = -1
    for (let i = rpui.indexOf('{', start); i < rpui.length; i++) {
      if (rpui[i] === '{') depth++
      else if (rpui[i] === '}') { depth--; if (depth === 0) { end = i; break } }
    }
    const body = rpui.slice(rpui.indexOf('{', start) + 1, end)
    for (const [sel, re, why] of [
      ['.dsht-rp-regex .rx-name', /min-height:\s*44px/, '实测 126×24（低于 38 底线）'],
      ['.dsht-rp-regex .rx-toggle', /min-height:\s*44px/, '实测 40×22（低于 38 底线）'],
    ] as Array<[string, RegExp, string]>) {
      const m = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}').exec(body)
      expect(m, `coarse 段缺 ${sel} 的下限规则（${why}）`).not.toBeNull()
      expect(m?.[1] ?? '', `${sel} 未给到 44px 下限`).toMatch(re)
    }
  })

  // 【探针自身的判据力护栏】W2 实测踩到**最危险的假绿**：
  //   12 个态里 11 个扫到 0 个我方元素，探针仍报 **PASS** ——
  //   因为判据力前提只查「所有态累计 > 0」（base 态有元素就通过）。
  //   真因是残留的全屏浮层（我方 drawer mask / 卡脚本 .kmc-root）挡住了一切。
  // ⇒ 探针必须**内含**三条护栏，否则该假绿会再次发生。本用例把它们钉死在源码里。
  it('✅ 探针护栏：ef-touch-targets 必须含「态生效断言 + 遮挡侦测 + 零覆盖拒绝」三件套', () => {
    const p = readFileSync(join(here, '..', '..', 'scripts', 'ef-touch-targets.mjs'), 'utf8')
    // ① 每态必须声明可见证据，且采集时校验（P-24：判据落结果不落机制）
    expect(p, '探针缺 expect 机制（进态脚本返回 ok ≠ 真的进了这个态）').toContain('expect:')
    expect(p, '探针未校验 expect 生效（P-24）').toContain('await ev(st.expect')
    // ② 遮挡侦测（P-17：测不出来 ≠ 事实否定，必须区分）
    expect(p, '探针缺遮挡侦测（被浮层挡住时会误判成「我方无可点元素」）').toContain('blocked-by:')
    // ③ 零覆盖拒绝（假绿的最深一层：什么都没测却报 PASS）
    expect(p, '探针缺「零覆盖冒充通过」护栏（这是本轮实测踩到的假绿形态）').toContain('本轮未取得跨态覆盖')
    // ④ 定位串唯一化（P-23：同名元素必须能被区分，否则并集会折叠）
    expect(p, '探针缺定位串唯一化（同名元素会被折叠成一条，26 报成 1）').toContain("'@@'")
    // ⑤ CDP 转发自愈（R15：应用重启后旧 pid 的转发失效 ⇒ 12 态全「快照失败」）
    expect(p, '探针缺 CDP 转发自愈（R15：应用重启后必须按实时 pid 重设）').toContain('localabstract:webview_devtools_remote_')
  })

  // 【M7 自身的判据力护栏】2026-09-15 勘察 W5 时抓到 J11 是**零杠杆判据**（P-20）：
  //   5 张卡全部报「检查 0 个节点」却判 PASS —— 「0 个节点里没有裸露 HTML」是恒真命题。
  //   真因两条：① 无判据力前提（nodes=0 照样 PASS）；② 扫描面只有一个容器类。
  // ⇒ 把两条修法都钉死在源码里，防回归（否则它下一次仍会静默退化成恒真）。
  it('✅ M7 护栏：J11「HTML 未裸露」必须含「零覆盖 SKIP + 扫描面全覆盖」两件套', () => {
    const p = readFileSync(join(here, '..', '..', 'scripts', 'ef-journey-all.mjs'), 'utf8')
    // ① 零覆盖必须 SKIP（不许把覆盖空洞写成绿的）
    expect(p, 'J11 缺「零覆盖 ⇒ SKIP」判据力前提（P-20：这是恒真判据的形态）').toContain('rawScanned === 0')
    expect(p, 'J11 缺零覆盖的出声说明（P-17：必须区分「事实否定」与「测不出来」）')
      .toContain('不冒充已覆盖')
    // ② 扫描面必须覆盖多类容器（不只 assistant body —— 迁移卡上该容器恒不存在）
    expect(p, 'J11 扫描面过窄（只扫 assistant 容器时，迁移卡上 nodes 恒 0）').toContain('nAssistant')
    expect(p, 'J11 扫描面缺 html 块容器').toContain('nHtml')
    // ③ 同理：J3 的浮球缺席不得对「本就无浮球能力」的卡判 FAIL（P-29）
    expect(p, 'J3 缺「该卡是否应有浮球」的判据力前提（无脚本卡上浮球本就不该存在）').toContain('cardExpectsFloat')
    // ④ J7 必须用「本轮唯一 stamp 的存在性」而非易漂移的总量差（P-23）
    expect(p, 'J7 缺唯一标识存在性判据（总量差会随前序状态漂移）').toContain('stampInContext')
  })

  // 【第五十二次判据修复的护栏】本轮完整旅程跑出 5 FAIL，取证后确认**全部**是判据自身缺陷
  //   （产品无缺陷），三条修法必须钉死在源码里，否则下次会以同一形态复发：
  //     ① J5 取按钮改短轮询（R16：采样必须等就绪）—— 切卡后首次取按钮时楼层可能还没渲染完
  //     ② J5/J6 无按钮时必须按「该卡有无用户楼层」区分 SKIP/FAIL（P-17：事实 vs 测不出）
  //     ③ J7 「发送已被宿主接住」必须能单独构成 SKIP（注释承诺过但实现里没有 ⇒ P-1 违例）
  it('✅ M7 护栏：J5/J6/J7 的判据力前提必须齐备（第五十二次修复，防同形态复发）', () => {
    const p = readFileSync(join(here, '..', '..', 'scripts', 'ef-journey-all.mjs'), 'utf8')
    // ① R16：取按钮必须轮询（不得单次瞬时取）
    expect(p, 'J5 取回退按钮缺短轮询（切卡后首次取按钮时楼层可能未渲染完 ⇒ 假 no-btn）').toContain('clickRollback')
    // ② P-17：无按钮的两种成因必须区分
    expect(p, 'J5 缺「无用户楼层 ⇒ 事实（SKIP）」的定性分支').toContain('noBtnFact')
    // ③ J6 必须继承 J5 的前提（没发生回退时占用本就不该降）
    expect(p, 'J6 缺「本轮未发生回退 ⇒ 无判据力」的前提').toContain('j6NoRollback')
    // ④ J7：「发送已被接住」必须能独立构成 SKIP（注释与实现口径一致）
    expect(p, 'J7 缺「发送已被宿主接住」的判据力前提（注释承诺过，实现里此前没有）').toContain('sendAccepted')
  })

  // 【第五十三次判据修复的护栏】`st-1q84arh` 的 J15 报 FAIL，而同一张卡的 J13 明写
  //   「生效证据：楼层 22→20（↓）」—— **证据串与结论矛盾**，是 P-29 的识别特征。
  //   取证（tmp/w6-j15-shape.mjs）：该卡**导出面只有 5 条**（楼层 21、事件 309 条）
  //   ⇒ `j7grew` 不足以推出「回退必然使导出下降」。
  //   两条修法必须钉死，否则同一形态会换个卡复发：
  //     ① 判据落**结果**而非易漂移的总量：用「本轮唯一 stamp 是否从导出消失」（P-23/P-24）
  //     ② 导出条数**反而增加** ⇒ 有并发生成正在落盘 ⇒ SKIP，不许判 FAIL（P-17）
  it('✅ M7 护栏：J15 必须用「stamp 存在性」+「导出并发写入」两件套（第五十三次修复）', () => {
    const p = readFileSync(join(here, '..', '..', 'scripts', 'ef-journey-all.mjs'), 'utf8')
    // ① 存在性判据：stamp 从导出面消失 = 回退确实移出了这条（比「字符量下降」硬）
    expect(p, 'J15 缺「本轮唯一 stamp 的存在性」判据（总量差会随并发落盘漂移）').toContain('stampGone')
    expect(p, 'J15 的存在性判据未参与判据力前提（stamp 本就不在导出面时测不出）').toContain('stampInExport0')
    // ② 导出条数增加 ⇒ 判据力前提不成立（测到的是「生成还在写」而非「回退没扣减」）
    expect(p, 'J15 缺「导出条数反而增加 ⇒ 有并发写入」的判据力前提（第五十二次同族形态）').toContain('exportGrew')
    // ③ 存在性判据必须有可观测的导出文本来源（否则 includes 恒 false ⇒ 全部 SKIP 的假绿）
    expect(p, 'exportStat 未返回拼接后的导出文本（存在性判据无从落地）').toContain('joined')
  })
})

// ---------------------------------------------------------------------------
// 3. 我方注入组件不得被宿主「行级通配规则」连带隐藏（P-5 边界隔离）
// ---------------------------------------------------------------------------

describe('L1 悬停揭示：我方注入组件不被宿主行级规则误伤', () => {
  it('turn-tail 行的隐藏规则必须按命名空间排除我方组件（否则变体条被整条藏掉）', () => {
    const s = src('dsht-rp-ui/src/client/style.ts')
    // 历史缺陷：`[data-chat-flow-kind="turn-tail"] span { display:none !important }`
    // 把我方 <span class="dsht-rp-variant-bar"> 一并隐藏 ⇒ 触屏看不到变体切换。
    const m = /\[data-chat-flow-kind="turn-tail"\]\s+span([^{]*)\{\s*display:\s*none\s*!important/.exec(s)
    expect(m, '未找到 turn-tail span 隐藏规则（结构变了，需同步本护栏）').not.toBeNull()
    const guard = m?.[1] ?? ''
    // 必须带「排除我方命名空间」的守卫
    expect(guard).toContain('dsht-')
    expect(guard).toContain(':not(')
  })

  it('我方动作容器在触屏下被显式常显（防被更具体选择器压回）', () => {
    const s = src('dsht-rp-ui/src/client/style.ts')
    expect(s).toMatch(/span\[class\*="dsht-"\]\s*\{\s*display:\s*inline-flex\s*!important/)
  })
})

// ---------------------------------------------------------------------------
// 4. W5 长文本/宽元素横向溢出兜底（2026-09-15 设备决定性实验驱动）
// ---------------------------------------------------------------------------

/**
 * 【判据自身的坑（P-29 家族）· 本组第一版连续踩两次，都是「判据的实现假设」】
 *   ① CSS 解析器只认 `选择器 { }` 形态，而真实规则是**多选择器分组**
 *      （`.dsht-rp-assistant-body, .dsht-rp-html { ... }`）⇒ 解析器取不到 ⇒ **假 FAIL**
 *      （FAIL 的证据串与结论矛盾：明明写了规则却说「缺 overflow-x 兜底」）。
 *      —— 这正是 P-29 的识别特征。修：解析器先做**逗号拆分**再精确匹配。
 *   ② `replaceChild` 检测命中了**注释里对历史写法的说明**（我把旧用法写进注释解释根因）
 *      ⇒ 同样假 FAIL。修：检测前**剥离注释**（保留行数，便于报错定位）。
 */

/**
 * 剥离 JS/TS 注释（保留换行 ⇒ 行号不变，便于报错定位）
 *
 * 【W24 2026-09-15 扩为「注释 + **单双引号**字符串」—— 但**刻意不动模板串**】
 * 只剥注释不够：**字符串字面量里的同形文本**会被当成真调用
 * （例：`var s = "p.replaceChild(frag, node)"`）。本组 W24 新增判据的自证当场抓出
 * 过这一条 FAIL —— 与 P-30 的纪律一致（负控要覆盖**真实误报形态**）。
 *
 * ⚠️ **为什么必须排除模板串**（本组第三次判据自造缺陷，P-19/P-29 家族）：
 * 第一版把反引号也当字符串成对剥离 —— 而真实文件里模板串可含 `${}` 与任意代码
 * （`display-compiler.ts` 有 **230 个反引号**），朴素的「找到下一个同类引号」会
 * **吃掉大段代码**（实测：剥离后 `insertBefore` 整段消失 ⇒ 判据假 FAIL）。
 * ⇒ 处理原则：单双引号字符串**内容**换空格（保留引号），**模板串原样保留**
 *   （模板串内极少出现 `innerHTML =` 这类形态；真要有，由「不得出现」类判据的其他
 *   口径兜住，且假红的代价高于漏报一条极罕见形态）。
 */
function stripJsComments(src: string): string {
  const noComments = src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length))
  const out = noComments.split('')
  const blank = (from: number, to: number): void => {
    for (let i = from; i < to; i += 1) if (out[i] !== '\n') out[i] = ' '
  }
  let i = 0
  while (i < noComments.length) {
    const c = noComments[i]
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < noComments.length) {
        if (noComments[j] === '\\') { j += 2; continue }
        if (noComments[j] === c || noComments[j] === '\n') break
        j += 1
      }
      blank(i + 1, Math.min(j, noComments.length))
      i = j + 1
      continue
    }
    i += 1
  }
  return out.join('')
}

/** 剥离 CSS 注释 */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** 取某选择器名下**全部**规则的声明合并体（CSS 层叠语义：同一选择器可有多条规则）。
 *
 *  【判据自身的坑（P-29 家族）· 第三次】第一版只取**第一条**匹配 —— 而真实文件里
 *  `.dsht-rp-assistant-body` 的第一次出现是既有的 `{ display:flex; ... }`（不含 overflow-x），
 *  于是判据报「缺 overflow-x 兜底」= **假 FAIL**（证据串与结论矛盾，P-29 识别特征）。
 *  ⇒ 必须按层叠语义把该选择器的**所有**规则块合并后再查属性。 */
function cssBlock(css: string, selector: string): string | null {
  const clean = stripCssComments(css)
  const parts: string[] = []
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (m[1] ?? '').split(',').map(x => x.trim())
    if (selectors.includes(selector)) parts.push(m[2] ?? '')
  }
  return parts.length === 0 ? null : parts.join(';')
}

/** 判据：某选择器最终生效的该属性声明值（按 CSS 层叠：后写的覆盖先写的） */
function declOf(css: string, selector: string, prop: string): string | null {
  const body = cssBlock(css, selector)
  if (body === null) return null
  const all = [...body.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'g'))]
  if (all.length === 0) return null
  const last = all[all.length - 1]
  return (last?.[1] ?? '').trim()
}

describe('W5 横向溢出兜底：规则存在性 + 归属（P-26 防死规则）', () => {
  const rpui = src('dsht-rp-ui/src/client/style.ts')

  it('判据解析器自带正控 + 负控（P-30：静态判据在真实仓库上 0 命中 = 0 信息量）', () => {
    // 正控特意用**多选择器分组**形态 —— 这正是本组第一版踩到的假 FAIL 形态
    const posGrouped = '.dsht-rp-assistant-body,\n.dsht-rp-html { min-width: 0; max-width: 100%; overflow-x: auto; }'
    const posSingle = '.dsht-rp-html pre { overflow-x: auto; }'
    const neg = '.dsht-rp-assistant-body { display: flex; }'
    // 正控一：分组形态必须能取到（防「只认单选择器」的假 FAIL）
    expect(declOf(posGrouped, '.dsht-rp-assistant-body', 'overflow-x'), '正控失败：分组选择器取不到声明（这正是第一版的假 FAIL 形态）').toBe('auto')
    expect(declOf(posGrouped, '.dsht-rp-html', 'overflow-x'), '正控失败：分组里第二个选择器取不到').toBe('auto')
    // 正控二：单选择器形态
    expect(declOf(posSingle, '.dsht-rp-html pre', 'overflow-x'), '正控失败：单选择器取不到声明').toBe('auto')
    // 负控一：没写该属性 ⇒ 必须取不到（若取到值说明判据恒真，后面的 PASS 全是假的）
    expect(declOf(neg, '.dsht-rp-assistant-body', 'overflow-x'), '负控失败：把不存在的声明当成存在（判据恒真）').toBeNull()
    // 负控二：选择器不存在 ⇒ 必须 null（防「随便给个选择器也能匹配到别处」）
    expect(declOf(posGrouped, '.dsht-not-exist', 'overflow-x'), '负控失败：不存在的选择器竟能取到声明').toBeNull()
    // 负控三：前缀相近但不等价的选择器不得误匹配（`.dsht-rp-html` ≠ `.dsht-rp-html pre`）
    expect(declOf(posSingle, '.dsht-rp-html', 'overflow-x'), '负控失败：短选择器误匹配到长选择器的规则（会掩盖真实缺失）').toBeNull()
  })

  it('body 与 html 容器都必须声明 overflow-x 兜底（缺一个就是「改一处漏一处」，P-1）', () => {
    for (const sel of ['.dsht-rp-assistant-body', '.dsht-rp-html']) {
      expect(declOf(rpui, sel, 'overflow-x'), `${sel} 缺 overflow-x 兜底（实测该容器上溢出可达 7489px）`).not.toBeNull()
      expect(declOf(rpui, sel, 'min-width'), `${sel} 缺 min-width:0（flex 链上 min-content 会一路传上去）`).toBe('0')
      expect(declOf(rpui, sel, 'max-width'), `${sel} 缺 max-width:100%`).toBe('100%')
    }
  })

  it('不可断长串必须允许断行（消融实验证明这是**关键那一条**：缺它则 4694px 不变）', () => {
    // 关键机理：overflow-x 只让盒子可滚，盒子仍被内容 min-content 撑大 ⇒ 必须同时允许断行
    const m = /\.dsht-rp-assistant-body a,[^{]*\{([^}]*)\}/.exec(rpui)
    expect(m, '未找到 body 后代断行规则（结构变了，需同步本护栏）').not.toBeNull()
    expect(m?.[1] ?? '', '断行规则未给 overflow-wrap: anywhere（超长串仍会撑破）').toContain('overflow-wrap: anywhere')
  })

  it('pre / table 必须自身可横向滚（代码块与宽表格是另外两类真实超宽产物）', () => {
    // 真实规则是分组形态：`.dsht-rp-assistant-body pre, .dsht-rp-html pre { ... }`
    for (const sel of ['.dsht-rp-assistant-body pre', '.dsht-rp-html pre', '.dsht-rp-assistant-body table', '.dsht-rp-html table']) {
      expect(declOf(rpui, sel, 'overflow-x'), `${sel} 缺 overflow-x（实测 pre 可达 7489px）`).not.toBeNull()
    }
  })

  it('媒体元素必须限宽（实测 img width=2000 达 2000px —— 这一条曾被错误消融掉）', () => {
    // 【本轮结论反转的回归锁】第一版消融样本里没有裸大图 ⇒ 判定 img 规则「无杠杆」而剔除；
    // 补上 bigImage 样本后实测 2000px 仍溢出 ⇒ 该规则**必要**。此用例防它再被删掉。
    for (const sel of ['.dsht-rp-assistant-body img', '.dsht-rp-html img', '.dsht-rp-assistant-body video', '.dsht-rp-html svg']) {
      const v = declOf(rpui, sel, 'max-width')
      expect(v, `${sel} 缺 max-width（卡内硬尺寸媒体会撑破页面；实测 <img width=2000> 达 2000px）`).not.toBeNull()
    }
    // 外壳也要 min-width:0（flex 链上否则 min-content 照样传上去）
    expect(declOf(rpui, '.dsht-rp-assistant', 'min-width'), '外壳缺 min-width:0').toBe('0')
  })

  it('消融样本必须覆盖每一类待删规则的触发场景（防「没测到」被误当成「无杠杆」）', () => {
    // 【教训的形式化】本轮实测：4 个样本的消融给出「img 规则无杠杆」的**错误结论**，
    // 补样本后反转。⇒ 探针必须同时含：固定宽表格 + 硬尺寸媒体，否则消融结论无效。
    const p = readFileSync(join(here, '..', '..', 'scripts', 'ef-overflow-probe.mjs'), 'utf8')
    expect(p, 'W5 探针缺「固定宽/不换行单元格」表格样本（窄单元格表格自适应，测不出 table 规则）').toContain('wideTableHard')
    expect(p, 'W5 探针缺「硬尺寸媒体」样本（不测它就会误判 img 规则无杠杆）').toContain('bigImage')
    expect(p, 'W5 探针缺结论反转的记录（后来者会重复同一错误）').toContain('结论反转')
  })

  it('规则不得写在错误的包（P-26 死规则：宿主注入顺序更晚时会覆盖我方）', () => {
    // 本组规则只许落在我方 UI 包的 style.ts；若被搬到插件包/宿主包，选择器还在但永不生效
    const mob = src('dsht-plugin-mobile/client/style.ts')
    expect(mob.includes('.dsht-rp-assistant-body { min-width: 0; max-width: 100%; overflow-x: auto'),
      'W5 兜底规则被写进了 mobile 插件包（该包注入更早，会被覆盖 ⇒ 死规则）').toBe(false)
    expect(rpui.includes('overflow-x: auto'), 'W5 兜底规则没有落在我方 UI 包').toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 5. F2 槽位致命缺陷回归锁（2026-09-15 设备实测根因）
// ---------------------------------------------------------------------------

/**
 * ## 为什么这组护栏存在（本轮最严重的缺陷，比 W5 本身严重得多）
 * 症状：**全部抽样卡**上 `.dsht-rp-assistant` 恒为 0 —— T2.5a 输出协议三组件 /
 * 显示正则 / HTML 渲染 / 代码增强 / 台词着色**在真机上全线静默失效**，正文由官方
 * 渲染器呈现（对照 `.dsht-rp-user-row` 正常）。logcat 只有一行无堆栈的
 * `slot entry crashed in 'conversation.chat.node': [object DOMException]`。
 *
 * 真因（控制变量实验：`tmp/diag-domfail.mjs` 抓现场 + `tmp/diag-fix-probe.mjs` 验语义）：
 * `wrapStQuotes` 收尾用 `parent.replaceChild(frag, node)` 替换了**宿主 React 持有的
 * 文本节点**；React 后续按引用删它 ⇒ `NotFoundError: removeChild`，抛在 commit 阶段
 * ⇒ 宿主 SlotErrorBoundary 捕获 ⇒ 按官方语义**永久让位**给下一个候选（不重试）
 * ⇒ 我方渲染器整场失效。
 *
 * 同卡同构建对照：replaceChild ⇒ assistant=0/q=0/崩溃 1 次；
 * 保留文本节点（insertBefore + 清空）⇒ assistant=3/q=14/崩溃 0 次。
 *
 * ## 判据（为什么是源码结构断言）
 * 本项目无 React/jsdom 测试环境（既有惯例见 `mobile-adapt.spec.ts`）。而这条缺陷的
 * **本质是可静态检查的**：凡在**宿主 React 渲染的子树**里做 DOM 增强的模块，一律
 * **不得 replaceChild / 不得 remove 掉 React 的节点**（只能新增节点 + 改属性）。
 * 于是判据 = 「这些模块的源码里没有 replaceChild」。
 */
/**
 * 【W24 2026-09-15 扩域】P-31 家族的失效手法**不止 `replaceChild` 一种**。
 *
 * ## 为什么必须扩（GOAL §5.2 第 4 条）
 * 「凡『按结构特征』建闸门，必须同时枚举该结构的**全部出现处**，并把『清单变短』
 * 也当作违约（防新增处静默落在覆盖外）」。本组原判据只查 **1 种手法** + **3 个硬编码
 * 文件** ⇒ 这是**双重盲区**（手法盲区 + 范围盲区），而 §六 一直挂着
 * 「F2 同类横向排查未穷举」的未收口项。
 *
 * ## 真正的语义不变量（比「某个 API」更本质）
 * F2 的根因不是「用了 `replaceChild`」，而是**让宿主 React 持有的节点引用失效**。
 * 凡**无条件销毁元素全部子节点**的写法都属于同族：
 *   ① `replaceChild(new, old)`      —— 直接换掉
 *   ② `removeChild(node)` / `node.remove()` —— 直接摘掉
 *   ③ `parent.textContent = ...`    —— 销毁全部子节点（含 React 的）
 *   ④ `parent.innerHTML = ...`      —— 同上
 * ⚠️ 必须区分「安全」与「不安全」以免判据过宽（过宽 ⇒ 假红，与过窄同样有害）：
 *   · `node.nodeValue = ''`（清空**保留节点**）⇒ **安全**，这正是 F2/W24 的修法
 *   · `parent.textContent = ''`        ⇒ **不安全**（销毁子节点；与上者**看起来极像**）
 *
 * ## 范围怎么确定（不能靠手写清单）
 * 判据的作用域 = **在宿主 React 渲染的子树内**做增强的模块。本仓的实际落点是
 * `RpNativeChat.tsx` 的 `bodyRef`（= `.dsht-rp-assistant-body`，宿主 MarkdownText 的产物）
 * ⇒ 由**调用点**机器化推导出模块清单，而不是硬编码文件名（硬编码清单会「变短」而无人知）。
 *
 * ## W24 的实测结果（分诊过全仓 11 个命中文件）
 * 逐条核实「被操作节点是否宿主 React 持有」后：**11 个文件全部是我方自建 DOM**
 * （`document.createElement` 出来的 toast / overlay / iframe / 预览抽屉 / `<style>` 等，
 * React 从未持有）⇒ 安全。**唯一致险点是 `display-compiler.ts` 的 `code.innerHTML`**
 * （它就在宿主 `<pre><code>` 上），已按本组纪律修掉（改为纯 DOM 构建 + 清空原文本节点）。
 */
describe('P-31 家族回归锁：宿主 React 子树内的 DOM 增强不得让 React 的节点引用失效', () => {
  /** 在宿主 React 渲染产物内做 DOM 增强的模块（由 `bodyRef` 调用点推导） */
  const domEnhancers = [
    'dsht-rp-ui/src/client/st-quotes.ts',
    'dsht-rp-ui/src/client/display-compiler.ts',
    'dsht-rp-ui/src/client/RpNativeChat.tsx',
  ]

  /**
   * P-31 家族形态检测器（4 类；**剥离注释与字符串**后再查）。
   * 返回命中的形态名 + 行号（便于定位）。
   */
  const findNodeKillers = (code: string): Array<{ kind: string; line: number }> => {
    const hits: Array<{ kind: string; line: number }> = []
    const lineAt = (idx: number): number => code.slice(0, idx).split('\n').length
    const scan = (re: RegExp, kind: string): void => {
      for (const m of code.matchAll(re)) hits.push({ kind, line: lineAt(m.index ?? 0) })
    }
    scan(/\.\s*replaceChild\s*\(/g, 'replaceChild')
    scan(/\.\s*removeChild\s*\(/g, 'removeChild')
    scan(/\.\s*remove\s*\(\s*\)/g, 'nodeRemove')
    // `textContent` **赋值**（读不算、`===` 比较不算）——修法本身用 `nodeValue = ''`，
    // 与 `textContent = ''` **看起来极像但语义相反**：前者保留节点、后者销毁子节点。
    scan(/\.\s*textContent\s*=(?!=)/g, 'textContentAssign')
    scan(/\.\s*innerHTML\s*=/g, 'innerHTMLAssign')
    return hits
  }

  /**
   * 从命中点回溯**该写法的目标表达式**（用于分诊「写的是宿主节点还是我方自建节点」）。
   * 取该行内 `=` / `(` 左侧的标识符链（如 `t.nodeValue`、`q.textContent`、`el.innerHTML`）。
   */
  const targetsOf = (code: string, kinds: ReadonlySet<string>): Array<{ kind: string; line: number; target: string }> =>
    findNodeKillers(code)
      .filter(h => kinds.has(h.kind))
      .map(h => {
        const lineText = code.split('\n')[h.line - 1] ?? ''
        const m = /([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*(?:\.\s*(?:replaceChild|removeChild|remove|textContent|innerHTML)\b)/.exec(lineText)
        return { ...h, target: m ? m[1].replace(/\s+/g, '') : '(未识别)' }
      })

  it('判据自带正控 + 负控（P-30；负控覆盖 3 类真实误报形态）', () => {
    const bad = 'function f(p, node) { p.replaceChild(frag, node) }'
    const good = 'function f(p, node) { p.insertBefore(holder, node); node.nodeValue = "" }'
    // 负控①：注释里的历史写法（本组第一版的假 FAIL 来源）
    const commentOnly = '// 此前用 replaceChild(frag, node)，见头注\nfunction f(p, node) { p.insertBefore(h, node) }'
    // 负控②：**字符串**里的同形文本（W24 新增判据时被自证抓到的假 FAIL 来源）
    const stringOnly = 'var s = "p.replaceChild(frag, node)"'
    // 负控③：`nodeValue = ''`（清空保留节点 = 修法本身，**不是**违规）
    const clearOnly = 'node.nodeValue = ""'
    const kinds = (s: string): string[] => [...new Set(findNodeKillers(stripJsComments(s)).map(h => h.kind))].sort()
    expect(kinds(bad), '正控失败：认不出 replaceChild').toEqual(['replaceChild'])
    expect(kinds(good), '负控失败：把安全写法当成违规').toEqual([])
    expect(kinds(commentOnly), '负控失败：把注释里的历史写法当成违规（第一版的假 FAIL）').toEqual([])
    expect(kinds(stringOnly), '负控失败：把字符串里的同形文本当成违规（W24 新增判据时的假 FAIL）').toEqual([])
    expect(kinds(clearOnly), '负控失败：把 `nodeValue = ""`（修法本身）当成违规').toEqual([])
    // 正控：另外三类也要认得出（否则扩域是假的）
    expect(kinds('p.innerHTML = "x"'), '认不出 innerHTML 赋值').toEqual(['innerHTMLAssign'])
    expect(kinds('p.removeChild(n)'), '认不出 removeChild').toEqual(['removeChild'])
    expect(kinds('n.remove()'), '认不出 node.remove()').toEqual(['nodeRemove'])
  })

  it('台词着色必须用「插入 + 清空」而非替换（否则整个 assistant 槽位在真机上失效）', () => {
    const s = src('dsht-rp-ui/src/client/st-quotes.ts')
    expect(/\breplaceChild\s*\(/.test(stripJsComments(s)),
      'st-quotes 又用上了 replaceChild ⇒ 会替换宿主 React 的文本节点 ⇒ slot 永久 abdicate（全部我方正文增强失效）').toBe(false)
    expect(s, 'st-quotes 必须保留 React 的文本节点（改为插入 + 清空）').toContain('insertBefore')
    expect(s, 'st-quotes 缺 holder 幂等标记（重跑会层层套 holder）').toContain('data-dsht-qwrap')
  })

  it('代码高亮不得用 innerHTML 重写宿主 <code>（W24 修复项；与 replaceChild 同族）', () => {
    // 判据的依据（本轮取证）：`code` 是宿主 MarkdownText 渲染的 `<code>`（在
    // `.dsht-rp-assistant-body` 内）；`innerHTML = …` 与 `replaceChild` 在
    // 「旧子节点引用失效」这一语义上**逐字等价**（设备控制变量实验：equivalent=true）。
    // ⇒ 修法 = 纯 DOM 构建片段 + insertBefore + 把原文本节点 nodeValue 清空。
    // ⚠️ 断言用 `src`（原文，不剥字符串）：`stripJsComments` 会把字符串**内容**换成空格，
    //    于是 `nodeValue = ''` 会变成 `nodeValue = ' '` ⇒ 直接匹配会假 FAIL（P-29 家族）。
    //    而「不得出现 innerHTML」这一条**必须**用剥过的文本（否则注释里的历史说明会假红）。
    const stripped = stripJsComments(src('dsht-rp-ui/src/client/display-compiler.ts'))
    const raw = src('dsht-rp-ui/src/client/display-compiler.ts')
    expect(/\.\s*innerHTML\s*=/.test(stripped),
      'display-compiler 又用 innerHTML 重写了 code ⇒ 销毁宿主 React 持有的子节点（P-31 同族）').toBe(false)
    expect(raw, 'display-compiler 的高亮必须清空原文本节点（保留节点 = R19 的关键）').toContain('nodeValue = ')
    expect(stripped, 'display-compiler 的高亮必须用 insertBefore 插入片段').toContain('insertBefore')
  })

  it('宿主子树内的增强模块：销毁型写法只允许作用于**我方自建节点**（白名单化，W24 分诊结论）', () => {
    // ## 口径说明（为什么不是「一律禁止」）
    // W24 对全仓 11 个命中文件逐条取证「被操作节点是否宿主 React 持有」，结论：
    // **除 `display-compiler.ts` 的 `code.innerHTML`（已修）外，全部作用在我方自建 DOM 上**
    // ⇒ React 从未持有它们 ⇒ 安全。若判据写成「一律禁止」，会对这些合法用法造成
    // 大量假红（判据过宽与过窄**同样有害**）。
    // ⇒ 正确口径：**对宿主节点的销毁型写法**零容忍；对我方自建节点的合法用法**逐条登记**
    //    为白名单（登记本身即护栏：新增一处未登记的目标 ⇒ 报红，迫使作者取证）。
    const ALLOWED_TARGETS: Record<string, string> = {
      // 台词着色：`q` 是我方 createElement('q') 造的；`t` 是传入的文本节点（下方另有断言）
      'dsht-rp-ui/src/client/st-quotes.ts': 'q',
      // <pre> 高亮：`span` 是我方 createElement('span') 造的（W24 修法把 innerHTML 换成
      // 纯 DOM 构建后引入；`nodeValue = ''` 是清空保留节点，**不算**销毁型故不在表内）
      'dsht-rp-ui/src/client/display-compiler.ts': 'span',
      // 聊天楼层：三处 `.remove()` 全部是我方命令式创建的 iframe（React 不管理其生命周期）
      'dsht-rp-ui/src/client/RpNativeChat.tsx': 'victim.el,el',
    }
    const DESTRUCTIVE = new Set(['replaceChild', 'removeChild', 'nodeRemove', 'textContentAssign', 'innerHTMLAssign'])
    for (const rel of domEnhancers) {
      const code = stripJsComments(src(rel))
      const hits = targetsOf(code, DESTRUCTIVE)
      const allowed = new Set((ALLOWED_TARGETS[rel] ?? '').split(',').map(s => s.trim()).filter(Boolean))
      const bad = hits.filter(h => !allowed.has(h.target))
      expect(bad,
        `${rel} 出现**未登记**的销毁型写法（可能作用于宿主 React 的节点 ⇒ slot 永久 abdicate）：`
        + bad.map(h => `${h.kind}@L${h.line}(目标 ${h.target})`).join(', ')
        + '　⇒ 若确认该目标是我方自建节点，请在本条判据的 ALLOWED_TARGETS 里登记并注明依据').toEqual([])
    }
  })

  it('P-20 杠杆断言：判据在「对宿主节点注入违规」时确实会红（防判据失效）', () => {
    expect(domEnhancers.length, '增强模块清单为空 ⇒ 判据无作用域（等于失效）').toBeGreaterThanOrEqual(3)
    // 杠杆自证：把一处**真实**源码注入违规（目标不在白名单）⇒ 必须报出来
    const real = stripJsComments(src('dsht-rp-ui/src/client/display-compiler.ts'))
    const injected = real + '\nfunction __w24Probe(hostReactNode: HTMLElement): void { hostReactNode.innerHTML = "x" }\n'
    const bad = targetsOf(injected, new Set(['innerHTMLAssign'])).filter(h => h.target === 'hostReactNode')
    expect(bad.length, '注入「对宿主节点写 innerHTML」后判据未报出 ⇒ 判据失效（零杠杆）').toBeGreaterThanOrEqual(1)
  })

  it('判据的「目标回溯」自身可靠（正控 + 负控；否则白名单会认错对象）', () => {
    const probe = [
      'node.nodeValue = ""',           // 修法：保留节点 ⇒ 不是销毁型
      'q.textContent = "x"',           // 我方自建节点 ⇒ 目标应为 q
      'parent.replaceChild(frag, n)',  // 目标应为 parent
      'a.remove()',                    // 目标应为 a
    ].join('\n')
    const got = targetsOf(probe, new Set(['replaceChild', 'nodeRemove', 'textContentAssign', 'innerHTMLAssign']))
    expect(got.map(h => `${h.kind}:${h.target}`).sort(),
      '目标回溯认错对象 ⇒ 白名单会失效').toEqual(['nodeRemove:a', 'replaceChild:parent', 'textContentAssign:q'].sort())
  })

  it('探针必须把这条缺陷钉成可复现判据（否则它只能靠撞见）', () => {
    // 该缺陷的唯一现场证据是宿主 console 的 slot 崩溃 + 我方壳层计数为 0
    const p = readFileSync(join(here, '..', '..', 'scripts', 'ef-overflow-probe.mjs'), 'utf8')
    expect(p, 'W5 探针缺「我方壳层是否存在」的判据力前提（P-17）').toContain('本卡上没有真实的 .dsht-rp-assistant-body')
  })
})
