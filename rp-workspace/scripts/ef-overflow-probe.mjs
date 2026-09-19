/**
 * W5 决定性实验：长文本/宽元素是否会横向溢出？加了兜底规则后是否改善？
 *
 * ## 为什么必须做实验（而不是直接写 CSS）
 * W5 的表述是「宿主正文无全局 overflow-x 兜底 ⇒ 我方加壳层兜底」。
 * 但按 P-29/P-24 的纪律，**不能凭猜测写规则** —— 两种可能的假动作：
 *   · 加了规则但**内容本来就不溢出**（无病呻吟，且规则可能误伤正常内容）；
 *   · 加了规则但**选择器打不中真实产物结构**（P-26 死规则：写了却不生效）。
 * 故本实验直接测**渲染结果**。
 *
 * ## v2 修正（前两轮实验暴露的两个自身缺陷）
 * 【缺陷一 · 挂载点靠猜（假 FAIL）】
 *   v1 把试件挂到「anchor.parentElement」上，而 anchor 退化成 `.dsht-rp-floor-head`
 *   （它就在 `.dsht-rp-assistant` **内部**）⇒ 试件被塞进一个已经膨胀的父级里，
 *   `max-width: 100%` 相对它当然无效 ⇒ 得出「规则治不住 pre」的**错误结论**。
 *   修：**不再造试件**，直接在**真实 `.dsht-rp-assistant-body` 内部**追加探针节点
 *   （测完 remove，不动 React 既有子节点），100% 继承真实层叠环境。
 *
 * 【缺陷二 · 判据把「内部滚动」当「溢出」（P-19/P-24）】
 *   v1 的溢出判据含 `else.scrollWidth > 容器宽`。但 `overflow-x: auto` 的**正确行为**
 *   就是内容比盒子宽、盒子内滚 —— 这是**修复生效**的表现，却被判成「仍溢出」。
 *   ⇒ 正解：溢出 = 内容**撑破**（几何宽 > 可用宽）或**画到盒子外**（overflow visible
 *   且内容更宽）。`overflow-x: auto/scroll` 时的 scrollWidth 只算「内部可滚」。
 *
 * ## 判据（P-24：落在结果）
 *   · overflows = 宿主容器几何宽 > 可用宽
 *             或 内容盒几何宽 > 可用宽
 *             或 内容在 overflow:visible 时画到盒外（bleeds，会被祖先滚动容器接住）
 *   · 现状 overflows=false ⇒ **该缺陷不存在**，不该加规则（否则是 P-26 死规则）
 *   · 现状=true 且候选后=false ⇒ 规则**有效**
 *   · 候选把内容裁掉（overflow hidden + 内容不可达）⇒ 记为 clipped，需换更温和的档
 *
 * 用法：node scripts/ef-overflow-probe.mjs [--sid <会话id>] [--port 9333]
 */
import process from 'node:process'

const argv = process.argv.slice(2)
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
const PORT = Number(flag('--port', '9333'))
const SID = flag('--sid', '')

let id = 0
const pending = new Map()
let ws = null

const connect = async () => {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl)
  if (!page) throw new Error('找不到可调试的 page 目标')
  const WS = (await import('node:module')).createRequire(import.meta.url)('ws')
  ws = new WS(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString())
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  })
}

const send = (method, params = {}) => new Promise((res) => {
  const myId = ++id
  pending.set(myId, res)
  ws.send(JSON.stringify({ id: myId, method, params }))
})

const evalJson = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: `JSON.stringify(${expr})`, awaitPromise: true, returnByValue: true })
  if (r.error) return { __err: String(r.error) }
  const v = r.result?.result?.value
  if (typeof v !== 'string') return { __err: 'no-value' }
  try { return JSON.parse(v) } catch (e) { return { __err: String(e) } }
}

