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
    // 汉堡 40px / rail 图标 40px / RP 控件 44px
    expect(MOBILE_CSS).toMatch(/\.dsht-mobile-hamburger \{[^}]*width: 40px; height: 40px;/s)
    expect(MOBILE_CSS).toContain('[data-dsht-mobile="sidebar-rail"] [data-dsht-mobile="rail-icon-button"] { width: 40px; height: 40px; }')
    expect(MOBILE_CSS).toContain('min-height: 44px')
  })
  it('竖屏规则收拢在 @media (max-width: 700px) 内', () => {
    expect(MOBILE_CSS).toContain('@media (max-width: 700px)')
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
  it('抽离的 RP 竖屏规则在新插件里保留（样式不能丢）', () => {
    for (const marker of [
      '.dsht-rp-overlay {',
      '.dsht-rp-tab { flex: 1; height: 44px;',
      '.dsht-rp-card-gear { width: 36px; height: 36px;',
      '.dsht-rp-drawer { max-height: none; height: 100%;',
      '.wb-chip { min-height: 44px;',
      '.dsht-fold-header { min-height: 44px;',
      '.dsht-rp-greeting-dock { margin: 0 8px 6px; }',
      '@media (hover: none) { .dsht-rp-card-gear { opacity: 1; } }',
    ]) {
      expect(MOBILE_CSS).toContain(marker)
    }
  })
})
