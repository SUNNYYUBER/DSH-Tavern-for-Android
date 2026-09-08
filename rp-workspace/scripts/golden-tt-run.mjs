#!/usr/bin/env node
// golden-tt-run.mjs — 通过 WebView2 CDP 驱动 TauriTavern
// 用法: node golden-tt-run.mjs probe          连接+环境报告
//       node golden-tt-run.mjs run [文本]     挂hook+选wuwa+发送+等dump
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('D:/DSH RolePlay/rp-workspace/tools-pw/node_modules/playwright-core');

const CMD = process.argv[2] ?? 'probe';
const TEXT = process.argv[3] ?? '（金标对照测试）请用一两句话简单打个招呼。';
const GOLDEN = 'D:/DSH RolePlay/golden';
const CDP = 'http://127.0.0.1:9222';

async function waitCdp() {
  for (let t = 0; t < 120; t += 5) {
    try {
      const r = await fetch('http://127.0.0.1:9222/json/version');
      if (r.ok) { console.log(`[tt] CDP 就绪（等待 ${t}s）`); return true; }
    } catch {}
    await new Promise(res => setTimeout(res, 5000));
  }
  return false;
}

if (!(await waitCdp())) { console.error('[tt][FATAL] 9222 CDP 120s 未就绪——tauri:dev 是否成功？'); process.exit(1); }

const browser = await chromium.connectOverCDP(CDP);
const ctx = browser.contexts()[0];
const page = ctx.pages().find(p => /tauri|localhost|127\.0\.0\.1|http/i.test(p.url())) ?? ctx.pages()[0];
console.log('[tt] page:', page.url());

if (CMD === 'probe') {
  const info = await page.evaluate(() => ({
    title: document.title,
    ttReady: !!window.__TAURITAVERN__,
    ttKeys: window.__TAURITAVERN__ ? Object.keys(window.__TAURITAVERN__) : [],
    apiKeys: window.__TAURITAVERN__?.api ? Object.keys(window.__TAURITAVERN__.api) : [],
    bodyHead: document.body.innerText.replace(/\s+/g, ' ').slice(0, 150),
    hasEventSourceCompat: !!(window.__TAURITAVERN__?.api?.eventSource ?? window.__TAURITAVERN__?.eventSource),
  }));
  console.log(JSON.stringify(info, null, 1));
  await browser.close();
  process.exit(0);
}

// run 模式：注入 hook（__TAURITAVERN__ 已 ready，直接挂）
await page.waitForFunction(() => !!window.__TAURITAVERN__, null, { timeout: 60000 }).catch(() => {});
const hookRes = await page.evaluate(() => {
  try {
    const T = window.__TAURITAVERN__;
    const bus = T?.api?.eventSource ?? T?.eventSource ?? (T?.getContext ? T.getContext().eventSource : null)
      ?? (typeof eventSource !== 'undefined' ? eventSource : null);
    if (!bus || typeof bus.on !== 'function') return { err: 'no bus' };
    window.__goldenSeq = 0;
    const dump = async (tag, data) => {
      window.__goldenSeq++;
      const character = (typeof this_chid !== 'undefined' && typeof characters !== 'undefined' && characters?.[this_chid]) ? characters[this_chid].name
        : (T?.getContext ? (T.getContext().characterId != null ? T.getContext().name2 ?? T.getContext().characters?.[T.getContext().characterId]?.name : undefined) : undefined);
      await fetch('http://127.0.0.1:31100/dump', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag, seq: window.__goldenSeq, env: 'tauritavern', ts: new Date().toISOString(), character, data }) });
      console.log('[golden] dumped #' + window.__goldenSeq + ' ' + tag);
    };
    for (const n of ['chat_completion_prompt_ready', 'CHAT_COMPLETION_PROMPT_READY']) {
      try { bus.on(n, (oaiMessages) => dump('chat_completion_prompt_ready', { oaiMessages })); } catch (e) { console.warn('reg fail', n, e.message); }
    }
    for (const n of ['generate_after_combine_prompts', 'GENERATE_AFTER_COMBINE_PROMPTS']) {
      try { bus.on(n, (prompt) => dump('generate_after_combine_prompts', { prompt: String(prompt ?? '') })); } catch (e) { console.warn('reg fail', n, e.message); }
    }
    return { ok: true, busType: typeof bus };
  } catch (e) { return { err: e.message }; }
});
console.log('[tt] hook:', JSON.stringify(hookRes));

