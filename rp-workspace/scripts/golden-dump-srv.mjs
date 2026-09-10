#!/usr/bin/env node
// golden-dump-srv.mjs — mock LLM：落盘请求体到 golden/dsht/ 后返回固定 SSE
import http from 'node:http'
import fs from 'node:fs'
const DUMP = 'D:/DSH RolePlay/golden/dsht'
fs.mkdirSync(DUMP, { recursive: true })
let seq = 0
const srv = http.createServer((req, res) => {
  const ch = []
  req.on('data', c => ch.push(c))
  req.on('end', () => {
    const body = Buffer.concat(ch).toString('utf8')
    if (req.url.includes('/models')) {
      res.writeHead(200, {'content-type':'application/json'})
      res.end(JSON.stringify({ object:'list', data:[{id:'deepseek-v4-flash', object:'model'}, {id:'golden-mock', object:'model'}] }))
      return
    }
    try {
      seq++
      const j = JSON.parse(body)
      fs.writeFileSync(`${DUMP}/rx-${String(seq).padStart(3,'0')}.json`, JSON.stringify({
        tag: 'provider_llm_request', seq, env:'dshtavern', ts:new Date().toISOString(),
        url:req.url, data:{ body: j },
      }, null, 1))
      const msgs = Array.isArray(j.messages) ? j.messages : []
      const chars = JSON.stringify(msgs).length
      console.log(`[rx] #${seq} messages=${msgs.length} chars=${chars} model=${j.model}`)
      // 逐条角色与字符
      msgs.forEach((m,i)=>{ const c = typeof m.content==='string'?m.content:JSON.stringify(m.content); console.log(`  [${i}] ${m.role} ${c.length}ch ${c.slice(0,70).replace(/\n/g,' ')}`) })
    } catch (e) { console.log('[rx] parse fail', e.message) }
    res.writeHead(200, {'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive'})
    const mk = (d)=>{ res.write(`data: ${JSON.stringify(d)}\n\n`) }
    mk({id:'mock',object:'chat.completion.chunk',created:Date.now(),model:'deepseek-v4-flash',choices:[{index:0,delta:{role:'assistant'},finish_reason:null}]})
    const txt = '（mock 回复）收到，这是一条简短应答。'
    for (const ch2 of txt.match(/.{1,6}/gs) || []) mk({id:'mock',object:'chat.completion.chunk',created:Date.now(),model:'deepseek-v4-flash',choices:[{index:0,delta:{content:ch2},finish_reason:null}]})
    mk({id:'mock',object:'chat.completion.chunk',created:Date.now(),model:'deepseek-v4-flash',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}})
    res.write('data: [DONE]\n\n')
    res.end()
  })
})
srv.listen(31101, '0.0.0.0', () => console.log('[dump-srv] listening :31101'))
