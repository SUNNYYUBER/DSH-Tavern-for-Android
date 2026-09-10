#!/usr/bin/env node
// golden-mock-llm.mjs — 本地 OpenAI 兼容 mock（Golden Master 用：让 ST/DSHT 能真正走完生成管线）
// 监听 0.0.0.0:31101
//   - /v1/models            → 模型列表
//   - /v1/chat/completions  → 支持 stream:true（SSE）与 stream:false（整包 JSON）
// DSHT 走 llm-pi-ai adapter 时固定 stream:true，故 SSE 是必需路径。
import http from 'node:http';

const REPLY = process.env.MOCK_REPLY
  || '（golden-mock）固定回复：This line exists so that the prompt-assembly hooks fire.';

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

http.createServer(async (req, res) => {
  const body = await readBody(req);
  console.log(`[mock-llm] ${req.method} ${req.url} (${body.length}B)`);

  if (req.url.includes('/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      object: 'list',
      data: [
        { id: 'deepseek-v4-flash', object: 'model', owned_by: 'mock' },
        { id: 'golden-mock', object: 'model', owned_by: 'mock' },
      ],
    }));
  }

  let payload = {};
  try { payload = JSON.parse(body); } catch {}
  const model = payload.model ?? 'golden-mock';
  console.log(`[mock-llm] messages=${payload.messages?.length ?? '?'} model=${model} stream=${!!payload.stream}`);

  // 【2026-09-11 心跳 47 新增】可选落盘最终出站 payload（排障/取证用，默认关闭）。
  // 用途：验证 prompt 装配产物（槽位是否注入、楼层正文是否为空、MVU 初始变量是否下发）
  // 时，光看"请求成功"不够 —— 必须看真实字节。设 MOCK_DUMP=<路径前缀> 即落盘
  //   <前缀>.<n>.json（整包 payload）
  const dumpPrefix = process.env.MOCK_DUMP;
  if (dumpPrefix) {
    try {
      // 注意：MOCK_DUMP_SEQ 非数字时 Number() 会得到 NaN → 产出 `outbound.NaN.json`（自己踩过）。
      const rawSeq = Number(process.env.MOCK_DUMP_SEQ);
      const n = Number.isFinite(rawSeq) ? rawSeq : Date.now();
      const { writeFileSync } = await import('node:fs');
      writeFileSync(`${dumpPrefix}.${n}.json`, JSON.stringify(payload, null, 2), 'utf8');
      console.log(`[mock-llm] payload 已落盘: ${dumpPrefix}.${n}.json (${body.length}B)`);
    } catch (e) {
      console.warn(`[mock-llm] payload 落盘失败: ${e?.message}`);
    }
  }

  const id = 'chatcmpl-mock-' + Date.now();
  const created = Math.floor(Date.now() / 1000);

  if (payload.stream) {
    // ── SSE 流式 ──
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const chunk = (delta, finish) => JSON.stringify({
      id, object: 'chat.completion.chunk', created, model,
      choices: [{ index: 0, delta, finish_reason: finish ?? null }],
    });
    // 首块：role
    res.write(`data: ${chunk({ role: 'assistant', content: '' })}\n\n`);
    // 正文按小块推
    const parts = REPLY.match(/[\s\S]{1,24}/g) ?? [REPLY];
    for (const p of parts) {
      res.write(`data: ${chunk({ content: p })}\n\n`);
    }
    // 末块：finish_reason
    res.write(`data: ${chunk({}, 'stop')}\n\n`);
    // usage 块（DSH 可能读）
    res.write(`data: ${JSON.stringify({
      id, object: 'chat.completion.chunk', created, model, choices: [],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    })}\n\n`);
    res.write('data: [DONE]\n\n');
    return res.end();
  }

  // ── 非流式整包 ──
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    id, object: 'chat.completion', created, model,
    choices: [{ index: 0, message: { role: 'assistant', content: REPLY }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  }));
}).listen(31101, '0.0.0.0', () => console.log('[mock-llm] listening http://0.0.0.0:31101 (模拟器内用 http://10.0.2.2:31101)'));
