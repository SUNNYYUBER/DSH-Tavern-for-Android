#!/usr/bin/env node
/**
 * A14 —— 构建产物**内容级**新鲜度闸门（心跳 75 立，心跳 76 升级为逐字节判据）
 *
 * ## 为什么需要（两轮实机实测各抓到一个真实缺陷）
 * · 心跳 75（T-85）：T-78 世界书 ReDoS 防护改在 `src/lore/{safe-regex,trigger}.ts`、
 *   单测 28 项全绿，但**浏览器侧产物 `assets/app.js` 是陈旧构建** ⇒ 设备上防护**完全不存在**
 *   （`window.DSHT.triggerWorldInfo` 遇 `/(a+)+$/` + 28 个 `a` **卡死 26739 ms**、零降级）。
 * · 心跳 76（T-86）：**node 侧产物同样陈旧** —— 源码已有 T-83 的 `planOrphanAgentPrune`
 *   （`index.ts:1667`），而 `dsh-runtime-android/.../lib/index.js` 里**搜不到该函数**。
 *   ⇒ 「一处陈旧」不是偶发，而是**结构性**的：只要源码改了、产物没重建，设备就跑旧逻辑。
 *
 * ## 判据（心跳 76 起：逐字节，不再只查符号）
 * 对每个「源码入口 → 产物」配对，**现场重跑一次同样的 esbuild**，与磁盘上的产物
 * **逐字节比对**：
 *   · 相同 ⇒ 产物就是当前源码的确定性输出（新鲜，且可复现）；
 *   · 不同 ⇒ 产物陈旧（或构建参数/ cwd 漂移）⇒ 报错并给出差异摘要。
 *
 * ### 为什么可以不用维护哈希基线（关键设计）
 * esbuild 对同一输入是**确定性**的（实测：连续两次编译哈希完全相同；
 * 统一 cwd 后与既有产物也逐字节一致）。因此「重新编译一遍再比对」**不需要任何人工基线**，
 * 也不会出现「每次正常构建都要更新基线」的维护成本 —— 这正是上一轮我拒绝升级哈希方案的理由，
 * 而该理由在「现场重编译」这条路径上不成立。
 *
 * ### 为什么必须统一 cwd（本闸门成立的前提）
 * esbuild 把它给每个模块生成的路径注释按 **cwd 相对路径**写进产物
 * （`// node_modules/foo/index.js` vs `// rp-workspace/packages/node_modules/foo/index.js`）。
 * cwd 不同 ⇒ 字节不同。三个构建脚本现已统一为 `cd <packages>` 后再编译；
 * 本闸门也用同一 cwd，故比对成立。
 *
 * ## 正控/负控/零控（--selftest）
 * 用构造语料跑：正控（内容不同 ⇒ 必须报）· 负控（内容相同 ⇒ 必须过）·
 * 零控（产物缺失 + optional ⇒ 跳过不误报）· 缺产物且非 optional ⇒ 必须报。
 * 无 `--selftest` 通过则闸门自身不可信 ⇒ die。
 *
 * ## 反控（--negative-control）
 * 真跑一次「人为破坏产物」→ 断言必须报红 → 还原 → 断言必须回绿。
 * 这是 L44「不跑正控的结论不可信」在闸门自身上的应用。
 *
 * 用法：
 *   node scripts/audit-artifact-freshness.mjs [--selftest] [-v] [--negative-control]
 */
import fs from 'node:fs'
// ★ W72：自证分数契约的**唯一产出点**（P-1；**不自己拼分数行**）
import { reportSelftest } from './selftest-summary.mjs'
import path from 'node:path'
import os from 'node:os'
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WS = path.resolve(HERE, '..')
const PKG = path.join(WS, 'packages')
// ★ W82 新增：**仓库根**（`rp-workspace/` 的上一级）—— `builtBy` 点名的装置可能在仓库根
//   （如 `build-wb.sh`），而 `source` 字段按 **`rp-workspace/` 相对**解析（W82 实测的真实形态）。
const REPO_ROOT = path.resolve(WS, '..')
const NODE = process.execPath
const ESB = path.join(PKG, 'node_modules', 'esbuild', 'bin', 'esbuild')

/**
 * 「源码入口 → 产物」配对表。
 *
 * `entry` / `args` 必须与**构建脚本里的那一行完全一致**（同样的 cwd、同样的 flags），
 * 否则比对会因环境差异而假红（本轮就踩过：cwd 不同导致注释路径不同）。
 * `source` 只用于「产物比源码新」的辅助信息与自检语料，判据本身是逐字节。
 */
export const PAIRS = [
  {
    name: 'T-78 世界书关键词正则防护（浏览器侧产物 app.js）',
    entry: 'src/import/browser-entry.ts',
    args: ['--bundle', '--format=iife', '--global-name=DSHT'],
    source: ['packages/src/lore/safe-regex.ts', 'packages/src/lore/trigger.ts'],
    artifact: 'dsh-runtime-android/node_modules/dsht-rp-plugin/assets/app.js',
    builtBy: 'build-wb.sh [2/6] / build-dsht.ps1 Step 5 / rebuild-plugins.ps1 [8/8]',
  },
  {
    name: 'T-78/T-79 + T-83（node 侧 runtime 产物 lib/index.js = **RP 总包**）',
    // 【T-87】entry 由 `src/dsh-plugin/index.ts` 改为总包 `src/dsht-rp/index.ts`（含 5 个子模块）。
    entry: 'src/dsht-rp/index.ts',
    args: ['--bundle', '--format=esm', '--platform=node'],
    source: ['packages/src/lore/safe-regex.ts', 'packages/src/dsht-plugin-shared/card-fence.ts'],
    artifact: 'dsh-runtime-android/node_modules/dsht-rp-plugin/lib/index.js',
    builtBy: 'build-wb.sh [1/6] / build-dsht.ps1 Step 4.7 / build-plugins.sh [1/7]',
    optional: true,   // runtime 未构建时（纯前端开发）跳过，不算失败
  },
  // ---- 以下 undo / preflight：治「产物存在即永不重建」这个结构性缺陷 ----
  // 背景（build-wb.sh:68-72 原记录）：这些插件**一旦产物存在就永不重建** ——
  // 源码改了不进包、静默部署旧逻辑（实测踩中：`tavern-helper` 的 facade.ts 改动根本没进产物，
  // 字节数与旧版完全相同，而 A1~A6 断言全过）。逐字节判据把这条路径彻底封死。
  //
  // 【T-87】原 R10 四包（mvu / tavern-helper / prompt-template / memory）**已从此表移除** ——
  // 它们不再是独立产物（代码并入总包，见上方总包项）。若保留，会因产物不再生成而
  // 变成「optional 永远跳过」的死条目（L141 续：闸门要建在构建真的会产出的对象上）。
  ...['dsht-plugin-undo', 'dsht-preflight'].map(p => ({
    name: `${p}（node 侧产物）`,
    entry: `src/${p}/index.ts`,
    args: ['--bundle', '--format=esm', '--platform=node'],
    source: [`packages/src/${p}/index.ts`],
    artifact: `dsh-runtime-android/node_modules/${p}/lib/index.js`,
    builtBy: `build-plugins.sh / rebuild-plugins.ps1`,
    optional: true,
  })),
  {
    name: 'EJS worker（独立 bundle，**已并入总包 lib/**）',
    // 【T-87 路径变化】worker 由 `join(dirname(import.meta.url), 'ejs-worker.js')` 定位；
    // 合并后 import.meta.url 指向总包 ⇒ 产物落 `dsht-rp-plugin/lib/ejs-worker.js`。
    entry: 'src/dsht-plugin-prompt-template/worker.ts',
    args: ['--bundle', '--format=esm', '--platform=node'],
    source: ['packages/src/dsht-plugin-prompt-template/worker.ts'],
    artifact: 'dsh-runtime-android/node_modules/dsht-rp-plugin/lib/ejs-worker.js',
    builtBy: 'build-plugins.sh [2/7] / build-dsht.ps1 Step 4.7',
    optional: true,
  },
  {
    name: 'dsht-rp-plugin 浏览器侧 client.js（RP UI wire 产物）',
    entry: 'src/dsht-rp-ui/src/client/index.tsx',
    args: ['--bundle', '--format=esm'],
    source: ['packages/src/dsht-rp-ui/src/client/index.tsx'],
    artifact: 'dsh-runtime-android/node_modules/dsht-rp-plugin/lib/client.js',
    builtBy: 'build-rp-ui.mjs（含 __ModuleLoader__ banner/footer 包装 + vendor 注入）',
    // 与 mobile client 同理：最终产物带后处理包装（banner 改 id、footer 收口），
    // **裸编译 ≠ 最终产物** ⇒ 逐字节判据不适用，退回符号存在性。
    skipByteCompare: true,
    // 特征串：模块表 id 由 build-rp-ui.mjs:211 显式改写为 dsht-rp-plugin（插件合并的定案），
    // 只可能来自该构建步骤 ⇒ 是有效的"新鲜度"锚点。
    markers: ['dsht-rp-plugin'],
    // client.js 缺失会让 RP UI 整块消失（loader 认不出浏览器半边）⇒ 非 optional。
  },
  {
    name: 'dsht-plugin-mobile client（浏览器侧产物）',
    entry: 'src/dsht-plugin-mobile/client/index.tsx',
    args: ['--bundle', '--format=cjs'],
    source: ['packages/src/dsht-plugin-mobile/client/index.tsx'],
    artifact: 'dsh-runtime-android/node_modules/dsht-plugin-mobile/lib/client.js',
    builtBy: 'build-mobile.mjs（含 banner/footer 包装）',
    // ⚠️ 与裸 esbuild 不同：client.js 由 build-mobile.mjs 加了 `__ModuleLoader__.load` 包装，
    // 故本项**不参与逐字节比对**（裸编译 ≠ 最终产物）。留作说明，`skipByteCompare` 显式标注。
    skipByteCompare: true,
    // 后处理产物退回「符号存在性」判据：必须能从源码里找到**只可能来自该改动**的特征串。
    markers: ['dsht-plugin-mobile'],
    optional: true,
  },
]

