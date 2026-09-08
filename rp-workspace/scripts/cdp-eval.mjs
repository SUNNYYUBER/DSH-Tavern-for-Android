// cdp-eval.mjs — 对 App 内 WebView 页面执行一段 JS 并打印结果（CDP 调试工具）
// 用法：node cdp-eval.mjs <wsUrl> <jsFile|-> [pageTitle]
//   "-" 时从 stdin 读 JS；先按 title 匹配当前打开的页面（缺省取第一个 page）
const base = process.argv[2] || 'http://127.0.0.1:9223'
const jsArg = process.argv[3] || '-'
const titleFilter = process.argv[4] || ''

async function main() {
  const list = await (await fetch(`${base}/json`)).json()
  const pages = list.filter(p => p.type === 'page')
  const page = (titleFilter ? pages.find(p => (p.title || '').includes(titleFilter) || (p.url || '').includes(titleFilter)) : null) || pages[0]
  if (!page) { console.error('no page found'); process.exit(2) }
  console.error(`target: ${page.title} ${page.url}`)
  const src = jsArg === '-' ? await new Promise(r => { let s = ''; process.stdin.on('data', d => s += d); process.stdin.on('end', () => r(s)) }) : (await import('node:fs')).readFileSync(jsArg, 'utf8')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let seq = 0
  const pending = new Map()
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
  ws.onmessage = m => {
    const msg = JSON.parse(m.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
    }
  }
  ws.onopen = async () => {
    try {
      const r = await send('Runtime.evaluate', { expression: src, awaitPromise: true, returnByValue: true })
      if (r.exceptionDetails) console.error('page exception:', r.exceptionDetails.exception?.description || r.exceptionDetails.text)
      else console.log(JSON.stringify(r.result?.value, null, 1))
    } catch (e) { console.error('cdp error:', e.message) }
    ws.close(); process.exit(0)
  }
  ws.onerror = () => { console.error('ws connect failed'); process.exit(1) }
}
main()
