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

/** 代码区/已包裹区跳过（对应 ST 正则的 <style>/```/` 保护）。
 *  另跳过**我方已产出的 holder 内部**：holder 内的文本是拆分后的残片（可能含不配对引号），
 *  再扫一遍会层层套 holder（幂等性），且语义上与 ST 一致（ST 也不会包不配对引号）。 */
function insideProtected(node: Text): boolean {
  let el: Element | null = node.parentElement
  while (el !== null) {
    const tag = el.tagName
    if (tag === 'CODE' || tag === 'PRE' || tag === 'TEXTAREA' || tag === 'SCRIPT' || tag === 'STYLE' || tag === 'Q') return true
    if (el.hasAttribute('data-dsht-qwrap')) return true
    el = el.parentElement
  }
  return false
}

/** 幂等性：已包裹的引号在 <q> 内（insideProtected 跳过）→ 重跑天然安全；流式新增文本重跑即补 */

/**
 * 【F2 2026-09-15 根因修复 · 不得替换 React 持有的文本节点】
 *
 * ## 症状（设备实测）
 * 全部抽样卡上 `.dsht-rp-assistant` = **0** —— T2.5a 输出协议三组件 / 显示正则 /
 * HTML 渲染 / 代码增强 / 本文件的台词着色**在真机上全线静默失效**，正文由官方
 * 渲染器呈现（对照：`.dsht-rp-user-row` 正常）。logcat 只留一行无堆栈的
 * `slot entry crashed in 'conversation.chat.node': [object DOMException]`。
 *
 * ## 真因（控制变量实验，tmp/diag-domfail.mjs + tmp/diag-fix-probe.mjs）
 * 本函数此前的收尾是 `parent.replaceChild(frag, node)` —— 而 `node` 是**宿主
 * MarkdownText（React）持有的文本节点**。被换掉后 React 仍按引用删它 ⇒
 * `NotFoundError: removeChild ... not a child of this node`，抛在 React commit 阶段
 * ⇒ 宿主 `SlotErrorBoundary` 捕获 ⇒ 按官方语义**永久 abdicate 该条目**
 * （dsh-client-ui-renderer client.js：shadowing 条目崩溃即让位给下一个候选，
 *  永不重试）⇒ 我方渲染器整场失效，且**只有一个 DOMException、无堆栈**。
 *
 * 实验数据（同卡同构建，仅差这一处）：
 *   A 现状（replaceChild）      ⇒ assistant=0 · q=0  · 崩溃 1 次
 *   B 候选（保留文本节点）      ⇒ assistant=3 · q=14 · 崩溃 0 次
 *
 * ## 修法
 * 把片段插到 React 文本节点**之前**，再由我方把该文本节点**清空**（`nodeValue = ''`）：
 *   · 引用不悬空 —— React 仍能找到它、仍能删它（删掉的是一个空文本节点，无害）；
 *   · 视觉等价 —— `<q>` 与剩余文本都在，只是外层多一个 inline holder（不改变布局）；
 *   · 幂等 —— holder 带 `data-dsht-qwrap` 标记，React 若把内容回写到原节点则只清空、
 *     不再插入第二份（否则会重复显示）。
 * 注意：React 更新该文本节点时会写回内容 ⇒ 下一轮 MutationObserver 会把「同一内容」
 * 识别出来并再次清空（下面的 prev 检查），不会累积。
 */
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
    if (parent === null || value === '') continue
    // React 把内容回写到原文本节点（上一轮已包裹过同一段）⇒ 只清空，避免重复渲染
    const prev = node.previousSibling
    if (prev !== null && prev.nodeType === Node.ELEMENT_NODE
      && (prev as Element).hasAttribute('data-dsht-qwrap')
      && prev.textContent === value) {
      node.nodeValue = ''
      continue
    }
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
    const holder = document.createElement('span')
    holder.setAttribute('data-dsht-qwrap', '')
    holder.appendChild(frag)
    parent.insertBefore(holder, node)
    node.nodeValue = ''
  }
}