// 找 wuwa 并选卡 —— 先探测 DOM（TT 前端结构未知，现场找）
const probe = await page.evaluate(() => {
  const cands = Array.from(document.querySelectorAll('[class*="character"], [class*="char-item"], [class*="charItem"]'))
    .map(e => ({ cls: e.className.slice(0, 60), text: (e.innerText || '').replace(/\s+/g, ' ').slice(0, 60) }))
    .filter(x => /wuwa|示例游戏|solaris/i.test(x.text));
  const inputs = Array.from(document.querySelectorAll('textarea, input[type="text"]')).map(e => ({ id: e.id, ph: (e.placeholder || '').slice(0, 40), vis: !!(e.offsetWidth || e.offsetHeight) })).filter(x => x.vis);
  return { cands: cands.slice(0, 6), inputs: inputs.slice(0, 6) };
});
console.log('[tt] wuwa DOM 候选:', JSON.stringify(probe.cands, null, 1));
console.log('[tt] 可见输入框:', JSON.stringify(probe.inputs, null, 1));

if (probe.cands.length === 0) { console.log('[tt] 未找到 wuwa DOM 候选——保持 hook 已挂，输出探测结束'); await browser.close(); process.exit(0); }

// 点击 wuwa 候选（第一个）
const first = probe.cands[0];
await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
const clicked = await page.evaluate((cls) => {
  const els = Array.from(document.querySelectorAll(`[class*="${cls.split(' ')[0]}"]`))
    .filter(e => /wuwa|示例游戏|solaris/i.test(e.innerText || ''));
  if (!els.length) return false;
  (els[0].closest('[class*="character"]') ?? els[0]).click();
  return true;
}, first.cls);
console.log('[tt] 点击 wuwa:', clicked);
await page.waitForTimeout(3000);
await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));

// 找可见输入框输入并发送
const sent = await page.evaluate((text) => {
  const ta = Array.from(document.querySelectorAll('textarea')).find(e => e.offsetWidth || e.offsetHeight);
  if (!ta) return { err: 'no visible textarea' };
  ta.focus();
  document.execCommand('insertText', false, text);
  const sendBtn = Array.from(document.querySelectorAll('button, [role="button"], div[title*="发送"], [class*="send"]'))
    .find(e => (e.offsetWidth || e.offsetHeight) && /send|发送/i.test((e.title || '') + e.className + e.id));
  if (sendBtn) { sendBtn.click(); return { via: 'button' }; }
  ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return { via: 'enter' };
}, TEXT);
console.log('[tt] 发送:', JSON.stringify(sent));

console.log('[tt] 轮询 golden dump（最多 120s）…');
fs.mkdirSync(path.join(GOLDEN, 'tt'), { recursive: true });
const known = new Set(fs.readdirSync(path.join(GOLDEN, 'st')).concat(fs.readdirSync(path.join(GOLDEN, 'tt'))));
let dumped = null;
for (let t = 0; t < 120; t += 3) {
  await page.waitForTimeout(3000);
  const now = fs.readdirSync(path.join(GOLDEN, 'tt')).filter(f => !known.has(f));
  if (now.length) { dumped = now; break; }
}
if (dumped) console.log('[tt] ✅ TT golden 落盘:', dumped.join(', '));
else console.error('[tt] ❌ 120s 无 dump——检查 hook 注册与事件名');
await browser.close();