const main = async () => {
  await connect()

  if (SID) {
    await evalJson(`(() => { window.dispatchEvent(new CustomEvent('dsht-rp-ui:locate-session', { detail: { sessionId: ${JSON.stringify(SID)} } })); return true })()`)
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 500))
      const n = await evalJson('document.querySelectorAll(".dsht-rp-floor-head").length')
      if (typeof n === 'number' && n > 0) break
    }
  }

  const r = await evalJson(`(() => {
    const availEl = document.querySelector('.dsht-rp-main') || document.documentElement
    const availW = Math.round(availEl.clientWidth)
    const diag = {
      availW,
      viewportW: document.documentElement.clientWidth,
      nAssistant: document.querySelectorAll('.dsht-rp-assistant').length,
      nBody: document.querySelectorAll('.dsht-rp-assistant-body').length,
      nHtml: document.querySelectorAll('.dsht-rp-html').length,
      nFloor: document.querySelectorAll('.dsht-rp-floor-head').length,
    }

    // 【v2 关键修正】挂到**真实**我方容器内部（不再造同类试件、不再猜父级）
    const realBody = document.querySelector('.dsht-rp-assistant-body')
    if (!realBody) {
      return { ok: false, diag, why: '本卡上没有真实的 .dsht-rp-assistant-body（正文未经我方容器渲染）⇒ 本实验在这里是**测不出来**（P-17），请先切到一张有 assistant 正文的卡' }
    }
    diag.hostParent = String((realBody.parentElement && realBody.parentElement.className) || '')
    diag.bodyW0 = Math.round(realBody.getBoundingClientRect().width)
    diag.bodyOx0 = getComputedStyle(realBody).overflowX

    const CASES = {
      longUrl: '<p><a href="#">' + 'https://example.com/very/long/path/segment/'.repeat(14) + '</a></p>',
      wideTable: '<table><tbody><tr>' + Array.from({ length: 14 }, (_, i) => '<td>单元格' + i + '内容</td>').join('') + '</tr></tbody></table>',
      preBlock: '<pre>' + 'const x = 1; // '.repeat(60) + '</pre>',
      longWord: '<p>' + 'A'.repeat(300) + '</p>',
      // 【v5 补充样本 · P-20 消融的完整性】上面 wideTable 的单元格很窄，表格会**自适应** 319px
      // ⇒ 它测不出「table 规则是否需要」。真会溢出的是**带固定宽/不换行单元格**的表格
      //（RP 卡里的状态栏、属性表常这么写）。同样，裸大图也只在 width 属性很大时才溢出。
      // 不加这两个样本，就会把「无杠杆」误判成「不需要」（或反过来漏掉真需要）。
      wideTableHard: '<table><tbody><tr>' + Array.from({ length: 14 }, (_, i) => '<td style="width:220px;white-space:nowrap">单元格' + i + '</td>').join('') + '</tr></tbody></table>',
      bigImage: '<p><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" width="2000" height="40" alt=""></p>',
    }

    const probe = document.createElement('div')
    probe.setAttribute('data-w5-probe', '1')
    realBody.appendChild(probe)
    const els = {}
    for (const name of Object.keys(CASES)) {
      const d = document.createElement('div')
      d.setAttribute('data-w5-case', name)
      d.innerHTML = CASES[name]
      probe.appendChild(d)
      els[name] = d
    }

    const measure = () => {
      const bodyCs = getComputedStyle(realBody)
      const bodyW = Math.round(realBody.getBoundingClientRect().width)
      const bodyScrollX = realBody.scrollWidth > realBody.clientWidth + 1
      const out = { __body: { bodyW, ox: bodyCs.overflowX, bodyScrollX } }
      for (const name of Object.keys(CASES)) {
        const el = els[name]
        const cs = getComputedStyle(el)
        const boxW = Math.round(el.getBoundingClientRect().width)
        const innerScroll = el.scrollWidth > el.clientWidth + 1
        // 画到盒外（overflow visible 且内容更宽）⇒ 会被祖先滚动容器接住 = 用户可见症状
        const bleeds = innerScroll && cs.overflowX === 'visible'
        out[name] = {
          boxW,
          ox: cs.overflowX,
          scrollW: el.scrollWidth,
          innerScroll,
          bleeds,
          // 溢出 = 宿主或内容**几何撑破**可用宽，或内容画到盒外
          overflows: bodyW > availW + 1 || boxW > availW + 1 || bleeds,
          // 被裁掉（不可达）：祖先没滚动能力又是 hidden/clip，内容永远看不到
          clipped: !innerScroll ? false : (cs.overflowX === 'hidden' || cs.overflowX === 'clip'
            ? true
            : (bodyCs.overflowX === 'hidden' || bodyCs.overflowX === 'clip')),
        }
      }
      out.__doc = {
        mainScrollX: availEl.scrollWidth > availEl.clientWidth + 1,
        docScrollX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      }
      return out
    }

    const addStyle = (rules) => {
      const st = document.createElement('style')
      st.setAttribute('data-w5-probe-style', '1')
      st.textContent = rules.join('\\n')
      document.head.appendChild(st)
      return st
    }

    // 阶梯消融（P-20：规则必须自带杠杆）。
    //
    // 【v5 重要修正 —— 本探针的「现状」基线已随修复进包而改变】
    // v3 时产品**还没有**任何兜底规则，故 A 组 = 无规则基线（实测 4694 / 7489 / 3131px 溢出，
    // 那份数据是「缺陷真实存在」的原始证据，已记入 style.ts 头注与 GOAL.md）。
    // 本轮修复进包后，A 组 = **含已进包规则**的状态 ⇒ 它现在回答的是
    // 「已修的规则够不够」，而不是「缺陷是否存在」。
    //
    // 【v5 抓到的结论反转 —— 样本集不完整会得出错误消融结论（P-27 同族）】
    // v4 只有 4 个样本（longUrl / wideTable / preBlock / longWord），据此判定
    // 「img/svg 那 3 条无杠杆 ⇒ 不加」。**补上两个真会溢出的样本后结论反转**：
    //   · wideTable 的单元格很窄 ⇒ 表格自适应 319px，**测不出** table 规则是否需要；
    //   · 没有裸大图样本 ⇒ **测不出** img 规则是否需要（实测 bigImage 2000px 溢出）。
    // ⇒ 少一个样本就可能把「必要规则」当成「死规则」删掉。教训：消融样本必须**覆盖
    //   每一类待删规则各自的真实触发场景**，否则消融结论无效。
    //（注意：本注释位于模板串内部，**不许出现反引号** —— 会提前终止模板串，A11。）
    const S1 = [
      '.dsht-rp-assistant-body { min-width: 0; max-width: 100%; overflow-x: auto; }',
      '.dsht-rp-html { min-width: 0; max-width: 100%; overflow-x: auto; }',
    ]
    const S2 = [
      ...S1,
      '.dsht-rp-assistant-body > * { max-width: 100%; min-width: 0; }',
      '.dsht-rp-html > * { max-width: 100%; min-width: 0; }',
    ]
    const S3 = [
      ...S2,
      '.dsht-rp-assistant-body a, .dsht-rp-assistant-body p, .dsht-rp-assistant-body li, .dsht-rp-assistant-body h1, .dsht-rp-assistant-body h2, .dsht-rp-assistant-body h3 { overflow-wrap: anywhere; }',
      '.dsht-rp-html > * { overflow-wrap: anywhere; }',
      '.dsht-rp-assistant-body pre { max-width: 100%; min-width: 0; overflow-x: auto; }',
      '.dsht-rp-assistant-body table { display: block; max-width: 100%; min-width: 0; overflow-x: auto; }',
      '.dsht-rp-html pre { max-width: 100%; min-width: 0; overflow-x: auto; }',
      '.dsht-rp-html table { display: block; max-width: 100%; min-width: 0; overflow-x: auto; }',
    ]
    // S4 = S3 + 媒体规则（img/video/canvas/svg 限宽）+ 外壳 min-width
    const S4 = [
      '.dsht-rp-assistant { min-width: 0; max-width: 100%; }',
      ...S3,
      '.dsht-rp-assistant-body img, .dsht-rp-assistant-body video, .dsht-rp-assistant-body canvas, .dsht-rp-assistant-body svg { max-width: 100% !important; height: auto !important; }',
      '.dsht-rp-html img, .dsht-rp-html video, .dsht-rp-html canvas, .dsht-rp-html svg { max-width: 100% !important; height: auto !important; }',
    ]

    const measureWith = (rules) => {
      const st = addStyle(rules)
      const m = measure()
      st.remove()
      return m
    }
    const A = measure()
    const M3 = measureWith(S3)
    const M4 = measureWith(S4)

    probe.remove()
    return {
      ok: true, diag, availW, A,
      levels: [
        { name: '现状（含已进包规则）', m: A },
        { name: 'S3 九条（已进包的那组）', m: M3 },
        { name: 'S4 十二条（S3 + img/video/canvas/svg 限宽 + 外壳）', m: M4 },
      ],
      S3, S4,
    }
  })()`)

  if (!r.ok) {
    console.log('\n[probe] 无法出结论:', r.why ?? JSON.stringify(r))
    console.log('[probe] 页面诊断:', JSON.stringify(r.diag))
    ws.close()
    process.exit(2)
  }

  const d = r.diag
  console.log('\n=== W5 决定性实验 v5：已进包规则是否足够（消融复核）===')
  console.log(`可用宽度 = ${r.availW}px（.dsht-rp-main clientWidth）；视口宽 = ${d.viewportW}px`)
  console.log(`挂载宿主 = 真实 .dsht-rp-assistant-body（父 class=${d.hostParent}），宿主宽 ${d.bodyW0}px / overflow-x=${d.bodyOx0}`)
  console.log(`页面我方容器计数：assistant=${d.nAssistant} body=${d.nBody} html=${d.nHtml} floor=${d.nFloor}\n`)
  console.log('注：宿主 overflow-x=auto 表示**本轮修复已进包并生效**；若为 visible 说明跑的是旧包。\n')

  const names = Object.keys(r.A).filter(k => !k.startsWith('__'))
  const fmt = (s) => s
    ? `${String(s.boxW).padStart(5)} ${s.ox.padEnd(7)} sw=${String(s.scrollW).padStart(5)} bleed=${s.bleeds ? 'YES' : 'no '} 溢出=${s.overflows ? 'YES' : 'no '} 裁切=${s.clipped ? 'YES' : 'no'}`
    : '-'

  for (const lv of r.levels) {
    console.log(lv.name)
    for (const n of names) console.log(`  ${n.padEnd(14)} ${fmt(lv.m[n])}`)
    const bad = names.filter(n => lv.m[n].overflows)
    const clip = names.filter(n => lv.m[n].clipped)
    console.log(`  ⇒ ${bad.length === 0 ? '全部治住 ✓' : '仍溢出：' + bad.join(', ')}${clip.length > 0 ? ' · 裁切：' + clip.join(', ') : ''}\n`)
  }

  const cur = r.levels[0].m
  const s4 = r.levels[2].m
  const badCur = names.filter(n => cur[n].overflows)
  const badS4 = names.filter(n => s4[n].overflows)
  console.log('结论：')
  console.log(`  · 已进包的 9 条规则：${badCur.length === 0 ? '足够 ✓' : '**不够**，仍溢出：' + badCur.join(', ')}`)
  console.log(`  · 12 条（补 img 限宽）：${badS4.length === 0 ? '足够 ✓' : '仍溢出：' + badS4.join(', ')}`)
  console.log(`  · 是否需补规则：${badCur.length > 0 ? '**是**（缺的那几条必须补进 style.ts，否则该场景仍撑破页面）' : '否'}`)
  console.log('\nS4 十二条原文（含应补的 img/video/canvas/svg 规则）：')
  for (const c of r.S4) console.log('  ' + c)

  ws.close()
  process.exit(0)
}

main().catch((e) => { console.error('[probe] FATAL', e); process.exit(1) })