/** 读文件（缺失返回 null） */
function readOrNull (rel) {
  try { return fs.readFileSync(path.join(WS, rel)) } catch { return null }
}

// ---------------------------------------------------------------------------
// 【2026-09-16 W29 · P-41】从**权威构建脚本**实读「这个产物是哪个 entry 编译出来的」
// ---------------------------------------------------------------------------
//
// ## 为什么必须这样（不是「顺手给 PAIRS 改个值」）
// W29 决定性实验（两个 entry 各重编译一次再逐字节比）：
//   · 按**权威路径** `build-dsht.ps1` Step 4.7 的 entry（`src/dsh-plugin/index.ts`）
//     重编译 ⇒ **916076 B，与磁盘产物逐字节一致** ⇒ **产物是新鲜的**；
//   · 按 PAIRS 当时写死的 entry（T-87 目标态 `src/dsht-rp/index.ts`）
//     重编译 ⇒ 1114303 B，**不一致** ⇒ 判为「陈旧」。
// ⇒ 闸门报的**不是产物陈旧，而是它自己锚错了**：它锚在「**架构应该长成什么样**」（代理量），
//   而不是「**权威路径实际编译的是哪个 entry**」（事实）。这正是 P-41 的形态 ——
//   且与 `verify-rp-consolidation.mjs` 判据 8② 在 W28 撞到的是**同一个 T-87 半迁移事实**，
//   只是换了一个观测面（W22 早已登记该状态，但当时只是「记下来」，没把锚点修对）。
//
// ## 修法：把 entry **从脚本里读出来**（P-27：别把「当前状态」硬编码成常量）
// 与 `verify-rp-consolidation.mjs:parseSplitEntries()` 同源思路。这样：
//   · T-87 第 4 步落地后（Step 4.7/4.72/4.75 合并）⇒ 读出的 entry 自动变成新总包 ⇒ **判据自己跟上**；
//   · 若谁改了构建脚本的 entry 而没同步产物 ⇒ 立刻报红（这才是闸门真正要守的东西）。
//
// ## 口径（诚实边界）
// · 只解析 `$var = "..."` **单行**赋值并做最多 5 轮展开（与 `audit-build-path-parity.py` 同法）；
// · 匹配口径：把 `--outfile=` 的实参与产物路径都归一到 `node_modules/<...>` 再比；
// · 读不出（脚本改了写法）⇒ **不用 PAIRS 里那个可能过期的值硬判**，而是出声标注
//   「锚点未从脚本证实」（P-11：无法判定 ≠ 判定通过）。

/** 把路径归一到 `node_modules/` 之后的部分（与其它构建审计脚本同口径） */
export function normNodeModules (p) {
  const s = String(p).replace(/\\/g, '/')
  const i = s.indexOf('node_modules/')
  return i < 0 ? null : s.slice(i + 'node_modules/'.length)
}

/**
 * 从构建脚本文本里解析「产物 → entry」映射。
 * @param {string} scriptText build-dsht.ps1 全文
 * @returns {Map<string, string>} 键 = 归一后的 node_modules 相对路径，值 = entry（相对 packages）
 */
