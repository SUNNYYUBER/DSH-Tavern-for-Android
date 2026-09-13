#!/usr/bin/env node
// golden-mvu-check.mjs — MVU 按钮单点复查（导航三重确认 + 15s 网络观察）
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// 【E2 脱敏 2026-09-13】原为硬编码本机路径（含用户名），改为环境变量可覆盖，避免泄露本机信息。
const ROOT = path.resolve(import.meta.dirname, '../..');   // 项目根，由本文件位置推导
const { chromium } = require(path.join(import.meta.dirname, '../tools-pw/node_modules/playwright-core'));
const EXE = process.env.DSHT_CHROME_EXE ?? '<path-to-chrome.exe>';
const ADB = process.env.DSHT_ADB ?? '<path-to-adb>';

function refreshToken() {
  try {
    execSync(`${ADB} -s emulator-5554 shell "run-as com.dshtavern.app cat files/.dsh/dsht-token" > "${path.join(ROOT, 'tmp/dsht-token.txt')}"`, { timeout: 20000 });
  } catch {}
  return fs.readFileSync(path.join(ROOT, 'tmp/dsht-token.txt'), 'utf8').trim();
}
const TOKEN = refreshToken();
const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-proxy-server'] });
const page = await browser.newPage();
const net = [];
page.on('request', r => { if (!/\.(png|js|css|ico|map)/.test(r.url())) net.push(`${r.method()} ${r.url().slice(0, 90)}`); });
page.on('console', m => { if (/error|失败|mvu/i.test(m.text())) net.push('[console] ' + m.text().slice(0, 140)); });

await page.goto(`http://127.0.0.1:43080/?token=${TOKEN}`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(15000);

async function navTo(reSrc, label) {
  // ① 点工作区行（最短匹配）
  const r1 = await page.evaluate((re) => {
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
    if (rows[0]) { document.elementFromPoint(rows[0].x, rows[0].y)?.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
    return rows[0] ? rows[0].len : 0;
  }, reSrc);
  await page.waitForTimeout(2500);
  // ② 点会话行（最长匹配，elementFromPoint 真实事件）
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
    if (rows[0]) { document.elementFromPoint(rows[0].x, rows[0].y)?.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  }, reSrc);
  const ok = await page.waitForSelector('textarea:not(.bhn1Oq_searchInput)', { state: 'attached', timeout: 60000 }).then(() => true).catch(() => false);
  console.log(`[mvu] ${label} 导航: wsLen=${r1} send_textarea=${ok}`);
  return ok;
}

let inChat = await navTo('wuwa|solaris', '第一次');
if (!inChat) {
  await page.reload().catch(() => {});
  await page.waitForTimeout(15000);
  inChat = await navTo('wuwa|solaris', '重试');
}
if (!inChat) {
  await page.screenshot({ path: path.join(ROOT, 'tmp/mvu-nav-fail.png') });
  console.log('[mvu] ❌ 两次导航都未进聊天——截图 mvu-nav-fail.png');
  await browser.close();
  process.exit(1);
}
await page.waitForTimeout(12000);
await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));

const btn = await page.evaluate(() => {
  for (const e of document.querySelectorAll('button, [role="button"], [class*="button" i], [class*="btn" i]')) {
    const t = (e.innerText || '').trim();
    if (/重新处理变量|重新读取初始变量/.test(t) && e.offsetWidth) { e.setAttribute('data-mvutest', '1'); return t.slice(0, 30); }
  }
  return null;
});
console.log('[mvu] 按钮找到:', btn);
if (!btn) { await page.screenshot({ path: path.join(ROOT, 'tmp/mvu-btn-missing.png') }); console.log('[mvu] 按钮不在主文档（可能在 iframe）——截图留证'); await browser.close(); process.exit(1); }

net.length = 0;
await page.evaluate(() => { document.querySelector('[data-mvutest="1"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
console.log('[mvu] 已点击，观察 15s…');
for (let s = 1; s <= 5; s++) {
  await page.waitForTimeout(3000);
  console.log(`[mvu] t+${s * 3}s: ${net.length} 事件 | ${net.slice(-2).join(' | ') || '(无)'}`);
}
await page.screenshot({ path: path.join(ROOT, 'tmp/mvu-btn-after.png') });
console.log('[mvu] 截图: mvu-btn-after.png');
await browser.close();
