#!/usr/bin/env node
// golden-st-run.mjs — 用 playwright-core 驱动 ST：选 wuwa 卡 → 发固定输入 → 验证 golden dump 落盘
// 用法: node golden-st-run.mjs [输入文本]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { chromium = require('D:/DSH RolePlay/rp-workspace/tools-pw/node_modules/playwright-core').chromium; } catch (e) {
  console.error('[run][FATAL] playwright-core 不可用:', e.message); process.exit(1);
}

const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const TEXT = process.argv[2] ?? '（金标对照测试）请用一两句话简单打个招呼。';
const GOLDEN = 'D:/DSH RolePlay/golden/st';
fs.mkdirSync(GOLDEN, { recursive: true });
const knownBefore = new Set(fs.readdirSync(GOLDEN));

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const context = await browser.newContext();

const GOLDEN_HOOK = `
(async () => {
  try {
    const m = await import(new URL('/script.js', location.origin).href);
    const { eventSource, event_types } = m;
    const ready = event_types?.CHAT_COMPLETION_PROMPT_READY ?? 'chat_completion_prompt_ready';
    const combined = event_types?.GENERATE_AFTER_COMBINE_PROMPTS ?? 'generate_after_combine_prompts';
    window.__goldenSeq = 0;
    const dump = async (tag, data) => {
      window.__goldenSeq++;
      await fetch('http://127.0.0.1:31100/dump', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag, seq: window.__goldenSeq, ts: new Date().toISOString(),
          character: (typeof this_chid !== 'undefined' && typeof characters !== 'undefined' && characters?.[this_chid]) ? characters[this_chid].name : undefined,
          chat: (typeof chat !== 'undefined' && chat) ? chat.filter(x => !x.is_system).map(x => ({ name: x.name, is_user: !!x.is_user, mes: String(x.mes ?? '') })) : undefined,
          data }) });
      console.log('[golden-init] dumped #' + window.__goldenSeq + ' ' + tag);
    };
    eventSource.on(ready, (oaiMessages) => dump('chat_completion_prompt_ready', { oaiMessages }));
    eventSource.on(combined, (prompt) => dump('generate_after_combine_prompts', { prompt: String(prompt ?? '') }));
    console.log('[golden-init] hooks installed');
  } catch (e) { console.error('[golden-init] failed: ' + e.message); }
})();
`;
await context.addInitScript(GOLDEN_HOOK);

const page = await context.newPage();
const consoleLogs = [];
page.on('console', m => consoleLogs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => consoleLogs.push(`[pageerror] ${e.message}`));
try {
  await page.goto('http://127.0.0.1:8000/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.character_select', { state: 'attached', timeout: 120000 });
  await page.waitForTimeout(3000);
  await page.waitForSelector('.character_select .ch_name', { state: 'attached', timeout: 60000 });
  const cards = await page.$$eval('.character_select', els => els.map(e => ({
    chid: e.getAttribute('data-chid'), name: (e.querySelector('.ch_name') || {}).textContent?.trim() || '',
  })));
  console.log('[run] 角色:', cards.map(c => `${c.chid}:${c.name}`).join(' | '));
  const target = cards.find(c => /wuwa|示例游戏|solaris|漂泊者/i.test(c.name));
  if (!target) throw new Error('未找到 wuwa 候选卡: ' + cards.map(c => c.name).join(','));
  console.log('[run] 选中:', target.chid, target.name);

  await page.click('#rightNavDrawerIcon');
  await page.waitForSelector(`.character_select[data-chid="${target.chid}"]`, { state: 'visible', timeout: 60000 });
  await page.click(`.character_select[data-chid="${target.chid}"]`);
  await page.waitForSelector('#send_textarea', { state: 'visible', timeout: 60000 });
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));

  console.log('[run] 连接 mock LLM（页面内 jQuery 直填）…');
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  const conn = await page.evaluate(() => {
    try {
      const $ = window.jQuery;
      $('#chat_completion_source').val('custom').trigger('change');
      const setVal = (sel, v) => { const e = $(sel); if (e.length) { e.val(v).trigger('input').trigger('change'); return true; } return false; };
      const urlOk = setVal('#custom_api_url_text', 'http://127.0.0.1:31101');
      const keyOk = setVal('#api_key_openai', 'sk-golden-mock');
      $('#api_button_openai').trigger('click');
      return { urlOk, keyOk };
    } catch (e) { return { err: e.message }; }
  });
  console.log('[run] 连接动作:', JSON.stringify(conn));
  await page.waitForTimeout(4000);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  console.log('[run] 已进入聊天，发送固定输入…');
  await page.evaluate(() => {
    document.querySelectorAll('dialog[open]').forEach(d => d.close());
    document.querySelector('#send_textarea').focus();
  });
  await page.keyboard.type(TEXT, { delay: 5 });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    document.querySelectorAll('dialog[open]').forEach(d => d.close());
    const b = document.querySelector('#send_but');
    if (b && !b.classList.contains('displayNone')) { b.click(); return 'button'; }
    const ta = document.querySelector('#send_textarea');
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return 'enter';
  });
  console.log('[run] 消息已提交');

  console.log('[run] 轮询 golden dump（最多 90s）…');
  let dumped = null;
  for (let t = 0; t < 90; t += 3) {
    await page.waitForTimeout(3000);
    const now = fs.readdirSync(GOLDEN).filter(f => !knownBefore.has(f));
    if (now.length) { dumped = now; break; }
  }
  if (dumped) {
    console.log('[run] ✅ golden 落盘:', dumped.join(', '));
  } else {
    console.error('[run] ❌ 90s 内无 dump——console 诊断:');
    const interesting = consoleLogs.filter(l => /golden|error|failed|uncaught/i.test(l));
    console.error(interesting.length ? interesting.slice(0, 15).join('\n') : consoleLogs.slice(-8).join('\n'));
    console.error('[run] console 总行数:', consoleLogs.length);
  }
} catch (e) {
  console.error('[run][FATAL]', e.message);
  try { await page.screenshot({ path: 'D:/DSH RolePlay/tmp/golden-run-fail.png' }); } catch {}
} finally {
  await browser.close();
}
