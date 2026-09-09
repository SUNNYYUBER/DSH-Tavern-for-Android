#!/usr/bin/env node
// golden-candidates-check.mjs — 4 个真候选单点复查（15s 长窗 + 网络判据 + 前后截图）
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('D:/DSH RolePlay/rp-workspace/tools-pw/node_modules/playwright-core');
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';

function refreshToken() {
  try {
    execSync('C:/Users/Administrator/.android/sdk/platform-tools/adb.exe -s emulator-5554 shell "run-as com.dshtavern.app cat files/.dsh/dsht-token" > "D:/DSH RolePlay/tmp/dsht-token.txt"', { timeout: 20000 });
  } catch {}
  return fs.readFileSync('D:/DSH RolePlay/tmp/dsht-token.txt', 'utf8').trim();
}
const TOKEN = refreshToken();
const CANDIDATES = [
  { name: '重新处理变量', re: '重新处理变量' },
  { name: '重新读取初始变量', re: '重新读取初始变量' },
  { name: 'dream_plot 标签', re: 'dream_plot', anyTag: true },
  { name: '角色创建选项', re: '角色创建：我的名字是示例人设甲' },
];

const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-proxy-server'] });
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:43080/?token=${TOKEN}`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(15000);
// 导航（两段）
await page.evaluate((re) => {
  const rx = new RegExp(re, 'i');
  const rows = [];
  for (const e of document.querySelectorAll('div, span, a, button')) {
    if (!e.offsetWidth) continue;
    const t = (e.innerText || '').trim();
    if (!t || t.length >= 60 || !rx.test(t) || e.children.length > 3) continue;
    const r = e.getBoundingClientRect();
    rows.push({ x: r.x + r.width / 2, y: r.y + r.height / 2, len: t.length });
  }
  rows.sort((a, b) => a.len - b.len);
  if (rows[0]) document.elementFromPoint(rows[0].x, rows[0].y)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}, 'wuwa|solaris');
await page.waitForTimeout(2500);
await page.evaluate((re) => {
  const rx = new RegExp(re, 'i');
  const rows = [];
  for (const e of document.querySelectorAll('div, span, a, button')) {
    if (!e.offsetWidth) continue;
    const t = (e.innerText || '').trim();
    if (!t || t.length >= 60 || !rx.test(t) || e.children.length > 3) continue;
    const r = e.getBoundingClientRect();
    rows.push({ x: r.x + r.width / 2, y: r.y + r.height / 2, len: t.length });
  }
  rows.sort((a, b) => b.len - a.len);
  if (rows[0]) document.elementFromPoint(rows[0].x, rows[0].y)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}, 'wuwa|solaris');
let inChat = false;
for (let attempt = 1; attempt <= 3 && !inChat; attempt++) {
  inChat = await page.waitForSelector('textarea:not(.bhn1Oq_searchInput)', { state: 'attached', timeout: 60000 }).then(() => true).catch(() => false);
  if (!inChat && attempt < 3) {
    console.log(`[cand] 第 ${attempt} 次未进聊天，reload 重试…`);
    await page.reload().catch(() => {});
    await page.waitForTimeout(15000);
    await page.evaluate((re) => {
      const rx = new RegExp(re, 'i');
      const rows = [];
      for (const e of document.querySelectorAll('div, span, a, button')) {
        if (!e.offsetWidth) continue;
        const t = (e.innerText || '').trim();
        if (!t || t.length >= 60 || !rx.test(t) || e.children.length > 3) continue;
        const r = e.getBoundingClientRect();
        rows.push({ x: r.x + r.width / 2, y: r.y + r.height / 2, len: t.length });
      }
      rows.sort((a, b) => a.len - b.len);
      if (rows[0]) document.elementFromPoint(rows[0].x, rows[0].y)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }, 'wuwa|solaris');
    await page.waitForTimeout(2500);
    await page.evaluate((re) => {
      const rx = new RegExp(re, 'i');
      const rows = [];
      for (const e of document.querySelectorAll('div, span, a, button')) {
        if (!e.offsetWidth) continue;
        const t = (e.innerText || '').trim();
        if (!t || t.length >= 60 || !rx.test(t) || e.children.length > 3) continue;
        const r = e.getBoundingClientRect();
        rows.push({ x: r.x + r.width / 2, y: r.y + r.height / 2, len: t.length });
      }
      rows.sort((a, b) => b.len - a.len);
      if (rows[0]) document.elementFromPoint(rows[0].x, rows[0].y)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }, 'wuwa|solaris');
    await page.waitForTimeout(5000);
  }
}
console.log('[cand] 进聊天:', inChat);
{
  const inputs = await page.evaluate(() => Array.from(document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]')).map(e => ({ id: e.id, cls: String(e.className).slice(0, 40), ph: (e.placeholder || '').slice(0, 30), vis: !!(e.offsetWidth || e.offsetHeight) })));
  console.log('[cand] 输入区 DOM:', JSON.stringify(inputs, null, 1));
  await page.screenshot({ path: 'D:/DSH RolePlay/tmp/cand-state.png' });
}
if (!inChat) { await page.screenshot({ path: 'D:/DSH RolePlay/tmp/cand-nav-fail.png' }); await browser.close(); process.exit(1); }
await page.waitForTimeout(10000);
for (let k = 0; k < 2; k++) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
}
await page.waitForTimeout(3000);

for (const cand of CANDIDATES) {
  const found = await page.evaluate((re) => {
    const rx = new RegExp(re, 'i');
    for (const e of document.querySelectorAll('button, [role="button"], [class*="button" i], [class*="btn" i], [class*="clickable" i], summary, span, div')) {
      if (!e.offsetWidth) continue;
      const t = (e.innerText || '').trim();
      if (!t || t.length > 80 || !rx.test(t)) continue;
      const r = e.getBoundingClientRect();
      if (r.width <= 0) continue;
      e.setAttribute('data-cand', '1');
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), tag: e.tagName.toLowerCase() };
    }
    return null;
  }, cand.re);
  if (!found) { console.log(`[cand] "${cand.name}": 未找到（可能被面板遮挡/不在当前视图）`); continue; }
  const net = [];
  const onReq = r => { if (!/\.(png|js|css|ico|map)/.test(r.url())) net.push(r.url().slice(0, 80)); };
  page.on('request', onReq);
  await page.mouse.click(found.x, found.y);
  console.log(`[cand] "${cand.name}" @(${found.x},${found.y}) ${found.tag} 已点击，观察 15s…`);
  for (let s = 1; s <= 5; s++) {
    await page.waitForTimeout(3000);
    if (net.length) { console.log(`  t+${s * 3}s: ${net.length} 请求 | ${net.slice(-2).join(' | ')}`); }
  }
  page.off('request', onReq);
  console.log(`  → 15s 网络事件总数: ${net.length} ${net.length ? '→ 有响应（异步）' : '→ 无网络活动'}`);
  await page.screenshot({ path: `D:/DSH RolePlay/tmp/cand-${cand.name.slice(0, 6)}.png` });
}
await browser.close();
console.log('[cand] 完成');
