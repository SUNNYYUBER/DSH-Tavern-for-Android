#!/usr/bin/env node
/**
 * audit-nodeservice-deploy.mjs — 守 NodeService/MainActivity 的「部署 + 迁移前置」四条不变量
 * ============================================================================
 * 【为什么需要它（W-3 真机 boot loop 事故，2026-09-21）】
 * 该事故连爆三层，每层都是「静态看起来全对、只有真机才炸、代价是**整个 DSH 起不来**」：
 *
 *   ① **拷贝集 ⊂ patch 集**：`dsht-device` 被加进 `pluginRows`（patch 写入）却**没加进**
 *      插件拷贝循环 ⇒ profile patch 引用了 `dsht-plugin-device`，而 App 从不把它拷进
 *      `profiles/web/node_modules` ⇒ Cordis 的 loader 拿不到该 entry
 *      （`entry.fiber === undefined`，**不是**「加载抛错」）⇒
 *      `assertEntriesLoaded` 抛 `plugin(s) failed to load: dsht-plugin-device` ⇒ boot loop。
 *      ⚠️ 隐蔽点：老设备上可能有**上一次部署的孤儿目录**，看起来「包在场」，实际与 patch 的
 *      引用没有任何契约关系 ⇒ **只在干净安装时暴露**，本地/老设备都不复现。
 *
 *   ② **顶层 inject 声明了本层不可得的 service**：见 `dsht-plugin-device/index.ts` 的
 *      `inject` 注释（`tools`/`systemPrompt` 是 agent 会话面服务，web profile 全局层没有）
 *      ⇒ 父 fiber 停 PENDING ⇒ `could not be resolved` ⇒ 同样 boot loop。
 *      该条由 `packages/tests/w3-device-plugin.spec.ts` 的单测守（更快、更贴近源码）。
 *
 *   ③ **`patchReload: "live"` 在 Android 上不可满足**：它让 `runProfile` 在 boot 之后走
 *      `watchUserPatches`，而后者**硬依赖 Cordis HMR 服务**（`ctx.get("hmr")` 非空），
 *      否则 throw；HMR 在 Android 起不来（dsh-base 的 bundle patch 里 `hmr` 行
 *      `disabled: true`）⇒ boot loop。**只在插件树修好后才会暴露**（被①掩盖）。
 *      合法取值只有 "live"/"startup"（dsh-app-boot 的 loadProfileDirectory 硬校验）。
 *
 * ---
 * 【判据】
 *   1. **拷贝集 ≡ patch 集**：NodeService 里「插件拷贝循环」的包名集合，必须与
 *      `pluginRows`（patch 写入）的包名集合**相等**。这是①的直接判据。
 *   2. **patchReload ≠ live**：`pkgCanonical` 里必须是 `"startup"`。这是③的直接判据。
 *   3. **老安装升级可达性**：`package.json` 的重写守卫必须**覆盖 patchReload**
 *      （否则老用户的 `"live"` 会残留，升级后继续 boot loop）。
 *   4. **★ 会话格式代次常量不得漂移**（2026-09-23 DSH 0.1.7 升级轮新增）：
 *      `MainActivity.CURRENT_SESSION_GENERATION` 必须等于单源 `dsh-version.json` 的
 *      `sessionFormatKnownGenerations` 的**最大值**。
 *      【为什么这也算"部署契约"】该常量是 **v4 迁移前置闸门**的判定上界
 *      （「会话头 version < 本值 ⇒ 待迁移 ⇒ 打开前先强制全量备份」）。它落后一代 ⇒
 *      **静默少备份一整代会话** ⇒ 用户打开老会话后被官方**不可逆**迁移，回退无门。
 *      ⇒ 与①②③同族：**静态看全对、只在真机发作、代价是数据**。
 *
 * 【为什么不能只靠单测】判据 1/2/3/4 是 **Kotlin 源码里跨段落（乃至跨文件）的一致性**，
 * 没有可运行的单元边界；而它们一旦破了，代价是整机不可用或**数据不可逆丢失**。
 * 故必须有一条**静态对账**常驻。
 *
 * 用法：node scripts/audit-nodeservice-deploy.mjs [--selftest]
 * 退出码：0 = 契约完整；1 = 破约；2 = 文件缺失；3 = selftest 失败
 */

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const WS = resolve(HERE, '..')
const KT = join(WS, 'android', 'app', 'src', 'main', 'java', 'com', 'dshtavern', 'app', 'NodeService.kt')

/** 抽 `listOf("a","b",...)` / 多行形态里的字符串项。 */
function listOfItems(text) {
  return [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1])
}

