#!/usr/bin/env node
// golden-st-run.mjs v2 — 「页面就绪后动态 import 注入」路线（已实证 busTest ok）
// 链路：goto → 12s 缓冲（角色列表渲染实测需 ~10s+）→ import script.js 挂 hook → 选 wuwa → 发送 → 等 dump
import fs from 'node:fs';
import path from 'node:path';

// 【E2 脱敏 2026-09-13】原为硬编码本机路径（含用户名），改为环境变量可覆盖，避免泄露本机信息。
const ROOT = path.resolve(import.meta.dirname, '../..');   // 项目根，由本文件位置推导
const GOLDEN = path.join(ROOT, 'golden');
const TEXT = process.argv[2] ?? '（金标对照测试）请用一两句话简单打个招呼。';
fs.mkdirSync(path.join(GOLDEN, 'st'), { recursive: true });
const knownBefore = new Set(fs.readdirSync(path.join(GOLDEN, 'st')));

const { chromium } = await (async () => {
  const require = (await import('node:module')).createRequire(import.meta.url);
  return require(path.join(import.meta.dirname, '../tools-pw/node_modules/playwright-core'));
})();
const EXE = process.env.DSHT_CHROME_EXE ?? '<path-to-chrome.exe>';

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage();
const consoleLogs = [];
page.on('console', m => consoleLogs.push(m.text()));
page.on('pageerror', e => consoleLogs.push('[pageerror] ' + e.message));

try {
  await page.goto('http://127.0.0.1:8000/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(12000);
  await page.waitForSelector('.character_select .ch_name', { state: 'attached', timeout: 60000 });
  await page.waitForTimeout(2000);

  // 1) 注入 golden hook（动态 import 绝对 URL——busTest 已实证）
  const hook = await page.evaluate(async () => {
    try {
      const m = await import(new URL('script.js', location.href).href);
      const bus = m.eventSource;
      if (!bus) return { ok: false, err: 'no eventSource' };
      window.__goldenSeq = 0;
      const dump = async (tag, data) => {
        window.__goldenSeq++;
        const character = (typeof this_chid !== 'undefined' && typeof characters !== 'undefined' && characters?.[this_chid]) ? characters[this_chid].name : undefined;
        const chatSnap = (typeof chat !== 'undefined' && Array.isArray(chat)) ? chat.filter(x => !x.is_system).map(x => ({ name: x.name, is_user: !!x.is_user, mes: String(x.mes ?? '') })) : undefined;
        await fetch('http://127.0.0.1:31100/dump', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tag, seq: window.__goldenSeq, env: 'sillytavern', ts: new Date().toISOString(), character, chat: chatSnap, data }) });
        console.log('[golden] dumped #' + window.__goldenSeq + ' ' + tag);
      };
      bus.on('chat_completion_prompt_ready', (oaiMessages) => dump('chat_completion_prompt_ready', { oaiMessages }));
      bus.on('generate_after_combine_prompts', (prompt) => dump('generate_after_combine_prompts', { prompt: String(prompt ?? '') }));
      return { ok: true };
    } catch (e) { return { ok: false, err: e.message.slice(0, 150) }; }
  });
  console.log('[run] hook 注入:', JSON.stringify(hook));
  if (!hook.ok) throw new Error('hook 注入失败: ' + hook.err);

  // 2) 选 wuwa
  const cards = await page.$$eval('.character_select', els => els.map(e => ({
    chid: e.getAttribute('data-chid'), name: (e.querySelector('.ch_name') || {}).textContent?.trim() || '',
  })));
  const target = cards.find(c => /wuwa|示例游戏|solaris|漂泊者/i.test(c.name));
  if (!target) throw new Error('未找到 wuwa 卡: ' + cards.map(c => c.name).filter(Boolean).join(' | '));
  console.log('[run] 选中:', target.chid, target.name);
  await page.evaluate(() => document.querySelector('#rightNavDrawerIcon').click());
  await page.waitForTimeout(1500);
  await page.evaluate((chid) => document.querySelector(`.character_select[data-chid="${chid}"]`).click(), target.chid);
  await page.waitForTimeout(3000);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));

  // 2.5) 连接 mock LLM（无 key 环境必需；每次 run 全新 context 必须重连）
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
  console.log('[run] mock 连接:', JSON.stringify(conn));
  await page.waitForTimeout(4000);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));

  // 3) 发送
  await page.evaluate(() => {
    document.querySelectorAll('dialog[open]').forEach(d => d.close());
    const ta = document.querySelector('#send_textarea');
    if (!ta) throw new Error('no #send_textarea');
    ta.focus();
  });
  await page.keyboard.type(TEXT, { delay: 5 });
  await page.waitForTimeout(400);
  const via = await page.evaluate(() => {
    document.querySelectorAll('dialog[open]').forEach(d => d.close());
    const b = document.querySelector('#send_but');
    if (b && !b.classList.contains('displayNone')) { b.click(); return 'button'; }
    document.querySelector('#send_textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return 'enter';
  });
  console.log('[run] 发送方式:', via);

  // 4) 轮询落盘
  console.log('[run] 轮询 golden dump（最多 120s）…');
  let dumped = null;
  for (let t = 0; t < 120; t += 3) {
    await page.waitForTimeout(3000);
    const now = fs.readdirSync(path.join(GOLDEN, 'st')).filter(f => !knownBefore.has(f));
    if (now.length) { dumped = now; break; }
  }
  if (dumped) {
    console.log('[run] ✅ golden 落盘:', dumped.join(', '));
  } else {
    console.error('[run] ❌ 120s 无 dump——console 诊断:');
    const interesting = consoleLogs.filter(l => /golden|error|failed|uncaught/i.test(l));
    console.error(interesting.slice(0, 12).join('\n') || consoleLogs.slice(-6).join('\n'));
  }
} catch (e) {
  console.error('[run][FATAL]', e.message.slice(0, 300));
  try { await page.screenshot({ path: path.join(ROOT, 'tmp/golden-run-fail.png') }); } catch {}
} finally {
  await browser.close();
}
