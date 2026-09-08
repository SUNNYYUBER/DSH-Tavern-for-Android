#!/usr/bin/env node
// golden-st-diag.mjs — 三查：index.js 可达性 / 扩展卡 DOM / console golden 痕迹
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('D:/DSH RolePlay/rp-workspace/tools-pw/node_modules/playwright-core');
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';

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
  return {
    fetchStatus: res.status,
    scriptHead: text.slice(0, 80),
    goldenInPanel: /golden/i.test(cards),
    swCount: navigator.serviceWorker?.controller ? 1 : 0,
  };
});
console.log(JSON.stringify(r, null, 1));
console.log('--- 4xx/5xx responses ---');
console.log(badResponses.slice(0, 12).join('\n') || '(none)');
console.log('--- console golden/error ---');
console.log(logs.filter(l => /golden|doExtrasFetch|503|Failed/i.test(l)).slice(0, 10).join('\n') || '(none)');
await browser.close();
