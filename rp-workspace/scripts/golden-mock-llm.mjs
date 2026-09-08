#!/usr/bin/env node
// golden-mock-llm.mjs — 本地 OpenAI 兼容 mock（Golden Master 用：让 ST 能真正走完生成管线）
// 监听 127.0.0.1:31101；/v1/chat/completions 返回固定回复。
import http from 'node:http';

const REPLY = '（golden-mock）固定回复：This line exists so that the prompt-assembly hooks fire.';
http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    console.log(`[mock-llm] ${req.method} ${req.url} (${body.length}B)`);
    if (req.url.includes('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'golden-mock', object: 'model' }] }));
    }
    let payload = {};
    try { payload = JSON.parse(body); } catch {}
    console.log(`[mock-llm] messages=${payload.messages?.length ?? '?'} model=${payload.model ?? '?'}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'golden-mock-1', object: 'chat.completion', created: Math.floor(Date.now() / 1000),
      model: payload.model ?? 'golden-mock',
      choices: [{ index: 0, message: { role: 'assistant', content: REPLY }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    }));
  });
}).listen(31101, '0.0.0.0', () => console.log('[mock-llm] listening http://0.0.0.0:31101 (模拟器内用 http://10.0.2.2:31101)'));
