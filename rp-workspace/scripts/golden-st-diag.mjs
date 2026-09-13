#!/usr/bin/env node
// golden-st-diag.mjs — 三查：index.js 可达性 / 扩展卡 DOM / console golden 痕迹
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// 【E2 脱敏 2026-09-13】原为硬编码本机路径（含用户名），改为环境变量可覆盖，避免泄露本机信息。
const { chromium } = require(path.join(import.meta.dirname, '../tools-pw/node_modules/playwright-core'));
const EXE = process.env.DSHT_CHROME_EXE ?? '<path-to-chrome.exe>';

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage();
const logs = [];
page.on('console', m => logs.push(m.text()));
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
const badResponses = [];
page.on('response', r => { if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url().slice(0, 120)}`); });
await page.goto('http://127.0.0.1:8000/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(12000);

const r = await page.evaluate(async () => {
  const res = await fetch('/scripts/extensions/third-party/golden-master/index.js');
  const text = await res.text();
  const cards = Array.from(document.querySelectorAll('#extensions_settings, #extensions_settings2'))
    .map(c => c.innerText).join('\n');
  let charsApi = null;
  try {
    const cr = await fetch('/api/characters/all', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const cj = await cr.json().catch(() => null);
    charsApi = { status: cr.status, count: Array.isArray(cj) ? cj.length : null, sample: Array.isArray(cj) ? cj.slice(0, 3).map(c => c.name) : String(cj).slice(0, 80) };
  } catch (e) { charsApi = { err: e.message }; }
  return {
    fetchStatus: res.status,
    scriptHead: text.slice(0, 60),
    goldenInPanel: /golden/i.test(cards),
    chNameCount: document.querySelectorAll('.character_select .ch_name').length,
    chNameSample: Array.from(document.querySelectorAll('.character_select .ch_name')).slice(0, 3).map(e => e.textContent?.trim() || '(空)'),
    charsApi,
    busTest: await (async () => {
      try {
        const m = await import(new URL('script.js', location.href).href);
        return { ok: true, hasEventSource: !!m.eventSource, exports: Object.keys(m).length };
      } catch (e) { return { ok: false, err: e.message.slice(0, 100) }; }
    })(),
  };
});
console.log(JSON.stringify(r, null, 1));
console.log('--- 4xx/5xx responses ---');
console.log(badResponses.slice(0, 12).join('\n') || '(none)');
console.log('--- console golden/error ---');
console.log(logs.filter(l => /golden|doExtrasFetch|503|Failed/i.test(l)).slice(0, 10).join('\n') || '(none)');
await browser.close();
