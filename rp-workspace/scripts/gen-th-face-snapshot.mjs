#!/usr/bin/env node
/**
 * gen-th-face-snapshot.mjs — 刷新「真 TH 裸全局面」快照（`scripts/data/th-bare-global-face.json`）
 * ============================================================================
 * 谁用它：`audit-th-face-coverage.mjs`（构建期门禁第 11 项）默认读该快照作基准。
 *
 * ## 为什么需要「快照」这一层（而不是每次现算）
 * GOAL.md **B8**：「仓库外副本可读、可同步，但**不作为主仓依赖**」。真 TH 的
 * `@types` 在开发者的 ST 安装目录里（本机 `$env:TH_ROOT`），CI / 无副本的机器上没有
 * ⇒ 若门禁只能现算，那些机器上会**永远拿不到基准**（要么红、要么被迫静默跳过 —— 后者
 * 会让门禁悄悄变成永远绿，正是 P-11 要防的）。
 * ⇒ 快照进仓库当**默认基准**；`TH_ROOT` 存在时门禁**以现场为准**并与快照对账（漂移即出声）。
 *
 * ## 数据来源（两级，缺一不可）
 *   ① **面清单** = 真 TH 官方 `@types/function/*.d.ts`
 *      · TavernHelper 对象成员（`readonly X: …`）
 *      · 裸全局声明（`declare function|const|let|var X`）
 *   ② **产物核实** = `dist/index.js` 里逐个查**运行时键**（对象键 / `_bind` 键 /
 *      `function` 形态 / 赋值形态）
 *      —— 剔除「只在 `.d.ts`、运行时不存在」的声明（实测 3 项，含 1 处明显笔误
 *      `updatelorebookEntriesWith` 小写 l）⇒ 那 3 项**不是缺口**，报出来会永远无法收敛
 *      （P-17：区分「事实是否定」与「我们测不出来」）。
 *
 * ## 为什么是「TavernHelper 成员 + 裸全局声明」
 * 真 TH 的裸全局机制（`JS-Slash-Runner/src/iframe/predefine.js:11-19`）把**父页
 * TavernHelper 对象的全部键**（+ `_bind` 去下划线键）合并进脚本 iframe 的 window
 * ⇒ **裸全局面 = TavernHelper 成员集**，是有限、可枚举、有官方声明为证的集合。
 *
 * 用法：
 *   $env:TH_ROOT = '<JS-Slash-Runner 目录>'; node scripts/gen-th-face-snapshot.mjs
 * 退出码：0 = 已写出；2 = 基准副本不可达（**不静默**）。
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const TH_ROOT = process.env.TH_ROOT ?? ''

if (TH_ROOT === '') {
  console.error('[gen-face] 需要 $env:TH_ROOT 指向 JS-Slash-Runner 目录（真 TH 的 @types 所在）')
  console.error('           不静默给结论 —— 属配置问题，exit 2。')
  process.exit(2)
}

/** 读 `{ ... }` 平衡块里的顶层成员名（`readonly X: …`） */
function tavernHelperMembers(dir) {
  const idx = readFileSync(join(dir, 'index.d.ts'), 'utf8')
  return [...idx.matchAll(/^\s*readonly\s+([A-Za-z_$][\w$]*)\s*:/gm)].map((m) => m[1])
}

/** 读各 .d.ts 里的 `declare function|const|let|var X` */
function bareDeclarations(dir) {
  const out = new Set()
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.d.ts'))) {
    const text = readFileSync(join(dir, f), 'utf8')
    for (const m of text.matchAll(/^\s*declare\s+(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) out.add(m[1])
  }
  return out
}

/**
 * 产物里是否存在该名字的**运行时键**。
 * 四种形态都查：对象字面量键 `X:` / `_bind` 键 `_X:` / `function X(` / 赋值 `X =`。
 */
function hasRuntimeKey(dist, name) {
  const esc = name.replace(/\$/g, '\\$')
  return new RegExp('(?<![\\w$])' + esc + '\\s*:').test(dist)
    || new RegExp('_' + esc + '\\s*:').test(dist)
    || new RegExp('function\\s+' + esc + '\\s*\\(').test(dist)
    || new RegExp('(?<![\\w$.])' + esc + '\\s*=').test(dist)
}

const typesDir = join(TH_ROOT, '@types', 'function')
let members
let bare
let dist
try {
  members = tavernHelperMembers(typesDir)
  bare = bareDeclarations(typesDir)
  dist = readFileSync(join(TH_ROOT, 'dist', 'index.js'), 'utf8')
} catch (e) {
  console.error(`[gen-face] 基准副本读取失败（${String(e.message).slice(0, 160)}）`)
  console.error('           期望结构：<TH_ROOT>/@types/function/*.d.ts 与 <TH_ROOT>/dist/index.js')
  process.exit(2)
}

const union = [...new Set([...members, ...bare])].sort()
const face = union.filter((n) => hasRuntimeKey(dist, n))
const dropped = union.filter((n) => !hasRuntimeKey(dist, n))

const out = {
  _comment: '真 TH 裸全局面快照。判据见 scripts/audit-th-face-coverage.mjs（真跑 shim + 枚举 window）。刷新见 scripts/gen-th-face-snapshot.mjs。',
  _source: 'JS-Slash-Runner 官方 @types/function/*.d.ts（面）+ dist/index.js（运行时键名核实）',
  _why: 'GOAL.md B8：仓库外副本不作主仓依赖 ⇒ 快照进仓库作默认基准；TH_ROOT 存在时以现场为准并对账。',
  _generatedAt: new Date().toISOString().slice(0, 10),
  _memberCount: members.length,
  _bareDeclCount: bare.size,
  _droppedDeclOnly: dropped,
  count: face.length,
  names: face,
}
mkdirSync(join(ROOT, 'scripts', 'data'), { recursive: true })
writeFileSync(join(ROOT, 'scripts', 'data', 'th-bare-global-face.json'), JSON.stringify(out, null, 1) + '\n', 'utf8')
console.log(`[gen-face] 声明面 union=${union.length} · 产物核实后 face=${face.length} · 剔除仅声明项 ${dropped.length} → ${dropped.join(', ')}`)
console.log('[gen-face] 已写出 scripts/data/th-bare-global-face.json')
