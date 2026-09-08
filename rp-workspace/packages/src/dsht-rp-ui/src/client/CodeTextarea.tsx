/**
 * B17 轻量代码编辑器（世界书条目内容用；EJS 设置 codeEditor=true 时替换裸 textarea）。
 *
 * 不引 Monaco——移动端性能优先（Monaco 首包 >2MB + 每 textarea 一套 worker，
 * RP 世界书面板同屏多编辑器必卡）；这里只做等宽编辑的四件补差：
 * - 行号列：与 textarea 同步行号 + 同步滚动（transform 随 scrollTop 平移）；
 * - Tab 键：插入两空格（不抢焦点——世界书内容里写 EJS/缩进文本是常态）；
 * - EJS 标签提示行：含 <% 或 %> 的行在行号列高亮 + 玻璃条提示（textarea 原生
 *   不支持逐行着色，行号列做提示面是零成本方案）；
 * - 深浅主题只消费 --dsw-alias-* 语义 token（与宿主同肤）。
 *
 * UI 标注「轻量编辑器（Monaco 在移动端不适用）」——用户可感知的取舍说明。
 */
import { useMemo, useRef, type JSX, type KeyboardEvent, type UIEvent } from 'react'

export interface CodeTextareaProps {
  value: string
  onChange: (next: string) => void
  rows?: number
  placeholder?: string
  ariaLabel?: string
}

export function CodeTextarea(props: CodeTextareaProps): JSX.Element {
  const { value, onChange, rows = 8, placeholder, ariaLabel } = props
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const gutterRef = useRef<HTMLDivElement | null>(null)

  const lines = useMemo(() => value.split('\n'), [value])
  /** EJS 标签提示行（1 起始行号）：内容含 <% 或 %> 即标记 */
  const ejsLines = useMemo(() => {
    const marked = new Set<number>()
    lines.forEach((line, i) => {
      if (line.includes('<%') || line.includes('%>')) marked.add(i + 1)
    })
    return marked
  }, [lines])
  const lineCount = Math.max(lines.length, 1)

  /** 行号列随 textarea 垂直滚动（水平不动——行号列无横向内容） */
  const syncScroll = (e: UIEvent<HTMLTextAreaElement>): void => {
    const gutter = gutterRef.current
    if (gutter !== null) gutter.scrollTop = e.currentTarget.scrollTop
  }

  /** Tab 插入两空格（保持焦点与光标；Shift+Tab 留给宿主行为） */
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key !== 'Tab' || e.shiftKey || e.ctrlKey || e.metaKey) return
    e.preventDefault()
    const ta = e.currentTarget
    const { selectionStart, selectionEnd } = ta
    const next = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`
    onChange(next)
    // 受控组件：DOM 异步更新后恢复光标到插入点之后
    requestAnimationFrame(() => {
      if (taRef.current === null) return
      taRef.current.selectionStart = selectionStart + 2
      taRef.current.selectionEnd = selectionStart + 2
    })
  }

  return (
    <div className="dsht-code-ta" data-testid="dsht-code-textarea">
      <div className="dct-note">轻量编辑器（Monaco 在移动端不适用）</div>
      <div className="dct-body" style={{ height: `${rows * 20 + 12}px` }}>
        <div className="dct-gutter" ref={gutterRef} aria-hidden="true">
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i} className={'dct-ln' + (ejsLines.has(i + 1) ? ' dct-ln-ejs' : '')}>{i + 1}</div>
          ))}
        </div>
        <textarea
          ref={taRef}
          className="dct-input"
          value={value}
          rows={rows}
          placeholder={placeholder}
          aria-label={ariaLabel}
          spellCheck={false}
          wrap="off"
          onChange={e => { onChange(e.target.value) }}
          onScroll={syncScroll}
          onKeyDown={onKeyDown}
        />
      </div>
    </div>
  )
}