/**
 * 抽「所有会被部署到 profile 的包名」集合 = 两种部署形态的并集：
 *   · 循环形态：`for (pkg in listOf("a","b")) { copyPackage(webProfile, pkg, ...) }`
 *   · 独立形态：`copyPackage(webProfile, "dsht-plugin-mobile", "lib/index.js", ...)`
 *              `copyPackageDir(webProfile, "dsht-rp-plugin", "assets")`
 *              `copyPackageTree(webProfile, "dsh-preset-enhance")`
 *
 * 【为什么必须两种都算】首版只解析 listOf 循环 ⇒ 对 `dsht-rp-plugin` /
 * `dsht-plugin-mobile` / `dsh-preset-enhance` 三个**走独立语句**的包报假红
 * （实测 3 处）。判据要判的是「**最终的部署面**」，不是「某一种写法」。
 */
function parseDeployedPackages(text) {
  const set = new Set()
  // 循环形态
  const loop = text.match(/for\s*\(\s*\w+\s+in\s+listOf\(([\s\S]*?)\)\s*\)\s*\{/)
  if (loop) for (const p of listOfItems(loop[1])) set.add(p)
  // 独立调用形态：copyPackage*(webProfile, "<pkg>", ...)  或 copyPackageTree(webProfile, "<pkg>")
  for (const m of text.matchAll(/copy(?:Package|PackageDir|PackageTree)\(\s*\w+\s*,\s*"([^"]+)"/g)) {
    set.add(m[1])
  }
  if (set.size === 0) throw new Error('未能解析出任何被部署的包（copyPackage 形态变了？）')
  return [...set]
}

/**
 * 抽「插件拷贝循环」遍历的包名集合（保留：用于读数展示与重复项检查）。
 */
function parseCopyLoop(text) {
  const m = text.match(/for\s*\(\s*\w+\s+in\s+listOf\(([\s\S]*?)\)\s*\)\s*\{/)
  if (!m) throw new Error('未找到插件拷贝循环 for (pkg in listOf(...)) {')
  return listOfItems(m[1])
}

/**
 * 抽 `pluginRows`（patch 写入）的包名集合。
 * 形态：`"dsht-rp" to "dsht-rp-plugin"` ——取 `to` **右侧**（真正的 npm 包名）。
 */
function parsePluginRows(text) {
  const m = text.match(/val\s+pluginRows\s*=\s*listOf\(([\s\S]*?)\n\s*\)/)
  if (!m) throw new Error('未找到 val pluginRows = listOf(...)')
  return [...m[1].matchAll(/"([^"]+)"\s+to\s+"([^"]+)"/g)].map((x) => x[2])
}

/** 抽 `pkgCanonical` 里的 patchReload 取值。 */
function parsePatchReload(text) {
  const m = text.match(/"patchReload"\s*:\s*"([^"]+)"/)
  return m ? m[1] : null
}

export function audit({ ktText, mainText = '', knownGenerations = null }) {
  const problems = []
  const notes = []

  // ---- 判据 1：部署集 ⊇ patch 集（且互相不缺） ----
  const copyList = parseDeployedPackages(ktText)
  const copySet = new Set(copyList)
  const rowSet = new Set(parsePluginRows(ktText))

  for (const p of rowSet) {
    if (!copySet.has(p)) {
      problems.push(
        `判据1: pluginRows 引用了 '${p}'，但它**不在部署面**（拷贝循环/独立 copyPackage*）里 —— ` +
          `profile patch 会引用一个 App 从不部署的包 ⇒ loader 拿不到 entry ` +
          `(entry.fiber === undefined) ⇒ assertEntriesLoaded 抛错 ⇒ **DSH boot loop**` +
          `（W-3 事故原型；且只在干净安装暴露）`,
      )
    }
  }
  for (const p of copySet) {
    if (!rowSet.has(p)) {
      problems.push(`判据1: 部署面里有 '${p}'，但 pluginRows 没有登记 ⇒ 包被拷进却永不被 mount（装了等于没装）`)
    }
  }
  const loopList = parseCopyLoop(ktText)
  if (new Set(loopList).size !== loopList.length) problems.push('判据1: 拷贝循环有重复项')
  notes.push(`部署集（${copySet.size}）≡ patch 集（${rowSet.size}）：${[...copySet].join(', ')}`)

  // ---- 判据 2：patchReload 不得是 live ----
  const reload = parsePatchReload(ktText)
  if (reload === null) {
    problems.push('判据2: 未找到 "patchReload" 取值（pkgCanonical 可能被改写）')
  } else if (reload === 'live') {
    problems.push(
      `判据2: patchReload 是 "live" —— 它让 runProfile 走 watchUserPatches，` +
        `而后者硬依赖 Cordis HMR 服务；HMR 在 Android 起不来 ⇒ 抛 ` +
        `"user patch-layer watching requires the Cordis HMR service" ⇒ **DSH boot loop**`,
    )
  } else if (reload !== 'startup') {
    problems.push(`判据2: patchReload="${reload}" 非法（dsh-app-boot 只接受 "live"/"startup"）`)
  } else {
    notes.push('patchReload = "startup"（不依赖 HMR 服务）')
  }

  // ---- 判据 3：重写守卫必须覆盖 patchReload ----
  // 形态要求：判定条件里出现对 `"patchReload": "live"` 的检测（防老用户残留）
  const guardOk = /pkgText\.contains\(\s*"\\"patchReload\\":\s*\\"live\\""\s*\)/.test(ktText)
  if (!guardOk) {
    problems.push(
      '判据3: package.json 的重写守卫未覆盖 patchReload —— 老安装的 package.json 已含 ' +
        '"dsh-web-app"，只判该字符串会让 `"patchReload": "live"` 在升级后**残留** ⇒ 老用户继续 boot loop',
    )
  } else {
    notes.push('重写守卫覆盖 patchReload（老安装升级可达）')
  }

  // ---- 判据 4：会话格式代次常量 与 单源 knownGenerations 不得漂移 ----
  //
  // 【为什么要有这条】MainActivity 的 `CURRENT_SESSION_GENERATION` 是 **v4 迁移前置闸门**
  // 的判定上界（「文件头 version < 本值 ⇒ 待迁移 ⇒ 先强制备份」）。若它比单源
  // `sessionFormatKnownGenerations` 的**最大值**小，闸门就会**漏判**一整代会话
  // ⇒ 用户在没有备份的情况下打开老会话 ⇒ 不可逆迁移后无法回退。
  // ⇒ 这条漂移是「静默少备份」，不报错、不崩溃，只能靠判据抓（P-30）。
  const ktGen = (() => {
    const m = mainText.match(/CURRENT_SESSION_GENERATION\s*=\s*(\d+)/)
    return m ? Number(m[1]) : null
  })()
  if (knownGenerations === null) {
    notes.push('判据4: 未提供 knownGenerations（跳过 —— 只跑单文件审计时无法判定漂移）')
  } else if (ktGen === null) {
    problems.push(
      '判据4: MainActivity 里未找到 CURRENT_SESSION_GENERATION —— v4 迁移前置闸门的判定上界缺失，' +
        '「迁移前强制全量备份」将无从判断哪些会话待迁移',
    )
  } else {
    const want = Math.max(...knownGenerations)
    if (ktGen !== want) {
      problems.push(
        `判据4: 代次常量漂移 —— MainActivity.CURRENT_SESSION_GENERATION=${ktGen}，` +
          `而单源 dsh-version.json 的 sessionFormatKnownGenerations 最大值为 ${want} ⇒ ` +
          `迁移前置闸门会**漏判**代次在 [${ktGen}, ${want}) 区间的会话，` +
          `这些会话将在**没有备份**的情况下被不可逆地迁移`,
      )
    } else {
      notes.push(`代次常量一致：CURRENT_SESSION_GENERATION=${ktGen} = max(knownGenerations)`)
    }
  }

  return { problems, notes }
}

// ---------------------------------------------------------------------------
// selftest：正控 + 负控（合成输入，不依赖真实仓库状态）
// ---------------------------------------------------------------------------

function selftest() {
  const results = []
  const ok = (name, cond) => results.push([name, !!cond])

  const good = `
private fun f() {
  for (pkg in listOf("dsht-plugin-mvu", "dsht-plugin-device")) {
    copyPackage(webProfile, pkg, "lib/index.js", "{}")
  }
  val pluginRows = listOf(
    "dsht-mvu" to "dsht-plugin-mvu",
    "dsht-device" to "dsht-plugin-device",
  )
  val pkgCanonical = """
      |      "patchReload": "startup"
  """
  if (pkgText == null || !pkgText.contains("dsh-web-app") || pkgText.contains("\\"patchReload\\": \\"live\\"")) {
    pkgJson.writeText(pkgCanonical)
  }
}
`
  // 1) 正控
  {
    const r = audit({ ktText: good })
    ok('正控：契约完整时无问题', r.problems.length === 0)
  }
  // 2) 负控 A：patch 集有、拷贝集缺（事故原型①）
  {
    const r = audit({ ktText: good.replace('"dsht-plugin-mvu", "dsht-plugin-device"', '"dsht-plugin-mvu"') })
    ok('负控A：patch 引用了未拷贝的包被抓（判据1）', r.problems.some((p) => p.startsWith('判据1') && p.includes('dsht-plugin-device')))
  }
  // 3) 负控 B：patchReload 回退成 live（事故原型③）
  {
    const r = audit({ ktText: good.replace('"patchReload": "startup"', '"patchReload": "live"') })
    ok('负控B：patchReload=live 被抓（判据2）', r.problems.some((p) => p.startsWith('判据2')))
  }
  // 4) 负控 C：守卫漏掉 patchReload 检测（老安装残留）
  {
    const r = audit({ ktText: good.replace(' || pkgText.contains("\\"patchReload\\": \\"live\\"")', '') })
    ok('负控C：守卫未覆盖 patchReload 被抓（判据3）', r.problems.some((p) => p.startsWith('判据3')))
  }
  // 5) 负控 D：拷贝有、patch 无（装了等于没装）
  {
    const r = audit({ ktText: good.replace('    "dsht-device" to "dsht-plugin-device",\n', '') })
    ok('负控D：拷贝集多出未被 mount 的包被抓（判据1）', r.problems.some((p) => p.startsWith('判据1') && p.includes('永不被 mount')))
  }
  // 6) 负控 E：非法取值
  {
    const r = audit({ ktText: good.replace('"patchReload": "startup"', '"patchReload": "never"') })
    ok('负控E：patchReload 非法取值被抓（判据2）', r.problems.some((p) => p.startsWith('判据2') && p.includes('非法')))
  }
  // 7) 判据 4：代次常量与其单源上界一致（正控）/ 漂移（负控）/ 缺失（负控）
  const mainGood = 'private const val CURRENT_SESSION_GENERATION = 4\n'
  {
    const r = audit({ ktText: good, mainText: mainGood, knownGenerations: [3, 4] })
    ok('正控F：代次常量 = max(knownGenerations) 时无问题', r.problems.length === 0)
  }
  {
    const r = audit({ ktText: good, mainText: 'private const val CURRENT_SESSION_GENERATION = 3\n', knownGenerations: [3, 4] })
    ok('负控F：代次常量落后于单源被抓（判据4，漏备份一整代）', r.problems.some((p) => p.startsWith('判据4') && p.includes('漂移')))
  }
  {
    const r = audit({ ktText: good, mainText: '', knownGenerations: [3, 4] })
    ok('负控G：代次常量缺失被抓（判据4）', r.problems.some((p) => p.startsWith('判据4') && p.includes('未找到')))
  }
  {
    const r = audit({ ktText: good, mainText: mainGood, knownGenerations: null })
    ok('零控H：未提供单源时不报漂移（只出声，不误报）', r.problems.filter((p) => p.startsWith('判据4')).length === 0)
  }

  let pass = 0
  for (const [name, goodRes] of results) {
    console.log(`${goodRes ? '  PASS' : '  FAIL'}  ${name}`)
    if (goodRes) pass++
  }
  console.log(`selftest: ${pass}/${results.length}`)
  // 头注声明「3 = selftest 失败」——必须真的 `process.exit(3)`（而不是 `return 3`）：
  // 本仓的 `audit-selftest-claims.mjs`（W76 判据）只从 `process.exit(N)` 形态读实现码，
  // `return 3` 读不到 ⇒ 会被判成「幽灵声明」（实测踩过）。同时这也让「闸门自己坏了」与
  // 「闸门检出违规」（退 1）在 CI 上可区分。
  process.exit(pass === results.length ? 0 : 3)
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

if (process.argv.includes('--selftest')) process.exit(selftest())

if (!existsSync(KT)) {
  console.error(`文件缺失：NodeService.kt (${KT})`)
  process.exit(2)
}

// 判据 4 需要两个额外输入：MainActivity（代次常量所在）与单源 dsh-version.json。
// 两者缺失时**降级为出声**（不冒充通过、也不误报）——由 `notes` 里的「跳过」文案体现。
const MAIN = join(WS, 'android', 'app', 'src', 'main', 'java', 'com', 'dshtavern', 'app', 'MainActivity.kt')
const VER = join(WS, 'dsh-version.json')
let knownGenerations = null
if (existsSync(VER)) {
  try {
    // 单源带 UTF-8 BOM ⇒ 必须剥掉再 parse（否则 JSON.parse 抛）
    const j = JSON.parse(readFileSync(VER, 'utf8').replace(/^\uFEFF/, ''))
    if (Array.isArray(j.sessionFormatKnownGenerations)) knownGenerations = j.sessionFormatKnownGenerations
  } catch (e) {
    console.error(`  ! dsh-version.json 解析失败：${e.message}`)
  }
}

const r = audit({
  ktText: readFileSync(KT, 'utf8'),
  mainText: existsSync(MAIN) ? readFileSync(MAIN, 'utf8') : '',
  knownGenerations,
})
for (const n of r.notes) console.log(`  · ${n}`)

if (r.problems.length === 0) {
  console.log('PASS  NodeService 部署契约完整（4 判据：拷贝集≡patch集 / patchReload≠live / 守卫覆盖 / 代次常量不上漂）')
  process.exit(0)
}
for (const p of r.problems) console.error(`  ✗ ${p}`)
console.error(`\nNodeService 部署契约破约：${r.problems.length} 处 —— 勿发货（真机上表现为 DSH boot loop）`)
process.exit(1)
