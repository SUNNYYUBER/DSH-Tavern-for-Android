#!/usr/bin/env node
// golden-mock-llm.mjs — 本地 OpenAI 兼容 mock（Golden Master 用：让 ST/DSHT 能真正走完生成管线）
// 监听 0.0.0.0:31101
//   - /v1/models            → 模型列表
//   - /v1/chat/completions  → 支持 stream:true（SSE）与 stream:false（整包 JSON）
// DSHT 走 llm-pi-ai adapter 时固定 stream:true，故 SSE 是必需路径。
import http from 'node:http';

// MOCK_REPLY_B64 优先（含 JSON/换行/尖括号的回复——PowerShell env 直传会炸引号，base64 免转义）
const REPLY = (process.env.MOCK_REPLY_B64 ? Buffer.from(process.env.MOCK_REPLY_B64, 'base64').toString('utf8') : null)
  || process.env.MOCK_REPLY
  || '（golden-mock）固定回复：This line exists so that the prompt-assembly hooks fire.';
// MOCK_PORT 可覆盖监听端口（同机多实例：默认 31101 不动既有用法）
const PORT = Number(process.env.MOCK_PORT) || 31101;

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

  // ── 错误注入（F1 正控用）：请求里出现 MOCK_ERROR 即回一个**含官方内部字面量**的错误 ──
  // 为什么需要：F1「错误文案归一化」的**正控**必须能真实触发一条泄漏消息，
  // 否则只能验「页面上没有泄漏」（负控），验不了「泄漏真的被翻译掉」（正控）。
  // 返回体刻意复刻官方 `dsh-llm-pi-ai/lib/index.js` 的 `mapStopReason` 字面量形态
  // （含第三方 SDK 名 `pi-ai` 与 `provider/model` 内部路由）。
  // 用法：MOCK_ERROR=1 让**所有**请求都回错；或在消息里写 MOCK_ERROR 触发单次。
  const wantErr = process.env.MOCK_ERROR === '1'
    || (payload.messages ?? []).some(m => String(m?.content ?? '').includes('MOCK_ERROR'));
  if (wantErr) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: {
        code: 'CONTEXT_WINDOW_EXCEEDED',
        message: 'pi-ai detected context overflow for model "deepseek/deepseek-v4-flash"',
        type: 'invalid_request_error',
      },
    }));
    console.log('[mock-llm] injected error (CONTEXT_WINDOW_EXCEEDED)');
    return;
  }

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
}).listen(PORT, '0.0.0.0', () => console.log(`[mock-llm] listening http://0.0.0.0:${PORT} (模拟器内用 http://10.0.2.2:${PORT})`));
