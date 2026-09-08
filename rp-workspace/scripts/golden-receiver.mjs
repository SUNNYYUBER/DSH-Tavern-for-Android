#!/usr/bin/env node
// Golden Master 接收器 — 收 ST 扩展 dump 的可观察行为，落盘 golden/st/
// 用法：node rp-workspace/scripts/golden-receiver.mjs   （监听 127.0.0.1:31100）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = path.join(ROOT, 'golden', 'st');
fs.mkdirSync(DIR, { recursive: true });

let n = 0;
http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.method !== 'POST' || !req.url.startsWith('/dump')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'POST /dump only' }));
  }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    n += 1;
    const file = path.join(DIR, `dump-${String(n).padStart(3, '0')}-${Date.now()}.json`);
    try {
      fs.writeFileSync(file, body);
      const head = JSON.parse(body);
      const size = head?.data?.oaiMessages?.length ?? (head?.data?.prompt ? `${head.data.prompt.length}ch` : '?');
      console.log(`[golden] #${n} ${head.tag} (${size}) chars=${head.character ?? '-'} -> ${path.basename(file)} (${(body.length / 1024).toFixed(1)}KB)`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, seq: n, file: path.basename(file) }));
    } catch (e) {
      console.error(`[golden] write failed: ${e.message}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}).listen(31100, '127.0.0.1', () => {
  console.log('[golden] receiver listening on http://127.0.0.1:31100');
  console.log(`[golden] dumps -> ${DIR}`);
});
