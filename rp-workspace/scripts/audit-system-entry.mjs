#!/usr/bin/env node
/**
 * audit-system-entry.mjs — 守「系统轻入口」（W-8）的三条落地契约
 * ============================================================================
 * 【为什么需要它】W-8 的能力全部**横跨两个文件、且只有真机点得出来**：
 *   · 分享接收 = `AndroidManifest.xml` 的 `<intent-filter>` **声明** + `MainActivity`
 *     的 `handleIncomingIntent()` **分派** —— 两者必须**成对**。只声明不分派 ⇒
 *     系统面板里能选到本 App，点进去**什么都不会发生**（静默失效，P-30）；
 *     只分派不声明 ⇒ 面板里根本不出现本 App（同样静默）。
 *   · 快速设置磁贴 = manifest 的 `<service>` + intent-filter + TOGGLEABLE_TILE 元数据 +
 *     权限**四件齐全**才被 SystemUI 发现 —— 少任何一件，磁贴**在快捷面板里不出现**，
 *     而一切都编译通过、无任何报错。
 *
 * 这类「声明与实现必须成对、破了也不报错」的缺陷正是本项目 P-30/P-59 家族，
 * 且**只有真机手点才能发现**（成本高、容易漏）⇒ 必须有静态对账常驻。
 *
 * ---
 * 【判据】
 *   1. **分享面成对**：manifest 的 SEND filter 声明了哪些 mimeType，`handleIncomingIntent`
 *      就必须有对应的分派分支（zip/octet-stream 走 EXTRA_STREAM；text 前缀走 EXTRA_TEXT；
 *      图片走 EXTRA_STREAM）。反向也查：代码里分派的类型必须在 manifest 里声明过。
 *   2. **磁贴四件套齐全**：`<service android:name=".LanTileService">` 必须同时具备
 *      exported=true / BIND_QUICK_SETTINGS_TILE 权限 / ACTION_QS_TILE intent-filter /
 *      TOGGLEABLE_TILE 元数据。缺任一项 ⇒ 磁贴不出现且无报错。
 *   3. **磁贴落点存在**：磁贴 `onClick()` 调用的原生入口（本仓是
 *      `NodeService.restartForLanToggle`）必须在源码里真的存在 —— 否则编译期就断，
 *      但那条断点在**改 NodeService 的人**手里，磁贴作者看不见（跨文件契约）。
 *
 * 用法：node scripts/audit-system-entry.mjs [--selftest]
 * 退出码：0 = 契约完整；1 = 破约；2 = 文件缺失；3 = selftest 失败
 */

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const WS = resolve(HERE, '..')
const ANDROID_SRC = join(WS, 'android', 'app', 'src', 'main')
const MANIFEST = join(ANDROID_SRC, 'AndroidManifest.xml')
const MAIN = join(ANDROID_SRC, 'java', 'com', 'dshtavern', 'app', 'MainActivity.kt')
const TILE = join(ANDROID_SRC, 'java', 'com', 'dshtavern', 'app', 'LanTileService.kt')
const NODESVC = join(ANDROID_SRC, 'java', 'com', 'dshtavern', 'app', 'NodeService.kt')

/** 取 manifest 里 SEND intent-filter 内声明过的所有 mimeType。 */
export function parseSendMimes(manifestXml) {
  // 定位 SEND filter 块（从 ACTION_SEND 到它所在的 </intent-filter>）
  const m = manifestXml.match(/<action\s+android:name="android\.intent\.action\.SEND"\s*\/>([\s\S]*?)<\/intent-filter>/)
  if (!m) return []
  return [...m[1].matchAll(/<data\s+android:mimeType="([^"]+)"\s*\/>/g)].map((x) => x[1])
}

/** 取 handleIncomingIntent 的函数体（粗略：从函数签名到下一个同缩进的 `private fun` / 类闭合）。 */
export function parseShareDispatch(mainKt) {
  const start = mainKt.indexOf('private fun handleIncomingIntent(')
  if (start < 0) return null
  // 向下找第一个「顶格 4 空格的 private fun」或文件尾，作为函数体边界
  const rest = mainKt.slice(start)
  const next = rest.slice(1).search(/\n {4}(?:@|private fun|fun |override fun)/)
  return next < 0 ? rest : rest.slice(0, next + 1)
}

/** 取 LanTileService 的 service 声明块（manifest 里，从 name=".LanTileService" 到 </service>）。 */
export function parseTileBlock(manifestXml) {
  const m = manifestXml.match(/<service[^>]*android:name="\.LanTileService"[\s\S]*?<\/service>/)
  return m ? m[0] : null
}

