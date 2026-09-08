/**
 * ST 台词着色（SillyTavern messageFormatting 的 <q> 包裹等价物，渲染层 DOM 形态）。
 *
 * 出处对照：ST public/script.js messageFormatting L1845-1871 —— 引号文本（"…"/“…”/«…»/
 * 「…」/『…』/＂…＂）→ <q> 元素；style.css L554 `.mes_text q { color: var(--SmartThemeQuoteColor) }`。
 * 用户 ST 实测主题（settings.json power_user）：quote_text_color = rgba(225,138,36,1)（橙）。
 *
 * 为何是渲染后 DOM 包裹而不是源码注入 <q>：宿主 MarkdownText（micromark/mdast React 渲染器，
 * 宿主 bundle ic 组件）对 mdast html 节点 `case"html": return n.value` —— 原样当文本渲染，
 * 源码注入 <q> 会字面露出。inline-html 通道虽可透传元素，但散文通道是 markdown——故渲染后
 * 对 body DOM 做文本节点扫描包裹（视觉与 ST 等价；代码块/已包裹区跳过；TreeWalker 不进
 * iframe 文档，卡内样式不受影响——与 ST 的 TH iframe 语义一致）。
 */

/** ST 引号对（同款清单：直引号/弯引号/书名号/直角引号/双直角引号/全角引号；非贪婪配对） */
const QUOTE_RE = /「[^「」]*」|『[^『』]*』|“[^“”]*”|"[^"\n]*"|«[^«»]*»|＂[^＂]*＂/g

/** 代码区/已包裹区跳过（对应 ST 正则的 <style>/```/` 保护） */
function insideProtected(node: Text): boolean {
  let el: Element | null = node.parentElement
  while (el !== null) {
    const tag = el.tagName
    if (tag === 'CODE' || tag === 'PRE' || tag === 'TEXTAREA' || tag === 'SCRIPT' || tag === 'STYLE' || tag === 'Q') return true
    el = el.parentElement
  }
  return false
}

/** 幂等性：已包裹的引号在 <q> 内（insideProtected 跳过）→ 重跑天然安全；流式新增文本重跑即补 */

export function wrapStQuotes(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const targets: Text[] = []
  let current = walker.nextNode()
  while (current !== null) {
    const t = current as Text
    if (t.nodeValue !== null && t.nodeValue.length > 1 && QUOTE_RE.test(t.nodeValue) && !insideProtected(t)) {
      targets.push(t)
    }
    QUOTE_RE.lastIndex = 0
    current = walker.nextNode()
  }
  for (const node of targets) {
    const value = node.nodeValue ?? ''
    const parent = node.parentElement
    if (parent === null) continue
    QUOTE_RE.lastIndex = 0
    let cursor = 0
    let match: RegExpExecArray | null
    const frag = document.createDocumentFragment()
    let wrapped = false
    while ((match = QUOTE_RE.exec(value)) !== null) {
      if (match.index > cursor) frag.appendChild(document.createTextNode(value.slice(cursor, match.index)))
      const q = document.createElement('q')
      q.textContent = match[0]
      frag.appendChild(q)
      cursor = match.index + match[0].length
      wrapped = true
    }
    if (!wrapped) continue
    if (cursor < value.length) frag.appendChild(document.createTextNode(value.slice(cursor)))
    parent.replaceChild(frag, node)
  }
}