export function parseArtifactEntries (scriptText) {
  const varmap = new Map()
  for (const m of scriptText.matchAll(/^\s*\$(\w+)\s*=\s*"([^"\r\n]*)"/gm)) varmap.set(m[1], m[2])

  const expand = (v) => {
    for (let i = 0; i < 5; i++) {
      if (!v.includes('$')) break
      const before = v
      // 长名优先：避免 `$ws` 抢先吃掉 `$wsXxx` 的前缀（与 audit-build-path-parity.py 同教训）
      for (const name of [...varmap.keys()].sort((a, b) => b.length - a.length)) {
        if (v.includes('$' + name)) v = v.split('$' + name).join(varmap.get(name))
      }
      if (v === before) break
    }
    return v
  }

  const out = new Map()
  const paramEntryCalls = []     // 见下：entry 为函数形参的调用行（由调用点解析补上）
  for (const line of scriptText.split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue          // 注释行不参与
    // entry = esbuild 的**第一个非选项实参**。实测两条权威脚本各用一种写法：
    //   · `& npx esbuild src/x/index.ts --bundle …`        （build-dsht.ps1）
    //   · `& $node $esb src/x/index.ts --bundle …`         （rebuild-plugins.ps1，可执行体是变量）
    // ⇒ 不能锚在 "esbuild" 这个词上（后者里它只出现在 `$esb` 变量名中，且注释/throw 文案里也有）。
    //   改为锚在「调用形态」：`& <任意非选项 token 组> <entry> --`（entry 以 src/ 开头且含 `/`）。
    const m = line.match(/^\s*&?\s*(?:[^\s]+[ \t]+)*?(src\/[^\s"']+|"src\/[^"]+"|'src\/[^']+')\s+(--)/)
    if (!m) continue
    const entry = m[1].replace(/^["']|["']$/g, '')
    const om = line.match(/--outfile=("[^"]*"|\S+)/)
    if (!om) continue
    const dst = normNodeModules(expand(om[1].replace(/^["']|["']$/g, '')))
    if (!dst) continue
    if (entry.includes('$')) {
      // 【W29 第二例】entry 是**函数形参**（`& $node $esb $entry … --outfile="$dir\lib\index.js"`），
      //   常见于 `Build-NodePlugin($name, $entry)` 这类通用函数。此时本行解析不出具体 entry，
      //   但**调用点**给了实参 —— 故登记形参名，由下面的调用点解析补上。
      paramEntryCalls.push({ line: line, dst })
      continue
    }
    out.set(dst, entry)
  }

  // 解析通用函数的调用点：`Build-NodePlugin 'pkg' 'src/pkg/index.ts'`
  //   ⇒ 与函数体里登记的形参 entry 配对，再用**调用点的实参**还原出「产物 → entry」。
  //
  // ## 【W29 第三例，P-19 家族】函数体范围不能用非贪婪正则圈
  // 首版写 `/function\s+(\w+)\s*\(([^)]*)\)\s*\{([\s\S]*?)\n\}/` —— 非贪婪 `*?` 会在
  // **第一个「行首/行尾的 `}`」**处停下，而 PowerShell 函数体内常有缩进的 `}` 行
  // （实测它停在 `Say` 这个函数上、把 `Build-NodePlugin` 的 body 整段错配）。
  // 识别特征：诊断显示 `FN: Say … body has $entry: true` —— **函数名与内容对不上**即此坑。
  // ⇒ 修法：先按 `function <name>(<params>) {` 定位**起点**，再**花括号配平**找终点。
  for (const head of scriptText.matchAll(/^[ \t]*function\s+([\w-]+)\s*\(([^)]*)\)\s*\{/gm)) {
    const fnName = head[1]
    const params = head[2].split(',').map(s => s.trim().replace(/^\$/, ''))
    // 花括号配平（从 head 的 `{` 起算）
    let depth = 0; let end = -1
    for (let i = head.index + head[0].length - 1; i < scriptText.length; i++) {
      if (scriptText[i] === '{') depth++
      else if (scriptText[i] === '}') { depth--; if (depth === 0) { end = i; break } }
    }
    if (end < 0) continue
    const body = scriptText.slice(head.index, end + 1)
    const entryParam = params.find(p => new RegExp(`\\$${p}\\s+--`).test(body))
    const outfileTpl = body.match(/--outfile=("[^"]*"|\S+)/)
    if (!entryParam || !outfileTpl) continue
    // ## 【W29 第四例】产物模板里的**函数内局部变量**必须一并展开
    // 实测 `Build-NodePlugin` 的 outfile 是 `"$dir\lib\index.js"`，而 `$dir = "$nm\$name"`
    // 是**函数体内**的赋值（不是脚本级 `$var = "…"`）⇒ 只替换形参 `$name` 会剩一个 `$dir`
    // ⇒ `normNodeModules` 认不出 ⇒ 该产物永远「读不到 entry」（实测 undo/preflight 两条）。
    // ⇒ 修法：把函数体内的局部赋值并入展开表（**作用域限于该函数**，与脚本级同名变量隔离）。
    const localVars = new Map(varmap)
    for (const lm of body.matchAll(/^\s*\$(\w+)\s*=\s*"([^"\r\n]*)"/gm)) localVars.set(lm[1], lm[2])
    //
    // ## 【W29 第五例】展开必须把**形参**和局部变量放在**同一张表里一次展开**
    // 首版先替换形参 `$name` → 实参，再展开 `$dir`；可 `$dir` 的值里**也有** `$name`
    // （`"$nm\$name"`）⇒ 展开 `$dir` 后又冒出个未展开的 `$name`，而它已不在表里
    // ⇒ 键变成字面量 `$name/lib/index.js`，**两次调用互相覆盖**（实测只剩 preflight 一条，
    //    undo 被吃掉）。⇒ 修法：把形参**并入**局部变量表，一次展开到位。
    const nameParam = params[0]
    for (const cm of scriptText.matchAll(new RegExp(`\\b${fnName}\\s+('[^']*'|"[^"]*")\\s+('[^']*'|"[^"]*")`, 'g'))) {
      const name = cm[1].replace(/^["']|["']$/g, '')
      const entry = cm[2].replace(/^["']|["']$/g, '')
      const vars = new Map(localVars)
      vars.set(nameParam, name)                    // 形参 → 本次调用的实参
      const expandAll = (v) => {
        for (let i = 0; i < 5; i++) {
          if (!v.includes('$')) break
          const before = v
          for (const k of [...vars.keys()].sort((a, b) => b.length - a.length)) {
            if (v.includes('$' + k)) v = v.split('$' + k).join(vars.get(k))
          }
          if (v === before) break
        }
        return v
      }
      const dst = normNodeModules(expandAll(outfileTpl[1].replace(/^["']|["']$/g, '')))
      if (dst && entry.startsWith('src/')) out.set(dst, entry)
    }
  }

  void paramEntryCalls
  return out
}

/**
 * ★★ **「该脚本是不是权威构建脚本」的单源判定**（**W81 新增**）。
 *
 * ## 语义（从代码事实读出，**不是猜** —— P-41）
 * 权威构建脚本 = **产 entry 的脚本** —— 判据是「**这个文件里有 esbuild 编译调用 + `--outfile`**」。
 *
 * ## ★★ 口径必须收「两种真实形态」（**W81 实测踩到的假红 —— P-38/P-45**）
 *   · **形态 A（同行）**：`build-dsht.ps1` 写作
 *     `& npx esbuild src/… --bundle --outfile="$dir\lib\index.js"`（同在**一行**）；
 *   · **形态 B（跨行 / 变量体）**：`rebuild-plugins.ps1` 写作
 *     `$esb = "$pkg\node_modules\esbuild\bin\esbuild"` + 后续 `& $node $esb $entry … --outfile=…`
 *     ⇒ ★ **同行内没有 `esbuild` 字样**（只有 `$esb` 变量）。
 *   ⇒ ★★ 首版口径只认形态 A ⇒ **真实仓库只发现 1 个**（漏 `rebuild-plugins.ps1`）
 *     ⇒ selftest 的「两侧一致」与「发现数 ≥2」当场 FAIL（**判据自己的口径缺陷**，诚实留痕）。
 *   ★ 修法：**按「文件级」判两个必要条件** —— ⑴ 含 esbuild 可执行体（`esbuild` 或 `$esb`/`$ESB` 变量名）；
 *     ⑵ 含 `--outfile`。★ 两者都在 ⇒ 它产 entry。
 *
 * ## 为什么不用「同行正则」（**P-45** 的教训）
 * 同行正则会**随写法变化静默漏**（W77 的「七版口径」同族）——
 * 而**文件级两个必要条件**对本仓两种真实写法**都成立**，且不引入词法模拟。
 *
 * @param {string} text 脚本全文
 * @returns {boolean} 是否含 entry 声明
 */
export function hasEntryDecl (text) {
  const s = String(text ?? '')
  // ⑴ esbuild 可执行体：直接写 `esbuild`，或形如 `$esb = "…esbuild…bin…"` 的变量
  const hasEsbuildBin = /\besbuild\b/i.test(s) || /\$\w*esb\w*\s*=\s*["'][^"']*esbuild/i.test(s)
  // ⑵ 有 `--outfile`（产物的落点）
  const hasOutfile = /--outfile\b/.test(s)
  return hasEsbuildBin && hasOutfile
}

/**
 * ★★ **判据⑨（W81 新增）：权威构建脚本必须「按语义自动发现」，不得手写名单**。
 *
 * ## 由头（**P-80 的同族分支穷举** —— P-70 纪律①）
 * **P-80**（W80）确立了「判据的受检面必须按语义自动发现，不得手写文件清单」，
 * ★ 但它**只在 `audit-selftest-claims.mjs` 一处落地**。本轮按 **P-70 纪律①** 做横向穷举
 * ⇒ 本闸门的 `readAllAuthoritativeScripts()` 与 `audit-a14-anchor-negctl.mjs` 里
 * **各写了一份完全相同的 2 项手写清单** `['build-dsht.ps1', 'rebuild-plugins.ps1']`。
 *
 * ## ★★ W81 决定性实验（该面**整类无守**）
 * 新建第三个**含 entry 声明**（`& npx esbuild <entry> … --outfile=…`）的 `.ps1`
 * ⇒ `audit-artifact-freshness` / `audit-a14-anchor-negctl` / `audit-selftest-claims` /
 * `audit-baseline-claims` / `audit-doc-refs` / `audit-goal-sections` / `audit-publish-hygiene` /
 * `audit-impl-duplication` / `audit-matrix-residuals` / `audit-build-path-parity.py`
 * **十个闸门全部 exit=0**（★ 实测中 `audit-build-path-parity.py` **报过一次红**，
 * ★★ 归因后确认它抓的是**我探针文件缺 BOM**，**不是**「清单漏项」——
 * **P-45**：别把「别的判据接住」当成「本条判据有效」）。
 *
 * ## 正确语义（**从代码事实读出**，不是猜）
 * `readAllAuthoritativeScripts` 的头注写着：「两条权威构建路径 —— **它们的产出集合不同**」
 * ⇒ ★ 语义 =「**含 entry 声明（`esbuild <entry> --outfile=`）的构建脚本**」，
 * **不是**「本仓全部 `.ps1`」—— 实测本仓另有 `emulator-dsht.ps1`（模拟器启动）
 * 与 `make-testdata.ps1`（测试数据生成），**两者都不含 entry 声明** ⇒ 手写 2 项**恰好等于**语义集，
 * ★ 但**「为什么是这 2 个」没有任何机器守**（P-27：**手写清单在写下的一刻就开始过期**）。
 *
 * ## 判据（三条，双向，守 **P-46**）
 *   ① **发现面** = `scripts/*.ps1` 里**含 entry 声明**的那些（正则判定，可机器验证）；
 *   ② **声明面** = 调用方传入手写清单；
 *   ③ ★★ **双向报红**：**发现 > 声明** ⇒ 报红（新增的构建路径**不会被想起**）；
 *      **声明 > 发现** ⇒ 报红（声明的脚本已不产 entry / 已改名 ⇒ 手写清单过期）。
 *   ★ **诚实边界（R7）**：本判据**只证「两侧名单一致」**，**不证**「发现的每个脚本都真的产出产物」
 *     —— 后者是 `checkPair` 的逐字节判据的职责（职责边界，**P-45**）。
 *
 * @param {string} scriptsDir `scripts/` 绝对路径
 * @param {string[]} declared 手写清单（相对文件名）
 * @returns {{problems:string[], discovered:string[], declared:string[], hasEntry:(t:string)=>boolean}}
 */
export function authoritativeScriptProblems (scriptsDir, declared) {
  const problems = []
  let files = []
  try { files = fs.readdirSync(scriptsDir).filter((f) => f.endsWith('.ps1')).sort() } catch { /* 读不到 ⇒ 无判据力 */ }
  const discovered = []
  for (const f of files) {
    try {
      if (hasEntryDecl(fs.readFileSync(path.join(scriptsDir, f), 'utf8'))) discovered.push(f)
    } catch { /* 单文件读失败 ⇒ 跳过（不静默：它不会进 discovered，双向比对会体现） */ }
  }
  const declaredSet = new Set(declared)
  const discoveredSet = new Set(discovered)
  for (const f of discovered) {
    if (!declaredSet.has(f)) {
      problems.push(`\`${f}\` **含 entry 声明**（\`esbuild … --outfile=\`）而**不在权威脚本清单里**`
        + ` ⇒ 它产出的产物**不会被 A14 核验**，而报告上**看不出差别**（**P-30**）`
        + ` ⇒ 二选一：⑴ 加进清单；⑵ 若它不该被核验，就**别让它产 entry**（写清理由）`)
    }
  }
  for (const f of declared) {
    if (!discoveredSet.has(f)) {
      problems.push(`清单里的 \`${f}\` **已不含 entry 声明**（或已改名/删除）⇒ **手写清单过期**`
        + `（**P-27**：手写清单在写下的一刻就开始过期）⇒ 请同步清单`)
    }
  }
  return { problems, discovered, declared: [...declared] }
}

/**
 * ★★ **判据⑩（W82 新增）：PAIRS 各项的路径字段必须「指向真实存在的对象」**。
 *
 * ## 由头（**P-62 的同族** —— 「数据表里的字段」也是一种声明）
 * **W81** 给「权威构建脚本清单」装了双向对账；★ 本轮按 **P-70 纪律①** 继续穷举
 * ⇒ 本文件的 `PAIRS` 是**数据表**，它的 `entry` / `source` / `artifact` / `builtBy`
 * **全是手写路径** —— ★★ 而**「它们现在还有效吗」没有任何机器问**。
 *
 * ## ★★ W82 决定性实验（该面**整类无守**）
 * 把 `source` 改成幽灵路径（`packages/src/lore/GHOST-safe-regex.ts`）、
 * 把 `entry` 改成幽灵路径（`src/import/GHOST-browser-entry.ts`）⇒
 * `audit-artifact-freshness` / `audit-selftest-claims` / `audit-baseline-claims` /
 * `audit-doc-refs` / `audit-goal-sections` / `audit-publish-hygiene` /
 * `audit-impl-duplication` / `audit-a14-anchor-negctl` / `audit-matrix-residuals` /
 * `audit-rule-claims` **十个闸门全部 exit=0**（逐字节还原自证）。
 *
 * ## ★★ 危害（**不是**「填错了不好看」，而是**判据静默失效** —— P-30）
 *   · `entry` 是 `checkPair` 的**编译输入**（`esbuild <entry> …`）⇒ 路径错了
 *     ⇒ 编译失败 ⇒ 报「产物陈旧」**假红**（**P-38**：假红会训练人忽略报警）；
 *   · `source` 在 `skipByteCompare` 分支里**真的被读**（从源码文本里找 `markers`）
 *     ⇒ 路径错了 ⇒ `read()` 返回 `null` ⇒ 拼出**空串** ⇒ `markers` 一个都找不到
 *     ⇒ **判据恒过**（**P-30**：失效与通过同貌）。★ W82 实测：`markers` 只在
 *     **源文本**里找得到时才会去产物里查（`srcText.includes(m) && !artText.includes(m)`）
 *     ⇒ 源文本为空时 `missing` 恒空 ⇒ **该分支从不报红**。
 *
 * ## 口径（三条，全部由「防假红」逼出）
 *   ⑴ ★★ **两个字段两套基准**（**W82 实测的真实形态**）：
 *      `entry` = **`packages/` 相对**；`source` = **`rp-workspace/` 相对**。
 *      ⇒ ★ 判据**必须各自按自己的基准解析**（**P-45**：扫描面与真目标对齐），
 *      ★ 且**不许静默换基准**（那正是「写错也不报」的成因）；
 *   ⑵ ★★ **`artifact` 不判存在性** —— 它在 runtime 未构建时**整体缺失**
 *      （`-SkipInstall` / 纯前端开发），那是 `checkPair` 的职责
 *      （且 `optional` / `skipByteCompare` 各有口径）⇒ 本判据**只管源码侧字段**（**P-45** 职责边界）；
 *   ⑶ ★★ **`builtBy` 点名的装置必须存在** —— ★ 它是**「谁产它」的声明**
 *      （**P-62**：声明必须能被指认）⇒ 点名了不存在的装置 ⇒ 报红。
 *
 * ## 诚实边界（R7）
 *   本判据**只证「字段指向的对象存在」**，**不证**「那个对象就是该产物的真正来源」
 *   （后者是 `checkPair` 逐字节判据的职责）。
 *
 * @param {object[]} pairs `PAIRS`
 * @param {(abs:string)=>boolean} existsFn 存在性判定（注入以便自证）
 * @param {string} wsRoot `rp-workspace/` 绝对路径
 * @param {string} repoRoot 仓库根绝对路径
 * @returns {{problems:string[], checked:number, notes:string[]}}
 */
export function pairFieldProblems (pairs, existsFn, wsRoot, repoRoot) {
  const problems = []
  const notes = []
  let checked = 0
  for (const p of pairs) {
    const label = String(p.name ?? '(未命名)').slice(0, 46)
    // ⑴ entry（**packages/ 相对**）
    if (p.entry) {
      checked += 1
      if (!existsFn(path.join(wsRoot, 'packages', p.entry))) {
        problems.push(`PAIRS 项「${label}」的 \`entry\` **不存在**：\`packages/${p.entry}\``
          + ` ⇒ \`checkPair\` 会用**不存在的源码**去编译 ⇒ 报「产物陈旧」**假红**（**P-38**）`)
      }
    }
    // ⑵ source（**rp-workspace/ 相对**）
    for (const s of (p.source ?? [])) {
      checked += 1
      if (!existsFn(path.join(wsRoot, s))) {
        problems.push(`PAIRS 项「${label}」的 \`source\` **不存在**：\`${s}\`（基准 = \`rp-workspace/\`）`
          + ` ⇒ 在 \`skipByteCompare\` 分支里源文本拼成**空串** ⇒ \`markers\` 一个都找不到`
          + ` ⇒ **该判据恒过**（**P-30**：失效与通过同貌）`)
      }
    }
    // ⑶ builtBy 点名的装置（**P-62**：声明必须能被指认）
    for (const n of [...String(p.builtBy ?? '').matchAll(/([A-Za-z0-9_.-]+\.(?:sh|ps1|mjs|js))/g)].map(m => m[1])) {
      checked += 1
      if (!existsFn(path.join(wsRoot, 'scripts', n)) && !existsFn(path.join(repoRoot, n))) {
        problems.push(`PAIRS 项「${label}」的 \`builtBy\` 点名了**不存在的装置**：\`${n}\``
          + ` ⇒ 那是「谁产它」的声明，**点名不到** = 该声明无法被指认（**P-62**）`)
      }
    }
  }
  if (checked === 0) notes.push('PAIRS 为空 ⇒ 判据⑩ 无对象可判（P-43）')
  return { problems, checked, notes }
}

/**
 * ★★ **判据⑨ 的单源发现器**（**W81 新增**）：返回「含 entry 声明的权威构建脚本」清单。
 *
 * ## 为什么要抽成单源（**P-1**）
 * 本闸门的 `readAllAuthoritativeScripts()` 与 `audit-a14-anchor-negctl.mjs`
 * **各写了一份相同的手写清单** —— ★ 两处**必须同源**，否则「口径改了只改一处」
 * ⇒ 对同一份仓库给出**相反结论**（**P-46**；W79 实测踩过同一形态）。
 *
 * @param {string} scriptsDir `scripts/` 绝对路径
 * @returns {{name:string, text:string}[]} 含 entry 声明的脚本（读失败者跳过）
 */
export function discoverAuthoritativeScripts (scriptsDir) {
  let files = []
  try { files = fs.readdirSync(scriptsDir).filter((f) => f.endsWith('.ps1')).sort() } catch { return [] }
  const out = []
  for (const f of files) {
    const p = path.join(scriptsDir, f)
    try {
      const text = fs.readFileSync(p, 'utf8')
      if (hasEntryDecl(text)) out.push({ name: f, text })
    } catch { /* 缺失不致命 */ }
  }
  return out
}

/** 读权威构建脚本（可能不存在 —— 纯前端开发环境） */
function readAuthoritativeScript () {
  const p = path.join(HERE, 'build-dsht.ps1')
  try { return { text: fs.readFileSync(p, 'utf8'), path: p } } catch { return { text: null, path: p } }
}

/**
 * 【W29】两条权威构建路径 —— 都要读，因为**它们的产出集合不同**（实测）：
 *   · `build-dsht.ps1`  —— 产总包 + **独立包形态**的 R10 + worker 落 `dsht-plugin-prompt-template/lib/`
 *   · `rebuild-plugins.ps1` —— 产总包 + undo + preflight + worker 落 `dsht-rp-plugin/lib/`
 * 只读一条 ⇒ 另一条独有的产物会被判「读不到 entry」（W29 首跑实测：3 条如此）。
 * 两条**各自的 entry 解析结果合并**（键相同、值不同时，以**后读到的**为准并出声 —— 见调用点）。
 */
function readAllAuthoritativeScripts () {
  // ★★ **W81 修（P-80 的同族分支）：改为「按语义自动发现」**（**P-1 / P-61**）。
  //   ★ 由头：此处原是**手写 2 项清单** `['build-dsht.ps1', 'rebuild-plugins.ps1']`，
  //     而 `audit-a14-anchor-negctl.mjs` 里**另写了一份完全相同的清单** ⇒
  //     ★ ⑴ **新增第三个含 entry 声明的构建脚本时，它不会被想起**（**P-27**）；
  //     ★ ⑵ **两处手写清单必须同源**（否则口径改了只改一处 ⇒ **P-46**）。
  //   ★★ **W81 决定性实验**：新建第三个含 entry 的 `.ps1` ⇒ **十个闸门全部 exit=0**。
  //   ⇒ 语义（从本函数原头注读出）=「**含 entry 声明（`esbuild … --outfile=`）的构建脚本**」，
  //     由 `discoverAuthoritativeScripts` 单源枚举。
  return discoverAuthoritativeScripts(HERE)
}

/** 现场重编译到临时文件，返回 Buffer（失败抛错） */
function recompile (pair) {
  const tmp = path.join(os.tmpdir(), `a14-${process.pid}-${Math.random().toString(36).slice(2)}.js`)
  try {
    execFileSync(NODE, [ESB, pair.entry, ...pair.args, `--outfile=${tmp}`, '--log-level=warning'], {
      cwd: PKG, stdio: 'pipe', maxBuffer: 64e6,
    })
    return fs.readFileSync(tmp)
  } finally {
    try { fs.unlinkSync(tmp) } catch { /* 已删 */ }
  }
}

/**
 * 核心判据：现场重编译 ≡ 磁盘产物（逐字节）。
 *
 * @param pair 配对项
 * @param deps 可注入（自检用）：{ recompile, read } —— 生产路径用真实实现
 * @returns {{ ok: boolean, reason?: string, detail?: string }}
 */
export function checkPair (pair, deps = {}) {
  const read = deps.read ?? readOrNull
  const rebuild = deps.recompile ?? recompile

  const art = read(pair.artifact)
  if (art === null) {
    return {
      ok: !!pair.optional,
      reason: `产物不存在：${pair.artifact}` + (pair.optional ? '（optional，跳过）' : ''),
    }
  }
  if (pair.skipByteCompare) {
    // 该产物的最终形态带后处理包装（如 `__ModuleLoader__.load` banner），裸编译 ≠ 最终产物 ⇒
    // 逐字节判据不适用。仍然检查「源码里的特征符号 ⊆ 产物」（上一代的符号判据）。
    const srcText = (pair.source ?? []).map(f => (read(f) ?? Buffer.from('')).toString('utf8')).join('\n')
    const artText = art.toString('utf8')
    const markers = (pair.markers ?? [])
    const missing = markers.filter(m => srcText.includes(m) && !artText.includes(m))
    return missing.length === 0
      ? { ok: true, reason: '（后处理产物：仅符号存在性判据）' }
      : { ok: false, reason: `后处理产物缺符号：${missing.join(', ')}` }
  }

  // 【W29 · P-41】先用**权威脚本实读的 entry**（若有）。deps.entryFromScript 由调用方注入，
  //   未注入 ⇒ 表示环境无权威脚本（纯前端开发）⇒ 退回 pair.entry 但**出声标注**。
  const effective = { ...pair }
  let anchorNote = ''
  if (deps.entryFromScript !== undefined) {
    if (deps.entryFromScript !== null) {
      effective.entry = deps.entryFromScript
      anchorNote = pair.entry === deps.entryFromScript
        ? ''                                   // 与 PAIRS 现值一致，不必出声
        : `（entry 取自权威脚本：${pair.entry} → ${deps.entryFromScript}）`
    } else {
      anchorNote = `（⚠️ 权威脚本里读不到该产物的 entry —— 退回 PAIRS 现值 ${pair.entry}，判定力可能不足）`
    }
  }

  let fresh
  try {
    fresh = rebuild(effective)
  } catch (e) {
    return { ok: false, reason: `现场重编译失败（无法判定产物新鲜度）：${e.message?.slice(0, 200)}` }
  }
  if (fresh.length === art.length && fresh.equals(art)) {
    return { ok: true, reason: anchorNote || undefined }
  }

  // 差异摘要：长度 + 首个不同字节所在行（便于人工定位）
  const a = fresh.toString('utf8').replace(/\r\n/g, '\n').split('\n')
  const b = art.toString('utf8').replace(/\r\n/g, '\n').split('\n')
  let firstDiff = -1
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) { firstDiff = i; break }
  }
  return {
    ok: false,
    reason: '产物与当前源码的编译结果**逐字节不同** ⇒ 产物陈旧或构建口径漂移' + anchorNote,
    detail: [
      `重编译 ${fresh.length} B / 产物 ${art.length} B`,
      firstDiff >= 0 ? `首个差异在归一化后的第 ${firstDiff + 1} 行：` : '（长度相同但字节不同）',
      firstDiff >= 0 ? `  重编译: ${(a[firstDiff] ?? '').slice(0, 140)}` : '',
      firstDiff >= 0 ? `  产物  : ${(b[firstDiff] ?? '').slice(0, 140)}` : '',
      `由谁产出：${pair.builtBy}`,
    ].filter(Boolean).join('\n'),
  }
}

/** 构造语料跑四例（闸门自证） */
function selftest () {
  const buf = (s) => Buffer.from(s, 'utf8')
  const cases = [
    {
      label: '正控：产物与重编译不同 ⇒ 必须报红',
      pair: { name: 'x', artifact: 'a', optional: false },
      read: (rel) => (rel === 'a' ? buf('OLD CONTENT') : null),
      recompile: () => buf('NEW CONTENT'),
      expect: { ok: false },
    },
    {
      label: '负控：产物 == 重编译 ⇒ 必须过',
      pair: { name: 'y', artifact: 'a', optional: false },
      read: (rel) => (rel === 'a' ? buf('SAME') : null),
      recompile: () => buf('SAME'),
      expect: { ok: true },
    },
    {
      label: '零控：产物缺失 + optional ⇒ 跳过不误报',
      pair: { name: 'z', artifact: 'a', optional: true },
      read: () => null,
      recompile: () => buf('X'),
      expect: { ok: true },
    },
    {
      label: '缺产物 + 非 optional ⇒ 必须报',
      pair: { name: 'w', artifact: 'a', optional: false },
      read: () => null,
      recompile: () => buf('X'),
      expect: { ok: false },
    },
    {
      label: '重编译自身失败 ⇒ 必须报（不能当成"新鲜"）',
      pair: { name: 'v', artifact: 'a', optional: false },
      read: (rel) => (rel === 'a' ? buf('X') : null),
      recompile: () => { throw new Error('esbuild 崩了') },
      expect: { ok: false },
    },
  ]
  let pass = 0
  for (const c of cases) {
    const got = checkPair(c.pair, { read: c.read, recompile: c.recompile })
    const ok = got.ok === c.expect.ok
    console.log(`[selftest] ${ok ? 'PASS' : 'FAIL'}  ${c.label}  → ok=${got.ok}`)
    if (ok) pass++
  }

  // ---- W29 新增：**锚点解析器**的自证（P-41 推论四：解析出来的事实多一层失效面）----
  // 判据的结论现在依赖 `parseArtifactEntries()` 从两条权威脚本里读出的 entry。
  // 解析器若漏形态，结论会**反向**（把真新鲜判成陈旧，正是本轮踩到的），故必须自证。
  // 每条用例都自带变量定义（否则展开不出 node_modules 路径 ⇒ 断言会因「一个键都没有」而假过）。
  const V = '$nm   = "$ws\\dsh-runtime-android\\node_modules"\n$ws   = "D:\\x"\n'
  const PARSER_CASES = [
    ['正控：`& npx esbuild <entry> … --outfile="<字面量>"`（build-dsht.ps1 写法）',
      V + '& npx esbuild src/dsh-plugin/index.ts --bundle --outfile="$nm\\dsht-rp-plugin\\lib\\index.js"',
      { 'dsht-rp-plugin/lib/index.js': 'src/dsh-plugin/index.ts' }],
    ['★ 正控：`& $node $esb <entry> …`（rebuild-plugins.ps1 写法，可执行体是变量）',
      V + '& $node $esb src/dsht-rp/index.ts --bundle --outfile="$nm\\dsht-rp-plugin\\lib\\index.js"',
      { 'dsht-rp-plugin/lib/index.js': 'src/dsht-rp/index.ts' }],
    ['★ 正控：通用函数 + 形参 entry + **函数内局部变量**（W29 第四例）',
      V + `function Build-NodePlugin($name, $entry) {
    $dir = "$nm\\$name"
    & $node $esb $entry --bundle --outfile="$dir\\lib\\index.js"
}
Build-NodePlugin 'dsht-plugin-undo' 'src/dsht-plugin-undo/index.ts'`,
      { 'dsht-plugin-undo/lib/index.js': 'src/dsht-plugin-undo/index.ts' }],
    ['★ 正控：同一函数**两次调用**必须各自成键（W29 第五例：展开顺序错会互相覆盖）',
      V + `function Build-NodePlugin($name, $entry) {
    $dir = "$nm\\$name"
    & $node $esb $entry --bundle --outfile="$dir\\lib\\index.js"
}
Build-NodePlugin 'dsht-plugin-undo' 'src/dsht-plugin-undo/index.ts'
Build-NodePlugin 'dsht-preflight' 'src/dsht-preflight/index.ts'`,
      { 'dsht-plugin-undo/lib/index.js': 'src/dsht-plugin-undo/index.ts',
        'dsht-preflight/lib/index.js': 'src/dsht-preflight/index.ts' }],
    ['负控：注释行里的 esbuild 示例不算（不得虚增键）',
      V + '# 例：& npx esbuild src/fake/index.ts --bundle --outfile="$nm\\fake\\lib\\index.js"\nWrite-Host ok',
      {}],
    ['负控：插值 entry（R10 循环形态）不登记 —— 静态无法定位，宁缺勿错',
      V + '& npx esbuild "src/$r10/index.ts" --bundle --outfile="$nm\\r10\\lib\\index.js"',
      {}],
    ['负控：无 --outfile 的行不登记（缺产物路径则无从配对）',
      V + '& npx esbuild src/dsh-plugin/index.ts --bundle',
      {}],
  ]
  let total = cases.length
  for (const [label, script, want] of PARSER_CASES) {
    const got = Object.fromEntries(parseArtifactEntries(script))
    const ok = JSON.stringify(Object.entries(got).sort()) === JSON.stringify(Object.entries(want).sort())
    console.log(`[selftest] ${ok ? 'PASS' : 'FAIL'}  （解析器）${label}  → ${JSON.stringify(got)}`)
    if (ok) pass++
    total++
  }

  // ---- ★★ W81 新增：**判据⑨（权威构建脚本必须按语义自动发现）** 的成对控 ----
  //   ★ 控必须**成对**（**P-67 纪律③**）：① 发现 > 声明 ⇒ 必须报红（**本轮实测的整类无守形态**）；
  //     ② 两侧一致 ⇒ 不得报红；③ 声明 > 发现 ⇒ 必须报红（手写清单过期）；④ 杠杆（只补清单 ⇒ 转绿）。
  //   ★ 用**临时目录**造样本（**P-48 最强形态**：能不改就不改 —— 连真实仓库都不碰）。
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a14-w81-'))
    // 形态 A（同行）：`& npx esbuild <entry> … --outfile=…`
    const entryBody = '$nm = "$ws\\nm"\n& npx esbuild src/x/index.ts --bundle --outfile="$nm\\p\\lib\\index.js"\n'
    // 形态 B（跨行 / 变量体）：`$esb = "…esbuild…"` + 后续用 `$esb`（**W81 实测的真实写法**）
    const entryBodyB = '$esb = "$pkg\\node_modules\\esbuild\\bin\\esbuild"\n& $node $esb src/y/index.ts --bundle --outfile="$nm\\q\\lib\\index.js"\n'
    // 无反例：**含 esbuild 但无 --outfile**（不产产物 ⇒ 不进发现面）
    const esbuildNoOut = '$esb = "$pkg\\node_modules\\esbuild\\bin\\esbuild"\nWrite-Host "只用 esbuild 做检查，不产 outfile"\n'
    // 无反例：**不含 esbuild**（如模拟器启动脚本）
    const plainBody = '# 只是启动模拟器，不含 entry 声明\nWrite-Host ok\n'
    const A = authoritativeScriptProblems
    try {
      fs.writeFileSync(path.join(tmpDir, 'build-a.ps1'), entryBody, 'utf8')
      fs.writeFileSync(path.join(tmpDir, 'build-b.ps1'), entryBodyB, 'utf8')
      fs.writeFileSync(path.join(tmpDir, 'no-out.ps1'), esbuildNoOut, 'utf8')
      fs.writeFileSync(path.join(tmpDir, 'plain-b.ps1'), plainBody, 'utf8')
      // ① ★★ 负控：新增一个含 entry 的脚本而清单没跟上 ⇒ 必须报红（**W81 整类无守的形态**）
      fs.writeFileSync(path.join(tmpDir, 'build-new.ps1'), entryBody, 'utf8')
      {
        const r = A(tmpDir, ['build-a.ps1', 'build-b.ps1'])
        const hit = r.problems.length === 1 && /build-new\.ps1/.test(r.problems[0])
        console.log(`[selftest] ${hit ? 'PASS' : 'FAIL'}  （W81 · 负控）新增含 entry 的构建脚本而清单没跟上 ⇒ **必须报红**  → ${JSON.stringify(r.problems.map(p => p.slice(0, 60)))}`)
        if (hit) pass++
        total++
      }
      // ② ★ 正控：两侧一致 ⇒ 不得报红
      {
        const r = A(tmpDir, ['build-a.ps1', 'build-b.ps1', 'build-new.ps1'])
        const ok = r.problems.length === 0 && r.discovered.length === 3
        console.log(`[selftest] ${ok ? 'PASS' : 'FAIL'}  （W81 · 正控）清单与语义发现一致 ⇒ **不得报红**  → discovered=${JSON.stringify(r.discovered)}`)
        if (ok) pass++
        total++
      }
      // ③ ★★ 负控：清单里写了一个**不含 entry** 的脚本 ⇒ 必须报红（手写清单过期）
      {
        const r = A(tmpDir, ['build-a.ps1', 'build-b.ps1', 'build-new.ps1', 'plain-b.ps1'])
        const hit = r.problems.length === 1 && /plain-b\.ps1/.test(r.problems[0]) && /过期/.test(r.problems[0])
        console.log(`[selftest] ${hit ? 'PASS' : 'FAIL'}  （W81 · 负控）清单里的脚本**不含 entry** ⇒ **必须报红**（手写清单过期）  → ${JSON.stringify(r.problems.map(p => p.slice(0, 60)))}`)
        if (hit) pass++
        total++
      }
      // ④ ★ 杠杆：删掉那个新增脚本 ⇒ 必须回绿（证明①②③不是恒定红）
      {
        fs.unlinkSync(path.join(tmpDir, 'build-new.ps1'))
        const r = A(tmpDir, ['build-a.ps1', 'build-b.ps1'])
        const ok = r.problems.length === 0
        console.log(`[selftest] ${ok ? 'PASS' : 'FAIL'}  （W81 · 杠杆）删掉那个新增脚本后 ⇒ **必须回绿**  → problems=${r.problems.length}`)
        if (ok) pass++
        total++
      }
      // ⑤ ★ 零控：**不含 entry 的脚本不得进发现面**（防过宽 —— P-38）
      {
        const r = A(tmpDir, ['build-a.ps1', 'build-b.ps1'])
        const ok = !r.discovered.includes('plain-b.ps1')
        console.log(`[selftest] ${ok ? 'PASS' : 'FAIL'}  （W81 · 零控）不含 entry 的脚本**不进发现面**（防过宽）  → ${JSON.stringify(r.discovered)}`)
        if (ok) pass++
        total++
      }
      // ⑥ ★★ 零控：**含 esbuild 但无 `--outfile`** ⇒ 不进发现面（**不产产物 ⇒ 不属权威构建脚本**）
      {
        const r = A(tmpDir, ['build-a.ps1', 'build-b.ps1'])
        const ok = !r.discovered.includes('no-out.ps1')
        console.log(`[selftest] ${ok ? 'PASS' : 'FAIL'}  （W81 · 零控）含 esbuild 但**无 --outfile** ⇒ 不进发现面（不产产物）  → ${JSON.stringify(r.discovered)}`)
        if (ok) pass++
        total++
      }
      // ⑥b ★★ 正控：**形态 B（变量体 `$esb`）必须被认**（**W81 实测踩到的口径缺陷**）
      {
        const r = A(tmpDir, ['build-a.ps1', 'build-b.ps1'])
        const ok = r.discovered.includes('build-b.ps1')
        console.log(`[selftest] ${ok ? 'PASS' : 'FAIL'}  （W81 · 正控）**形态 B（$esb 变量体）必须被认**（首版只认同行形态 ⇒ 真实仓库只发现 1 个）  → ${JSON.stringify(r.discovered)}`)
        if (ok) pass++
        total++
      }
      // ⑦ ★★ 真实仓库控：**当前受检面必须两侧一致**（否则主流程会红）
      {
        const r = A(HERE, ['build-dsht.ps1', 'rebuild-plugins.ps1'])
        const ok = r.problems.length === 0
        console.log(`[selftest] ${ok ? 'PASS' : 'FAIL'}  （W81 · 真实仓库）权威脚本清单与语义发现**两侧一致**  → discovered=${JSON.stringify(r.discovered)}`)
        if (ok) pass++
        total++
      }
      // ⑧ ★★ 真实仓库控：**确有对象被发现**（否则「0 违规」是零样本冒充通过 —— P-30）
      {
        const r = A(HERE, ['build-dsht.ps1', 'rebuild-plugins.ps1'])
        const ok = r.discovered.length >= 2
        console.log(`[selftest] ${ok ? 'PASS' : 'FAIL'}  （W81 · 真实仓库）**确有对象被发现**（≥2）  → ${r.discovered.length}`)
        if (ok) pass++
        total++
      }
      // ⑨ ★★ **单源口径控**（**P-1 / P-46**）：`discoverAuthoritativeScripts` 与判据⑨ **同一口径**
      {
        const d = discoverAuthoritativeScripts(HERE).map(x => x.name)
        const r = A(HERE, ['build-dsht.ps1', 'rebuild-plugins.ps1'])
        const ok = JSON.stringify(d) === JSON.stringify(r.discovered)
        console.log(`[selftest] ${ok ? 'PASS' : 'FAIL'}  （W81 · 单源）发现器与判据⑨**同一口径**  → ${JSON.stringify(d)}`)
        if (ok) pass++
        total++
      }
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* 已删 */ }
    }
  }

  // ---- ★★ W82 新增：**判据⑩（PAIRS 的路径字段必须指向真实存在的对象）** 的成对控 ----
  //   ★ 控必须**成对**（**P-67 纪律③**）：① entry 幽灵 ⇒ 必须报红（**假红形态**）；
  //     ② source 幽灵 ⇒ 必须报红（**静默失效形态**，本轮实测）；③ 全真 ⇒ 不得报红；
  //     ④ 杠杆（把幽灵改回真路径 ⇒ 转绿）；⑤ builtBy 点名不存在的装置 ⇒ 必须报红（**P-62**）；
  //     ⑥ ★★ **基准口径控**（**P-45**）：`source` 必须按 **`rp-workspace/` 相对**解析
  //     （若错按仓库根解析 ⇒ 真实仓库会**全项假红** —— 这正是我探针首版踩的坑）。
  {
    const exists = (set) => (p) => set.has(p.replace(/\\/g, '/'))
    const WSABS = 'D:/x/rp-workspace'
    const ROOTABS = 'D:/x'
    const mk = (over) => ({ name: 'T-x', entry: 'src/a/index.ts', source: ['packages/src/a.ts'], builtBy: 'build-dsht.ps1', artifact: 'r/a.js', ...over })
    const allReal = new Set([
      `${WSABS}/packages/src/a/index.ts`,
      `${WSABS}/packages/src/a.ts`,
      `${WSABS}/scripts/build-dsht.ps1`,
    ])
    const P = (pairs, set = allReal) => pairFieldProblems(pairs, exists(set), WSABS, ROOTABS)
    // ① ★★ 负控：entry 幽灵 ⇒ 必须报红（**假红形态** —— checkPair 会编译不存在的源码）
    {
      const r = P([mk({ entry: 'src/ghost/index.ts' })])
      const hit = r.problems.length === 1 && /entry/.test(r.problems[0]) && /假红/.test(r.problems[0])
      console.log(`[selftest] ${hit ? 'PASS' : 'FAIL'}  （W82 · 负控）\`entry\` 幽灵路径 ⇒ **必须报红**（假红形态）  → ${JSON.stringify(r.problems.map(p => p.slice(0, 55)))}`)
      if (hit) pass++
      total++
    }
    // ② ★★ 负控：source 幽灵 ⇒ 必须报红（**静默失效形态** —— 本轮实测）
    {
      const r = P([mk({ source: ['packages/src/GHOST.ts'] })])
      const hit = r.problems.length === 1 && /source/.test(r.problems[0]) && /恒过/.test(r.problems[0])
      console.log(`[selftest] ${hit ? 'PASS' : 'FAIL'}  （W82 · 负控）\`source\` 幽灵路径 ⇒ **必须报红**（静默失效形态）  → ${JSON.stringify(r.problems.map(p => p.slice(0, 55)))}`)
      if (hit) pass++
      total++
    }
    // ③ ★ 正控：全真 ⇒ 不得报红
    {
      const r = P([mk()])
      const ok = r.problems.length === 0 && r.checked === 3
      console.log(`[selftest] ${ok ? 'PASS' : 'FAIL'}  （W82 · 正控）三个字段都真实存在 ⇒ **不得报红**  → checked=${r.checked}`)
      if (ok) pass++
      total++
    }
    // ④ ★ 杠杆：把幽灵改回真路径 ⇒ 必须转绿（证明①②不是恒定红）
    {
      const ghost = P([mk({ entry: 'src/ghost/index.ts' })])
      const real = P([mk()])
      const ok = ghost.problems.length === 1 && real.problems.length === 0
      console.log(`[selftest] ${ok ? 'PASS' : 'FAIL'}  （W82 · 杠杆）把 \`entry\` 改回真路径 ⇒ **必须转绿**  → ${ghost.problems.length}→${real.problems.length}`)
      if (ok) pass++
      total++
    }
    // ⑤ ★★ 负控：builtBy 点名**不存在的装置** ⇒ 必须报红（**P-62**：声明必须能被指认）
    {
      const r = P([mk({ builtBy: 'ghost-build.ps1 / build-dsht.ps1' })])
      const hit = r.problems.length === 1 && /builtBy/.test(r.problems[0]) && /ghost-build\.ps1/.test(r.problems[0])
      console.log(`[selftest] ${hit ? 'PASS' : 'FAIL'}  （W82 · 负控）\`builtBy\` 点名的装置不存在 ⇒ **必须报红**（P-62）  → ${JSON.stringify(r.problems.map(p => p.slice(0, 55)))}`)
      if (hit) pass++
      total++
    }
    // ⑥ ★★ **基准口径控**（**P-45**）：`source` 必须按 `rp-workspace/` 相对解析
    {
      // 若错按「仓库根」解析（`D:/x/packages/src/a.ts`），则 WS 侧的真实文件**找不到** ⇒ 假红
      const rWs = P([mk()], allReal)                    // 按 WS 基准（正确）⇒ 绿
      const rootOnly = new Set([`${ROOTABS}/packages/src/a.ts`, `${ROOTABS}/packages/src/a/index.ts`, `${ROOTABS}/scripts/build-dsht.ps1`])
      const rRoot = P([mk()], rootOnly)                 // 模拟「按仓库根解析」⇒ 应报红（证明基准不同源会被发现）
      const ok = rWs.problems.length === 0
      console.log(`[selftest] ${ok ? 'PASS' : 'FAIL'}  （W82 · 口径）\`source\` 按 \`rp-workspace/\` 相对解析 ⇒ 真实路径命中（不假红）  → ${rWs.problems.length} 处`)
      if (ok) pass++
      total++
      // ★ 反向断言：若把同一份文件放到**另一套基准**下 ⇒ 判据会报红（证明基准是**真的在判**的）
      const ok2 = rRoot.problems.length >= 2
      console.log(`[selftest] ${ok2 ? 'PASS' : 'FAIL'}  （W82 · 杠杆 · 基准）换到**另一套基准** ⇒ **必须报红**（证明基准口径真的在判）  → ${rRoot.problems.length} 处`)
      if (ok2) pass++
      total++
    }
    // ⑦ ★★ 真实仓库控：当前 PAIRS **全部字段有效**（否则主流程会红）
    {
      const r = pairFieldProblems(PAIRS, (p) => fs.existsSync(p), WS, REPO_ROOT)
      const ok = r.problems.length === 0
      console.log(`[selftest] ${ok ? 'PASS' : 'FAIL'}  （W82 · 真实仓库）PAIRS 全部路径字段有效  → checked=${r.checked} ${JSON.stringify(r.problems.slice(0, 2))}`)
      if (ok) pass++
      total++
    }
    // ⑧ ★★ 真实仓库控：**确有对象被检查**（否则「0 违规」是零样本冒充通过 —— P-30）
    {
      const r = pairFieldProblems(PAIRS, (p) => fs.existsSync(p), WS, REPO_ROOT)
      const ok = r.checked >= 10
      console.log(`[selftest] ${ok ? 'PASS' : 'FAIL'}  （W82 · 真实仓库）**确有对象被检查**（≥10 个字段）  → ${r.checked}`)
      if (ok) pass++
      total++
    }
    // ⑨ ★ 零控：PAIRS 为空 ⇒ `checked=0` 且出声（P-43）
    {
      const r = P([])
      const ok = r.checked === 0 && r.problems.length === 0 && r.notes.length === 1
      console.log(`[selftest] ${ok ? 'PASS' : 'FAIL'}  （W82 · 零控）空 PAIRS ⇒ 无对象可判且**出声**（P-43）  → ${JSON.stringify(r.notes)}`)
      if (ok) pass++
      total++
    }
  }
  return { pass, total, ok: pass === total }
}

/**
 * 反控：人为破坏产物 ⇒ 必须报红 ⇒ 还原 ⇒ 必须回绿。
 * 只在第一个**非 optional 且存在**的产物上做（避免污染 runtime 产物）。
 */
function negativeControl () {
  const target = PAIRS.find(p => !p.optional)
  if (!target) { console.log('[negctl] 无可用靶点（全是 optional）'); return false }
  const abs = path.join(WS, target.artifact)
  if (!fs.existsSync(abs)) { console.log(`[negctl] 靶点不存在：${target.artifact}`); return false }
  const backup = fs.readFileSync(abs)
  let ok = false
  try {
    // 破坏：追加一个字节（长度变化必然不等）
    fs.writeFileSync(abs, Buffer.concat([backup, Buffer.from('\n// A14-NEGCTL\n')]))
    const broken = checkPair(target)
    console.log(`[negctl] 破坏后 → ok=${broken.ok}（期望 false）`)
    if (broken.ok) { console.log('[negctl] FAIL —— 破坏后仍报"新鲜"，闸门无效'); return false }
    // 还原
    fs.writeFileSync(abs, backup)
    const restored = checkPair(target)
    console.log(`[negctl] 还原后 → ok=${restored.ok}（期望 true）`)
    ok = restored.ok
    if (!ok) console.log(`[negctl] FAIL —— 还原后仍报陈旧：${restored.reason ?? ''}\n${restored.detail ?? ''}`)
  } finally {
    fs.writeFileSync(abs, backup)   // 无论如何都还原
  }
  return ok
}

// ---------------------------------------------------------------------------

const argv = process.argv.slice(2)
const VERBOSE = argv.includes('-v')

// 【W29】只有**被当作主程序直接执行**时才跑判定；被 `import` 时（如
// `audit-a14-anchor-negctl.mjs` 复用本文件的解析器）**不得**产生副作用与输出。
// 修前实测：负控脚本 import 本模块时把 A14 的整套判定（含 7 条配对、每条现场重编译）
// 全都跑了一遍 ⇒ 输出里混进 A14 的报告，且白白多花几十秒。
// 与 `verify-rp-consolidation.mjs` 的 `--selftest-parser` 守卫同款思路。
const IS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (!IS_MAIN) {
  // 被导入：只导出纯函数，不执行任何判定
} else if (argv.includes('--selftest')) {
  // ★★ **W72：接入单源自证分数契约**（**P-50**）——
  //   此前收尾是自造行 `[selftest] PASS —— 闸门自身可信` ⇒ **机器读不出分数** ⇒
  //   §3.2 里关于它的任何分数声明**无法被证伪**（**P-11 元级**）。
  //   ⇒ 按 **P-1** 复用唯一产出点 `reportSelftest`。
  const r = selftest()
  console.log(r.ok ? '\n[selftest] PASS —— 闸门自身可信' : '\n[selftest] FAIL —— 闸门不可信，先修闸门')
  reportSelftest('artifact-freshness', r.pass, r.total)
  process.exit(r.ok ? 0 : 1)
} else if (argv.includes('--negative-control')) {
  const ok = negativeControl()
  console.log(ok ? '\n[negctl] PASS —— 闸门能报红、且还原后能回绿' : '\n[negctl] FAIL —— 反控未通过')
  process.exit(ok ? 0 : 1)
} else {

let failed = 0

// ---- ★★ 判据⑨（W81 新增）：**权威构建脚本必须按语义自动发现，不得手写名单** ----
//   由头：本文件的 `readAllAuthoritativeScripts()` 与 `audit-a14-anchor-negctl.mjs`
//     各写了一份相同的 2 项手写清单 —— ★★ W81 决定性实验：新建第三个含 entry 的 `.ps1`
//     ⇒ **十个闸门全部 exit=0** ⇒ 该面**整类无守**（且两处清单**不同源** ⇒ **P-1/P-46**）。
//   ★ 判据双向（守 P-46）：发现 > 声明 ⇒ 报红（新增的不会被想起）；声明 > 发现 ⇒ 报红（清单过期）。
const AUTH_DECLARED = ['build-dsht.ps1', 'rebuild-plugins.ps1']
{
  const ap = authoritativeScriptProblems(HERE, AUTH_DECLARED)
  if (ap.problems.length) {
    console.log(`[A14] ✗ 判据⑨（权威构建脚本按语义自动发现）：${ap.problems.length} 处不一致`)
    for (const p of ap.problems) console.log(`[A14] ✗   ${p}`)
    console.log('[A14] ⇒ 手写清单与语义发现不一致（P-80：手写清单在写下的一刻就开始过期）')
    failed += ap.problems.length
  } else {
    console.log(`[A14] 判据⑨（权威构建脚本按语义自动发现）：发现 ${ap.discovered.length} 个含 entry 声明的脚本`
      + `（${ap.discovered.join(' + ')}）· 与手写清单**两侧一致** · 违规 0 处`)
  }
}

// 【W29 · P-41】从**权威构建脚本**实读「产物 → entry」，覆盖 PAIRS 里可能过期的硬编码值。
// 为什么放在这里（而不是改 PAIRS 的常量）：PAIRS 的 entry 是「架构应该长成什么样」的**代理量**，
// 而真正的事实是「权威路径实际编译的是哪个 entry」—— 后者会随 T-87 迁移自动改变。
// ⇒ 读脚本（P-27），让判据在迁移前后都锚在事实上；读不到则出声退回现值（P-11）。
// ⇒ **常驻负控**：`scripts/audit-a14-anchor-negctl.mjs`（3 条独立断言：
//   锚点来自权威脚本 / 用解析出的 entry 重编译 ≡ 产物 / 换错误 entry 字节必然不同）。
//
// ⚠️ **必须读两条路径**（W29 首跑实测的缺陷）：两条脚本的**产出集合不同** ——
//   `build-dsht.ps1` 不产 undo/preflight，`rebuild-plugins.ps1` 不产 R10 独立包与
//   `dsht-plugin-prompt-template/lib/ejs-worker.js`。只读一条 ⇒ 另一条独有的产物被判
//   「读不到 entry」（首跑实测 3 条），等于**退回硬编码值**，判据在那里又变成代理量。
const authScripts = readAllAuthoritativeScripts()
// 逐条产物收集**所有**声明（不是一个值）—— 因为实测两条路径对同一产物可能声明不同 entry，
// 而「取哪一个」不能由我静默决定：那正是 P-41 的代理量错误（选错一个就把真新鲜判成陈旧，实测踩到）。
// ⇒ 口径：**只要磁盘产物与其中任一 entry 的重编译结果逐字节一致，即判新鲜**（该产物确实是
//   权威路径之一的确定性输出）；全都不一致才报红。两种以上声明时出声。
const entryDecls = new Map()          // 键 = 归一化产物路径；值 = [{entry, from}]
for (const s of authScripts) {
  for (const [dst, entry] of parseArtifactEntries(s.text)) {
    if (!entryDecls.has(dst)) entryDecls.set(dst, [])
    const list = entryDecls.get(dst)
    if (!list.some(d => d.entry === entry)) list.push({ entry, from: s.name })
  }
}
if (authScripts.length === 0) {
  console.log('[A14] ⚠️ 读不到任何权威构建脚本 ⇒ 锚点退回 PAIRS 现值（判定力可能不足）')
} else {
  const total = [...entryDecls.values()].reduce((n, l) => n + l.length, 0)
  console.log(`[A14] 权威脚本锚点：从 ${authScripts.map(s => s.name).join(' + ')} 实读 ${total} 条「产物 → entry」（去重后 ${entryDecls.size} 个产物）`)
  for (const [dst, list] of entryDecls) {
    if (list.length > 1) {
      console.log(`[A14] ⓘ node_modules/${dst} 有 ${list.length} 条 entry 声明（逐条试编译，任一一致即判新鲜）：` +
        list.map(d => `${d.entry}（${d.from}）`).join(' · '))
    }
  }
}

// ---- ★★ 判据⑩（W82 新增）：**PAIRS 的路径字段必须指向真实存在的对象** ----
//   由头：W81 给「权威构建脚本清单」装了双向对账；本轮按 P-70 纪律① 继续穷举 ⇒
//     本文件的 `PAIRS` 是**数据表**，`entry` / `source` / `builtBy` 全是手写路径，
//     而「它们还有效吗」**没有任何机器问**。
//   ★★ W82 决定性实验：把 `source` / `entry` 改成幽灵路径 ⇒ **十个闸门全部 exit=0**。
//   ★★ 危害（**P-30**）：`source` 错了 ⇒ `skipByteCompare` 分支的源文本拼成空串
//     ⇒ `markers` 一个都找不到 ⇒ **该判据恒过**（失效与通过同貌）。
{
  const pf = pairFieldProblems(PAIRS, (p) => fs.existsSync(p), WS, REPO_ROOT)
  if (pf.problems.length) {
    console.log(`[A14] ✗ 判据⑩（PAIRS 字段真实性）：${pf.problems.length} 处字段失效`)
    for (const p of pf.problems) console.log(`[A14] ✗   ${p}`)
    console.log('[A14] ⇒ 数据表里的路径**已经指不到东西**（P-62：声明必须能被指认）')
    failed += pf.problems.length
  } else {
    console.log(`[A14] 判据⑩（PAIRS 字段真实性）：核对 ${pf.checked} 个路径字段（entry = packages/ 相对 · `
      + `source = rp-workspace/ 相对 · builtBy 点名的装置）· 违规 0 处`)
  }
  for (const n of pf.notes) console.log(`[A14] ⓘ ${n}`)
}

for (const pair of PAIRS) {
  const key = normNodeModules(pair.artifact) ?? pair.artifact
  const decls = entryDecls.get(key) ?? []
  // 无声明 ⇒ 退回 PAIRS 现值并出声；有声明 ⇒ 逐条试（第一条由 checkPair 直接判，其余在此兜底）
  let r
  if (authScripts.length === 0 || decls.length === 0) {
    r = checkPair(pair, authScripts.length === 0 ? {} : { entryFromScript: null })
  } else {
    r = checkPair(pair, { entryFromScript: decls[0].entry })
    if (!r.ok && decls.length > 1) {
      for (const d of decls.slice(1)) {
        const alt = checkPair(pair, { entryFromScript: d.entry })
        if (alt.ok) { r = { ok: true, reason: `（entry 取自权威脚本 ${d.from}：${pair.entry} → ${d.entry}）` }; break }
      }
    }
  }
  if (r.ok) {
    console.log(`✓ ${pair.name}${r.reason ? `  — ${r.reason}` : '  — 与现场重编译逐字节一致'}`)
  } else {
    failed++
    console.log(`✗ ${pair.name}`)
    if (r.reason) console.log(`    ${r.reason}`)
    if (r.detail) console.log(r.detail.split('\n').map(l => `    ${l}`).join('\n'))
    console.log(`    ⇒ 重跑构建即可修复：`)
    console.log(`       · ${pair.builtBy}`)
    console.log(`       · 或本机（无 WSL bash 时）：pwsh rp-workspace/scripts/rebuild-plugins.ps1`)
  }
}

if (failed > 0) {
  console.log(`\n[A14] 违约：${failed} 个产物与当前源码不一致。设备/浏览器跑的是**产物**，不重建即不生效。`)
  process.exit(1)
}
console.log('\n[A14] OK —— 全部产物与当前源码的编译结果逐字节一致（新鲜且可复现）')

}   // end of IS_MAIN 分支
