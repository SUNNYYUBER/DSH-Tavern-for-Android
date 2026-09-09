#!/usr/bin/env node
// golden-panel-check.mjs — 心跳 12：开面板→点面板内按钮（重新处理/读取初始变量）
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
const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-proxy-server'] });
const page = await browser.newPage();
const net = [];
page.on('request', r => { if (!/\.(png|js|css|ico|map)/.test(r.url())) net.push(`${r.method()} ${r.url().slice(0, 90)}`); });
page.on('console', m => { if (/error|失败/i.test(m.text())) net.push('[console] ' + m.text().slice(0, 140)); });

await page.goto(`http://127.0.0.1:43080/?token=${TOKEN}`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
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
const inChat = await page.waitForSelector('textarea:not(.bhn1Oq_searchInput)', { state: 'attached', timeout: 60000 }).then(() => true).catch(() => false);
console.log('[panel] 进聊天:', inChat);
if (!inChat) { await page.screenshot({ path: 'D:/DSH RolePlay/tmp/panel-nav-fail.png' }); await browser.close(); process.exit(1); }
await page.waitForTimeout(10000);

// 找目标按钮（全 frame）
async function findTargets() {
  const found = [];
  for (const f of page.frames()) {
    try {
      const els = await f.evaluate(() => {
        const out = [];
        for (const e of document.querySelectorAll('button, [role="button"], [class*="button" i], [class*="btn" i], div[onclick], span[onclick]')) {
          if (!e.offsetWidth) continue;
          const t = (e.innerText || '').trim();
          if (/重新处理变量|重新读取初始变量/.test(t) && t.length < 40) {
            const mark = 'pt' + Math.random().toString(36).slice(2, 8);
            e.setAttribute('data-pt', mark);
            out.push({ mark, text: t.slice(0, 30) });
          }
        }
        return out;
      });
      for (const el of els) found.push({ frame: f, ...el });
    } catch {}
  }
  return found;
}

let targets = await findTargets();
console.log('[panel] 直接扫描命中:', targets.length, targets.map(t => t.text).join(' / '));

if (!targets.length) {
  // 逐步开面板：①📋 ExampleGame 世界书控制 ②🎬 重新加载 ③重新最外层逻辑析
  for (const opener of ['ExampleGame 世界书控制', '重新加载', '重新最外层逻辑析']) {
    const opened = await page.evaluate((label) => {
      for (const e of document.querySelectorAll('button, [role="button"], [class*="button" i]')) {
        if (!e.offsetWidth) continue;
        const t = (e.innerText || '').trim();
        if (t.includes(label)) { e.click(); return true; }
      }
      return false;
    }, opener);
    if (!opened) { console.log(`[panel] 开面板按钮未找到: ${opener}`); continue; }
    console.log(`[panel] 已点开: ${opener}，等 5s 再扫…`);
    await page.waitForTimeout(5000);
    targets = await findTargets();
    if (targets.length) { console.log('[panel] 面板内命中:', targets.map(t => t.text).join(' / ')); break; }
  }
}

if (!targets.length) {
  await page.screenshot({ path: 'D:/DSH RolePlay/tmp/panel-no-target.png' });
  console.log('[panel] ❌ 各面板均未找到目标按钮——截图 panel-no-target.png');
  await browser.close();
  process.exit(1);
}

for (const t of targets.slice(0, 2)) {
  net.length = 0;
  let err = '';
  try { await t.frame.locator(`[data-pt="${t.mark}"]`).click({ force: true, timeout: 3000 }); } catch (e) { err = e.message.slice(0, 50); }
  console.log(`[panel] 点击 "${t.text}" ${err ? 'ERR:' + err : 'ok'}，观察 15s…`);
  for (let s = 1; s <= 5; s++) {
    await page.waitForTimeout(3000);
    console.log(`  t+${s * 3}s: ${net.length} | ${net.slice(-2).join(' | ') || '(无)'}`);
  }
  console.log(`  → "${t.text}" 15s 网络事件: ${net.length} ${net.length ? '→ 有响应' : '→ 无网络活动'}`);
  await page.screenshot({ path: `D:/DSH RolePlay/tmp/panel-${t.text.slice(0, 8)}.png` });
}
await browser.close();
console.log('[panel] 完成');
