#!/usr/bin/env node
// golden-import.mjs — 驱动 DSHT 导入中心：上传 tauritavern-data zip → 观察流转
// 用法: node golden-import.mjs [zip路径]
import path from 'node:path';

const ZIP = process.argv[2] ?? 'C:/Users/Administrator/Documents/xwechat_files/wxid_EXAMPLE123456_4649/msg/file/2026-09/tauritavern-data-20260903-162517.zip';
const { chromium } = await (async () => {
  const require = (await import('node:module')).createRequire(import.meta.url);
  return require('D:/DSH RolePlay/rp-workspace/tools-pw/node_modules/playwright-core');
})();
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage();
const logs = [];
page.on('console', m => logs.push(m.text()));
const apiCalls = [];
page.on('response', r => { if (/import|staging|upload|kickoff/i.test(r.url())) apiCalls.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 100)}`); });
page.on('requestfailed', r => { if (/import|staging|upload/i.test(r.url())) apiCalls.push(`FAIL ${r.url().slice(0, 100)}`); });

await page.goto('http://127.0.0.1:43080/dsht-rp/import-center', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('#zipFile', { state: 'attached', timeout: 30000 });
console.log('[import] 页面就绪，上传 zip…');
await page.setInputFiles('#zipFile', ZIP);
await page.evaluate(() => {
  const el = document.querySelector('#zipFile');
  el.dispatchEvent(new Event('change', { bubbles: true }));
  if (typeof window.handleFile === 'function') { try { window.handleFile(el, 'zip', 'zipResult'); } catch (e) { console.log('handleFile direct:', e.message); } }
});

// 观察流转：每 5s 抓一次页面状态（按钮/文本/进度），连续 3 次无变化且出现"待点击"则打印
let last = '';
const clicked = new Set();
for (let t = 0; t < 240; t += 1) {
  await page.waitForTimeout(5000);
  const st = await page.evaluate(() => ({
    text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 400),
    buttons: Array.from(document.querySelectorAll('button')).map(x => x.textContent.trim()).filter(Boolean).slice(0, 10),
    hasFileStage: !!document.querySelector('#zipFile'),
  }));
  const sig = st.text.slice(0, 150) + '|' + st.buttons.join(',');
  if (sig !== last) {
    console.log(`[import t+${(t + 1) * 5}s]`, JSON.stringify(st, null, 1).slice(0, 600));
    last = sig;
  }
  const go = st.buttons.find(b => /开始导入|开始适配|确认导入|下一步|开始迁移|导入$/.test(b));
  if (go && !clicked.has(go)) {
    clicked.add(go);
    console.log('[import] 自动点击(去重):', go);
    await page.evaluate((label) => {
      const btn = Array.from(document.querySelectorAll('button')).find(x => x.textContent.trim() === label);
      btn?.click();
    }, go);
    await page.waitForTimeout(2000);
  }
}
const tail = await page.evaluate(() => ({
  zipResult: document.querySelector('#zipResult')?.innerText?.replace(/\s+/g, ' ').slice(0, 400) ?? '(无)',
  anyResult: Array.from(document.querySelectorAll('[id*=Result], [class*=result]')).map(x => x.id + ':' + x.innerText.replace(/\s+/g, ' ').slice(0, 100)).filter(x => x.split(':')[1].trim() !== '(无)').slice(0, 5),
}));
console.log('[import] zipResult:', JSON.stringify(tail, null, 1));
console.log('[import] API 调用:', apiCalls.slice(0, 10).join('\n') || '(无)');
console.log('[import] console 尾部:', logs.slice(-8).join(' / '));
await browser.close();
