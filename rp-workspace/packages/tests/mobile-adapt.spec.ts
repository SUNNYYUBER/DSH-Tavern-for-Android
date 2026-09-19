/**
 * P2#13 移动端抽离（dsht-plugin-mobile）测试：
 * - CSS 五件套标记齐全（100dvh / grid 轨道锁定 / left 抽屉 / safe-area / 触控目标）
 * - 锚点约定：CSS 零宿主哈希类名（单点维护在 anchors.ts 候选选择器）
 * - 锚点解析器：结构性解析（[data-shell-overlay] 父元素）+ 候选类名兜底 + 幂等
 * - dsht-rp-ui/style.ts 抽离后不再携带竖屏媒体查询与哈希类名 hack
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ANCHOR_ATTR,
  ANCHOR_DEFS,
  resolveAnchors,
  type AnchorElementLike,
} from '../src/dsht-plugin-mobile/client/anchors.ts'
import { MOBILE_CSS } from '../src/dsht-plugin-mobile/client/style.ts'

const here = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// 最小假 DOM（支持 .cls / [attr] / [attr="v"] 单选择器）
// ---------------------------------------------------------------------------

class FakeEl implements AnchorElementLike {
  private attrs = new Map<string, string>()
  private cls: string
  private kids: FakeEl[] = []
  parentElement: FakeEl | null = null
  constructor(cls = '') { this.cls = cls }
  get firstElementChild(): FakeEl | null { return this.kids[0] ?? null }
  getAttribute(name: string): string | null { return this.attrs.get(name) ?? null }
  setAttribute(name: string, value: string): void { this.attrs.set(name, value) }
  append(...children: FakeEl[]): void {
    for (const c of children) { c.parentElement = this; this.kids.push(c) }
  }
  matches(selector: string): boolean {
    const sel = selector.trim()
    if (sel.startsWith('.')) return this.cls.split(/\s+/).includes(sel.slice(1))
    const m = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel)
    if (m) {
      const v = this.getAttribute(m[1]!)
      return m[2] === undefined ? v !== null : v === m[2]
    }
    return false
  }
  private *walk(): Generator<FakeEl> {
    for (const c of this.kids) { yield c; yield* c.walk() }
  }
  querySelectorAll(selector: string): FakeEl[] {
    const out: FakeEl[] = []
    for (const el of this.walk()) if (el.matches(selector)) out.push(el)
    return out
  }
}

// ---------------------------------------------------------------------------

describe('CSS 五件套（对照 dsh-client-ui-mobile-adapt v20）', () => {
  it('① 100dvh 动态视口', () => {
    expect(MOBILE_CSS).toContain('html, body { height: 100dvh; }')
  })
  it('② grid 轨道锁定（显式锁定每列轨道 + details 列隐藏）', () => {
    expect(MOBILE_CSS).toContain('grid-template-columns: 0 minmax(0, 1fr) 0 !important')
    expect(MOBILE_CSS).toMatch(/\[data-dsht-mobile="sidebar-col"\] \{ grid-column: 1; \}/)
    expect(MOBILE_CSS).toMatch(/\[data-dsht-mobile="center-col"\] \{ grid-column: 2; \}/)
    expect(MOBILE_CSS).toMatch(/\[data-dsht-mobile="details-col"\] \{ grid-column: 3; display: none !important; \}/)
  })
  it('③ left 抽屉（不用 transform）+ 宿主 data-sidebar-collapsed 状态钩子', () => {
    expect(MOBILE_CSS).toContain('left: -110%')
    expect(MOBILE_CSS).toContain('transition: left .25s ease')
    expect(MOBILE_CSS).toContain('[data-dsht-mobile="app-frame"]:not([data-sidebar-collapsed]) [data-dsht-mobile="sidebar-col"] { left: 0; }')
  })
  it('④ safe-area inset（汉堡/RP overlay）', () => {
    expect(MOBILE_CSS).toContain('env(safe-area-inset-top, 0px)')
    expect(MOBILE_CSS).toContain('env(safe-area-inset-left, 0px)')
    expect(MOBILE_CSS).toContain('env(safe-area-inset-bottom)')
  })
  it('⑤ 触控目标 ≥38px', () => {
    // 【2026-09-14 第二十轮 · 判据改为「结果」而非「具体数值」（P-24）】
    // 原判据写死 `width: 40px; height: 40px;`，而本轮把汉堡从 40 抬到 44
    // （设备探针 ef-touch-targets.mjs 实测 40 属 P2 未达目标）⇒ **判据把已改好的报成坏**。
    // 这正是 P-24 说的「判据不得锁死实现」：应断言**结果**（尺寸 ≥ 底线 38）。
    const ham = /\.dsht-mobile-hamburger \{[^}]*\}/s.exec(MOBILE_CSS)
    expect(ham, '未找到 .dsht-mobile-hamburger 规则（结构变了，需同步本护栏）').not.toBeNull()
    const hamW = Number(/width:\s*(\d+)px/.exec(ham?.[0] ?? '')?.[1] ?? 0)
    const hamH = Number(/height:\s*(\d+)px/.exec(ham?.[0] ?? '')?.[1] ?? 0)
    expect(hamW, `.dsht-mobile-hamburger 宽 ${hamW}px 低于 38 拇指底线`).toBeGreaterThanOrEqual(38)
    expect(hamH, `.dsht-mobile-hamburger 高 ${hamH}px 低于 38 拇指底线`).toBeGreaterThanOrEqual(38)
    const rail = /\[data-dsht-mobile="sidebar-rail"\] \[data-dsht-mobile="rail-icon-button"\] \{[^}]*\}/s.exec(MOBILE_CSS)
    const railW = Number(/width:\s*(\d+)px/.exec(rail?.[0] ?? '')?.[1] ?? 0)
    expect(railW, `rail 图标按钮宽 ${railW}px 低于 38 拇指底线`).toBeGreaterThanOrEqual(38)
    // 【2026-09-14 第二十轮】原断言 `MOBILE_CSS` 含 'min-height: 44px' —— 那条来自
    // `.dsht-rp-btn { min-height: 44px }`，而该规则已迁到 rp-ui（P-26）。
    // ⇒ 改为断言「mobile 包内**仍存在**触控尺寸放大（≥44）」这件**结果**，不绑定具体类名。
    const dims = [...MOBILE_CSS.matchAll(/(?:min-width|min-height|width|height):\s*(\d+)px/g)].map(m => Number(m[1]))
    expect(Math.max(...dims), 'mobile 包内无任何 ≥44px 的触控尺寸声明').toBeGreaterThanOrEqual(44)
  })
  it('竖屏规则收拢在「宽度或触屏」并集媒体查询内（L2 竖屏/横屏 · P-1 单源）', () => {
    // 【2026-09-14 第十七轮】原判据只查 `@media (max-width: 700px)`。
    // 设备实测（scripts/ef-orientation.mjs）：手机横屏 CSS 视口 873×345 ⇒
    // `(max-width:700px)` = false 而 `(pointer: coarse)` = true ⇒ 五件套整体失效
    // （汉堡消失 / 侧栏退回静态三栏）。⇒ 判据改为**并集**，本护栏同步收紧：
    // 必须同时含宽度与触屏两个条件，二者缺一即为「手机横屏失配」回归。
    expect(MOBILE_CSS).toContain('@media (max-width: 700px), (pointer: coarse)')
    // 负控：不得退回只按宽度（会把横屏手机判成桌面）
    expect(MOBILE_CSS).not.toMatch(/@media \(max-width: 700px\) \{/)
  })
  it('【P-1 单源】CSS 与 file-preview 的「手机判据」必须同源（否则半适配）', () => {
    // 症状：手机横屏时若 CSS 按手机渲染、而 JS 按桌面放行 ⇒ 点文件引用无预览。
    // 两处判据必须**同时**含 `(pointer: coarse)`；任一缺失即为漂移。
    const fp = readFileSync(join(here, '..', 'src', 'dsht-plugin-mobile', 'client', 'file-preview.ts'), 'utf8')
    expect(MOBILE_CSS).toContain('(pointer: coarse)')
    expect(fp).toContain("matchMedia('(pointer: coarse)')")
    // 负控：取 narrow() 的函数体，其中**必须**同时出现宽度与触屏两个判据
    // （只按宽度 = 手机横屏下 JS 按桌面放行 ⇒ 半适配）
    const m = /const narrow = \(\): boolean => \{([\s\S]*?)\n  \}/.exec(fp)
    expect(m, '未找到 narrow() 定义').not.toBeNull()
    const body = m?.[1] ?? ''
    expect(body).toContain("matchMedia('(max-width: 700px)')")
    expect(body).toContain("matchMedia('(pointer: coarse)')")
  })
  it('【P-1 单源】同源 iframe 页 import-center.html 的手机判据同步为并集', () => {
    // 该页是**同源 iframe**（RpOverlay 内），若它仍只按宽度，手机横屏下导入页仍是桌面版式。
    const html = readFileSync(join(here, '..', 'src', 'dsh-plugin', 'assets', 'import-center.html'), 'utf8')
    expect(html).toContain('@media (max-width: 700px), (pointer: coarse)')
  })
})

describe('宿主锚点类名约定', () => {
  it('CSS 零宿主哈希类名（.VOzbGW_* / .pI_x6G_* / .hHd-Xa_* 形态一律禁止）', () => {
    // 哈希类名形态：2-8 个字母数字/连字符 + 下划线（.VOzbGW_panel / .pI_x6G_frame / .hHd-Xa_railIn）
    const hashClass = MOBILE_CSS.match(/\.[A-Za-z0-9-]{2,8}_[A-Za-z0-9]/g)
    expect(hashClass).toBeNull()
  })
  it('CSS 只消费 data-dsht-mobile 锚点，且每个锚点都在 ANCHOR_DEFS 登记', () => {
    const used = new Set(
      [...MOBILE_CSS.matchAll(/\[data-dsht-mobile="([^"]+)"\]/g)].map((m) => m[1]),
    )
    expect(used.size).toBeGreaterThan(0)
    const defined = new Set(ANCHOR_DEFS.map((d) => d.anchor))
    for (const anchor of used) expect(defined.has(anchor), `未登记的锚点：${anchor}`).toBe(true)
    // 反向：登记的锚点都要被 CSS 消费（防死锚点）
    for (const anchor of defined) expect(used.has(anchor), `CSS 未消费的锚点：${anchor}`).toBe(true)
  })
  it('哈希类名单点维护：只出现在 anchors.ts 候选选择器', () => {
    const src = readFileSync(join(here, '../src/dsht-plugin-mobile/client/anchors.ts'), 'utf8')
    expect(src).toContain("'.VOzbGW_panel'")
    expect(src).toContain("'.pI_x6G_frame'")
    expect(src).toContain("'.hHd-Xa_railIn'")
  })
})

describe('锚点解析器 resolveAnchors', () => {
  it('结构性解析：app-frame 取 [data-shell-overlay] 父元素（零类名依赖），sidebar-col 取其首子', () => {
    const sidebarCol = new FakeEl()
    const centerCol = new FakeEl()
    const overlay = new FakeEl()
    overlay.setAttribute('data-shell-overlay', 'true')
    const frame = new FakeEl()
    frame.append(sidebarCol, centerCol, overlay)
    const body = new FakeEl()
    body.append(frame)

    const tagged = resolveAnchors(body)
    expect(tagged).toBe(2)
    expect(frame.getAttribute(ANCHOR_ATTR)).toBe('app-frame')
    expect(sidebarCol.getAttribute(ANCHOR_ATTR)).toBe('sidebar-col')
    expect(centerCol.getAttribute(ANCHOR_ATTR)).toBeNull()
  })
  it('候选类名兜底：设置面板与侧栏 rail（宿主无 data 钩子的区域）', () => {
    const panel = new FakeEl('VOzbGW_panel')
    const nav = new FakeEl('VOzbGW_nav')
    const cell = new FakeEl('VOzbGW_navCell')
    nav.append(cell)
    panel.append(nav)
    const railBtn = new FakeEl('hHd-Xa_iconButton')
    const rail = new FakeEl('hHd-Xa_railIn')
    rail.append(railBtn)
    const body = new FakeEl()
    body.append(panel, rail)

    resolveAnchors(body)
    expect(panel.getAttribute(ANCHOR_ATTR)).toBe('settings-panel')
    expect(nav.getAttribute(ANCHOR_ATTR)).toBe('settings-nav')
    expect(cell.getAttribute(ANCHOR_ATTR)).toBe('settings-nav-cell')
    expect(rail.getAttribute(ANCHOR_ATTR)).toBe('sidebar-rail')
    expect(railBtn.getAttribute(ANCHOR_ATTR)).toBe('rail-icon-button')
  })
  it('幂等：已打标元素跳过，二轮扫描零新增', () => {
    const overlay = new FakeEl()
    overlay.setAttribute('data-shell-overlay', 'true')
    const frame = new FakeEl()
    frame.append(new FakeEl(), overlay)
    const body = new FakeEl()
    body.append(frame)

    expect(resolveAnchors(body)).toBeGreaterThan(0)
    expect(resolveAnchors(body)).toBe(0)
  })
  it('空宿主（无 frame/无设置面板）：不炸、零打标', () => {
    const body = new FakeEl()
    body.append(new FakeEl('whatever'))
    expect(resolveAnchors(body)).toBe(0)
  })
})

describe('dsht-rp-ui/style.ts 抽离后回归锁', () => {
  const rpStyle = readFileSync(join(here, '../src/dsht-rp-ui/src/client/style.ts'), 'utf8')
  it('不再携带竖屏媒体查询与宿主哈希类名 hack', () => {
    expect(rpStyle).not.toContain('@media (max-width: 700px)')
    expect(rpStyle).not.toContain('VOzbGW')
    expect(rpStyle).not.toContain('hHd-Xa')
  })
  it('桌面基线样式与注入入口不丢（RP UI 既有功能不受影响）', () => {
    expect(rpStyle).toContain('export function ensureStyle')
    expect(rpStyle).toContain('.dsht-rp-overlay')
    expect(rpStyle).toContain('.dsht-rp-grid')
    expect(rpStyle).toContain('.dsht-rp-statusbar')
    expect(rpStyle).toContain('@media (prefers-reduced-motion: reduce)')
  })
  it('抽离的 RP 竖屏规则在正确的位置保留（第二十轮起改由 rp-ui 自己承载）', () => {
    // 【2026-09-14 第二十轮 · 本用例随架构收口更新】
    // 原断言「这些规则在 MOBILE_CSS 里」—— 但设备实测证明**它们在那里是死规则**：
    // 与 rp-ui 桌面基线**同特异性**（都是 0,1,0），而 mobile 注入**先于** rp-ui
    // ⇒ 同特异性下后写者胜 ⇒ 实测 .dsht-rp-back 32px / .dsht-rp-tab 28px /
    //   .dsht-rp-card-gear 26px（三项均低于 38px 拇指底线）。
    // ⇒ 规则已迁到 rp-ui 自己的 (pointer: coarse) 段（P-26：归属原则）。
    // 本用例改为：断言**它们出现在 rp-ui 的 coarse 段里**（新位置）。
    const coarse = (() => {
      const start = rpStyle.indexOf('@media (pointer: coarse) {')
      if (start < 0) return ''
      let depth = 0, end = -1
      for (let i = rpStyle.indexOf('{', start); i < rpStyle.length; i++) {
        if (rpStyle[i] === '{') depth++
        else if (rpStyle[i] === '}') { depth--; if (depth === 0) { end = i; break } }
      }
      return end > 0 ? rpStyle.slice(rpStyle.indexOf('{', start) + 1, end) : ''
    })()
    expect(coarse, '未找到 rp-ui 的 (pointer: coarse) 段').not.toBe('')
    for (const marker of [
      '.dsht-rp-overlay',
      '.dsht-rp-tab ',
      '.dsht-rp-card-gear',
      '.dsht-rp-drawer',
      '.dsht-rp-books .wb-chip',
      '.dsht-fold-header',
      '.dsht-rp-greeting-dock',
    ]) {
      expect(coarse, `rp-ui coarse 段缺 ${marker}（迁入后样式不能丢）`).toContain(marker)
    }
    // 反向：这些规则**不得**回流到 mobile 包（回流 = 死规则复发）。
    // 注意必须**排除注释**再查 —— 迁移说明里会提到这些类名（那是历史记录，不是规则）。
    const mobSels = (() => {
      const out = []
      let inBlock = false
      for (const line of MOBILE_CSS.split('\n')) {
        const t = line.trim()
        if (inBlock) { if (t.includes('*/')) inBlock = false; continue }
        if (t.startsWith('/*')) { if (!t.includes('*/')) inBlock = true; continue }
        if (t.startsWith('*') || t.startsWith('//')) continue
        const i = line.indexOf('{')
        if (i >= 0) out.push(line.slice(0, i))
      }
      return out.join('\n')
    })()
    for (const back of ['.dsht-rp-back', '.dsht-rp-card-gear', '.dsht-rp-tab']) {
      expect(mobSels, `${back} 作为**规则选择器**回流到 mobile 包（P-26：跨包规则是死规则）`).not.toContain(back)
    }
  })
})