export function audit({ manifestXml, mainKt, tileKt, nodeSvcKt }) {
  const problems = []
  const notes = []

  // ---- 判据 1：分享面成对 ----
  const mimes = parseSendMimes(manifestXml)
  if (mimes.length === 0) {
    problems.push('判据1: manifest 里找不到 SEND intent-filter 的 mimeType 声明（分享面缺失或被改名）')
  }
  const dispatch = parseShareDispatch(mainKt)
  if (dispatch === null) {
    problems.push('判据1: MainActivity 里找不到 handleIncomingIntent（声明了分享却没有分派 ⇒ 点进去什么都不发生）')
  } else {
    // 声明了 text/* ⇒ 代码里必须有 text 前缀分支
    const declaresText = mimes.some((t) => t.startsWith('text/'))
    const hasTextBranch = /startsWith\(\s*"text\/"\s*\)/.test(dispatch)
    if (declaresText && !hasTextBranch) {
      problems.push('判据1: manifest 声明了 text/* 分享，但 handleIncomingIntent 没有对应分派分支（静默失效）')
    }
    // 声明了 image/* ⇒ 代码里必须有 image 前缀判定（用于落盘名/分流）
    const declaresImage = mimes.some((t) => t.startsWith('image/'))
    const hasImageBranch = /startsWith\(\s*"image\/"\s*\)/.test(dispatch)
    if (declaresImage && !hasImageBranch) {
      problems.push('判据1: manifest 声明了 image/* 分享，但 handleIncomingIntent 没有对应分派分支（静默失效）')
    }
    // 代码里的前缀分派必须在 manifest 里有声明（反向：代码支持但系统面板不给入口）
    if (hasTextBranch && !declaresText) {
      problems.push('判据1: 代码支持 text/* 分享，但 manifest 未声明该 mimeType ⇒ 系统面板里根本不出现本 App')
    }
    if (hasImageBranch && !declaresImage) {
      problems.push('判据1: 代码支持 image/* 分享，但 manifest 未声明该 mimeType ⇒ 系统面板里根本不出现本 App')
    }
    // 文件/图片路径必须真的读 EXTRA_STREAM（否则图片收不到）
    if (declaresImage && !/EXTRA_STREAM/.test(dispatch)) {
      problems.push('判据1: 声明了图片分享，但分派里没有读 EXTRA_STREAM（收不到图片）')
    }
  }
  notes.push(`分享面：manifest 声明 ${mimes.length} 个 mimeType（${mimes.join(' / ')}）`)

  // ---- 判据 2：磁贴四件套 ----
  const block = parseTileBlock(manifestXml)
  if (block === null) {
    problems.push('判据2: manifest 里没有 LanTileService 的 <service> 声明（磁贴不会出现）')
  } else {
    const checks = [
      [/android:exported="true"/, 'exported="true"（SystemUI 是外部进程，false 则绑不上）'],
      [/android:permission="android\.permission\.BIND_QUICK_SETTINGS_TILE"/, 'BIND_QUICK_SETTINGS_TILE 权限'],
      [/android\.service\.quicksettings\.action\.QS_TILE/, 'QS_TILE intent-filter'],
      [/android\.service\.quicksettings\.TOGGLEABLE_TILE/, 'TOGGLEABLE_TILE 元数据'],
    ]
    for (const [re, label] of checks) {
      if (!re.test(block)) problems.push(`判据2: 磁贴 service 缺 ${label} —— 磁贴不会出现在快捷面板，且无任何报错`)
    }
  }
  if (!existsSync(TILE)) problems.push('判据2: LanTileService.kt 不存在（manifest 声明了但实现缺席 ⇒ 编译期就会断）')

  // ---- 判据 3：磁贴落点存在 ----
  if (existsSync(TILE) && existsSync(NODESVC)) {
    const called = [...tileKt.matchAll(/NodeService\.(\w+)\(/g)].map((x) => x[1])
    if (called.length === 0) {
      problems.push('判据3: LanTileService 没有调用任何 NodeService 入口（切 LAN 不会生效）')
    }
    for (const fn of new Set(called)) {
      if (!new RegExp(`fun\\s+${fn}\\s*\\(`).test(nodeSvcKt)) {
        problems.push(`判据3: 磁贴调用的 NodeService.${fn}() 在 NodeService 里不存在（跨文件契约断裂）`)
      }
    }
    notes.push(`磁贴落点：NodeService.${[...new Set(called)].join(' / ')}`)
  }

  return { problems, notes }
}

// ---------------------------------------------------------------------------
// selftest：正控 + 负控（合成输入）
// ---------------------------------------------------------------------------

function selftest() {
  const results = []
  const ok = (n, c) => results.push([n, !!c])

  const manifest = `
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application>
    <activity android:name=".MainActivity">
      <intent-filter>
        <action android:name="android.intent.action.SEND" />
        <category android:name="android.intent.category.DEFAULT" />
        <data android:mimeType="application/zip" />
        <data android:mimeType="text/plain" />
        <data android:mimeType="image/*" />
      </intent-filter>
    </activity>
    <service android:name=".LanTileService" android:exported="true"
        android:permission="android.permission.BIND_QUICK_SETTINGS_TILE">
      <intent-filter>
        <action android:name="android.service.quicksettings.action.QS_TILE" />
      </intent-filter>
      <meta-data android:name="android.service.quicksettings.TOGGLEABLE_TILE" android:value="true" />
    </service>
  </application>
</manifest>`

  const main = `
    private fun handleIncomingIntent(intent: Intent?) {
        val mime = intent.type ?: "application/octet-stream"
        if (mime.startsWith("text/")) { return }
        val uri = intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        val n = if (mime.startsWith("image/")) "img" else "zip"
    }

    private fun other() {}
`
  const tile = `
class LanTileService : TileService() {
    override fun onClick() { NodeService.restartForLanToggle(this) }
}`
  const nodesvc = `
    fun restartForLanToggle(ctx: Context) {}
    fun restartNode() {}`

  // 1) 正控
  ok('正控：契约完整时无问题',
    audit({ manifestXml: manifest, mainKt: main, tileKt: tile, nodeSvcKt: nodesvc }).problems.length === 0)

  // 2) 负控：声明了 text/* 但无分派（静默失效）
  ok('负控A：声明 text/* 却无分派 ⇒ 报红',
    audit({ manifestXml: manifest, mainKt: main.replace('mime.startsWith("text/")', 'false'), tileKt: tile, nodeSvcKt: nodesvc })
      .problems.some((p) => p.startsWith('判据1') && p.includes('text/')))

  // 3) 负控：代码支持 image/* 但 manifest 未声明（面板里不出现）
  ok('负控B：代码支持 image/* 但未声明 ⇒ 报红',
    audit({ manifestXml: manifest.replace('        <data android:mimeType="image/*" />\n', ''), mainKt: main, tileKt: tile, nodeSvcKt: nodesvc })
      .problems.some((p) => p.startsWith('判据1') && p.includes('image/')))

  // 4) 负控：磁贴缺 TOGGLEABLE_TILE 元数据
  ok('负控C：磁贴缺 TOGGLEABLE_TILE ⇒ 报红',
    audit({ manifestXml: manifest.replace(/<meta-data[\s\S]*?TOGGLEABLE_TILE[\s\S]*?\/>/, ''), mainKt: main, tileKt: tile, nodeSvcKt: nodesvc })
      .problems.some((p) => p.startsWith('判据2') && p.includes('TOGGLEABLE_TILE')))

  // 5) 负控：磁贴缺 enabled=false（绑不上）
  ok('负控D：磁贴 exported 非 true ⇒ 报红',
    audit({ manifestXml: manifest.replace('android:exported="true"', 'android:exported="false"'), mainKt: main, tileKt: tile, nodeSvcKt: nodesvc })
      .problems.some((p) => p.startsWith('判据2') && p.includes('exported')))

  // 6) 负控：磁贴调了不存在的 NodeService 入口
  ok('负控E：磁贴调用的 NodeService 入口不存在 ⇒ 报红',
    audit({ manifestXml: manifest, mainKt: main, tileKt: tile, nodeSvcKt: '    fun restartNode() {}' })
      .problems.some((p) => p.startsWith('判据3')))

  // 7) 负控：完全没有 SEND filter
  ok('负控F：无 SEND filter ⇒ 报红',
    audit({ manifestXml: '<manifest><application></application></manifest>', mainKt: main, tileKt: tile, nodeSvcKt: nodesvc })
      .problems.some((p) => p.startsWith('判据1')))

  let pass = 0
  for (const [n, good] of results) {
    console.log(`${good ? '  PASS' : '  FAIL'}  ${n}`)
    if (good) pass++
  }
  console.log(`selftest: ${pass}/${results.length}`)
  process.exit(pass === results.length ? 0 : 3)
}

if (process.argv.includes('--selftest')) selftest()

const missing = [MANIFEST, MAIN, TILE, NODESVC].filter((f) => !existsSync(f))
if (missing.length > 0) {
  console.error(`文件缺失：\n  ${missing.join('\n  ')}`)
  process.exit(2)
}

const r = audit({
  manifestXml: readFileSync(MANIFEST, 'utf8'),
  mainKt: readFileSync(MAIN, 'utf8'),
  tileKt: readFileSync(TILE, 'utf8'),
  nodeSvcKt: readFileSync(NODESVC, 'utf8'),
})
for (const n of r.notes) console.log(`  · ${n}`)

if (r.problems.length === 0) {
  console.log('PASS  系统轻入口契约完整（3 判据：分享面成对 / 磁贴四件套 / 落点存在）')
  process.exit(0)
}
for (const p of r.problems) console.error(`  ✗ ${p}`)
console.error(`\n系统轻入口破约：${r.problems.length} 处 —— 勿发货（真机上表现为「点了没反应」且无报错）`)
process.exit(1)
