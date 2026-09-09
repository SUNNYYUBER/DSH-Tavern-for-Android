#!/usr/bin/env node
// golden-tt-cdp.mjs — TT 侧全流程（CDP 直连）：挂hook→选wuwa→发消息→dump
import fs from 'node:fs';

const PORT = process.argv[2] || '9333';
const MSG = '（金标对照测试）请用一两句话简单打个招呼。';

const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const target = list.find(t => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}
ws.onmessage = ev => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
};
await new Promise(res => { ws.onopen = res; });
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 200));
  return r.result.value;
}

console.log('[tt] ① 挂 hook…');
console.log('[tt] hook:', await ev(`(async () => {
  const m = await import(new URL('script.js', location.href).href);
  const bus = m.eventSource, et = m.event_types ?? {};
  if (!bus) return 'no bus';
  window.__gseq = 0;
  if (!window.__goldenHooked) {
    window.__goldenHooked = true;
    const dump = async (tag, data) => {
      window.__gseq++;
      const ctx = window.__TAURITAVERN__?.getContext?.() ?? {};
      await fetch('http://10.0.2.2:31100/dump', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag, seq: window.__gseq, env: 'tauritavern', ts: new Date().toISOString(), character: ctx.name2 ?? ctx.character?.name, data }) }).catch(() => {});
    };
    bus.on(et.CHAT_COMPLETION_PROMPT_READY ?? 'chat_completion_prompt_ready', (m2) => dump('chat_completion_prompt_ready', { oaiMessages: m2 }));
    bus.on(et.GENERATE_AFTER_COMBINE_PROMPTS ?? 'generate_after_combine_prompts', (p) => dump('generate_after_combine_prompts', { prompt: String(p ?? '') }));
    return 'installed';
  }
  return 'already';
})()`));

console.log('[tt] ② 选 wuwa 卡…');
console.log('[tt] 选卡:', await ev(`(async () => {
  await new Promise(r => setTimeout(r, 1000));
  const card = Array.from(document.querySelectorAll('.character_select')).find(e => /wuwa/i.test((e.querySelector('.ch_name') || {}).textContent || ''));
  if (!card) return '卡片不在列表（角色抽屉未开？）';
  card.click();
  await new Promise(r => setTimeout(r, 3000));
  return 'clicked chid=' + card.getAttribute('data-chid');
})()`));

console.log('[tt] ③ 发送消息…');
console.log('[tt] 发送:', await ev(`(async () => {
  const ta = document.querySelector('#send_textarea');
  if (!ta) return 'no #send_textarea';
  ta.focus();
  ta.value = ${JSON.stringify(MSG)};
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 600));
  const b = document.querySelector('#send_but');
  if (b && !b.classList.contains('displayNone')) { b.click(); return 'via button'; }
  ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return 'via enter';
})()`));

console.log('[tt] ④ 等 25s（生成+dump）…');
await new Promise(r => setTimeout(r, 25000));
console.log('[tt] 状态:', await ev(`({ mes: document.querySelectorAll('.mes').length, lastHasTest: document.body.innerText.includes('金标对照测试') })`));
ws.close();
