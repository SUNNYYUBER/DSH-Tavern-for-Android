#!/usr/bin/env node
// golden-verify.mjs — 逐元素点击验证（心跳 5 主工具）
// 用法: node golden-verify.mjs probe|verify [卡名正则]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// 【E2 脱敏 2026-09-13】原为硬编码本机路径（含用户名），改为环境变量可覆盖，避免泄露本机信息。
const ROOT = path.resolve(import.meta.dirname, '../..');   // 项目根，由本文件位置推导
const { chromium } = require(path.join(import.meta.dirname, '../tools-pw/node_modules/playwright-core'));
const EXE = process.env.DSHT_CHROME_EXE ?? '<path-to-chrome.exe>';
const ADB = process.env.DSHT_ADB ?? '<path-to-adb>';
const { execSync } = await import('node:child_process');
function refreshToken() {
  try {
    execSync(`${ADB} -s emulator-5554 shell "run-as com.dshtavern.app cat files/.dsh/dsht-token" > "${path.join(ROOT, 'tmp/dsht-token.txt')}"`, { timeout: 20000 });
  } catch (e) { console.log('[verify] token 刷新失败:', e.message.slice(0, 60)); }
  return fs.readFileSync(path.join(ROOT, 'tmp/dsht-token.txt'), 'utf8').trim();
}
const TOKEN = refreshToken();
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
await page.screenshot({ path: path.join(ROOT, 'tmp/verify-current.png') });
console.log('[verify] console 尾部:', logs.slice(-4).join(' / ') || '(none)');

// verify 模式：逐元素点击 + 响应判定
if (CMD === 'verify') {
  const TOKEN2 = refreshToken();
  await page.goto(`http://127.0.0.1:43080/?token=${TOKEN2}`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(15000);
  // 进 wuwa
  await page.evaluate((re) => {
    const rx = new RegExp(re, 'i');
    const items = Array.from(document.querySelectorAll('a, [role="button"], div, span'))
      .filter(e => e.offsetWidth && rx.test((e.innerText || '').trim()) && (e.innerText || '').trim().length < 60);
    items[0]?.click();
  }, CARD_RE.source);
  await page.waitForTimeout(5000);
  await page.waitForSelector('#send_textarea', { state: 'visible', timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(12000);

  // 收集主文档可交互元素（可见、视口内或可滚动到）
  const els = await page.evaluate(() => {
    const out = [];
    const seen = new Set();
    for (const e of document.querySelectorAll('button, [role="button"], [onclick], [class*="button" i], [class*="btn" i]')) {
      if (!e.offsetWidth && !e.offsetHeight) continue;
      const r = e.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || r.bottom < 0) continue;
      const key = (e.id || '') + '|' + String(e.className).slice(0, 40) + '|' + (e.innerText || '').slice(0, 20);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ i: out.length, tag: e.tagName.toLowerCase(), cls: String(e.className).slice(0, 45), text: (e.innerText || e.title || '').replace(/\s+/g, ' ').trim().slice(0, 36) || '(icon)', x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
    }
    return out;
  });
  console.log('[verify] 待测元素:', els.length);
  if (!els.length) {
    const diag = await page.evaluate(() => ({
      url: location.href.slice(0, 70),
      bodyHead: document.body.innerText.replace(/\s+/g, ' ').slice(0, 250),
      ta: !!document.querySelector('#send_textarea'),
    }));
    console.log('[verify] 0元素诊断:', JSON.stringify(diag));
    await page.screenshot({ path: path.join(ROOT, 'tmp/verify-0elem.png') });
  }
  const results = [];
  for (const el of els) {
    const before = {
      reqs: 0, dom: '',
    };
    const netCounter = { n: 0 };
    const onReq = () => { netCounter.n++; };
    page.on('request', onReq);
    const domBefore = await page.evaluate(() => document.body.innerHTML.length + ':' + document.querySelectorAll('iframe').length);
    try {
      await page.mouse.click(el.x, el.y);
    } catch { /* 越界等 */ }
    await page.waitForTimeout(2000);
    const domAfter = await page.evaluate(() => document.body.innerHTML.length + ':' + document.querySelectorAll('iframe').length);
    page.off('request', onReq);
    const responded = netCounter.n > 0 || domBefore !== domAfter;
    results.push({ ...el, responded, net: netCounter.n });
    console.log(`[verify] ${responded ? '响应' : '无响应'} net=${netCounter.n} | ${el.tag} ${el.cls.slice(0, 30)} "${el.text}" @(${el.x},${el.y})`);
  }
  const fail = results.filter(r => !r.responded);
  console.log(`[verify] === 汇总: ${results.length - fail.length}/${results.length} 响应，${fail.length} 无响应 ===`);
  fs.writeFileSync(path.join(ROOT, 'loop-mvu-interact/verify-report.json'), JSON.stringify({ ts: new Date().toISOString(), total: results.length, failed: fail, all: results }, null, 1));
  console.log('[verify] 报告: loop-mvu-interact/verify-report.json');
  await browser.close();
  process.exit(0);
}

await browser.close();
