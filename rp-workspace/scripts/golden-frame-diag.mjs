#!/usr/bin/env node
// golden-frame-diag.mjs — 抓 TH 脚本 iframe 内的完整错误与全局缺失清单
import fs from 'node:fs';
const TOKEN = fs.readFileSync('D:/DSH RolePlay/tmp/dsht-token.txt', 'utf8').trim();
const { chromium } = await (async () => {
  const require = (await import('node:module')).createRequire(import.meta.url);
  return require('D:/DSH RolePlay/rp-workspace/tools-pw/node_modules/playwright-core');
})();
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';

const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-proxy-server'] });
const page = await browser.newPage();
const frameErrors = [];
page.on('console', m => {
  const loc = m.location()?.url?.slice(0, 40) ?? '';
  frameErrors.push(`[${m.type()}][${loc}] ${m.text().slice(0, 200)}`);
});
page.on('pageerror', e => frameErrors.push(`[pageerror] ${e.message.slice(0, 200)}`));
const badApi = [];
page.on('response', async r => {
  if (r.status() >= 400 && /dsht-tavern|dsht-rp|variables|preset|worldbook|chat/i.test(r.url())) {
    let reqBody = '';
    try { reqBody = r.request().postData()?.slice(0, 300) ?? ''; } catch {}
    let resBody = '';
    try { resBody = (await r.text()).slice(0, 200); } catch {}
    const fr = r.request().frame();
    const frameTag = fr ? (fr === fr.page().mainFrame() ? 'MAIN' : `iframe:${fr.url().slice(0, 30)}`) : '?';
    badApi.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 90)} [frame=${frameTag}]\n  req: ${reqBody}\n  res: ${resBody}`);
  }
});

await page.goto(`http://127.0.0.1:43080/?token=${TOKEN}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(12000);
const click = await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll('a, [role="button"], div, span'))
    .filter(e => e.offsetWidth && /wuwa|solaris/i.test((e.innerText || '').trim()) && (e.innerText || '').trim().length < 60);
  items[0]?.click();
  return items.length;
});
console.log('[diag] 侧栏命中:', click);
await page.waitForTimeout(15000);

// 每个 iframe 内检查常见依赖全局
for (const f of page.frames()) {
  if (f === page.mainFrame()) continue;
  try {
    const check = await f.evaluate(() => {
      const g = (n) => { try { return typeof window[n]; } catch { return 'blocked'; } };
      return {
        url: location.href.slice(0, 50),
        vue: g('Vue'), jquery: g('jQuery'), $: g('$'), z: g('z'), lodash: g('_'),
        toastr: g('toastr'), YAML: g('YAML'), SillyTavern: g('SillyTavern'),
        eventSource: g('eventSource'), documentHaveScripts: document.querySelectorAll('script').length,
      };
    });
    console.log('[frame]', JSON.stringify(check));
  } catch (e) { console.log('[frame] eval fail:', e.message.slice(0, 80)); }
}
console.log('--- 4xx 桥调用（req/res）---');
console.log(badApi.slice(0, 8).join('\n---\n') || '(none)');
console.log('--- frame console/error（全部）---');
console.log(frameErrors.filter(l => /error|not defined|failed|golden|vue/i.test(l)).slice(0, 20).join('\n') || '(none)');
await browser.close();
