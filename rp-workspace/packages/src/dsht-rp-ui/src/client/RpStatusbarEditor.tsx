/**
 * MVU-2（2026-09-21，MVU-PAINPOINTS 面一）：MVU 状态栏模板编辑面板。
 * ============================================================================
 * 痛点：渲染链早已完整（GET /dsht-mvu/statusbar-render），但全前端对
 * PUT /dsht-mvu/statusbar 零调用——改模板只能手写 mvu-settings.json。
 *
 * 本面板：
 * - GET /dsht-mvu/statusbar → 编辑模板（template/content/text 取首个字符串键；
 *   三个键都不存在时新建 template 键）；
 * - 「保存」→ PUT /dsht-mvu/statusbar（read-modify-write：config 其他键原样保留）；
 * - 「预览」→ GET /dsht-mvu/statusbar-render?sessionId=&template=<编辑中文本>
 *   （服务端 MVU-2 override：用编辑中文本渲染，不落盘、不污染已保存配置）；
 * - 预览 HTML 走 sanitizeDisplayHtml 白名单（与 RpNativeChat 消费面同源）；
 *   sanitize 不通过显示提示，不裸文本。
 * - 挂载：RpStateFloat 悬浮球面板头部「状态栏」按钮拉起（与 RpTablesView 同款式 overlay）。
 */
import { useCallback, useEffect, useState, type JSX } from 'react'
import { sanitizeDisplayHtml } from './output-protocol.ts'
import { useEscapeClose } from './a11y-props.ts'

const TEMPLATE_KEYS = ['template', 'content', 'text'] as const

export function RpStatusbarEditor(props: { sessionId: string; onClose: () => void }): JSX.Element {
  const { sessionId, onClose } = props
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [templateKey, setTemplateKey] = useState<string>('template')
  const [text, setText] = useState('')
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [previewNote, setPreviewNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  useEscapeClose(onClose)

  useEffect(() => {
    let alive = true
    fetch('/dsht-mvu/statusbar')
      .then(r => r.json() as Promise<{ config?: Record<string, unknown> }>)
      .then(b => {
        if (!alive) return
        const cfg = b.config ?? {}
        setConfig(cfg)
        const key = TEMPLATE_KEYS.find(k => typeof cfg[k] === 'string' && String(cfg[k]).trim().length > 0) ?? 'template'
        setTemplateKey(key)
        setText(typeof cfg[key] === 'string' ? String(cfg[key]) : '')
        setLoading(false)
      })
      .catch((e: Error) => { if (alive) { setError(e.message); setLoading(false) } })
    return () => { alive = false }
  }, [])

  const save = useCallback(() => {
    setBusy(true); setError('')
    // read-modify-write：config 其他键原样保留，只替换模板键
    const next = { ...config, [templateKey]: text }
    fetch('/dsht-mvu/statusbar', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ config: next }),
    })
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        setConfig(next)
        setSavedFlash(true)
        setTimeout(() => setSavedFlash(false), 1500)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false))
  }, [config, templateKey, text])

  const preview = useCallback(() => {
    setBusy(true); setError(''); setPreviewNote('')
    const qs = `sessionId=${encodeURIComponent(sessionId)}&template=${encodeURIComponent(text)}`
    fetch(`/dsht-mvu/statusbar-render?${qs}`)
      .then(r => r.json() as Promise<{ html?: string; note?: string }>)
      .then(b => {
        const safe = typeof b.html === 'string' ? sanitizeDisplayHtml(b.html) : null
        if (safe) { setPreviewHtml(safe); if (b.note) setPreviewNote(b.note) }
        else { setPreviewHtml(null); setPreviewNote(b.note ?? '模板渲染结果未过白名单（含不允许的标签/属性）') }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false))
  }, [sessionId, text])

  return (
    <div className="dsht-rp-overlay" role="dialog" aria-label="状态栏模板编辑" data-testid="dsht-rp-statusbar-editor">
      <div className="sf-head">
        <span>📊 状态栏模板（MVU）</span>
        <span className="sf-head-actions">
          <button type="button" className="sf-btn" disabled={busy} onClick={preview}>预览</button>
          <button type="button" className="sf-btn" disabled={busy} onClick={save}>
            {savedFlash ? '已保存 ✓' : '保存'}
          </button>
          <button type="button" className="sf-btn" aria-label="关闭状态栏模板编辑" onClick={onClose}>✕</button>
        </span>
      </div>
      <div className="sf-body">
        {loading && <div className="sv-empty">读取配置中…</div>}
        {error !== '' && <div className="sf-error" role="status">操作失败：{error}</div>}
        {!loading && (
          <>
            <div className="sv-hint">
              模板支持 <code>{'{{getvar::路径}}'}</code> 宏与裸 <code>{'{{路径}}'}</code> 变量引用
              （服务端宏引擎渲染，HTML 转义安全输出）。保存即对所有新渲染的状态栏生效。
            </div>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              spellCheck={false}
              placeholder={'例：时间: {{getvar::time}} | 地点: {{getvar::location}} | 好感度: {{getvar::stat_data.好感度}}'}
              style={{
                width: '100%', minHeight: 140, resize: 'vertical',
                background: 'var(--dsw-alias-bg-secondary, rgba(255,255,255,.04))',
                color: 'var(--dsw-alias-label-primary)',
                border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6,
                padding: '6px 8px', fontSize: 12, fontFamily: 'monospace',
              }}
            />
            {previewNote !== '' && <div className="sv-hint" role="status">{previewNote}</div>}
            {previewHtml !== null && (
              <div className="dsht-rp-mvu-statusbar" style={{ marginTop: 8 }}
                dangerouslySetInnerHTML={{ __html: previewHtml }} />
            )}
          </>
        )}
      </div>
    </div>
  )
}
