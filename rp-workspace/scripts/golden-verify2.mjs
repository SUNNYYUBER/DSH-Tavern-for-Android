#!/usr/bin/env node
// golden-verify2.mjs — 逐元素点击验证 v2
// v2 升级：①主文档+全部子 iframe 元素覆盖（MVU 状态栏/TH 脚本 UI 在 iframe 里）
//         ②响应判定 = MutationObserver 计数（点击前后 2s 的 DOM 突变，含 class/attribute 变化）
// 用法: node golden-verify2.mjs [卡名正则=wuwa|solaris]
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('D:/DSH RolePlay/rp-workspace/tools-pw/node_modules/playwright-core');
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const CARD_RE = new RegExp(process.argv[2] ?? 'wuwa|solaris', 'i');

function refreshToken() {
  try {
    execSync('C:/Users/Administrator/.android/sdk/platform-tools/adb.exe -s emulator-5554 shell "run-as com.dshtavern.app cat files/.dsh/dsht-token" > "D:/DSH RolePlay/tmp/dsht-token.txt"', { timeout: 20000 });
  } catch (e) { console.log('[v2] token 刷新失败:', e.message.slice(0, 60)); }
  return fs.readFileSync('D:/DSH RolePlay/tmp/dsht-token.txt', 'utf8').trim();
}
const TOKEN = refreshToken();

const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-proxy-server'] });
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:43080/?token=${TOKEN}`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(15000);
// 两段导航：①点工作区行（展开）②点会话行（进聊天）——坐标点击，避免 React 合成事件吞 click
const nav = await page.evaluate((re) => {
  const rx = new RegExp(re, 'i');
  const rows = [];
  for (const e of document.querySelectorAll('div, span, a, button')) {
    if (!e.offsetWidth) continue;
    const t = (e.innerText || '').trim();
    if (!t || t.length >= 60 || !rx.test(t)) continue;
    // 取最内层匹配行（children 不再包含更长同文本）
    if (e.children.length > 3) continue;
    const r = e.getBoundingClientRect();
    rows.push({ x: r.x + r.width / 2, y: r.y + r.height / 2, text: t, len: t.length });
  }
  rows.sort((a, b) => a.len - b.len);
  return rows;
}, CARD_RE.source);
if (!nav.length) throw new Error('侧栏未找到目标卡行');
// ① 先点最短文本的（工作区行）
console.log('[v2] 点工作区行:', nav[0].text);
await page.mouse.click(nav[0].x, nav[0].y);
await page.waitForTimeout(2500);
// ② 再点最长文本的（会话行，带后缀）
const nav2 = await page.evaluate((re) => {
  const rx = new RegExp(re, 'i');
  const rows = [];
  for (const e of document.querySelectorAll('div, span, a, button')) {
    if (!e.offsetWidth) continue;
    const t = (e.innerText || '').trim();
    if (!t || t.length >= 60 || !rx.test(t)) continue;
    if (e.children.length > 3) continue;
    const r = e.getBoundingClientRect();
    rows.push({ x: r.x + r.width / 2, y: r.y + r.height / 2, text: t, len: t.length });
  }
  rows.sort((a, b) => b.len - a.len);
  return rows;
}, CARD_RE.source);
if (nav2.length && nav2[0].len > nav[0].len) {
  console.log('[v2] 点会话行:', nav2[0].text);
  await page.mouse.click(nav2[0].x, nav2[0].y);
}
await page.waitForTimeout(5000);
await page.waitForSelector('#send_textarea', { state: 'visible', timeout: 90000 }).catch(() => {});
await page.waitForTimeout(12000);
await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));

// 挂 MutationObserver（每个 frame）
async function armFrame(f) {
  try {
    await f.evaluate(() => {
      window.__mc = 0;
      if (!window.__mo) {
        window.__mo = new MutationObserver(ms => { window.__mc += ms.length; });
        window.__mo.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
      }
      window.__mc = 0;
    });
    return true;
  } catch { return false; }
}
async function readFrame(f) {
  try { return await f.evaluate(() => window.__mc ?? -1); } catch { return -1; }
}

// 收集元素（主文档 + 所有 frame），注入标记
const targets = [];
let idx = 0;
for (const f of page.frames()) {
  const isMain = f === page.mainFrame();
  try {
    const els = await f.evaluate(() => {
      const out = [];
      for (const e of document.querySelectorAll('button, [role="button"], [onclick], [class*="button" i], [class*="btn" i], [class*="clickable" i], summary, details > summary')) {
        if (!e.offsetWidth && !e.offsetHeight) continue;
        const r = e.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        const key = e.tagName + '|' + String(e.className).slice(0, 30) + '|' + (e.innerText || '').slice(0, 16);
        if (out.some(o => o.key === key)) continue;
        // 聚焦过滤器：只测卡交互元素（有文本的按钮/状态栏类），跳过纯 icon 与重复
        const hasText = (e.innerText || '').trim().length > 0;
        const isRpish = /mvu|status|rp|th|script/i.test(String(e.className));
        if (!hasText && !isRpish) continue;
        const mark = 'vfy' + Math.random().toString(36).slice(2, 8);
        e.setAttribute('data-vfy', mark);
        out.push({ mark, tag: e.tagName.toLowerCase(), cls: String(e.className).slice(0, 40), text: (e.innerText || e.title || '').replace(/\s+/g, ' ').trim().slice(0, 36) || '(icon)' });
      }
      return out;
    });
    for (const el of els) targets.push({ frame: f, isMain, ...el, n: idx++ });
  } catch (e) { console.log('[v2] frame 收集失败:', e.message.slice(0, 50)); }
}
console.log(`[v2] 待测元素（含 iframe）: ${targets.length}`);
for (const t of targets) console.log(`  #${t.n} [${t.isMain ? 'main' : 'iframe'}] <${t.tag}> ${t.cls.slice(0, 30)} "${t.text}"`);

// 逐元素点击 + MutationObserver 判定
const results = [];
for (const t of targets) {
  await armFrame(t.frame).catch(() => {});
  let clickErr = '';
  try {
    await t.frame.locator(`[data-vfy="${t.mark}"]`).click({ force: true, timeout: 2000 });
  } catch (e) { clickErr = e.message.slice(0, 40); }
  await page.waitForTimeout(1500);
  const mc = await readFrame(t.frame);
  const responded = !clickErr && mc > 0;
  results.push({ ...t, frameUrl: t.isMain ? 'main' : t.frame.url().slice(0, 50), responded, mc, clickErr });
  console.log(`[v2] ${responded ? '响应' : '无响应'} mut=${mc} | #${t.n} [${t.isMain ? 'main' : 'iframe'}] "${t.text}" ${clickErr ? 'clickErr:' + clickErr : ''}`);
  // 清标记
  try { await t.frame.evaluate(m => { document.querySelector(`[data-vfy="${m}"]`)?.removeAttribute('data-vfy'); }, t.mark); } catch {}
}
const fail = results.filter(r => !r.responded);
console.log(`[v2] === 汇总: ${results.length - fail.length}/${results.length} 响应，${fail.length} 无响应 ===`);
fs.writeFileSync('D:/DSH RolePlay/loop-mvu-interact/verify-report-v2.json', JSON.stringify({ ts: new Date().toISOString(), card: CARD_RE.source, total: results.length, failed: fail, all: results }, null, 1));
console.log('[v2] 报告: loop-mvu-interact/verify-report-v2.json');
await browser.close();
