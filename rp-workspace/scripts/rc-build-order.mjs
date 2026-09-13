#!/usr/bin/env node
/**
 * rc-build-order.mjs — build-wb.sh 产物覆盖顺序 · 反控（心跳 75）
 * ============================================================================
 * 验证的不变量（T-85 的真根因）：
 *   `build-wb.sh` 里「assets 整树同步」**不得**发生在「esbuild 编译 app.js」之后 ——
 *   否则会用 `packages/src/dsh-plugin/assets/app.js`（提交进仓库的**可能陈旧**产物）
 *   覆盖掉刚编译出来的新产物 ⇒ 构建"成功"、断言全绿，而设备跑的是旧代码。
 *
 * 真跑方式（不真跑构建，而是**在同一份文件系统上模拟这两步**）：
 *   ① 造一个临时的「源目录」与「产物目录」，源里放**陈旧** app.js（标记 OLD），
 *      产物目录放**新** app.js（标记 NEW）。
 *   ② 按**修复前**的顺序执行（编译 → 整树覆盖）⇒ 断言结果是 OLD（复现缺陷）。
 *   ③ 按**修复后**的顺序执行（同步[排除 app.js] → 编译）⇒ 断言结果是 NEW（缺陷消失）。
 *
 * 用法：node scripts/rc-build-order.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WS = path.resolve(HERE, '..')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-buildorder-'))

const results = []
const check = (ok, label, extra = '') => { results.push({ ok, label }); console.log(`${ok ? '✓' : '✗'} ${label}${extra ? '  — ' + extra : ''}`) }

// 造场景：src/assets/app.js = 陈旧；编译产物 = 新
const srcAssets = path.join(TMP, 'src-assets')
const dstAssets = path.join(TMP, 'dst-assets')
fs.mkdirSync(srcAssets, { recursive: true })
fs.mkdirSync(dstAssets, { recursive: true })
fs.writeFileSync(path.join(srcAssets, 'app.js'), 'OLD_ARTIFACT')
fs.writeFileSync(path.join(srcAssets, 'import-center.html'), '<html>static</html>')
fs.writeFileSync(path.join(dstAssets, 'app.js'), 'NEW_ARTIFACT')

const readDst = () => fs.readFileSync(path.join(dstAssets, 'app.js'), 'utf8')

/**
 * 纯 Node 实现「整树复制」，不依赖 bash（WSL bash 在本机不可靠）。
 * 复刻 `cp -r src/. dst/` 的语义：递归覆盖同名文件。
 */
function copyTree (srcDir, dstDir, excludeName = null) {
  fs.mkdirSync(dstDir, { recursive: true })
  for (const e of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (excludeName !== null && e.name === excludeName) continue
    const s = path.join(srcDir, e.name)
    const d = path.join(dstDir, e.name)
    if (e.isDirectory()) copyTree(s, d, excludeName)
    else fs.copyFileSync(s, d)
  }
}

/** 旧顺序：编译（产出 NEW）→ 整树 cp（用 OLD 覆盖） */
function oldOrder () {
  fs.writeFileSync(path.join(dstAssets, 'app.js'), 'NEW_ARTIFACT')   // 模拟 esbuild
  copyTree(srcAssets, dstAssets)                                      // 旧 A13：整树（含 app.js）
}
/** 新顺序：同步（排除 app.js）→ 编译（产出 NEW，不再被覆盖） */
function newOrder () {
  copyTree(srcAssets, dstAssets, 'app.js')                            // 新 A13：排除 app.js
  fs.writeFileSync(path.join(dstAssets, 'app.js'), 'NEW_ARTIFACT')    // 模拟 [2/6] esbuild
}

// ① 复现缺陷
oldOrder()
check(readDst() === 'OLD_ARTIFACT', '旧顺序复现缺陷：整树覆盖把新产物换成了陈旧副本', `实得 ${readDst()}`)

// ② 验证修复
fs.writeFileSync(path.join(dstAssets, 'app.js'), 'OLD_ARTIFACT')  // 复位
newOrder()
check(readDst() === 'NEW_ARTIFACT', '新顺序消除缺陷：新产物未被陈旧副本覆盖', `实得 ${readDst()}`)
check(fs.readFileSync(path.join(dstAssets, 'import-center.html'), 'utf8') === '<html>static</html>',
  '新顺序仍同步了静态资产（import-center.html 到位，未因排除 app.js 而漏拷）')

// ③ 静态断言：build-wb.sh 里 A13 必须在 [2/6] esbuild 之前
const sh = fs.readFileSync(path.join(WS, 'scripts/build-wb.sh'), 'utf8')
const a13At = sh.indexOf('say "[A13]')
const esbAt = sh.indexOf('say "[2/6]')
check(a13At > 0 && esbAt > 0 && a13At < esbAt, 'build-wb.sh：A13（assets 同步）在 [2/6]（esbuild）之前',
  `A13@${a13At} vs [2/6]@${esbAt}`)
check(/find \. -type f ! -name 'app\.js'/.test(sh), 'build-wb.sh：A13 明确排除 app.js（不被陈旧副本覆盖）')

fs.rmSync(TMP, { recursive: true, force: true })
const pass = results.filter(r => r.ok).length
console.log(`\n[rc-build-order] ${pass}/${results.length} PASS`)
process.exit(pass === results.length ? 0 : 1)
