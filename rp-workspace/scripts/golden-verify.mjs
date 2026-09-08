#!/usr/bin/env node
// golden-verify.mjs — 逐元素点击验证（心跳 5 主工具）
// 用法: node golden-verify.mjs probe|verify [卡名正则]
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('D:/DSH RolePlay/rp-workspace/tools-pw/node_modules/playwright-core');
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const TOKEN = fs.readFileSync('D:/DSH RolePlay/tmp/dsht-token.txt', 'utf8').trim();
const CMD = process.argv[2] ?? 'probe';
const CARD_RE = new RegExp(process.argv[3] ?? 'wuwa|Solaris', 'i');

const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-proxy-server'] });
const page = await browser.newPage();
const logs = [];
page.on('console', m => logs.push(m.text().slice(0, 120)));
page.on('pageerror', e => logs.push('[pageerror] ' + e.message.slice(0, 120)));

await page.goto(`http://127.0.0.1:43080/?token=${TOKEN}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(12000);

// 点侧栏 wuwa 工作区
const clicked = await page.evaluate((re) => {
  const items = Array.from(document.querySelectorAll('a, [role="button"], div, span'))
    .filter(e => e.offsetWidth && re.test((e.innerText || '').trim()) && (e.innerText || '').trim().length < 60);
  if (!items.length) return { ok: false, sidebar: document.body.innerText.replace(/\s+/g, ' ').slice(0, 150) };
  items[0].click();
  return { ok: true, clicked: (items[0].innerText || '').trim().slice(0, 50) };
}, CARD_RE);
console.log('[verify] 侧栏点击:', JSON.stringify(clicked));
await page.waitForTimeout(8000);
await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));

// 扫描主文档 + 所有 iframe 的可交互元素
const scan = await page.evaluate(() => {
  const collect = (doc, label) => {
    const els = [];
    for (const e of doc.querySelectorAll('button, [role="button"], a[href], input[type="button"], input[type="submit"], [onclick], [class*="button" i], [class*="btn" i], [class*="clickable" i], [title]')) {
      if (!e.offsetWidth && !e.offsetHeight) continue;
      const r = e.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      els.push({
        label,
        tag: e.tagName.toLowerCase(),
        id: e.id || undefined,
        cls: String(e.className).slice(0, 50) || undefined,
        text: (e.innerText || e.title || e.value || '').replace(/\s+/g, ' ').trim().slice(0, 40) || '(icon)',
        x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2),
      });
    }
    return els;
  };
  const out = collect(document, 'main');
  return out;
});
console.log('[verify] 主文档可交互元素:', scan.length);
console.log(JSON.stringify(scan.slice(0, 40), null, 1));

// iframe 清单（MVU 状态栏/脚本 UI 在 iframe 里）
const frames = page.frames().map(f => ({ url: f.url().slice(0, 80), name: f.name() || '(main-if-frame)' }));
console.log('[verify] frames:', JSON.stringify(frames, null, 1));
await page.screenshot({ path: 'D:/DSH RolePlay/tmp/verify-current.png' });
console.log('[verify] console 尾部:', logs.slice(-4).join(' / ') || '(none)');
await browser.close();
