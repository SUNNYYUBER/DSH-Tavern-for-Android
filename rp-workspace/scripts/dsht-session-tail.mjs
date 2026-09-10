#!/usr/bin/env node
/** dsht-session-tail.mjs — 解析 DSH 会话 jsonl，打印事件序列摘要
 *  用法: node dsht-session-tail.mjs <file.jsonl> [--tail N]
 */
import fs from 'node:fs'
const [file] = process.argv.slice(2)
const ti = process.argv.indexOf('--tail')
const TAIL = ti >= 0 ? Number(process.argv[ti + 1]) : 25
const lines = fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim())
const rows = []
/** 从 message.content（string | [{type:'text',text}]）里抽纯文本 */
const textOf = (c) => {
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.map(x => (typeof x === 'string' ? x : x?.text ?? '')).join('')
  return ''
}
for (const l of lines) {
  let o; try { o = JSON.parse(l) } catch { rows.push(['PARSE_ERR', l.slice(0, 80)]); continue }
  const kind = o.type ?? o.kind ?? '?'
  const d = o.data ?? {}
  let extra = ''
  if (kind === 'user/message' || kind === 'assistant/message') {
    const txt = textOf(d.message?.content ?? d.content)
    extra = `id=${String(d.message?.id ?? d.id ?? '').slice(0, 28)} ` + JSON.stringify(txt.replace(/\s+/g, ' ').slice(0, 64))
  } else if (kind === 'system/message') {
    extra = `(${textOf(d.message?.content ?? d.content).length} ch)`
  } else if (kind === 'request/header') {
    const c = d.header?.config ?? {}
    extra = `provider=${c.provider ?? '?'} model=${c.model ?? '?'}`
  } else if (kind === 'turn/end') {
    extra = `turn=${d.turn ?? '?'} reason=${d.reason?.kind ?? ''}`
  } else if (kind === 'turn/start') {
    extra = `turn=${d.turn ?? '?'}`
  } else if (kind === 'step/start' || kind === 'step/end') {
    extra = `turn=${d.turn ?? '?'} step=${d.step ?? '?'}`
  } else if (kind === 'session/start') {
    extra = `cwd=${d.cwd ?? '?'}`
  }
  rows.push([`seq=${o.seq ?? '?'}`, kind, extra])
}
console.log(`共 ${rows.length} 条事件`)
for (const r of rows.slice(-TAIL)) console.log(r.filter(Boolean).join('  '))
