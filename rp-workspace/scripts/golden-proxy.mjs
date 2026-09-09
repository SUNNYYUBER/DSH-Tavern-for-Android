#!/usr/bin/env node
// golden-proxy.mjs — 透明 LLM 代理：截获 DSHT 主聊天请求体（golden dump）+ 转发真 provider
// 监听 0.0.0.0:31102 → 转发 https://api.commandcode.ai（保留原 path/headers/key）
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';

const DUMP = 'D:/DSH RolePlay/golden/dsht';
fs.mkdirSync(DUMP, { recursive: true });
function nextSeq() {
  const f = DUMP + '/proxy-seq.txt';
  let n = 0;
  try { n = parseInt(fs.readFileSync(f, 'utf8').trim() || '0', 10) || 0; } catch {}
  n += 1;
  fs.writeFileSync(f, String(n));
  return n;
}

http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    // 落盘
    try {
      const s = body.toString('utf8');
      if (s.length > 100) {
        const seq = nextSeq();
        fs.writeFileSync(`${DUMP}/px-${String(seq).padStart(3, '0')}.json`, JSON.stringify({
          tag: 'provider_llm_request', seq, env: 'dshtavern', ts: new Date().toISOString(),
          url: 'https://api.commandcode.ai' + req.url,
          data: { body: JSON.parse(s) },
        }, null, 1));
        console.log(`[proxy] #${seq} 截获 ${req.method} ${req.url} (${s.length}B)`);
      }
    } catch (e) { console.log('[proxy] dump fail:', e.message); }
    // 转发真 provider
    const upReq = https.request({
      hostname: 'api.commandcode.ai', port: 443, path: req.url, method: req.method,
      headers: { ...req.headers, host: 'api.commandcode.ai' },
    }, upRes => {
      res.writeHead(upRes.statusCode, upRes.headers);
      upRes.pipe(res);
    });
    upReq.on('error', e => {
      console.log('[proxy] 上游错误:', e.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'golden-proxy upstream: ' + e.message } }));
    });
    upReq.end(body);
  });
}).listen(31102, '0.0.0.0', () => console.log('[proxy] http://0.0.0.0:31102 → api.commandcode.ai'));
