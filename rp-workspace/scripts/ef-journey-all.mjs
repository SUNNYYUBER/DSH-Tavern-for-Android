#!/usr/bin/env node
/**
 * ef-journey-all.mjs —— E-F 多卡**完整旅程**设备实测（M5/M7，2026-09-14 第二轮）
 * ============================================================================
 * ## 为什么需要这个脚本（补上一个真实的验收缺口）
 * goal §七 E-F 的原文是「**M7 抽样的卡全部**走完『导入 → 开聊 → 脚本 UI 交互（含拖拽）→
 * 回退 → 重新生成 → 再回退』无阻断问题」。而上一轮只在**一张**卡
 * （`session-32c0b451…`）上跑了「真回退 → 真重发」，其余 4 张抽样卡**只验了结果态**。
 * 「抽样的卡全部走完」是**硬性口径**（R6 把 M7 列为宣称达成的四要素之一），
 * 不能以「机制同族、已有单测覆盖」代替。
 *
 * ## 关键突破：可编程切卡
 * 上一轮卡在「无法用脚本切到别的卡」（`rp/open-chat` 只对运行时已加载的会话成功）。
 * 本轮发现壳侧有**深链机制**：`dsht-rp-ui:locate-session` CustomEvent →
 * 前端监听器调 `ctx.sessions.open(sessionId)`，**与用户点角色卡完全同一条路径**
 * （见 dsht-rp-ui/client/index.tsx 的 `onLocateSession`）。
 * 故本脚本经 CDP 直接派发该事件即可切卡，无需任何新接口（不违 B10）。
 *
 * ## 每张卡跑什么（判据全部可机械化断言）
 *   J0 备份会话文件      —— 两文件分别判定（`session.v3.jsonl` 仅 live 写入态存在）
 *   J1 切卡成功          —— 目标 sessionId 真的被打开（快照稳定才算就绪）
 *   J2 脚本 UI 在位      —— `.dsht-rp-scriptball` / `.dsht-rp-script-pillbar` / 状态浮球
 *   J3 拖拽真值          —— 宿主 `$.ui.mouse.prototype.__dshtTouchBridge` + 卡脚本帧全部装桥
 *   J4 回退前基线        —— 记录楼层数 + `hiddenSeqs` + token 占用（含计量就绪等待）
 *   J5 真回退（UI 点击） —— 点「↩ 回退到此处」→ 确认 → 掩码增加 **或** 楼层减少
 *   J6 占用下降（C3）    —— 回退后 token 占用**下降**（回退生效的可观测证据；带判据力前提）
 *   J7 真重发            —— 经 composer 注入并发送（走 mock LLM）→ 楼层增加
 *   J8 旧楼层不复活      —— 重发后：被回退的楼层文本**不得**重新出现（F2 核心）
 *   J9 掩码持久有效      —— 重发后 `hiddenSeqs` **未归零**且仍含被移出的 seq
 *  J13 再回退           —— 第二次回退：集合**收敛**（旧隐藏项不减）且确实生效（B4 第三步）
 *  J14 真重新生成        —— 点「↻ 重新生成」→ confirm → 旧回复移出（集合增长/结构变）且收敛
 *                          （**与 J7「重发」语义不同**：重发=追加 user；重新生成=只重来最后一轮）
 *  J10 不新开 session    —— 会话目录/清单数不变（B13）
 *  J11 HTML 未裸露       —— 回退+重发后扫 `.dsht-rp-assistant-body` 无裸 `<script`
 *  J12 还原用户数据      —— 会话文件还原并清理备份
 *
 * ## 安全（不改用户真实数据）
 * 每张卡操作前**备份** `session.jsonl` 与 `session.v3.jsonl`，旅程结束**还原**并删除备份。
 * 备份走 `run-as cp` + **绝对路径**（相对路径在 run-as 下不可靠）；还原失败会**出声**（R8）。
 *
 * 用法：
 *   node scripts/ef-journey-all.mjs --cards <sid1,sid2,...> [--port 9333] [--yes]
 *   node scripts/ef-journey-all.mjs --auto [--port 9333] [--yes]
 * （默认 dry-run；`--yes` 才真跑回退/重发）
 */
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const argv = process.argv.slice(2)
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
const PORT = flag('--port', '9333')
const YES = argv.includes('--yes')
const AUTO = argv.includes('--auto')
const PKG = 'com.dshtavern.app'

/**
 * adb 路径解析（**判据自身的坑 · 第四次**）。
 *
 * 上一版 `const ADB = process.env.DSHT_ADB ?? 'adb'` —— 而本机 `adb` **不在 PATH**
 * （SDK 装在 `%USERPROFILE%\.android\sdk\platform-tools\`）⇒ `execFileSync` 每次都抛
 * ENOENT ⇒ `runAs` 一律返回 `__ADBERR__` ⇒ J0/J10/J12 全部静默降级。
 * **危险之处**：它降级成 SKIP 而不是 FAIL，看起来只是「该卡没有目录」，
 * 掩盖了「备份/还原根本没执行」这一安全前提失效（R8：失败必须出声）。
 * ⇒ 修法：显式按已知候选路径探测，找不到则**出声**并在启动时中止（fail-closed，
 * 不带着失效的备份能力继续跑写操作）。
 */
function resolveAdb() {
  const cands = [
    process.env.DSHT_ADB,
    process.env.ADB_PATH,
    process.env.ANDROID_HOME && `${process.env.ANDROID_HOME}/platform-tools/adb.exe`,
    process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}/Android/Sdk/platform-tools/adb.exe`,
    process.env.USERPROFILE && `${process.env.USERPROFILE}/.android/sdk/platform-tools/adb.exe`,
    process.env.HOME && `${process.env.HOME}/.android/sdk/platform-tools/adb.exe`,
    'adb',
  ].filter(Boolean)
  for (const c of cands) {
    if (c === 'adb') return c // 交给 PATH 兜底（可能就装在 PATH 上）
    if (existsSync(c)) return c
  }
  return null
}
const ADB = resolveAdb()
if (ADB === null) {
  console.error('[E-F 旅程][FATAL] 找不到 adb（DSHT_ADB / ANDROID_HOME / ~/.android/sdk 均无）——')
  console.error('  备份/还原是旅程的**安全前提**，缺失时不得继续（fail-closed）。')
  process.exit(3)
}

// M7 抽样：覆盖 goal 点名的类别
//
// goal §四 轨道 F 的 F5 原文要求覆盖五类：**MVU 系 / 飞讯系 / 剧情控制台系 / 纯文本卡 / 重前端卡**。
// 【2026-09-14 本轮核查结论（诚实标注，不冒充覆盖）】
//   · 「飞讯系」在**本仓内不是可枚举的卡实体** —— 全仓 grep `飞讯` 只命中**兼容性注释**
//     （`th-shim.ts:225` 记其名「飞讯 0703」；`facade.ts` 记其 `is_feixun_record` 回读特征），
//     卡的清单不在仓库里（在设备工作区）。⇒ 本脚本**无法**按名字点名它，
//     只能用**同类形态**覆盖：飞讯 = 「重前端 + 大量 TH 写桥 + 交互对话框」⇒ 对应本清单的
//     「重前端卡」项（下面显式标注）。这是**有意的替代并已如实记录**，不是偷偷省略。
//   · 「重前端卡」= 卡脚本自带 UI（悬浮球/面板）、依赖 jQuery UI 拖拽、依赖 TH 写桥的卡。
//
// 【抽样口径修订（2026-09-14 实测驱动）】原文另有 3 张卡**结构上无法跑完整旅程**（已换下并记录）：
//   · `session-fdfc1a28` —— 已被回退到 **0 个可见楼层**（切过去也没有可回退内容）
//   · `session-8b45ce80` —— 单会话 **3.0MB / 4767 行**，模拟器切不过去（同批另 4 张全过）
//   · `st-asm3yf` 所在工作区的模型配置在测试机不可用（`UNSUPPORTED_REASONING_EFFORT`）
// 【抽样清单修订（2026-09-14 第二十轮续三 · 设备数据重建后）】
//
// ## 为什么必须改（事故驱动，见 GOAL.md §七 R18 / 方法论 §6.14f）
// 本轮我为解决 `INSTALL_FAILED_INSUFFICIENT_STORAGE` 误用 `pm uninstall`，
// **清空了设备应用数据目录** ⇒ 下列原清单中的会话 id **随之消失**：
//   · `st-y1noek`（原「纯文本卡」代表）—— 已不存在
//   · `session-4849a2b6-…`（原「MVU 编辑系」代表）—— 已不存在
// 数据已按 R18 走**产品导入中心**从用户的 `tauritavern-data.zip` 重建
// （17 卡 / 30 书 / 17 聊 / 4 预设，迁移报告见设备
//  `.dsh/rp-import/<batchId>/migration-report.md`），迁移后的会话 id 是**新**的。
// ⇒ 清单按重建后的真实会话更新（`ls .dsh/sessions/*/`），类别口径保持不变。
//
// ## 类别口径（与原文一致）
//   · 纯文本卡（轻脚本）     · 纯文本卡（重文本量）
//   · 带内嵌正则的卡          · MVU 系（依赖变量树）
//   · 重前端卡（带脚本 UI 的卡：正则条数多 / 依赖 TH 桥）
//
// ★ 抽样清单来自**外部配置**（不入库）：`rp-workspace/.m7-cards.json`
//   `{ "cards": ["<sid1>", "<sid2>", ...] }`
// ★ 为什么外置（T-25b 发布卫生）：SID 是**本机设备上的会话标识** ——
//   硬编码在脚本里既对别人无用（他们设备上没有这些会话），又暴露了本机抽样清单。
//   缺失时明确提示怎么补（**不静默降级**，P-3）。
function loadPreferredCards () {
  const p = fileURLToPath(new URL('../.m7-cards.json', import.meta.url))
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'))
    return Array.isArray(j.cards) ? j.cards.filter(s => typeof s === 'string' && s) : []
  } catch { return [] }
}
const PREFER = loadPreferredCards()
const CARDS = AUTO ? PREFER : flag('--cards', '').split(',').map(s => s.trim()).filter(Boolean)
if (CARDS.length === 0) {
  console.error('用法：--cards <sid1,sid2,...> 或 --auto')
  if (AUTO) {
    console.error('  --auto 需要抽样清单：rp-workspace/.m7-cards.json')
    console.error('    格式：{"cards":["<sid1>","<sid2>"]}')
    console.error('    取 SID：adb shell run-as com.dshtavern.app ls files/.dsh/sessions/*/')
  }
  process.exit(2)
}

/**
 * 【判据自身的坑（P-19）· 第三十二次】CDP 不可达时必须给**可读**的失败，
 * 而不是未捕获的 `fetch` 异常（`TypeError: fetch failed` + 一坨 errno 细节）。
 *
 * 为什么会踩：本脚本的收尾会 `am force-stop` 停应用（P-21 的安全前提）——
 * 于是**上一轮结束后 App 是停着的**，此时再跑（哪怕 dry-run）就会在连 CDP 时抛。
 * 实测第一版直接崩在 `await fetch(...)`，输出只有 `bytesRead: 0` 之类的底层细节
 * ⇒ 看的人完全不知道「要先启动 App」，只能去翻源码。
 * ⇒ 修法：包一层并给出**可操作**的指引（含现成的启动命令）。
 */
let targets
try {
  targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
} catch (e) {
  console.error(`[E-F 旅程][FATAL] 连不上设备 WebView 调试端口 ${PORT}：${String(e?.message ?? e)}`)
  console.error('')
  console.error('  注意：本脚本收尾会 `am force-stop` 停应用（P-21 安全前提），故**跑完后 App 是停着的**。')
  console.error('  再跑之前请先启动并转发端口（与构建步骤同款）：')
  console.error(`    adb shell monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`)
  console.error('    # 等 30s，再：')
  console.error('    adb shell "cat /proc/net/unix | grep webview_devtools_remote"   # 取 pid')
  console.error('    adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>')
  process.exit(4)
}
const page = targets.find(t => t.type === 'page')
if (!page) {
  console.error(`[E-F 旅程][FATAL] ${PORT} 上无 page target（WebView 未就绪 / 端口未转发）`)
  console.error('  先 adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>，或先启动 App 后等 30s。')
  process.exit(4)
}
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0; const pending = new Map()
/**
 * 【判据自身的坑（P-3 静默失败 / P-19）· 第五十五次 · 2026-09-16 设备实测抓到】
 *
 * ## 症状（最严重的一次「测具把自己挂死」）
 * 一次 `--auto --yes` 跑到首卡 `st-n0gnfp` 的 J4 之后**永久挂起**：
 *   · 日志停在 J4，**10+ 分钟不再增长**（`w24-m7.log` 停在 1127 字节）
 *   · 进程 CPU 累计 **0.55s**（几乎不耗 CPU）却永不退出
 *   · **没有任何错误输出**、没有超时、没有退出码 ⇒ 看日志的人只会以为「还在跑」
 *
 * ## 真因
 * 本函数的 `Promise` **没有超时**：`await send(...)` 一旦遇到
 *   · CDP 目标卡住（页面主线程长时间不让出 / iframe 进程假死），或
 *   · `awaitPromise: true` 的表达式内部 Promise **永不 settle**
 * ⇒ 该 Promise **永不 settle** ⇒ 整个 M7 停在那里，**不报错也不退出**。
 * 这恰恰是本项目最忌讳的缺陷族（**静默**）：测具挂了 ≠ 判据失败，报告里看不出来。
 *
 * ## 修法（fail-closed 出声）
 * 给每条 CDP 命令加**超时**；超时 ⇒ reject 带明确文案 ⇒ 由上层记录 FAIL 并
 * 继续/退出，**不再无声挂死**。超时值取 120s：远大于任何正常判据（最长单条实测
 * ~20s），又能在真挂时给出可读结论。
 */
const CDP_TIMEOUT_MS = 120000
const send = (m, p = {}) => new Promise((res, rej) => {
  const i = ++seq
  const timer = setTimeout(() => {
    pending.delete(i)
    rej(new Error(`CDP 超时（${CDP_TIMEOUT_MS / 1000}s 无响应）：${m} —— 页面主线程可能被长时间占用（见 P-3/P-19）`))
  }, CDP_TIMEOUT_MS)
  pending.set(i, {
    res: (v) => { clearTimeout(timer); res(v) },
    rej: (e) => { clearTimeout(timer); rej(e) },
  })
  try { ws.send(JSON.stringify({ id: i, method: m, params: p })) } catch (e) {
    clearTimeout(timer); pending.delete(i); rej(new Error(`CDP 发送失败：${String(e?.message ?? e)}`))
  }
})
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const q = pending.get(m.id); pending.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result) } })
try {
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', () => rej(new Error('WebSocket error'))); setTimeout(() => rej(new Error('WebSocket 连接超时（15s）')), 15000) })
} catch (e) {
  console.error(`[E-F 旅程][FATAL] CDP WebSocket 连接失败：${String(e?.message ?? e)}`)
  console.error('  多半是 App 刚被停/重启中——等 30s 后重试，或重跑 adb forward。')
  process.exit(4)
}
const evalJs = async (e) => {
  try {
    const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception?.description ?? 'fail').slice(0, 400) }
    return r.result?.value
  } catch (err) {
    // 【判据自身的坑（P-3 / P-19）· 第五十五次】`send()` 现带超时（见上），超时抛错。
    // 本函数的调用点遍布全脚本且**多数没有 try** ⇒ 不就地兜住就会一路冒到顶层，
    // **丢掉后续所有卡的覆盖**（与「第五次」同类后果：进程异常退出 ≠ 判据失败，
    // 报告里看不出来）。⇒ 转成 `{__err}` 普通对象走同一条通道，并出声（P-3）。
    const msg = `CDP 超时/失败：${String(err?.message ?? err).slice(0, 220)}`
    console.error(`  [warn] ${msg}`)
    return { __err: msg }
  }
}

/**
 * 【判据自身的坑 · 第五次】安全解析 evalJs 的返回值。
 *
 * 上一版直接 `JSON.parse(await evalJs(...))` —— 而 evalJs 在**页面异常**时返回的是
 * 对象 `{__err: …}`（不是字符串）⇒ `JSON.parse({})` 抛 `"[object Object]" is not valid JSON`
 * ⇒ **整个脚本崩掉，后续卡全部不跑**。这比「判据写错」更糟：它让一次运行**丢掉了
 * 后面所有卡的覆盖**，而报告里看不出来（进程异常退出 ≠ 判据失败）。
 * ⇒ 修法：统一走本函数，异常时返回带 `__err` 的**普通对象**，由调用方判定
 * （fail-closed：解析不了就记 FAIL，不静默跳过）。
 */
const evalJson = async (expr) => {
  const v = await evalJs(expr)
  if (v !== null && typeof v === 'object') return v // 已是 __err 对象
  try { return JSON.parse(v) } catch (e) { return { __err: `JSON.parse 失败：${String(e.message).slice(0, 160)}` } }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
await send('Runtime.enable')
await send('Page.enable')

/**
 * 【判据自身的坑（P-46 / P-47）· W40 决定性实验】
 *
 * ## 现象
 * W40 复跑 M7 时，5 张卡里 **3 张**只跑到 J0+J1 就降级成一条
 * `ⓘ J2~J11 旅程`，SKIP 依据是「**快照已稳定但两类楼层计数均为 0**」，
 * 而同一条证据串里还写着「会话文件里 user/message 380 条 / assistant/message 201 条」
 * ⇒ **读数与已知事实严重不符**（这正是 P-45/P-46 的识别特征）。
 *
 * ## 决定性实验（`tmp/w40-efj-lifetime-exp.mjs`，4 项全绿）
 *   A 注入哨兵 `window.__w40probe='alive'` ⇒ 立即可见
 *   B **`Page.reload` 后哨兵丢失**（读到 `null`）
 *   B2 同一次重载后 **`window.__efj` 也不存在**（= 本脚本的注入同此命运）
 *   C 对照：重载后**新注入**的哨兵立即可见 ⇒ 「读」这个动作没问题
 *   D ★ 重载后页面**真实读数** `floorHead=21 / myAssistant=15` ⇒ **页面有内容**
 * 另一独立探针（`tmp/w40-floor-head-probe.mjs`，**不依赖 `__efj`**）在同一张卡上读到
 * `m7floors=31/21`，而 M7 同时报 `floors=0`。
 *
 * ## 根因
 * 本脚本的 `window.__efj` 是**一次性 `evalJs` 注入**的 —— 页面一旦重载
 * （`am force-stop` 后重启 / WebView 崩溃恢复 / 宿主主动 reload），注入**即消失**。
 * 于是 `snap()` 抛 `TypeError`、`evalJson` 返回 `{__err}`，而 `waitRendered` 的
 * `if (sn.__err) { last = null; continue }` 会**一直重试到 25s 用光**，
 * 最终返回 `{ floors: 0 }` —— **把「判据装置自己丢了注入」报成「会话无可见楼层」**
 * （P-47：用**判据自身**那一层的故障去指控**数据/渲染层**）。
 * ★ 与 W32 的 `loadError` 混层、W34 的 `transport/struct` 混层是**同一族**，
 *   只不过这次的「另一层」是**判据装置自己**。
 *
 * ## 修法（两层，缺一不可）
 * ① **注入随重载自动重装**：用 CDP `Page.addScriptToEvaluateOnNewDocument` ——
 *    它保证「**每个新文档创建前**」执行该脚本（这正是 P-31 取证时用过的手法）。
 * ② **自愈兜底**：每次读快照前先 `ensureEfj()` 检查 `typeof window.__efj === 'object'`，
 *    缺失就**当场重装**（不让「装置自己坏了」静默变成「产品读数」）。
 * ③ ★ **读数分层**（P-47）：`waitRendered` 的 `__err` 分支**不再吞掉**——
 *    若 `__efj` 缺失且重装也失败，返回 `probeErr: true`，由 J1 记
 *    **判据装置自身失败**（FAIL 并出声），**不**退化成 SKIP。
 */
const EFJ_SOURCE = `(() => {
  window.__efj = {
    // 楼层快照
    //
    // 【判据选择器的教训（P-11）】上一版只用 dsht-rp-assistant / dsht-rp-user-row
    // 计数 ⇒ 在**纯文本卡**上 assistant 不走我方容器渲染（走宿主原生节点），
    // 于是 asst=0，看起来像「内容没加载」，实际是**选择器覆盖不全**。
    // 设备实测（session-8b45ce80 纯文本卡）：userRow=8 / floorHead=8 / assistant=0
    // 而会话文本完全正常 ⇒ 必须改用**每楼必有**的通用锚点 dsht-rp-floor-head 作为主计数，
    // 并把 user/assistant 作为**辅助信息**（不再作为就绪判据）。
    //
    // 【判据自身的坑（P-11/P-19）· 第三十四次】floor-head 是**已渲染**楼层数，**不是楼层总数**：
    // 消息窗口化（chat-windowing 的 WINDOWING_THRESHOLD=40）会把视口外楼层换成**等高占位 div**
    // （带 data-windowed 属性、**无** floor-head），而**空闲渐进物化**（滚动停止后每 400ms 向外扩张
    // 一档，上限 120000px）会让「已渲染数」在切卡后 10+ 秒内持续增长。
    // 设备实测（tmp/probe-floor-vs-windowed.mjs，切到 st-clk9pd）：
    //   t=1.4s floorHead=3 windowed=44 ｜ t=2.1s 32/11 ｜ t=2.8s 8/35 ｜ t=4.9s 14/29
    //   ｜ t=7.0s 22/21 ｜ t=10.5s 31/12 ｜ t=14s+ 43/0（收敛）
    // ⇒ 「连续两次读数一致」会**在收敛前**满足（扩张按 400ms 档、采样按 500ms，常落同一档），
    //   于是基线取到的是「此刻渲染了几个」⇒ **读数不确定**（同一张卡三次运行分别读得 43/34/21），
    //   直接污染 J5/J13「回退是否让楼层下降」的判定（P-20：判据必须自带杠杆，且**读数必须确定**）。
    // ⇒ 修法：主计数改为 **已渲染 + 占位**（= 平铺楼层总数，与窗口化无关），并单独暴露
    //   并单独暴露 rendered / windowed 两个字段供诊断。实测该和值在窗口化启动后**恒为 43**
    //   （仅 t=1.4s 的 47 是全量初始化瞬间，会被「快照稳定」判据过滤）。
    // （注意：本注释位于模板串内部，**不许出现反引号** —— 会提前终止模板串，
    //   这正是本仓 A11 闸门（audit-shim-template-literal）记录的坑。）
    snap: () => {
      const rendered = document.querySelectorAll('.dsht-rp-floor-head').length
      const windowed = document.querySelectorAll('[data-windowed]').length
      return {
      floors: rendered + windowed,                                          // 主计数（总数，窗口化无关）
      rendered, windowed,                                                   // 诊断（收敛过程可见）
      user: document.querySelectorAll('.dsht-rp-user-row').length,          // 辅助
      asst: document.querySelectorAll('.dsht-rp-assistant').length,         // 辅助
      bubbles: [...document.querySelectorAll('.dsht-rp-user-bubble')].map(b => (b.textContent || '').trim().slice(0, 26)),
      asstTexts: [...document.querySelectorAll('.dsht-rp-assistant-body')].map(b => (b.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 26)),
      meter: (document.querySelector('.dsht-rp-tokenmeter .tm-num') || {}).textContent || null,
      meterPct: (document.querySelector('.dsht-rp-tokenmeter .tm-fill') || {}).style?.width || null,
      // 【判据自身的坑（P-11）· 第十一次】只用百分比判「占用是否下降」在**饱和**时失效：
      // 实测 st-asm3yf 卡（≈ 1.5M / 1M）⇒ 百分比恒为 100%，回退后仍 100% ⇒ 判 FAIL。
      // 这是**判据分辨率不足**，不是功能缺陷。故同时留原始文本，由脚本解析绝对 token 数。
      // （注意：本注释位于模板串内部，**不许出现反引号** —— 会提前终止模板串，A11。）
      tokenRaw: (document.querySelector('.dsht-rp-tokenmeter .tm-num') || {}).textContent || null,
      // P-9 精确观测面（本轮新增 data-*）：优先用它，避免 formatTokens 的精度损失
      // （1.5M 的 M 级只有 100k 精度 ⇒ 小幅下降在 UI 文本上不可见）。
      tokenExact: (() => {
        const n = document.querySelector('.dsht-rp-tokenmeter')
        const v = n && n.getAttribute('data-tokens')
        return v === null || v === undefined ? null : Number(v)
      })(),
      // 【F4-C3 判据】产品**自身口径**的字符量（= sumMessageChars 扣掉掩码后的结果）。
      // 这是「占用是否该下降」的第一手证据：它变了说明计量面确实变了。
      // （比 dist-tokens 分辨率高：token = round(chars/2.5)，chars 是整数原值。）
      dataChars: (() => {
        const n = document.querySelector('.dsht-rp-tokenmeter')
        const v = n && n.getAttribute('data-chars')
        return v === null || v === undefined ? null : Number(v)
      })(),
      budgetExact: (() => {
        const n = document.querySelector('.dsht-rp-tokenmeter')
        const v = n && n.getAttribute('data-budget')
        return v === null || v === undefined ? null : Number(v)
      })(),
      // 【W40 修正】脚本 UI 五件套 + 回退/重发按钮 **必须在 snap() 里**
      //（我重写时误把它们挪进单独的 ui()，而 J2/J3/J5/... 一律从 s.*（snap 的返回）读
      //  ⇒ 实测 🧩球=undefined · script-pill=undefined · 状态浮球=undefined，
      //  即「就绪判据读到 undefined」—— 与 P-11 同族的**装置自伤**）。
      //  保留 ui() 作为等价入口（供显式调用），但 snap 必须自带这些字段。
      scriptball: document.querySelectorAll('.dsht-rp-scriptball').length,
      pills: document.querySelectorAll('.dsht-rp-script-pill').length,
      statefloat: document.querySelectorAll('.dsht-rp-statefloat-ball').length,
      draggable: document.querySelectorAll('.ui-draggable,[data-draggable="true"]').length,
      rollback: document.querySelectorAll('.dsht-rp-rollback-btn').length,
      regen: document.querySelectorAll('.dsht-rp-regen-btn').length,
      // 【W40 新增 · 就绪面】RP 视图是否**已挂载**。
      // 产品在楼层头挂载计数 >0 时给 body 打 data-dsht-rp-active=1（RpNativeChat.tsx:628）。
      // ★ 为什么必须显式读它（决定性实验 tmp/w40-floors-compare.mjs）：
      //   切卡后 **t=0..18s** 期间 rpActive=null 且 floorHead=0 —— 那是**RP 容器还没挂载**，
      //   不是「会话无内容」；t=21s 才出现 39 个楼层头。仅等 floors>0 会把这段窗口
      //   误读成「稳定地 0 楼层」⇒ 走 SKIP（或更糟：当 FAIL）。
      //   把它纳成就绪面后，waitRendered 会**等容器挂载**再判读数（P-46 推论三）。
      // （注意：本注释位于模板串内部，**不许出现反引号** —— A11 闸门。）
      rpActive: !!(document.body && document.body.getAttribute('data-dsht-rp-active') === '1'),
      }
    },
    // P-46：把「数据层」与「传输层」分开读（详见 waitRendered 注释）
    loadError: () => {
      const txt = (document.body ? document.body.innerText : '') || ''
      const lines = txt.split('\\n').map(s => s.trim()).filter(s => /Failed to load|failed to project|is corrupt|invalid seed|api gateway|Remote stream|WebSocket/.test(s))
      const struct = lines.filter(s => /failed to project session|is corrupt|invalid seed|Failed to load history: failed/.test(s))
      const transport = lines.filter(s => /api gateway|Remote stream|WebSocket closed/.test(s))
      const other = lines.filter(s => !struct.includes(s) && !transport.includes(s))
      return { struct: struct.length ? struct.slice(0, 2) : null, transport: transport.length ? transport.slice(0, 2) : null, other: other.length ? other.slice(0, 2) : null, any: lines.length ? lines.slice(0, 3) : null }
    },
    // 脚本 UI 五件套 + 回退/重发按钮
    ui: () => ({
      scriptball: document.querySelectorAll('.dsht-rp-scriptball').length,
      pills: document.querySelectorAll('.dsht-rp-script-pill').length,
      statefloat: document.querySelectorAll('.dsht-rp-statefloat-ball').length,
      draggable: document.querySelectorAll('.ui-draggable,[data-draggable="true"]').length,
      rollback: document.querySelectorAll('.dsht-rp-rollback-btn').length,
      regen: document.querySelectorAll('.dsht-rp-regen-btn').length,
    }),
    sid: () => {
      // 【W40 修正 · P-19：不许凭命名习惯猜选择器】
      // 我重写 EFJ_SOURCE 时曾把这里写成读 [data-session-id] —— **产品里没有这个属性**
      //（设备实测：data-* 白名单为 data-dsht-anchor / data-dsht-mobile / data-dsht-note /
      //  data-dsht-qwrap / data-dsht-rp-active，无任何会话 id 落点）
      // ⇒ M7 立刻报「切卡 3 次未生效（当前 null）」。
      // 设备实测找到的**权威来源**：localStorage['dsh.sessions.current'] 是产品自己写的
      // 「当前打开的会话」记录，形如 {"sessionId":"st-1q84arh"}，且**派发切卡后会跟着变**
      //（tmp/w40-test-sid-source.mjs：st-n0gnfp → st-1q84arh，逐字可复跑）。
      // （注意：本注释位于模板串内部，**不许出现反引号** —— A11 闸门。）
      try {
        const raw = window.localStorage.getItem('dsh.sessions.current')
        if (!raw) return null
        const j = JSON.parse(raw)
        return typeof j?.sessionId === 'string' ? j.sessionId : null
      } catch (e) { return null }
    },
    // HTML 未裸露（J11）：正文里不得出现 script 标签原文
    htmlLeak: () => {
      const els = document.querySelectorAll('.dsht-rp-assistant-body, .dsht-rp-html, .dsht-rp-user-bubble')
      let a = 0, b = 0
      for (const el of els) {
        const t = el.textContent || ''
        if (/<script[\\s>]/i.test(t)) a++
        if (/<\\/script>/i.test(t)) b++
      }
      return { n: els.length, rawOpen: a, rawClose: b }
    },
    // 切卡：走与用户点角色卡**完全同一条**路径（深链事件 → ctx.sessions.open）
    switchTo: (sid) => {
      window.__dshtLocateConsumed = false
      window.dispatchEvent(new CustomEvent('dsht-rp-ui:locate-session', { detail: { sessionId: sid } }))
      return window.__dshtLocateConsumed === true
    },
    // ---------------------------------------------------------------------
    // 数据面（产品同源 RPC）—— 【W40 重建：原实现在重写 EFJ_SOURCE 时丢失】
    // 路由与返回形状**逐个取证过**（不凭印象写）：
    //   · POST /dsht-rp/rp/rollback-mask {sessionId} → { hiddenSeqs:number[], hide:number, ... }
    //     （权威判据是 seqs 集合；hide 仅降级/兼容用 —— 见 dsh-plugin/index.ts 的 rollbackMaskCache 注）
    //   · POST /dsht-tavern-helper/chat/messages {sessionId} → StMessage[]（只读聊天记录导出，端点 8）
    // 用法约束：调用方一律 .then(m => JSON.stringify(m))，故这里必须返回 **Promise<对象>**。
    // （注意：本注释位于模板串内部，**不许出现反引号** —— A11 闸门。）
    // ---------------------------------------------------------------------
    mask: (sid) => fetch('/dsht-rp/rp/rollback-mask', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: sid }),
    }).then(r => r.json()).catch(() => ({ __err: 'rollback-mask 请求失败' })),
    items: (sid) => fetch('/dsht-tavern-helper/chat/messages', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: sid }),
    }).then(r => r.json()).then(j => {
      // ★【W40 修正】**返回形状必须是 { items: [...] }**，不是裸数组 ——
      // 调用点全部写 (exportItemsN.items ?? []) / .filter(x => x.seq)（见 J7/J8 的判据）。
      // 我重建时误返回裸数组 ⇒ .items 恒 undefined ⇒ itemsCount 恒 0、stampInContext 恒 false
      // ⇒ J7 把「重发成功」判成 FAIL（实测 st-1q84arh 1 FAIL，证据串里「已点发送=false」
      //   而同一卡另一次运行是 true —— 读数不确定正是这一处的后果）。
      // ★ 教训（P-19）：**重建被删的实现时，形状必须从调用点反推，不能凭印象**。
      const arr = Array.isArray(j) ? j : ((j && j.messages) || [])
      return { items: arr }
    }).catch(() => ({ __err: 'chat/messages 请求失败' })),
    // 导出侧统计（J13/J15 用）：条数 + 其中**带 seq** 的条数（带 seq 才能与掩码集合做差集）
    exportStat: (sid) => fetch('/dsht-tavern-helper/chat/messages', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: sid }),
    }).then(r => r.json()).then(j => {
      const arr = Array.isArray(j) ? j : ((j && j.messages) || [])
      const withSeq = arr.filter(m => m && Number.isFinite(m.seq))
      return { count: arr.length, withSeq: withSeq.length, seqs: withSeq.map(m => m.seq) }
    }).catch(() => ({ __err: 'chat/messages 请求失败' })),
    // J11：扫描我方正文容器里是否残留 script 标签**原文**
    rawHtml: () => {
      const els = document.querySelectorAll('.dsht-rp-assistant-body, .dsht-rp-html, .dsht-rp-user-bubble')
      let a = 0, b = 0
      for (const el of els) {
        const t = el.textContent || ''
        if (/<script[\\s>]/i.test(t)) a++
        if (/<\\/script>/i.test(t)) b++
      }
      return { nodes: els.length, rawScript: a, rawScriptClose: b }
    },
  }
  return 'ok'
})()`

/**
 * ① 注册「新文档创建前」的注入（页面重载后自动重装）。
 * CDP 会在**每个**新文档（含 reload / 崩溃恢复后的新文档）创建前执行这段脚本。
 * 失败时不中断（退化为 ② 的自愈兜底），但**出声**（P-3：降级必须可见）。
 */
let newDocHookInstalled = false
try {
  await send('Page.addScriptToEvaluateOnNewDocument', { source: EFJ_SOURCE })
  newDocHookInstalled = true
} catch (e) {
  console.error(`  [warn] Page.addScriptToEvaluateOnNewDocument 注册失败：${String(e?.message ?? e).slice(0, 160)}`
    + '（将只依赖 ensureEfj() 自愈兜底；页面重载后的首次读数可能记 probeErr）')
}

/** ② 自愈兜底：读快照前确保注入在位（缺失即当场重装） */
const ensureEfj = async () => {
  const t = await evalJs(`(typeof window.__efj === 'object' && window.__efj !== null) ? 'present' : 'missing'`)
  if (t === 'present') return { ok: true, reinstalled: false }
  const r = await evalJs(EFJ_SOURCE)
  return { ok: r === 'ok', reinstalled: true }
}

await evalJs(EFJ_SOURCE)

/**
 * 【判据自身的坑（P-11/P-19）· 第三十三次】**点击类动作前必须先等 UI 稳定**。
 *
 * 现象：J13 偶发 `clicked/no-confirm`，证据里同时写着「楼层 **37→43（增长 6）**」——
 * 这说明那一刀点下去时页面**正在重排**（回退后的重渲染把楼层从 37 涨到 43）。
 * 于是：① 点到的回退按钮可能是**即将被替换**的旧节点；② 随后轮询确认框时
 * DOM 还在变，`文本 === '回退'` 的按钮可能还没挂出来。
 *
 * 根因是**判据在「页面未静止」时动作**——与第八次（脚本 UI 异步挂载）同族，
 * 但那次只在切卡后等一次；本类缺陷要求**每个会改变 DOM 的动作之前都等**。
 * ⇒ 修法：抽出通用的「等 UI 静止」（连续两次结构签名一致，上限 12s），
 *   在 J5 / J13 / J14 的点击前调用；超时也继续（只是不稳，记入证据）。
 */
const uiSig = async () => {
  const sn = await evalJson(`JSON.stringify(window.__efj.snap())`)
  if (sn.__err) return null
  // 签名覆盖「会被重渲染改变」的结构量（楼层数 / 气泡数 / 按钮数）
  return JSON.stringify([sn.floors, sn.user, sn.asst, sn.rollback, sn.regen, sn.pills])
}
const waitUiStable = async (maxMs = 12000) => {
  const t0 = Date.now()
  let last = null
  while (Date.now() - t0 < maxMs) {
    const cur = await uiSig()
    if (cur !== null && last !== null && cur === last) return { stable: true, ms: Date.now() - t0 }
    last = cur
    await sleep(600)
  }
  return { stable: false, ms: Date.now() - t0 }
}

// ---- adb 辅助（备份/还原会话文件） ----
//
// 【判据自身的坑（P-11）· 第三次】`execFileSync(adb, ['shell', 'run-as pkg <整串>'])`
// 把**整个命令串当作单个 argv 元素** ⇒ adb 转发到设备后，设备 shell 只把它当**一个词**
// ⇒ 命令找不到（或参数被并成一个）。正确形态是**逐个 argv 元素分开传**，
// adb 会把它们**原样**交给设备端 shell（不额外拆/拼）。
// 设备实测对照：`adb shell run-as pkg find <路径> -maxdepth 3 -type d -name X` 正常返回。
// ⇒ 本函数改为可变参数形态。
const runAs = (...args) => {
  try {
    // maxBuffer 必须显式放大：默认 1MB，读会话日志（实测最大 1.7MB~3MB）会被**截断**
    // ⇒ 后续任何「按行解析」的判据都会看到**不完整的日志**（静默错，P-11 变体）。
    return execFileSync(ADB, ['shell', 'run-as', PKG, ...args], { encoding: 'utf8', timeout: 30000, maxBuffer: 96 * 1024 * 1024 })
  } catch (e) {
    return `__ADBERR__ ${String(e.message).slice(0, 200)}`
  }
}
/** find 输出里取第一个 `files/…` 路径（过滤 adb/shell 的杂音行） */
const pickPath = (out) =>
  String(out).trim().split('\n').map(l => l.trim()).filter(l => l.startsWith('files/')).pop() ?? ''
/** 找某 session 的会话目录。
 *
 * 真实布局是 `files/.dsh/sessions/<projectKey>/<sessionId>/`（两级），
 * 而 sessionId 既可能是 `session-<uuid>` 也可能只是 `st-xxxxx` 这种短名
 * （取决于卡的导入方式）⇒ 不能只按 maxdepth 猜，必须**先按名直查、再逐级深查**。
 * 上一版只搜 `maxdepth 2` ⇒ 4/5 张卡「未定位到目录」= **判据自身写错**（P-11）：
 * 它会让「J10 不新开 session」与「J12 还原」静默降级为 SKIP，掩盖真实覆盖度。
 */
const findSessionDir = (sid) => {
  // 路径形式 1：sessions/<projectKey>/<sid>（argv 分开传，避免任何一层做引号处理）
  const out1 = runAs('find', 'files/.dsh/sessions', '-maxdepth', '3', '-type', 'd', '-name', sid)
  const p1 = pickPath(out1)
  if (p1 !== '') return p1
  // 路径形式 2：会话目录直接叫 <sid>（无 projectKey 层）
  const out2 = runAs('ls', '-d', `files/.dsh/sessions/${sid}`)
  return pickPath(out2)
}

/**
 * 【判据自身的坑（P-11）· 第二十一次】`run-as <pkg> cp <相对路径>` **不可靠**：
 * `run-as` 的 `cwd` 不是 `files/` 根，而 `find` 返回的是**相对**路径 ⇒
 * 实测 `cp: bad 'files/.dsh/.../session.v3.jsonl': No such file or directory`
 * ——而该文件**确实存在**（`ls -la` 可见，1.88MB）。
 * 后果：J0 备份被判「失败」⇒ 该卡 J10/J12 全部降级 ⇒ **安全前提（可还原）静默失效**。
 * 更糟的是这会让报告看起来「备份能力有问题」，而实际只是**路径形态错了**。
 * ⇒ 修法：统一转成**绝对路径**（`/data/data/<pkg>/...`），`run-as` 下绝对路径稳定。
 */
const absPath = (rel) => `/data/data/${PKG}/${rel.replace(/^files\//, 'files/')}`


const results = []
/**
 * 【R8 安全前提 · W36 续 · 首次真跑即被抓到的真问题】
 * `rec()` 的自检是 **fail-closed（throw）**，但 throw 会**跳过脚本末尾的「统一还原」**
 * ⇒ 用户会话被留在旅程态（实测：一次真跑中断后设备上残留 **10 个 `.efjbak`**，
 * 会话文件停在回退后状态）。**这比 P-3 更严重**：P-3 是「测具挂了」，这里是
 * **测具挂了并把用户数据留在半途**（P-21 的同类）。
 * ⇒ 修法：`rec()` 在 throw **之前**先调用「紧急还原」钩子（由主流程在定义后注入；
 * 未注入时退化为只打印告警，绝不静默）。紧急还原 = 停应用 + 逐卡还原（与正常收尾同路径）。
 */
let onFatalRestore = null
const SKIP_REASONS_TEXT = '（这一条是**判据装置自身**的失败，不是产品缺陷；用户数据已走紧急还原路径）'
/**
 * SKIP 的**依据类别**（**穷举**，不允许自由文本 —— 自由文本会立刻退化成「文本特征」，见下）。
 *
 * 【W36 续 · P-46 推论一的**结构化**收口】为什么必须结构化：
 * P-46 推论一要求「SKIP 的理由必须是**读出来的事实**，不能是推测」。W36 首版试图用
 * **正则扫结论串**（查「可能/疑似/推测」）来守它，被**明确否决** —— 那个口径**天然过宽**：
 * 它分不清「给用户看的结论」「给人看的注释」「fail-closed 的守卫文案」（后者如
 * 「疑似解析口径失效，拒绝给出结论」**正是正确用法**）。按 P-38（过宽 ⇒ 假红 ⇒
 * 训练人忽略报警）不做。⇒ 改为**结构化**：把「这条 SKIP 依据的是什么」做成**必填字段**，
 * 于是「有没有读事实」成为**结构属性**，而不是要从文本里猜的特征。
 *
 *   · `read`      —— 依据是**读出来的事实**（P-46 推论一合规）。**必须**附 `facts`（读到的具体值）。
 *   · `no-lev`    —— 判据力前提不成立：该场景在**这张卡上不存在**（P-43/P-20）。
 *   · `no-change` —— 动作**已发生但无变化** ⇒ 本条**测不出**（P-17）。
 *   · `dry-run`   —— 未传 `--yes`，本轮不执行写操作。
 *   · `env`       —— 环境/装置限制（大会话切卡不动、未定位会话目录、未备份等）。
 *   · `probe-err` —— 探针自身异常，**未取得证据**。
 */
const SKIP_BASIS_KINDS = new Set(['read', 'no-lev', 'no-change', 'dry-run', 'env', 'probe-err'])
/**
 * 记录一条判据结果。
 *
 * @param {string} card 会话 id
 * @param {string} name 判据名
 * @param {'PASS'|'FAIL'|'SKIP'} status
 * @param {string} evidence 证据串（给人看）
 * @param {{kind: string, facts?: string}} [basis] **SKIP 必填**（见 SKIP_BASIS_KINDS）
 */
const rec = (card, name, status, evidence, basis) => {
  // 【R8】任何装置级失败都**先保数据**再抛（见上方 onFatalRestore 注释）
  const bail = (msg) => {
    console.error(`\n[判据装置][FATAL] ${msg}`)
    if (typeof onFatalRestore === 'function') {
      console.error('[判据装置] 触发**紧急还原**（停应用 → 逐卡还原），避免把用户会话留在旅程态 …')
      try { onFatalRestore() } catch (e) { console.error(`[判据装置] 紧急还原自身失败：${String(e.message).slice(0, 200)}`) }
    } else {
      console.error('[判据装置] ⚠️ 紧急还原钩子未注入 —— 若此前已备份，请人工还原设备上的 *.efjbak')
    }
    throw new Error(msg)
  }
  if (status === 'SKIP') {
    // 三条**结构性**断言（fail-closed，出声后立即中止 —— 装置坏了不许当作「测完了」）
    if (basis === undefined) {
      bail(`[判据装置·P-46 推论一] SKIP 缺依据字段：${card} · ${name}${SKIP_REASONS_TEXT}`)
    }
    if (!SKIP_BASIS_KINDS.has(basis.kind)) {
      bail(`[判据装置·P-46 推论一] SKIP 依据类别未知 "${basis.kind}"：${card} · ${name}`
        + `（必须是 ${[...SKIP_BASIS_KINDS].join(' / ')} 之一）${SKIP_REASONS_TEXT}`)
    }
    if (basis.kind === 'read' && (typeof basis.facts !== 'string' || basis.facts.trim() === '')) {
      bail(`[判据装置·P-46 推论一] SKIP 声称依据为 read 但未附 facts：${card} · ${name}`
        + `（「依据是读出来的事实」必须写出**读到了什么**，否则不许这样声称）${SKIP_REASONS_TEXT}`)
    }
  } else if (basis !== undefined) {
    // 第 4 条：`basis` **只允许出现在 SKIP 上** —— 防止把「依据」挂到 PASS/FAIL 上，
    // 那会让「这条 SKIP 依据了什么」在统计时**混入非 SKIP 行**（统计口径被稀释）。
    // 更常见的用法错误是「本想写 SKIP，但 status 算成了 PASS/FAIL」—— 那种自相矛盾必须出声。
    bail(`[判据装置·P-46 推论一] 只有 SKIP 可以带 basis（本条 status=${status}）：${card} · ${name}`
      + `（多半是 status 与 basis 的判定顺序不同源 —— 见 j6status 处的 P-1 注记）${SKIP_REASONS_TEXT}`)
  }
  results.push({ card, name, status, evidence, basis })
  const mark = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : 'ⓘ'
  console.log(`    ${mark} ${name}\n        ${evidence}`)
}

/**
 * 还原会话文件（幂等；只还原**实际备份过**的那几个）。
 * 返回是否全部成功（失败要出声，R8）。
 *
 * 【判据自身的坑（P-11/P-19）· 第二十八次 —— 本次是**夹具损坏了用户数据**，最严重的一类】
 *
 * 现象：跨轮次跑 M7 时，同一张卡的掩码单调增长（25 → 32 → 43），可见楼层单调下降
 * （27 → 3 → 0）；最后两张卡被宿主判为
 * `stored session ... is corrupt: invalid seed event at index 76: surface replace:
 *  start seq 75 not found in surface` ⇒ **整会话打不开**（UI 渲染 0 楼层）。
 *
 * 根因：本函数只做 `cp <backup> <file>`，而**应用仍在运行**、**该会话仍在内存里**。
 * 产品有一条明确设计（见 `session-surgery.ts` 注释「进程被杀不丢回退标记」的耐久 barrier）：
 * 内存态会在后续写操作时 flush 回文件。于是：
 *   ① 我 `cp` 把文件**倒退**到旅程前的状态（seq 空间随之退回）；
 *   ② 产品的内存日志**没有**跟着退（它记的是旅程后的 seq）；
 *   ③ 产品下一次写（含退出前的 flush）把「按内存 seq 计算」的 `surfaceOp.replace`
 *      写进了**已经退回的文件** ⇒ 该 `replace` 的 `startSeq` 在文件里指向
 *      一个**非 surface 成员**（实测：指向 `turn/end`）⇒ 官方 loader 校验失败。
 * 违反的纪律：**夹具的写操作必须与产品的内存态互斥**（R9 安全前提此前只在注释里，
 * 没有实现）。同时这也是 P-19 的一个新形态：**夹具自己成了缺陷制造者**——
 * 报告里却会显示成「J12 还原用户数据 PASS」（`cp` 确实成功了），**假绿**。
 *
 * ⇒ 修法（本函数只保留「执行」职责，安全顺序由调用方编排）：
 *   ① 还原前**必须** `am force-stop`（见 `restoreAllPending`），使内存态不再能写；
 *   ② 还原后**必须校验**：文件大小与备份逐一致（不一致即出声，fail-closed）；
 *   ③ 校验通过才删备份（失败则**保留**备份，供人工恢复）。
 */
const restoreSession = (dir, suffix, main, v3) => {
  if (dir === '') return { ok: true, note: '无备份（未定位目录）' }
  const a = absPath(dir)
  let ok = true
  const problems = []
  const verify = (name) => {
    const src = Number(String(runAs('stat', '-c', '%s', `${a}/${name}${suffix}`)).trim())
    const dst = Number(String(runAs('stat', '-c', '%s', `${a}/${name}`)).trim())
    if (!Number.isFinite(src) || !Number.isFinite(dst) || src !== dst) {
      ok = false
      problems.push(`${name} 大小不符（备份 ${src} vs 已还原 ${dst}）`)
    }
  }
  if (main) {
    const r = runAs('cp', `${a}/session.jsonl${suffix}`, `${a}/session.jsonl`)
    if (String(r).includes('__ADBERR__') || String(r).trim() !== '') { ok = false; problems.push(`session.jsonl cp 失败：${String(r).trim().slice(0, 60)}`) }
    else verify('session.jsonl')
  }
  if (v3) {
    const r = runAs('cp', `${a}/session.v3.jsonl${suffix}`, `${a}/session.v3.jsonl`)
    if (String(r).includes('__ADBERR__') || String(r).trim() !== '') { ok = false; problems.push(`session.v3.jsonl cp 失败：${String(r).trim().slice(0, 60)}`) }
    else verify('session.v3.jsonl')
  }
  // 校验通过才清备份；失败**保留**（人工可据它恢复）
  if (ok) runAs('rm', '-f', `${a}/session.jsonl${suffix}`, `${a}/session.v3.jsonl${suffix}`)
  return {
    ok,
    note: ok
      ? '已还原并校验一致、清理备份'
      : `还原未通过校验（R8 出声）：${problems.join('；')}——**备份已保留**供人工恢复`,
  }
}

console.log(`[E-F 旅程] ${CARDS.length} 张卡 · ${YES ? '真跑（--yes）' : 'dry-run（无 --yes，只读探测）'}\n`)

/**
 * 【安全前提 · 第二十八次修复的核心】
 * 产品的 live 会话有「立即耐久 barrier」（`flushLiveSession` → `/rp/flush-all`）：
 * **内存里的会话日志会在后续写盘时被 flush 回文件**。
 * 因此「在应用存活时 cp 还原文件」必然与内存态打架（实测把会话写成官方 loader
 * 判定的 corrupt）⇒ **还原必须与产品内存态互斥**：先 `am force-stop`，再还原。
 *
 * 于是本脚本的结构改为：**每张卡的还原动作全部延后到旅程末尾统一执行**
 *（先停应用 → 逐卡还原并校验 → 重启应用）。
 */
const pendingRestores = []
/**
 * 登记「旅程结束后要还原的卡」。
 *
 * 【P-1 / R8 · W36 续】**幂等**：按 `sid` 去重 —— 备份成功后会在 J0 处**立即**登记
 *（消除「已写盘未登记」的窗口，见 J0 处注释），而流程末尾**仍会**按既有分支再登记一次
 *（那条分支同时承担「未备份 ⇒ 记 J12 SKIP」的覆盖）。若不去重，同一张卡会登记两条
 * ⇒ 还原两次 + J12 出现两条记录（P-46 推论二：项数变了本身就是判据 ⇒ 不许无端翻倍）。
 */
const deferRestore = (sid, dir, suffix, main, v3) => {
  if (pendingRestores.some(p => p.sid === sid)) return
  pendingRestores.push({ sid, dir, suffix, main, v3 })
}

/**
 * 停应用（使内存态不再能写盘）。
 *
 * 【坑】`am force-stop` **必须走非 run-as 的 adb shell**：run-as 下会抛
 * `SecurityException: Permission denied: forceStopPackage() ... requires
 *  android.permission.FORCE_STOP_PACKAGES`（实测；本轮首跑 M7 因此
 * 打印「⚠️ 停应用失败」而**还原照旧执行** —— 安全修复等于没生效）。
 * ⇒ 单独用 `execFileSync(ADB, ['shell', 'am', 'force-stop', PKG])`。
 */
const stopApp = () => {
  try {
    const out = execFileSync(ADB, ['shell', 'am', 'force-stop', PKG], { encoding: 'utf8', timeout: 30000 })
    if (String(out).trim() === '') return true
    return !/SecurityException|Permission Denial/.test(String(out))
  } catch (e) {
    return false
  }
}
// 【R8 · W36 续】注入紧急还原钩子（`rec()` 在装置级失败时会先调它，再抛）。
// 语义与脚本末尾的「统一还原」一致：**先停应用**（与内存态互斥）→ 逐卡还原 → 清备份。
// 幂等：清空 `pendingRestores` 后再调不会重复还原。
onFatalRestore = () => {
  if (pendingRestores.length === 0) { console.error('[判据装置] （无需还原：本次尚无备份）'); return }
  const stopped = stopApp()
  if (!stopped) {
    console.error('[判据装置][FATAL] 紧急还原：停应用失败 ⇒ **不还原**（内存态可能覆盖 ⇒ 会损坏会话）')
    console.error(`  备份已保留在设备上（${pendingRestores.length} 张卡）：`)
    for (const p of pendingRestores) console.error(`    · ${p.sid} → ${p.dir}`)
    return
  }
  console.error(`[判据装置] 紧急还原：已停应用，开始还原 ${pendingRestores.length} 张卡`)
  for (const p of pendingRestores) {
    try {
      const r = restoreSession(p.dir, p.suffix, p.main, p.v3)
      console.error(`    ${r.ok ? '✓' : '✗'} ${p.sid}：${r.note}`)
    } catch (e) {
      console.error(`    ✗ ${p.sid}：还原抛异常 ${String(e.message).slice(0, 160)}（备份保留）`)
    }
  }
  pendingRestores.length = 0 // 幂等：避免末尾再还原一次
}

for (const sid of CARDS) {
  console.log(`── ${sid} ──`)
  const dir = findSessionDir(sid)
  const bakSuffix = '.efjbak'
  // ---------- 备份（安全前提） ----------
  //
  // 两文件**分别**判定：`session.jsonl` 是权威日志（必有）；`session.v3.jsonl` 仅
  // **live 写入面**存在（非 RP 活跃态或未写过就没有）——上一版把两者当**必需对**
  // ⇒ 只要 v3 缺失就整条 J0 判失败 ⇒ J10/J12 全部降级（安全前提静默失效）。
  let backedMain = false
  let backedV3 = false
  if (dir) {
    const a = absPath(dir)
    // 清理上轮中断遗留的备份（幂等：先删再备，避免 cp 覆盖到自身）
    runAs('rm', '-f', `${a}/session.jsonl${bakSuffix}`, `${a}/session.v3.jsonl${bakSuffix}`)
    const r1 = runAs('cp', `${a}/session.jsonl`, `${a}/session.jsonl${bakSuffix}`)
    backedMain = !String(r1).includes('__ADBERR__') && String(r1).trim() === ''
    const hasV3 = String(runAs('ls', `${a}/session.v3.jsonl`)).includes('session.v3.jsonl')
    if (hasV3) {
      const r2 = runAs('cp', `${a}/session.v3.jsonl`, `${a}/session.v3.jsonl${bakSuffix}`)
      backedV3 = !String(r2).includes('__ADBERR__') && String(r2).trim() === ''
    }
    const ok = backedMain && (hasV3 ? backedV3 : true)
    // 【R8 / P-1 · W36 续】备份**成功即登记**（不等到 J0 之后）——
    // 首次真跑暴露：备份写盘与 `deferRestore` 注册之间**存在窗口**，若在这两步之间抛异常，
    // 紧急还原会看到「pendingRestores 为空」而跳过 ⇒ 设备上残留 `.efjbak`（负控实测残留 2 个）。
    // ⇒ 登记必须与写盘**同一处**（P-1：同一语义只有一个权威点），窗口归零。
    if (ok) deferRestore(sid, dir, bakSuffix, backedMain, backedV3)
    rec(sid, 'J0 备份会话文件', ok ? 'PASS' : 'FAIL',
      ok
        ? `已备份 ${dir}（session.jsonl${backedMain ? '✓' : '✗'}${hasV3 ? ` · session.v3.jsonl${backedV3 ? '✓' : '✗'}` : ' · 无 session.v3.jsonl（非 live 写入态，正常）'}）`
        : `备份失败（R8 出声）：session.jsonl=${JSON.stringify(String(r1).trim().slice(0, 80))} v3=${hasV3 ? JSON.stringify(String(r2).trim().slice(0, 80)) : '-'}`)
  } else {
    rec(sid, 'J0 备份会话文件', 'FAIL', '未定位到该会话目录 ⇒ **无法保证可还原**（安全前提失效，后续判据仍跑但结论降级）')
  }

  // ---------- J1 切卡 ----------
  const before = await evalJs(`window.__efj.sid()`)
  // 【关键】必须**轮询等会话真的渲染出来**，不能固定 sleep：
  // 上一版固定 2.5s ⇒ 多数卡拿到 `user=0 asst=0`（内容还在加载）＝ 用**未就绪的快照**
  // 当基线，会让 J5/J7/J8 全部基于错基线判定（又一种假结论，P-11）。
  //
  // 【判据自身的坑（P-11）· 第八次】只等 `floors > 0` 仍然不够：楼层先出，
  // **脚本 UI（🧩 球 / pillbar / 状态浮球）是异步加载脚本清单之后才挂载的**。
  // 于是 J2/J3 拿到 `scriptball=false · 无浮球元素` ⇒ 被记成「该卡无脚本 UI，属正常」
  // —— 这条 SKIP 是**假的**：设备实测同一张卡 2.4s 后 ball=true / pills=3。
  // 危险在于它会**永久掩盖**「脚本 UI 是否真的能用」这一 L1 核心面的覆盖度。
  // ⇒ 修法：就绪改为**快照稳定**（连续两次读数完全一致），且上限放宽到 25s。
  //
  // 【第 34 次坑的连带修正（见 snap 的注释）】`floors` 已改为「已渲染 + 占位」＝总数，
  // 因此本处「稳定」判据现在真的等价于「楼层总数不再变」，不再受窗口化扩张影响；
  // 但 `rendered`/`windowed` 仍会随扩张变化 ⇒ 稳定签名**只用不受扩张影响的量**
  // （floors 总和 + 脚本 UI 挂载态），否则窗口化扩张期内永远等不到「两次一致」，
  // 会把 25s 全耗光（那是判据自己制造的慢）。
  // 【W34】签名里只放**结构类**判据项（`le`）：传输类（api gateway / WebSocket）会**间歇抖动**
  // ⇒ 若进签名，稳定判定永远等不到「两次一致」（会把 25s 预算全耗光 —— 那是判据自己制造的慢）。
  // 取法：结构类 + 未知兜底（两者都代表「宿主拒绝这份数据」），传输类**明确不进**。
  const leKey = (x) => (x.loadError?.struct ?? null) ?? (x.loadError?.other ?? null)
  const sig = (x) => JSON.stringify([x.floors, x.scriptball, x.pills, x.statefloat, x.draggable, x.rollback, leKey(x)])
  const waitRendered = async () => {
    let last = null
    // 【P-47 分层 · W40】把「判据装置自己坏了」与「产品真读不到」分开计数 ——
    // 前者（`__efj` 缺失且重装失败）**不许**退化成「floors=0」的 SKIP（见 EFJ_SOURCE 注释）。
    let probeErrCount = 0
    // 【W40】预算 50×500ms = 25s。实测（tmp/w40-floors-compare.mjs）在这台模拟器上
    // 「切卡 → RP 容器挂载」最慢到 **21s**（大会话 st-clk9pd），25s 余量偏紧 ⇒ 提为 80 步（40s），
    // 并在预算耗尽时**如实报出**（见下方 `budgetExhausted`），避免把「等不够」写成「真没有」。
    const MAX_TRIES = 80
    for (let i = 0; i < MAX_TRIES; i += 1) {
      // 【W40 自愈】读快照前确保注入在位（页面重载会清掉一次性注入 ⇒ 当场重装）
      const ens = await ensureEfj()
      if (!ens.ok) { probeErrCount += 1; last = null; await sleep(500); continue }
      const cur = await evalJs(`window.__efj.sid()`)
      const sn = await evalJson(`JSON.stringify(window.__efj.snap())`)
      // 【判据自身的坑（P-19/P-20/R16）· 第三十六次】上一版在 `sn.__err`（一次**瞬时**求值
      // 失败）时**立即 return floors:0** ⇒ 把「本机此刻测不到」当成事实「0 楼层」，
      // 且**把 25s 的重试预算一秒都没用**（这一行就是「M7 读 0」的直接来源）。
      // 设备实证（tmp/w32-floor-zero-trace.mjs，W32）：切卡瞬间求值会抛异常（页面整棵子树
      // 重挂载窗口），随后正常 —— 同一张卡在 M7 里读 total=0，在独立探针里读 **31 楼**，
      // 差异全部来自这一行。⇒ 改为**重试**（不早退、不记 0、不消耗结论）。
      if (sn.__err) { probeErrCount += 1; last = null; await sleep(500); continue }
      // **打不开是确定性终态**：宿主已给出**结构性**加载失败文案（拒绝这份数据）
      // ⇒ 再等也不会出现楼层，立即返回（避免把 25s 预算耗在「注定的 0」上）。
      // ★ 只认 `struct` / `other`（未知来源按结构类 fail-closed）；**传输类不算** ——
      //   它是网络层抖动（`api gateway / Remote stream`），会自愈，必须继续等（P-46）。
      if (cur === sid && (sn.loadError?.struct || sn.loadError?.other)) return { cur, sn, ready: false, openFail: true }
      if (cur === sid && sn.floors > 0) {
        if (last !== null && sig(last) === sig(sn)) return { cur, sn, ready: true }
        last = sn
      } else {
        // ★【W40 · P-46 推论三】`floors === 0` 有**两种相反含义**，必须分开：
        //   · `rpActive === false` ⇒ **RP 视图还没挂载**（切卡后的正常中间态）
        //     实测（tmp/w40-floors-compare.mjs）：切卡后 t=0..18s `rpActive=null` 且 0 楼层，
        //     t=21s 才挂出 39 个楼层头 ⇒ 此时**必须继续等**，不许当成「稳定地 0 楼层」
        //     （否则会把「容器没挂载」记成「会话无可见楼层」的 SKIP，吃掉该卡全部覆盖）。
        //   · `rpActive === true` 且 `floors === 0` ⇒ 容器在、确实没楼层 ⇒ 可以进入稳定判定。
        if (sn.rpActive === true) { last = null }   // 容器在、真无楼层 ⇒ 交给外层判 SKIP
      }
      await sleep(500)
    }
    const cur = await evalJs(`window.__efj.sid()`)
    const sn = await evalJson(`JSON.stringify(window.__efj.snap())`)
    // ★ 【P-47】预算耗尽时**必须区分两种终态**：
    //   · `probeErrCount > 0` 且最终仍拿不到快照 ⇒ 判据装置侧故障 ⇒ 报 `probeErr`
    //     （由 J1 记**装置失败**并出声，**不**当「会话无可见楼层」）
    //   · 否则 ⇒ 真的是「稳定地读到 0 楼层」（可能是数据层真的空 / 或渲染层没出）
    // 【W40 追加】预算耗尽本身也要可判读：把「RP 容器是否挂载」带出去，
    //   让 J1 的 SKIP 能区分「容器没挂载（等不够/环境慢）」与「容器在但真没楼层」。
    if (sn.__err) return { cur, sn: { floors: 0 }, ready: false, probeErr: true, probeErrCount, budgetExhausted: true }
    return {
      cur, sn, ready: false,
      probeErr: probeErrCount >= Math.floor(MAX_TRIES / 3),
      probeErrCount,
      budgetExhausted: true,
    }
  }
  // 【判据自身的坑（P-11）· 第十四次】重前端卡（`session-8b45ce80`）切卡**偶发不生效**：
  // 深链事件消费成功（`__dshtLocateConsumed === true`）但 React 侧 `ctx.sessions.open`
  // 尚未完成（模拟器内存紧张时更明显）⇒ sessionId 仍是上一张 ⇒ J1 FAIL，
  // 且把后续 10 条判据全部降级成 SKIP（覆盖度被一条时序问题吃掉）。
  // ⇒ 修法：**重试派发**（最多 3 轮，每轮独立等待），成功即继续；仍失败才判 FAIL。
  let cur = '', ready = false, snapS = { floors: 0 }, openFail = false
  let dispatched = 'not-sent'
  let probeErr = false
  let probeErrCount = 0
  let budgetExhausted = false
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    // 【W40 自愈】派发前也要确保注入在位 —— 否则 `switchTo` 会因 `__efj` 缺失而抛错，
    // 表现为「切卡 3 次未生效（当前 null）」（首次真跑就被这条绊过）。
    await ensureEfj()
    dispatched = await evalJs(`window.__efj.switchTo(${JSON.stringify(sid)})`)
    const r = await waitRendered()
    cur = r.cur; snapS = r.sn; ready = r.ready; openFail = r.openFail === true
    probeErr = r.probeErr === true
    probeErrCount = r.probeErrCount ?? 0
    // 【W40】预算是否耗尽（见 waitRendered 注）：用于 J1 的 SKIP 依据（P-46 推论一）
    if (r.budgetExhausted === true) budgetExhausted = true
    if (cur === sid && !probeErr) break
    console.log(`    ⓘ 第 ${attempt} 次切卡未生效（当前 ${cur}${probeErr ? ` · 判据装置侧异常 ${probeErrCount} 次` : ''}），重试…`)
    await sleep(1500)
  }
  let s = snapS
  const switched = cur === sid
  // 【判据自身的坑（P-11）· 第十八次】切卡失败的**性质**必须区分，不许一律记 FAIL。
  // 实测 `session-8b45ce80`（3.0MB / 4767 行，goal 点名的「重前端卡、事件量最大」）
  // 三次重试都没切过去——但**不是功能坏了**：同一次运行里另外 4 张卡全部切卡成功，
  // 而这张卡只是**渲染/解析量远超模拟器能力**（该次会话还伴随内存压力）。
  // 把「大会话在模拟器上切不动」记成「切卡功能 FAIL」= 用环境限制指控产品。
  // ⇒ 修法：报**未知**并**带上可判读的证据**（会话字节数 + 三次都失败这一事实），
  //    让报告读者自己判断该不该追（真机大概率能过）。判 FAIL 仅当**小会话也切不动**。
  const sizeInfo = dir ? (() => {
    const r = runAs('stat', '-c', '%s', `${dir}/session.jsonl`)
    const n = Number(String(r).trim())
    return Number.isFinite(n) ? n : null
  })() : null
  const bigSession = sizeInfo !== null && sizeInfo > 1_000_000
  // 【判据自身的坑（P-19/P-20）· 第三十七次】三种终态必须分开（原先只有「成功/失败」两分）：
  //   · 切卡成功且能读出内容 ⇒ PASS
  //   · 切卡成功但**宿主报加载失败**（会话整份打不开）⇒ **FAIL**（用户可见的硬缺陷，
  //     不许再记成「无可见楼层，可能已被回退到空」那种 SKIP —— 那正是本缺陷被掩盖 6 轮的原因）
  //   · 切卡本身没成功 ⇒ 大会话记 SKIP（环境限制）/ 小会话记 FAIL
  // 【P-46 推论一 · W40 连带】J1 的三元里 `!switched && bigSession` 会产出 **SKIP**
  // ⇒ 按装置的结构性断言，SKIP **必须**带 `basis`（否则 `rec()` fail-closed 中止）。
  // ★ 这正是装置该做的事：我上一版改了三元却漏了第 5 参，**首次真跑当场被抓**
  //   （且紧急还原正确执行 —— 负控之外的又一次实战验证）。
  const j1status = !switched ? (bigSession ? 'SKIP' : 'FAIL') : (probeErr ? 'FAIL' : (openFail ? 'FAIL' : 'PASS'))
  rec(sid, 'J1 切卡成功',
    j1status,
    !switched
      ? `切卡 3 次未生效（当前仍 ${cur}）· 会话 session.jsonl ${sizeInfo ?? '未知'} 字节${bigSession ? '（＞1MB：模拟器渲染/解析受限，**本机测不出**，真机待验）' : '（小会话仍切不动 ⇒ 疑真缺陷）'}`
      : (probeErr
        // ★【P-47 分层 · W40】这是**判据装置自身**那一层的故障，不是产品缺陷：
        //   实测根因 = 一次性 `window.__efj` 注入在页面重载后消失（`tmp/w40-efj-lifetime-exp.mjs`）。
        //   ⇒ 报 FAIL 并**出声**（R8），把「装置坏了」与「会话无可见楼层」**分开**，
        //     不许再退化成「无可见楼层」的 SKIP（那正是本缺陷被掩盖的形态）。
        ? `**判据装置自身异常**（会话并未无内容）：快照探针 \`window.__efj\` 在 ${probeErrCount} 次采样中均不可用（页面重载后一次性注入丢失）⇒ **本卡读数不可采信**，非产品缺陷。已装 Page.addScriptToEvaluateOnNewDocument 自动重装 + ensureEfj() 自愈；若本条仍红，请检查 CDP 会话是否被重置。`
        : (openFail
          ? `**该会话整份打不开**（宿主数据面拒绝加载，用户只能看到红字）⇒ 非「无内容」：${s.loadError?.struct ?? s.loadError?.other}`
          : `派发消费=${dispatched} · sessionId ${before} → ${cur} · 内容就绪=${ready} · 楼层 total=${s.floors}（已渲染 ${s.rendered} + 窗口化占位 ${s.windowed}）· user=${s.user} asst=${s.asst} · 🧩球=${s.scriptball} 脚本按钮=${s.pills} 状态浮球=${s.statefloat} 可拖=${s.draggable}`
            + ` · RP 容器已挂载=${s.rpActive === true}` + (budgetExhausted ? '（★ 就绪预算已耗尽）' : '')
            + (s.loadError?.transport ? ` · [网络层] ${s.loadError.transport}` : ''))),
    // 【P-46 推论一 · 结构化依据】只有 SKIP 才带 basis；类别与 `j1status` 同源（P-1）
    j1status === 'SKIP'
      ? { kind: 'env', facts: `切卡 3 次未生效（当前仍 ${cur}）· 会话 session.jsonl ${sizeInfo ?? '未知'} 字节（＞1MB ⇒ 模拟器受限）` }
      : undefined)
  if (!switched || probeErr) {
    rec(sid, 'J2~J11 旅程', 'SKIP',
      probeErr
        ? `**判据装置侧异常**（非产品缺陷）：快照探针不可用 ${probeErrCount} 次 ⇒ 本卡读数不可采信，不冒充已覆盖`
        : '切卡未成功，后续判据无法在本卡上执行（不冒充已覆盖）',
      { kind: 'env', facts: probeErr ? `__efj 不可用 ${probeErrCount} 次（页面重载丢注入）` : `切卡 3 次未生效（当前仍 ${cur}）` })
    // 还原已在 J0 处登记（P-1）⇒ 此处不再重复登记
    continue
  }
  // 【判据自身的坑（P-11）· 第十七次】切卡成功 ≠ 该卡**能做旅程**。
  // 实测 `session-fdfc1a28`：切换到成功（sessionId 对了）但 `floors=0`
  //（该会话已被回退到只剩 0 个可见楼层）⇒ J5「点回退按钮」直接 `no-btn`、
  // J6/J7 在空会话上必然失败 ⇒ 三条**无意义 FAIL**，把「该卡无可回退内容」
  // 这个**事实**误报成「功能坏了」。
  // ⇒ 修法：内容不足以支撑旅程时，显式 SKIP 并**说明原因**（P-17：区分「事实是否定」
  //    与「我们测不出来」），不让后继判据在空基线上产生假红。
  //
  // 【第三十七次的连带修正】「0 楼层」的**两种含义**在这里再次分叉：若原因是
  // **宿主报加载失败**（会话整份打不开），那**不是**「无内容」而是硬缺陷 ——
  // 此时该卡的后继旅程确实测不了（记 SKIP 合理），但**必须把失败文案写在结论里**
  // 并与「确实无内容」区分开（P-19/P-20：同一读数不许有两种相反解释）。
  if (s.floors === 0) {
    // 【W40 · P-46 推论三】**先把两种 0 楼层分开**（依据是读出来的事实，不是推测）：
    //   · RP 容器**尚未挂载**（`rpActive=false`）⇒ 这是**就绪竞态**：容器没出来，
    //     楼层当然读不到 ⇒ 后续旅程在本卡上**无法执行**，但原因属**装置/环境**（P-43 SKIP）。
    //     实测（tmp/w40-floors-compare.mjs）：切卡后 0~18s `rpActive=null`、t=21s 才有 39 楼。
    //   · RP 容器**已挂载**且仍 0 楼层 ⇒ 容器在、确实没内容 ⇒ 走下面的「读盘对账」分支。
    if (s.rpActive !== true) {
      rec(sid, 'J2~J11 旅程', 'SKIP',
        `**RP 容器尚未挂载**（\`data-dsht-rp-active\` 未置位）⇒ 楼层读不到是就绪竞态，非产品缺陷。`
        + `读出的事实：楼层 total=${s.floors} · RP 容器已挂载=${s.rpActive === true} · 就绪预算已耗尽=${budgetExhausted}`
        + ` · 会话文件 session.v3.jsonl 存在（J0 已备份）⇒ 数据在磁盘上，只是本机此刻没渲染出来。`
        + `按 R7/P-17/P-43 记 SKIP 不判 FAIL。`,
        { kind: 'env', facts: `rpActive=${s.rpActive === true} · floors=0 · budgetExhausted=${budgetExhausted}` })
      // 还原已在 J0 处登记（P-1）⇒ 此处不再重复登记
      continue
    }
    // 【P-46 推论一 · W36 收口】**SKIP 的理由必须是读出来的事实，不能是推测**。
    // 旧文案写「（head=0，**可能**已被回退到空）」—— 那是**猜测**，而复核者不会去追问
    // （理由读起来很合理）。⇒ 改为就地**读两件确定事实**：
    //   ① 产品同源掩码 RPC（`/dsht-rp/rp/rollback-mask`）⇒ 被移出上下文的 seq 数；
    //   ② 会话文件里 `user/message` / `assistant/message` 的**物理条数**（直接读盘）。
    // 二者合起来能**确定**「是内容被回退光了」还是「文件里本来就没有楼层」。
    const m0z = await evalJson(`window.__efj.mask(${JSON.stringify(sid)}).then(m => JSON.stringify(m))`)
    const hiddenZ = Array.isArray(m0z?.hiddenSeqs) ? m0z.hiddenSeqs.length : null
    const evCount = (() => {
      if (!dir) return null
      const listing = runAs('ls', '-1', `${absPath(dir)}`)
      if (String(listing).startsWith('__ADBERR__')) return null
      const entries = String(listing).split('\n').map(s => s.trim()).filter(Boolean)
      // 【判据自身的坑（P-3）· 第三十九次】此处**不能**调 `pickLogName` —— 它是后面才
      // 用 `const` 定义的（TDZ）⇒ 提前引用会抛 `Cannot access 'pickLogName' before initialization`，
      // 而该异常发生在 `rec()` 之前 ⇒ **整个脚本崩掉、后续所有卡不跑**（正是 P-3 的形态）。
      // ⇒ 就地内联同款规则（取最高版本的 `session.v<N>.jsonl`，否则回落 `session.jsonl`）。
      let logName = null, bestV = -1
      for (const n of entries) {
        const m = /^session\.v(\d+)\.jsonl$/.exec(n)
        if (m === null) continue
        const v = Number(m[1])
        if (v > bestV) { bestV = v; logName = n }
      }
      if (logName === null) logName = entries.includes('session.jsonl') ? 'session.jsonl' : null
      if (logName === null) return null
      const txt = runAs('cat', `${absPath(dir)}/${logName}`)
      if (String(txt).startsWith('__ADBERR__')) return null
      let nUser = 0, nAsst = 0
      for (const line of String(txt).split('\n')) {
        const t = line.trim()
        if (t === '') continue
        // 只做**结构计数**（不解析 JSON，避免半行/大对象开销）
        if (t.includes('"type":"user/message"')) nUser += 1
        else if (t.includes('"type":"assistant/message"')) nAsst += 1
      }
      return { logName, nUser, nAsst }
    })()
    const fact = `快照已稳定（连续两次签名一致）但两类楼层计数均为 0`
      + ` · 掩码被移出 ${hiddenZ === null ? '未取得' : `${hiddenZ} 个 seq`}`
      + ` · 会话文件 ${evCount === null ? '未取得' : `${evCount.logName}：user/message ${evCount.nUser} 条 / assistant/message ${evCount.nAsst} 条`}`
    rec(sid, 'J2~J11 旅程', 'SKIP',
      openFail
        ? `该会话**整份打不开**（宿主拒绝加载：${s.loadError?.struct ?? s.loadError?.other}）⇒ 后继旅程无对象可判（J1 已 FAIL，不重复计数）`
        : `切卡成功但该会话**无可见楼层** ⇒ 无法执行「回退/重发」旅程，不冒充已覆盖。**读出的事实**：${fact}`,
      openFail
        ? { kind: 'no-lev', facts: `宿主拒绝加载（${s.loadError?.struct ?? s.loadError?.other}）` }
        // 【P-46 推论一】这里读了两件确定事实（掩码 RPC + 读盘计数）⇒ 依据类别必须是 read
        : { kind: 'read', facts: fact })
    // 还原已在 J0 处登记（P-1）
    continue
  }

  // ---------- J2/J3 脚本 UI + 拖拽前提 ----------
  // J2：脚本 UI 是否真的挂上了。设备实测 5 张抽样卡**都有**（pills 2~4、状态浮球在），
  // 上一版判成「无脚本 UI」纯属快照未就绪（见 waitRendered 的第八次注记）。
  // 现在快照已稳定，故「无脚本 UI」只能是**真的**没有 → 才允许 SKIP。
  const hasScriptUi = s.scriptball || s.pills > 0 || s.statefloat
  rec(sid, 'J2 脚本 UI 在位', hasScriptUi ? 'PASS' : 'SKIP',
    `🧩球=${s.scriptball} · script-pill=${s.pills} · 状态浮球=${s.statefloat}${hasScriptUi ? '' : '（快照已稳定仍无脚本 UI ⇒ 该卡确实无脚本）'}`,
    hasScriptUi ? undefined : { kind: 'no-lev', facts: `快照已稳定仍无脚本 UI（球=${s.scriptball} pill=${s.pills} 浮球=${s.statefloat}）` })
  // J3：拖拽真值。P0-1 的验收面是「**卡脚本的 jQuery UI 触屏拖拽**」。
  //
  // 【判据自身的坑（P-11）· 第二十次】上一版把**楼层帧**（`.dsht-rp-message-frame`）
  // 也纳入判据：「有内容帧里若有 N 个尚未装载 jQuery ⇒ FAIL」。设备实测（`tmp/floorframe-probe.mjs`）
  // 证伪：楼层帧是**窗口化 + 按需装载 vendor** 的——同一会话在切卡后 0s/3s/6s…15s
  // 读到的「有内容帧」数量从 0 到 15 不断变化（随滚动/渲染推进），且 vendor 装载**晚于**
  // 首帧测量时刻。⇒ 该判据测的是**渲染时序**，不是「拖拽是否可用」，必然随机 FAIL。
  // 真正与拖拽相关的是：
  //   ① 宿主 jQuery 上的桥（P0-1 的主战场：卡脚本经 `window.parent.$` 把浮窗 append 进宿主 body）
  //   ② **卡脚本帧**（每个脚本一个帧，装载即装桥；数量在会话内稳定）
  //   ③ 我方浮球（React 自研拖拽，非 jQuery UI）——只要求可定位、可点
  // ⇒ 修法：楼层帧降为**信息项**（打印但不进判据）。
  //
  // 【判据自身的坑（P-19/P-20）· 第三十五次】`ball` 是**单次瞬时采样**，而切卡会触发
  // **整棵子树重挂载**：设备实测（`tmp/probe-ball-j3.mjs` 按 1s 采样 20 次切到
  // `session-4849a2b6`）显示存在一个 2~5s 的窗口，其中某个时刻 `floor-head=0`、
  // 浮球与 🧩 球**同时消失**（t=3s `total=0`），随后又全部回来并稳定 15s+：
  //   t=0..2s  total=43 stateBall=true scriptBall=false→true
  //   t=3s     total=0  stateBall=false scriptBall=false   ← 重挂载窗口
  //   t=5s+    total=7  stateBall=true scriptBall=true      ← 稳定
  // ⇒ 若那一次瞬时采样恰好落在窗口内，J3 就报「我方浮球=无」——**假红**（同一次运行里
  //   J1 对同一会话读出 `状态浮球=true`，自相矛盾即是红色信号）。
  // ⇒ 修法（P-20：读数必须确定）：把 ball 的读取改为**短轮询直到出现或超时**（上限 8s，
  //   每次 500ms）；并把它与 J1 已确认的 `s.statefloat` 做**交叉校验** —— 两者矛盾时报
  //   SKIP（说明「本机此刻测不出」）而不是 FAIL（P-17：区分事实否定与测不出）。
  const dragOk = await evalJson(`(() => {
    const out = { host: false, hostVendor: null, jq: null, marked: 0,
      scriptFrames: 0, scriptBridged: 0, liveFrames: 0, liveBridged: 0, liveNoJq: 0 }
    try { out.host = !!(window.$ && window.$.ui && window.$.ui.mouse && window.$.ui.mouse.prototype && window.$.ui.mouse.prototype.__dshtTouchBridge === true) } catch (e) { out.hostErr = String(e).slice(0, 80) }
    try { out.hostVendor = (window.__dshtHostVendor || {}).tag || null } catch (e) {}
    try { out.jq = (window.$ && window.$.fn && window.$.fn.jquery) || null } catch (e) {}
    out.marked = document.querySelectorAll('[data-dsht-touch-drag]').length
    for (const f of document.querySelectorAll('iframe')) {
      const isScriptFrame = /^TH 脚本/.test(f.getAttribute('title') || '')
      const b = f.getBoundingClientRect()
      const live = b.width > 4 && b.height > 4
      let bridged = false, hasJq = false
      try { const w = f.contentWindow; const jq = w && w.$; hasJq = !!jq; bridged = !!(jq && jq.ui && jq.ui.mouse && jq.ui.mouse.prototype && jq.ui.mouse.prototype.__dshtTouchBridge === true) } catch (e) {}
      if (isScriptFrame) { out.scriptFrames += 1; if (bridged) out.scriptBridged += 1 }
      if (live && !isScriptFrame) { out.liveFrames += 1; if (bridged) out.liveBridged += 1; else if (!hasJq) out.liveNoJq += 1 }
    }
    const ball = document.querySelector('.dsht-rp-scriptball') || document.querySelector('.dsht-rp-statefloat-ball')
    if (ball) {
      const cs = getComputedStyle(ball)
      const b = ball.getBoundingClientRect()
      out.ball = { position: cs.position, pe: cs.pointerEvents, w: Math.round(b.width), h: Math.round(b.height) }
    }
    return JSON.stringify(out)
  })()`)
  const dragPass = !dragOk.__err && dragOk.host === true
    && dragOk.scriptFrames === dragOk.scriptBridged
  // 【第 35 次坑的修法】ball 单独做**短轮询**（切卡后子树重挂载期间会瞬时消失）。
  const readBall = async () => {
    for (let i = 0; i < 16; i += 1) {
      const cur = await evalJson(`(() => {
        const el = document.querySelector('.dsht-rp-scriptball') || document.querySelector('.dsht-rp-statefloat-ball')
        if (!el) return JSON.stringify({ present: false })
        const cs = getComputedStyle(el); const b = el.getBoundingClientRect()
        return JSON.stringify({ present: true, position: cs.position, pe: cs.pointerEvents, w: Math.round(b.width), h: Math.round(b.height) })
      })()`)
      if (!cur.__err && cur.present === true) return cur
      await sleep(500)
    }
    return { present: false }
  }
  const ballProbe = await readBall()
  if (ballProbe.present === true) dragOk.ball = ballProbe
  const ballOk = ballProbe.present === true && ballProbe.position !== 'static' && ballProbe.pe !== 'none'
  // ---------- J3 真拖拽实验（W32 补 · E-F 的「含拖拽」要求） ----------
  //
  // 【为什么要补（P-24：判据落结果，不落机制）】
  //  本条此前**只验「桥装上了」**（`$.ui.mouse.prototype.__dshtTouchBridge === true` +
  //  卡脚本帧全部装桥）—— 那是**机制**（「具备可拖拽的前提」），
  //  而 goal §八 E-F 要求的是「脚本 UI 交互（**含拖拽**）」= **真的拖了一次、它真的动了**。
  //  两者差距很大：若拖拽逻辑因 **pointer capture 生命周期**缺陷失效
  //  （本仓 W7 就修过 `lostpointercapture` 缺失），桥仍然「装着」⇒ 本条**照样 PASS**
  //  ⇒ **覆盖空洞**（P-20）。旁证：`eg-mobile-actions.mjs` ① 早已改成真拖实验，
  //  设备实测 `340,219 → 340,279`（Δ=0,60）⇒ 说明「真拖」是可测的，没有理由只测桥。
  //
  // 【口径（守 R7/P-17/P-43）】
  //  · 该卡**无浮球** ⇒ 沿用既有口径（只判桥，不把浮球缺席当缺陷）；
  //  · 有浮球 ⇒ **必须真的拖得动**才算 PASS（这才是「拖拽真值」这个名字的含义）
  //    —— 这正是把名字兑现：原名如此，实现却在测别的东西（P-1 的注释/实现不一致形态）。
  //  · 拖不动 ⇒ **先 SKIP 并出声**（不立刻判 FAIL）：本条的合成 pointer 事件与真机触摸
  //    仍有差异，且要看装置是否就绪；证据里给出完整读数供人判断（判据力前提见下）。
  const dragReal = ballOk
    ? await evalJson(`(async () => {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms))
        const el = document.querySelector('.dsht-rp-scriptball') || document.querySelector('.dsht-rp-statefloat-ball')
        if (!el) return JSON.stringify({ err: 'no-ball' })
        const b0 = el.getBoundingClientRect()
        const x0 = b0.left + b0.width / 2, y0 = b0.top + b0.height / 2
        const DX = 36, DY = 48
        const mk = (type, x, y) => new PointerEvent(type, {
          bubbles: true, cancelable: true, composed: true,
          pointerId: 1, pointerType: 'touch', isPrimary: true,
          clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1,
        })
        el.dispatchEvent(mk('pointerdown', x0, y0))
        await sleep(60)
        for (let i = 1; i <= 5; i++) { el.dispatchEvent(mk('pointermove', x0 + DX * i / 5, y0 + DY * i / 5)); await sleep(40) }
        el.dispatchEvent(mk('pointerup', x0 + DX, y0 + DY))
        await sleep(400)
        const b1 = el.getBoundingClientRect()
        return JSON.stringify({
          from: [Math.round(b0.left), Math.round(b0.top)],
          to: [Math.round(b1.left), Math.round(b1.top)],
          dx: Math.round(b1.left - b0.left), dy: Math.round(b1.top - b0.top),
        })
      })()`)
    : null
  const dragMoved = !!dragReal && !dragReal.__err && !dragReal.err
    && (Math.abs(dragReal.dx) >= 8 || Math.abs(dragReal.dy) >= 8)
  // 交叉校验（P-17）：J1 的快照里 statefloat 与此处 ball 矛盾 ⇒ 本机此刻测不出 ⇒ SKIP。
  // 仅当**两处一致地**「无浮球」且该卡 J1 也未报状态浮球时，才算真缺陷（FAIL）。
  const contradictory = ballProbe.present !== true && s.statefloat === true
  // 【J3 判据力修正 · 第五十一次 · 2026-09-15 W4 收口轮设备实测抓到（P-29 家族）】
  //
  // ## 症状（与 J2 **自相矛盾**）
  // 同一张卡 `st-1jfywz9`：J2 判 **SKIP** 并注明「该卡确实无脚本」（依据 J1 快照
  // `🧩球=false · script-pill=0 · 状态浮球=false`），而紧接着的 **J3 却判 FAIL**，
  // 证据同样是「我方浮球=无」。**同一事实、同一个快照读数，相邻两步结论相反**。
  //
  // ## 真因
  // J3 把 `ballOk`（浮球在位）写成 PASS 的**必要条件**，但**没有先问「这张卡该有浮球吗」**。
  // 浮球（`.dsht-rp-statefloat-ball` / `.dsht-rp-scriptball`）只在
  // **挂了脚本 / 有 MVU 状态**的 RP 卡上才渲染；无脚本的卡上它**本就不该存在**。
  // ⇒ 对无脚本卡，`ballOk=false` 是**正常状态**，却被当成缺陷 ⇒ 假 FAIL。
  // 这与 `P-24`（判据落在机制/先决条件而非结果）同族，也与 P-17 同族
  // （判据力前提不成立时应 SKIP，不该 FAIL）。
  //
  // ## 修法
  // 判据力前提：**该卡是否有「该出现浮球」的证据**（取 J1 同一快照，不新采一次、
  // 避免引入新的时序假设）。有 ⇒ 浮球仍是必要条件（缺了就是真缺陷）；
  // 无 ⇒ 本条只测**桥**（`dragPass`），浮球缺席记为「该卡无浮球能力，不适用」并在证据里出声。
  const cardExpectsFloat = s.statefloat === true || s.scriptball === true || s.pills > 0
  // 【判据力前提（P-20/P-43）】「真拖」只在**该卡有浮球**时才有对象可判
  //   ⇒ 无浮球 ⇒ 沿用旧口径（只判桥）；有浮球 ⇒ 必须真拖得动。
  const j3ok = dragPass && (ballOk ? dragMoved : !cardExpectsFloat)
  const j3Evidence = `宿主桥已装=${dragOk.host}（vendor=${dragOk.hostVendor} · jQuery ${dragOk.jq}）· 已标记可拖元素=${dragOk.marked} · 卡脚本帧 ${dragOk.scriptBridged}/${dragOk.scriptFrames} 已装桥 · 我方浮球=${dragOk.ball ? `${dragOk.ball.position}/${dragOk.ball.pe}/${dragOk.ball.w}×${dragOk.ball.h}px` : '无'}`
    + (ballOk
      ? ` · **真拖实验**（pointerdown→move×5→up，目标 +36,+48）：`
        + (dragReal && !dragReal.err
          ? `位置 ${dragReal.from[0]},${dragReal.from[1]} → ${dragReal.to[0]},${dragReal.to[1]}（Δ=${dragReal.dx},${dragReal.dy}）`
            + (dragMoved ? ' ⇒ **真的拖动了**' : ' ⇒ 位置未变')
          : `无法执行（${dragReal?.err ?? dragReal?.__err ?? 'null'}）`)
        + (dragMoved ? '' : '　⚠️ **未拖动**：本项无法区分「拖拽坏了（产品缺陷）」与「合成 pointer 事件不被该实现接受（装置侧）」；按 R7/P-17 记 SKIP 并出声，不判 FAIL')
      : '（该卡无浮球 ⇒ 本条只判桥，不把浮球缺席当缺陷）')
    + `${contradictory ? ` ← 与 J1 快照**矛盾**（J1: 状态浮球=${s.statefloat} · 本探针: 浮球 present=${ballProbe.present}）⇒ 两处读数不一致 = 本机此刻测不出，按 R7/P-17 记 SKIP 不判 FAIL（不猜原因：可能是重挂载窗口，也可能是探针/选择器差异 —— **两种实情输出相同，故不下推论**）` : ''}`
    + `（楼层帧信息，不进判据：有内容 ${dragOk.liveFrames}／装桥 ${dragOk.liveBridged}／未装 vendor ${dragOk.liveNoJq}）`
  const j3status = dragOk.__err ? 'SKIP'
    : (contradictory ? 'SKIP' : (j3ok ? 'PASS' : (ballOk && !dragMoved ? 'SKIP' : 'FAIL')))
  rec(sid, 'J3 拖拽真值（touch→mouse 桥 + 真拖实验）',
    j3status,
    dragOk.__err
      ? `探测异常，未取得证据：${String(dragOk.__err).slice(0, 120)}`
      : j3Evidence,
    // 【P-46 推论一 · 结构化依据】三元的三种 SKIP 成因**依据类别不同**：
    //   · 探针异常 ⇒ probe-err（未取得证据）
    //   · 与 J1 读数矛盾 ⇒ no-change（两处读数不一致 = 本机此刻测不出）
    //   · 有浮球但未拖动 ⇒ no-change（无法区分产品缺陷 vs 合成事件不被接受）
    // ★ 首层必须与 `j3status` 同源（`status === 'SKIP'`），否则 FAIL 时也会带上 basis
    //   而触发第 4 条断言（P-1：不许各写一遍条件）。
    j3status === 'SKIP'
      ? (dragOk.__err
        ? { kind: 'probe-err', facts: String(dragOk.__err).slice(0, 120) }
        : (contradictory
          ? { kind: 'no-change', facts: `J1 读 状态浮球=${s.statefloat}，本探针读 present=${ballProbe.present}` }
          : { kind: 'no-change', facts: `浮球存在（present=${ballProbe.present}）但合成 pointer 序列未使位置改变` }))
      : undefined)

  // ---------- J4 回退前基线 ----------
  //
  // 【判据自身的坑（P-11/P-17）· 第六次】上一版把**首次渲染快照**里的 meterPct 直接
  // 当基线 ⇒ 首次渲染时进度条还没算出值（`0%` 或 null），而回退后它算出来了
  // （`0.578%`）⇒ 判据把「基线未就绪」判成「占用上升」= FAIL。这是**假失败**，
  // 与假绿同害：它指向一个不存在的问题，浪费整轮排查。
  // ⇒ 修法：先**轮询等计量就绪**（上限 20s）再取基线；始终未就绪则 J6 记 SKIP
  // 并说明「测不出来」（P-17：必须能区分「事实是否定」与「我们测不出来」）。
  const readMeter = async () => {
    const sn = await evalJson(`JSON.stringify(window.__efj.snap())`)
    if (sn.__err) return { pct: NaN, meter: null, raw: null, tokenRaw: null, exact: null, exactBudget: null, dataChars: null }
    return { pct: parseFloat(sn.meterPct ?? ''), meter: sn.meter, raw: sn.meterPct, tokenRaw: sn.tokenRaw, exact: sn.tokenExact, exactBudget: sn.budgetExact, dataChars: sn.dataChars }
  }
  /** 解析 `≈ 5.8k / 1M tokens` → 5800（精度受 formatTokens 限制：k 级 100、M 级 100k） */
  const parseTokens = (raw) => {
    const m = /≈\s*([\d.]+)\s*([kM]?)\s*\//.exec(String(raw ?? ''))
    if (m === null) return NaN
    const n = parseFloat(m[1])
    return m[2] === 'M' ? n * 1e6 : m[2] === 'k' ? n * 1e3 : n
  }
  let meterBase = await readMeter()
  for (let i = 0; i < 40 && !(Number.isFinite(meterBase.pct) && meterBase.pct > 0); i += 1) {
    await sleep(500)
    meterBase = await readMeter()
  }
  const meterReady = Number.isFinite(meterBase.pct) && meterBase.pct > 0
  const mask0 = await evalJson(`window.__efj.mask(${JSON.stringify(sid)}).then(m => JSON.stringify(m))`)
  const m0 = mask0.__err ? {} : mask0
  const pctBefore = meterBase.pct
  // 【J6 判据力前提 · 必须在**回退之前**取】导出侧「seq → 文本字符数」快照。
  //
  // 【判据自身的坑（P-11/P-18）· 第二十七次】此前在**回退之后**才扫导出，于是
  // 5/5 张卡全部「新移出项 ∩ 导出 = 0」——看似「产品正确地不需要降」，实为**判据盲**。
  // 设备查证（`tmp/j6-probe.mjs` + `tmp/j6-which-file.mjs`）揭示两个独立原因：
  //   ① 文件世代读错：`hiddenSeqs` 来自 `/rp/rollback-mask`（按官方
  //      `pickCurrentSessionFilename` 读**当前世代**，实测是 `session.v3.jsonl`），
  //      而判据**自己重拼了 `session.jsonl`**（v0 冻结世代，seq 空间不同）⇒ P-18 违例；
  //   ② **时点错了**：live 分支回退会把被移出的消息**就地替换成 23 字符的
  //      snapshot 占位行**（`[{变体切换}] 该楼层的上一版本已从上下文移除。`，
  //      `source.form==='snapshot'` ⇒ 被导出排除）⇒ 回退**之后**再扫，那些 seq
  //      早已「不在导出中」⇒ 交集恒 0。
  // ⇒ 修法：① 与产品读侧**同规则**取当前世代文件名；② **回退前**取快照。
  const pickLogName = (entries) => {
    let best = null, bestV = -1
    for (const n of entries) {
      const m = /^session\.v(\d+)\.jsonl$/.exec(String(n).trim())
      if (m === null) continue
      const v = Number(m[1])
      if (v > bestV) { bestV = v; best = String(n).trim() }
    }
    return best ?? 'session.jsonl'
  }
  const scanExportChars = () => {
    if (dir === '') return null
    const listing = runAs('ls', '-1', `${absPath(dir)}`)
    if (String(listing).startsWith('__ADBERR__')) return null
    const logName = pickLogName(String(listing).split('\n'))
    const txt = runAs('cat', `${absPath(dir)}/${logName}`)
    if (String(txt).startsWith('__ADBERR__')) return null
    const chars = new Map()
    for (const line of String(txt).split('\n')) {
      const t = line.trim()
      if (t === '' || (!t.includes('"type":"user/message"') && !t.includes('"type":"assistant/message"'))) continue
      let ev; try { ev = JSON.parse(t) } catch { continue }
      if (ev.type !== 'user/message' && ev.type !== 'assistant/message') continue
      if (typeof ev.seq !== 'number') continue
      const msg = ev.type === 'user/message' ? ev.data : ev.data?.message
      if (!msg || typeof msg !== 'object') continue
      if (msg.source?.form === 'snapshot') continue // 快照占位（含回退占位）不进导出
      const c = msg.content
      const text = Array.isArray(c)
        ? c.filter(b => b && b.type === 'text').map(b => String(b.text ?? '')).join('\n')
        : (typeof c === 'string' ? c : '')
      const isTh = msg.source?.thSystem === true || msg.source?.model === 'th-system'
      if (!text && !isTh) continue
      chars.set(ev.seq, text.length)
    }
    chars.set('__logName__', logName)
    return chars
  }
  const exportBefore = scanExportChars()
  const exportLogName = exportBefore === null ? '?' : String(exportBefore.get('__logName__') ?? '?')
  // 【J8 口径修正 · 第三十六次坑】回退**前**的产品同源用户消息文本集（差集被减数）。
  const exportItems0 = await evalJson(`window.__efj.items(${JSON.stringify(sid)}).then(s => JSON.stringify(s))`)
  rec(sid, 'J4 回退前基线', 'PASS',
    `楼层 total=${s.floors}（已渲染 ${s.rendered} + 窗口化占位 ${s.windowed}）· user=${s.user} asst=${s.asst} · 掩码 hiddenSeqs=${Array.isArray(m0.hiddenSeqs) ? m0.hiddenSeqs.length : 'n/a'} 项 · 占用=${meterBase.meter}（${meterBase.raw}，计量就绪=${meterReady}）`
      + ` · 导出快照=${exportBefore === null ? '未取得' : `${exportBefore.size - 1} 条（读 ${exportLogName}）`}`)

  if (!YES) {
    rec(sid, 'J5~J9 真回退/重发', 'SKIP', 'dry-run（未传 --yes）——不执行写操作',
      { kind: 'dry-run', facts: '未传 --yes' })
    // 还原已在 J0 处登记（P-1）
    continue
  }

  // ---------- J5 真回退（UI 点击，与用户操作同路径） ----------
  // 【第三十三次】点击前先等 UI 静止（防点到正被重渲染替换的旧节点 / 确认框挂不出来）
  //
  // 【判据自身的坑（P-29 家族）· 第五十二次 · 本轮设备实测抓到（5 条 FAIL 里的 4 条）】
  //
  // ## 症状
  // 全量 `--auto --yes` 轮报 **5 FAIL**，其中 4 条的**证据串与结论矛盾**：
  //   · `st-1q84arh` J5 报 `点击=no-btn`，同一行却写「掩码 +6 项（28→34）且 楼层 21→19（↓）」
  //     —— **回退确凿生效**，却被判 FAIL；
  //   · `st-n0gnfp` J5/J6 报 `点击=no-btn` / 占用未降，而该卡 J1 明写 `user=0`。
  //
  // ## 真因（取证探针 `tmp/diag-m7-fails.mjs` 逐卡读 DOM 确认，不是猜）
  //   ① `st-n0gnfp`：`userRow=0` ⇒ 该卡**没有任何用户楼层** ⇒ 回退按钮**本就不存在**
  //      ⇒ `no-btn` 是**事实**（P-17），不是缺陷 ⇒ J5/J6 应 **SKIP**（P-20：无判据力前提）。
  //   ② `st-1q84arh`/`st-vr2jg2`：取证显示按钮**存在**（`rollbackBtns=12/26`，文案
  //      「↩ 回退到此处」，含「回退」）⇒ 说明点击失败不是「选择器错」而是**时序**：
  //      切卡后**首次**取按钮时该楼层尚未渲染完（同一探针等 25×900ms 后就能读到），
  //      而后续 3.5s 的快照读数已显示回退生效。
  //      ⇒ 单次瞬时取按钮 = **采样未等就绪**（违反 R16）。
  //
  // ## 修法（P-24：判据落在结果；R16：轮询到就绪）
  //   ① 取按钮改**短轮询**（最多 ~10s），等到「有按钮」再点（无按钮则如实记，并区分原因）；
  //   ② 无按钮时的定性：该卡**用户楼层数为 0** ⇒ SKIP（事实：无可回退内容）；
  //      有用户楼层却仍无按钮 ⇒ FAIL（真缺陷：按钮该在却不在）；
  //   ③ J5 生效判据保持只看**结果**（`floorsDropped || maskGrew`，见第四十六次注记）。
  // 【判据自身的坑（P-19/P-20/R16）· 第三十八次】轮询找按钮**仍然不够**：
  // `st-clk9pd` 修好后 J5 报 `no-btn`，而**同一张卡的 J13「再回退」却 `clicked` 成功**——
  // 同一次运行里自相矛盾即是红色信号（与第三十五次同族）。
  // 设备取证（`tmp/w32-j5-nobtn.mjs`，切卡后每 1s 采样 40 次）：
  //   t=1..4s  head=0 win=0 **rollback=0**      ← 窗口化占位期，楼层还没物化
  //   t=5s     head=3 win=42 **rollback=1**     ← 按钮出现
  //   t=40s    head=40 win=5  rollback=1        ← 空闲渐进物化收敛
  // ⇒ 真因：**回退按钮所在的那一楼还在 `data-windowed` 占位里**（J1 快照写着
  //   「已渲染 1 + 窗口化占位 44」），而占位 div **不含**任何楼层内容（见 RpNativeChat.tsx:1583
  //   —— 占位只有 height，`windowed` 时不渲染 floor-head/按钮）。
  //   「被动等」要等**空闲渐进物化**从下往上扩到那一楼，可能超过 10s 轮询上限。
  // ⇒ 修法：轮询里**主动把滚动容器滚到底部**（让最近的楼层立即物化），再找按钮；
  //   这是「让判据自己去创造它要观测的事实」（P-20），而不是加长等待。
  //   ★ 记 SKIP 的前置条件因此收紧：必须**主动物化过之后**仍无按钮，才算「真的没有」。
  //
  // 【P-38 三段式同类横向排查（W34）】本形态（**要找的元素还在窗口化占位里**）
  // **不是 J5 独有** —— 凡「取楼层内的元素」处都同病。按 P-38 的三段：
  //   ① **按语义不变量枚举手法**（不是按已知 API）：不变量 = 「判据要操作的元素
  //      由楼层渲染产出，而楼层可能处于 `data-windowed` 占位态」；
  //   ② **全仓穷举拿候选**：`grep 'scrollIntoView|querySelector.*btn'` ⇒ J5 / J13 / J14 三处
  //      （J7 的发送按钮在**编辑器**里、不在楼层内 ⇒ 不受此影响，已逐条分诊）；
  //   ③ **逐条分诊「谁该负责」**：三处同因同修 ⇒ **抽成本函数（P-1 单源）**，
  //      而不是各修各的（各修各的正是 §6.32 抓到的 `ev()` 双拷贝坑）。
  /**
   * 按选择器取元素并点击；**找不到时主动把滚动容器滚到底**促使计数最末的楼层物化（P-20）。
   * 语义与官方无关，纯装置侧：这是「让判据创造它要观测的事实」，不是加长等待。
   *
   * @param sel      CSS 选择器（可含 `:scope` 等标准语法）
   * @param filter  可选：文本过滤（如 `/回退/`）；用**函数体字符串**传入（本函数在页面里 eval）
   * @param picks    可选：'first' | 'last'（默认 'last' —— 楼层类按钮取最末一个）
   * @returns 'clicked' | 'no-btn'（'no-btn' 只代表「本轮主动物化后仍取不到」，不代表不存在）
   */
  const clickBySelector = async (sel, filterBody = 'true', picks = 'last', tries = 20) => {
    for (let i = 0; i < tries; i += 1) {
      const r = await evalJs(`(() => {
        const all = [...document.querySelectorAll(${JSON.stringify(sel)})].filter(b => (${filterBody}))
        const b = all[${JSON.stringify(picks)} === 'first' ? 0 : all.length - 1]
        if (b) { b.scrollIntoView({ block: 'center' }); b.click(); return 'clicked' }
        // 找不到 ⇒ 可能目标所在楼层还在窗口化占位里：把可滚动容器滚到底，促使最近楼层物化
        const sc = [...document.querySelectorAll('*')].find(e => {
          const cs = getComputedStyle(e)
          return /auto|scroll/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 40
        })
        if (sc) sc.scrollTop = sc.scrollHeight
        window.scrollTo(0, document.body.scrollHeight)
        return 'no-btn'
      })()`)
      if (r === 'clicked') return r
      await sleep(500)
    }
    return 'no-btn'
  }
  const clickRollback = () => clickBySelector('.dsht-rp-rollback-btn', `/回退/.test(b.textContent)`, 'last')
  const clicked = await clickRollback()
  await sleep(1200)
  // 同 J13：确认对话框**若有**则点它（产品当前实现无确认框，见 J13 处的判据修订）。
  const confirmed = await (async () => {
    for (let i = 0; i < 30; i += 1) {
      const r = await evalJs(`(() => {
        const bs = [...document.querySelectorAll('button')].filter(b => (b.textContent || '').trim() === '回退')
        if (!bs.length) return 'no-confirm'
        bs[bs.length - 1].click(); return 'confirmed'
      })()`)
      if (r === 'confirmed') return r
      await sleep(500)
    }
    return 'no-confirm'
  })()
  await sleep(3500)
  s = await evalJson(`JSON.stringify(window.__efj.snap())`)
  if (s.__err) s = snapS
  const maskR1 = await evalJson(`window.__efj.mask(${JSON.stringify(sid)}).then(m => JSON.stringify(m))`)
  const m1 = maskR1.__err ? {} : maskR1
  // 【J8 口径修正 · 第三十六次坑】回退**后**的产品同源用户消息文本集（差集减数）。
  const exportItems1 = await evalJson(`window.__efj.items(${JSON.stringify(sid)}).then(s => JSON.stringify(s))`)
  const hidden1 = Array.isArray(m1.hiddenSeqs) ? m1.hiddenSeqs : []
  const hidden0 = Array.isArray(m0.hiddenSeqs) ? m0.hiddenSeqs : []
  // 【判据自身的坑（P-11）· 第十二次】上一版判据是「**hiddenSeqs 必须增加**」。
  // 这在 **live 分支**（逻辑回退 = compaction+replace）下是错的：live 回退会
  // **重写 session.jsonl**，把被移出的消息**物理删掉**并写一条新 marker，
  // 于是历史 marker 连同它记录的旧 seq 一起消失 ⇒ `hiddenSeqs` 可能**不增反减**
  // （实测 session-fdfc1a28：101 → 0，而回退确实执行了）。
  // 真正与用户观感一致的判据是「**上下文中可见的楼层变少**」：
  //   · live 分支：楼层 head 减少（消息被物理移出）
  //   · 非 live 分支：hiddenSeqs 增加（掩码把消息藏起来）
  // 两者**任一**成立即证明回退生效；两者都无变化 ⇒ 该卡无可回退内容（SKIP，出声）。
  const sBefore = snapS
  const floorsDropped = s.floors < sBefore.floors
  const maskGrew = hidden1.length > hidden0.length
  // 【判据自身的坑（P-24 违例）· 第四十六次 · 本轮设备实测抓到】
  //
  // ## 症状
  // J5 证据里明明写着「掩码 +89 项（113→202）且 楼层 1→0（↓）」——**回退确凿生效**，
  // 却判 **FAIL**。同形态在 J13 上更普遍（4/5 卡 FAIL，证据同样是「集合 16→16 未增」）。
  //
  // ## 真因（读产品源码确认）
  // 判据把 `confirmed === 'confirmed'` 当作生效的**必要条件**，而它找的是
  // 「文案恰好为**『回退』**的按钮」——那是**确认对话框**的形态。
  // 但产品当前实现**没有确认框**：
  //   `RpNativeChat.tsx` 的 user 气泡按钮
  //     `onClick={() => { void rollback() }}`   ← 直接执行
  // 其文案是「↩ 回退到此处」（含『回退』但**不相等**）。
  // ⇒ `confirmed` 恒为 `'no-confirm'` ⇒ 判据**恒 FAIL**，把已生效的回退报成坏。
  // 这正是 **P-24**（判据落在「机制」而非「结果」）——「有没有确认框」是实现细节，
  // 用户可观测的**结果**是「掩码增加 / 楼层减少」。
  //
  // ## 修法
  // 把 `confirmed` 降级为**可选**：生效判据只看**结果**（`floorsDropped || maskGrew`）。
  // 保留确认框探测（若将来产品加回确认框，仍会点它，不影响正确性），
  // 并在证据里如实标注是否出现过确认框（可追溯，不静默）。
  const confirmedNote = confirmed === 'confirmed' ? '' : '（无确认框：产品直接执行——本条判据只看生效结果）'
  const j5ok = clicked === 'clicked' && (floorsDropped || maskGrew)
  const j5noChange = clicked === 'clicked' && !floorsDropped && !maskGrew
  // 【第五十二次修法 · 无按钮时的定性】`no-btn` 有两种成因，结论**相反**（P-17）：
  //   · 该卡**没有用户楼层** ⇒ 按钮本就不该存在 ⇒ **事实**，SKIP（P-20 判据力前提不成立）
  //   · 有用户楼层却找不到按钮 ⇒ **真缺陷**（按钮该在却不在）⇒ FAIL
  const noBtnFact = clicked === 'no-btn' && s.user === 0
  // 注：`s.user` 是回退**前**快照里的用户楼层数（J4 已记录，见上方）。
  const j5status = j5ok ? 'PASS'
    : (j5noChange || noBtnFact) ? 'SKIP'
      : 'FAIL'
  rec(sid, 'J5 真回退生效',
    j5status,
    j5noChange
      ? `回退已点击但无任何变化（楼层 ${sBefore.floors}→${s.floors} · hiddenSeqs ${hidden0.length}→${hidden1.length}）——该卡只剩 ${sBefore.floors} 楼，无可回退内容，本条测不出`
      : noBtnFact
        ? `该卡**无用户楼层**（user=0）⇒ 回退按钮本就不存在（快照已稳定、且探针已轮询 10s）——**事实而非缺陷**，本条无判据力`
        : `点击=${clicked} · 生效证据：${maskGrew ? `掩码 +${hidden1.length - hidden0.length} 项（${hidden0.length}→${hidden1.length}）` : ''}${maskGrew && floorsDropped ? ' 且 ' : ''}${floorsDropped ? `楼层 ${sBefore.floors}→${s.floors}（↓）` : ''}${confirmedNote}`
          + `　[参考] 回退前后楼层读数 ${sBefore.floors}→${s.floors}${
            // 楼层数**上涨**是可能的（本轮旅程反复回退/重发，且 live 分支会重写文件后重新渲染）——
            // 这里只作参考，判据以「掩码增加」或「楼层减少」为准（见上方第十二次注记）。
            s.floors > sBefore.floors ? '（上涨：live 分支重写文件后重渲染 / 上一轮旅程残留，属正常）' : ''}`,
    // 【P-46 推论一 · 结构化依据】两种 SKIP 成因不同类：
    //   · `noBtnFact`（user=0 ⇒ 按钮本就不存在）= **事实**，无对象可判 ⇒ no-lev
    //   · `j5noChange`（点了但无变化）= 测不出 ⇒ no-change
    j5status === 'SKIP'
      ? (noBtnFact
        ? { kind: 'no-lev', facts: `该卡 user=${s.user}（无用户楼层）· 探针已轮询 10s 仍无回退按钮` }
        : { kind: 'no-change', facts: `点击=clicked 但楼层 ${sBefore.floors}→${s.floors} 且掩码 ${hidden0.length}→${hidden1.length} 均未变` })
      : undefined)
  // J6：占用必须**下降**（这是 C3「回退在计量上可见」的唯一可机验证据）。
  //
  // 【判据自身的坑（P-11）· 第二十三次】掩码/占用的刷新是**异步**的，且
  // `chat/messages` 在会话文件被改写后要**全量重扫**（facade 的 mtime 缓存失效）。
  // 设备实测：1.7MB 大会话（st-y1noek）在 `sleep(3500)` 后仍未刷新完 ⇒ 读到「未降」，
  // 而**同一张卡在更早一轮（文件更小）时是降的**，说明这是**时序**而非功能缺陷。
  // ⇒ 修法（P-19：禁止固定 sleep 充当就绪）：**轮询等占用刷新**（上限 25s），
  //    「等到了下降」即 PASS；直到超时才按判据力前提决定 FAIL / SKIP。
  //
  // 【判据分辨率】百分比在饱和时（≈1.5M / 1M ⇒ 恒 100%）**无分辨率**，
  // 故同时解析**绝对 token 数**：只要绝对数下降即认定「回退在计量上可见」。
  // 只有基线计量**确实就绪**时才有判据力；基线测不出 ⇒ 记 SKIP 并出声（P-17/R8），
  // 不得记 PASS（无判据力）也不得记 FAIL（那是在指控一个没测到的事实）。
  let meterAft = await readMeter()
  const readExact = (m) => (Number.isFinite(m.exact) ? m.exact : parseTokens(m.tokenRaw))
  const exBefore0 = readExact(meterBase)
  const charsBefore = Number.isFinite(meterBase.dataChars) ? meterBase.dataChars : null
  for (let i = 0; i < 25; i += 1) {
    const now = readExact(meterAft)
    if (Number.isFinite(exBefore0) && Number.isFinite(now) && now < exBefore0) break
    if (charsBefore !== null && Number.isFinite(meterAft.dataChars) && meterAft.dataChars < charsBefore) break
    if (Number.isFinite(meterAft.pct) && Number.isFinite(meterBase.pct) && meterAft.pct < meterBase.pct) break
    await sleep(1000)
    meterAft = await readMeter()
  }
  const pctAfter = meterAft.pct
  const exBefore = exBefore0
  const exAfter = readExact(meterAft)
  const charsAfter = Number.isFinite(meterAft.dataChars) ? meterAft.dataChars : null
  const byAbs = Number.isFinite(exBefore) && Number.isFinite(exAfter) && exAfter < exBefore
  const byPct = Number.isFinite(pctAfter) && pctAfter < pctBefore
  // 【最高分辨率判据】产品自身的 `data-chars`（= sumMessageChars 扣掩码后的整数原值）：
  // 它比 `data-tokens`（= round(chars/2.5)）多一位有效信息，能看见「不足 1 token」的变化。
  const byChars = charsBefore !== null && charsAfter !== null && charsAfter < charsBefore
  //
  // 【判据自身的坑（P-11）· 第二十二次】占用**不变**也可能是**正确行为**：
  // 被移出的 seq 里，只有「确实出现在聊天导出中」的那些才影响占用；而导出只含
  // `user/message` / `assistant/message` 且**排除快照注入、空文本、TH 隐藏楼层**。
  // ⇒ 判据力前提：先算「本轮**新**移出的 seq」（hidden1 − hidden0），与**回退前**
  //   的导出快照取交；交集为空 ⇒ 占用本就不该变 ⇒ SKIP 并说明（不是缺陷）。
  //
  // 【判据自身的坑（P-11/P-19）· 第二十五次】「占用没降」还必须排除**判据分辨率不足**：
  // 计量口径是 `round(chars / 2.5)`，若被移出的文本只有几个字符，四舍五入后
  // **本就不足 1 token** ⇒ 占用读数不动是**数学必然**，不是缺陷。
  // （现已叠加 `byChars` 高分辨率判据：只要字符量下降就算「计量可见」，此坑从根上消除。）
  //
  // 【判据自身的坑（P-11/P-18）· 第二十七次】快照必须在**回退之前**取：
  // live 分支把被移出的消息**就地替换成 23 字符的 snapshot 占位行**（被导出排除）
  // ⇒ 回退后再扫，那些 seq 早已「不在导出中」⇒ 交集恒 0（假 SKIP）。
  // 且文件名必须与产品读侧**同规则**（`session.v*.jsonl` 取最高版本）⇒ 见上方 `pickLogName`。
  const newlyHidden = hidden1.filter(q => !hidden0.includes(q))
  const affected = exportBefore === null ? null : newlyHidden.filter(q => exportBefore.has(q))
  const affectedChars = affected === null ? null
    : affected.reduce((n, q) => n + (Number(exportBefore.get(q)) || 0), 0)
  const hasLeverage = affected !== null && affected.length > 0
  const j6ok = meterReady && (byAbs || byChars || byPct)
  // 【第五十二次修法 · J6 的判据力前提】若 J5 判定为「该卡无用户楼层 ⇒ 按钮本就不存在」
  // （`noBtnFact`），则**没有发生回退**，占用本就不该降 ⇒ J6 必须 SKIP。
  // 否则会出现自相矛盾的报告：J5 说「按钮不存在（事实）」，J6 却把「占用未降」判成 FAIL
  // —— 这正是本轮 `st-n0gnfp` 的两条 FAIL（且它的 `hasLeverage=true` 是被
  //   **前序轮次旅程残留的掩码变化**喂出来的，不是本轮回退的贡献）。
  const j6NoRollback = noBtnFact || j5noChange
  // 【P-1 单源 · W36 续】status 与 basis 必须**同序判定** —— 二者若各写一遍条件，
  // 优先级一旦不同就会出现「status=SKIP 但 basis 缺失」的自相矛盾（首次真跑即被抓到，
  // 见 §6.38⑥：J6 的 `j6NoRollback` 优先于 `j6ok`，而 basis 首版把 `j6ok` 放在前面）。
  // ⇒ 先算出**唯一的** status，再据它派生 basis。
  const j6status = !meterReady ? 'SKIP' : (j6NoRollback ? 'SKIP' : (j6ok ? 'PASS' : (hasLeverage ? 'FAIL' : 'SKIP')))
  rec(sid, 'J6 占用下降（C3）',
    j6status,
    !meterReady
      ? `基线计量未就绪（读数为 ${meterBase.raw}）——测不出回退是否在计量上可见，不冒充已覆盖`
      : j6NoRollback
        ? `**本轮未发生回退**（${noBtnFact ? '该卡无用户楼层 ⇒ 回退按钮本就不存在' : '点击后无任何变化'}）⇒ 占用本就不该降，本条无判据力`
        : `占用 ${meterBase.tokenRaw ?? pctBefore + '%'} → ${meterAft.tokenRaw ?? pctAfter + '%'}（精确 token ${exBefore}→${exAfter} ${byAbs ? '↓' : '未降'} · 字符量 ${charsBefore ?? 'n/a'}→${charsAfter ?? 'n/a'} ${byChars ? '↓' : '未降'} · 百分比 ${pctBefore}%→${pctAfter}% ${byPct ? '↓' : '未降'}）`
          + `【回退前导出快照：${exportBefore === null ? '未取得' : `${exportBefore.size - 1} 条（读 ${exportLogName}）`}`
          + `；本轮新移出 ${newlyHidden.length} 项，其中在快照中的 ${affected === null ? '未知' : affected.length} 项`
          + `${affectedChars === null ? '' : `，共 ${affectedChars} 字符 ≈ ${Math.round(affectedChars / 2.5)} token`}】`
        + (!j6ok && affected !== null && affected.length === 0
          ? '　⇒ 新移出项均不在回退前导出中（多为 step/空文本/隐藏楼层/占位替换）⇒ 占用**本就不该变**，非缺陷'
          : ''),
    // 【P-46 推论一 · 结构化依据】四种 SKIP 成因分三类：
    //   · 计量未就绪 ⇒ probe-err；本轮未发生回退 ⇒ no-lev（无按钮）/ no-change（点了没变）；
    //   · 本刀不影响导出 ⇒ no-lev（没有可观测的对象）。
    // ★ 顺序与 `j6status` **逐支对应**（P-1：不许各写一遍条件）。
    j6status !== 'SKIP' ? undefined
      : !meterReady
        ? { kind: 'probe-err', facts: `基线计量未就绪（读数 ${meterBase.raw}）` }
        : j6NoRollback
          ? (noBtnFact
            ? { kind: 'no-lev', facts: `该卡 user=${s.user} ⇒ 回退按钮本就不存在，本轮未发生回退` }
            : { kind: 'no-change', facts: '回退已点击但无任何变化 ⇒ 本轮未发生回退' })
          : { kind: 'no-lev', facts: `本轮新移出 ${newlyHidden.length} 项，其中在导出快照中的 ${affected === null ? '未知' : affected.length} 项 ⇒ 本刀不影响导出` })

  // ---------- J7 真重发（走 mock LLM） ----------
  await evalJs(`(() => {
    const ed = document.querySelector('[contenteditable="true"]')
    if (ed) { ed.focus(); const sel = window.getSelection(); sel.removeAllRanges(); const rg = document.createRange(); rg.selectNodeContents(ed); sel.addRange(rg) }
    return 'sel'
  })()`)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 46, key: 'Delete' })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 46, key: 'Delete' })
  await sleep(300)
  // 【判据自身的坑（P-11）· 第十六次】重发文本必须**每卡唯一且与历史楼层不同**。
  // 上一版写死「（E-F 旅程）重发，旧楼层不得复活。」——它既会**混进用户真实会话**
  // （已被 J12 还原兜住），又会在**同一张卡连续跑两轮**时与上一轮遗留的同名楼层撞车：
  // J8 用「文本」当楼层身份 ⇒ 把「本轮新消息」误判成「旧楼层复活」（实测 st-y1noek
  // 报 `重发后复活 1 条: ["（E-F 旅程）重发，旧楼层不得复活。"]`——那其实是**本轮自己发的**）。
  // ⇒ 修法：带**唯一时间戳**，使「新消息」在文本上不可能等于任何历史楼层。
  const stamp = `（E-F 旅程 ${Date.now().toString(36)}）重发，旧楼层不得复活。`
  await send('Input.insertText', { text: stamp })
  await sleep(400)
  // 发送按钮几何。
  //
  // 【判据自身的坑（P-11）· 第十三次】上一版只找 `aria-label="Send message"`，
  // 而本 App 宿主 composer 的真实按钮是 **`aria-label="Queue message"`**
  // （class `uV2eYG_primary`）——设备实测该选择器返回 null ⇒ 发送从未点出
  // ⇒ J7 恒 FAIL，且看起来像「后端拒了/模型没回」，指向完全错误的方向。
  // ⇒ 修法：按**降级序**找候选（Send message → Queue message → 主按钮 class），
  // 并记录实际用了哪个选择器（可追溯，不猜）。
  // 【判据自身的坑（P-11/P-19）· 第二十六次】`Input.dispatchMouseEvent` 只认**坐标**，
  // 不认元素 —— 坐标上压着谁，就点谁。设备实测（st-4sut7v / st-y1noek）：
  // **卡脚本自建的模态对话框**（`div.kmc-root > div.kmc-modal > div.kmc-footer > button.kmc-btn`，
  // 按钮文案「下一步」）正好盖住宿主 composer 的发送按钮坐标 ⇒ 脚本点的是**卡的按钮**，
  // 宿主发送从未被触发 ⇒ composer 仍留有本轮 stamp ⇒ 上一版据此判 FAIL。
  // 而按 goal §五 边界 B2/B3（卡作者侧 UI 重叠、卡自身逻辑：只标记不修），
  // 这**不是宿主适配缺陷** ⇒ 判 FAIL 等于「用卡的设计缺陷指控产品」。
  // ⇒ 修法：点击前做 **命中校验**（`document.elementFromPoint`），
  //    · 命中发送按钮自身/其后代 ⇒ 真点（有判据力）
  //    · 被其他元素遮挡 ⇒ **不点**（避免误触卡的功能），记 SKIP 并**报出遮挡元素**（可追溯）
  const hit = await evalJson(`(() => {
    const cands = ['button[aria-label="Send message"]', 'button[aria-label="Queue message"]', 'button.uV2eYG_primary']
    let used = null, btn = null
    for (const c of cands) { const b = document.querySelector(c); if (b && b.offsetParent !== null && !b.disabled) { btn = b; used = c; break } }
    if (!btn) return JSON.stringify({ ok: false, tried: cands })
    const r = btn.getBoundingClientRect()
    const x = r.x + r.width / 2, y = r.y + r.height / 2
    const top = document.elementFromPoint(x, y)
    const selfHit = top === btn || (top !== null && btn.contains(top))
    const desc = (el) => el === null ? 'null' : (el.tagName + (el.getAttribute('aria-label') ? '[' + el.getAttribute('aria-label') + ']' : '') + (el.className ? '.' + String(el.className).split(' ').slice(0, 2).join('.') : ''))
    return JSON.stringify({ ok: r.width > 0 && r.height > 0, used, x, y, w: r.width, h: r.height, selfHit, blockedBy: selfHit ? null : desc(top) })
  })()`)
  const geo = hit
  let sent = false
  let blocked = ''
  if (!geo.__err && geo.ok && geo.selfHit === true) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: geo.x, y: geo.y, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: geo.x, y: geo.y, button: 'left', clickCount: 1 })
    sent = true
  } else if (!geo.__err && geo.ok && geo.selfHit === false) {
    // 被卡脚本浮层遮挡。**不放弃覆盖**（fidelity）：改用**合成点击**送达宿主按钮，
    // 验证「宿主是否接住发送」这条逻辑；但**如实标注**判据力降级——
    // 合成点击不验证「真实用户这一刻能否点到」（那是卡作者侧 UI 重叠的锅，边界 B2/B3）。
    blocked = String(geo.blockedBy ?? '未知元素')
    const synth = await evalJs(`(() => {
      const b = document.querySelector('button[aria-label="Send message"]') || document.querySelector('button[aria-label="Queue message"]') || document.querySelector('button.uV2eYG_primary')
      if (!b) return 'no-btn'
      b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      b.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      b.click()
      return 'synthetic-clicked'
    })()`)
    if (synth === 'synthetic-clicked') sent = 'synthetic'
  }
  // 【判据自身的坑（P-11）· 第二十四次】`sleep(20000)` 是**固定等待充当就绪**，
  // 在大会话上不够：实测 st-y1noek（1.7MB、已反复回退）在 20s 内 mock 还没回包
  // ⇒ 楼层 17→17 判 FAIL，而**同一张卡在更早几轮是 PASS 的**（那时文件更小）。
  // 这属于判据的时序缺陷，不是产品缺陷（P-19：禁止固定 sleep 充当就绪）。
  // ⇒ 修法：**轮询等楼层变化**（上限 40s）；超时后再按「有无错误面板 / 注入是否成功」定性。
  // 同时记录「注入后 composer 里是否真的留下了文本」——用于区分
  // 「没注入进去（判据自身问题）」与「注入成功但后端没回（真问题）」。
  const composerText = await evalJs(`(() => { const ed = document.querySelector('[contenteditable="true"]'); return ed ? (ed.textContent || '').slice(0, 40) : null })()`)
  // 【判据自身的坑（P-19）· 第四十八次 · 本轮设备实测抓到（st-vr2jg2）】
  //
  // ## 症状
  // 该卡 J7 报 `已点发送=true · 楼层 13→13 · 注入留痕=已清空（发送已被接住）· 无错误面板`
  // ⇒ FAIL。看起来像「后端没回」，但同批另 4 张全 PASS。
  //
  // ## 真因（读会话文件确认）
  // 该会话跑的是**真实 provider**（`provider: deepseek`，文件里最后一步
  // `usage.outputTokens=16000` + `finish reason:max-tokens`）——**生成极长、远超 mock 卡**。
  // 40 秒轮询窗口对它不够（mock 卡 1~3 秒就回包）。
  // ⇒ 这是**时序判据缺陷**（P-19/P-20 同族：固定上限充当就绪），不是产品缺陷。
  //
  // ## 修法
  //  ① 轮询窗口 40s → **90s**，并且**每轮都记录「是否仍在生成」**（host 在生成中
  //     会把发送按钮置 disabled / 出现停止入口 —— 这是可观测的**结果**，P-24）；
  //  ② 超时仍未增楼层时：
  //     · 若**仍在生成** ⇒ SKIP（生成没结束，判据力前提不成立）；
  //     · 若「发送已被接住」且无错误面板、且**从未观察到生成态** ⇒ 也记 SKIP 并说明
  //       「真实 provider 的长生成未在窗口内落盘」——**不记 FAIL**
  //       （把「长得慢」当成「坏了」= 用环境限制指控产品；P-17 测不出来 ≠ 事实否定）。
  const probeRunning = async () => {
    const r = await evalJs(`(() => {
      const btns = [...document.querySelectorAll('button')]
      const send = btns.find(b => /Send message|Queue message/.test(b.getAttribute('aria-label') || ''))
      const stop = btns.find(b => /stop|停止/i.test(b.getAttribute('aria-label') || '') || /停止/.test(b.textContent || ''))
      return JSON.stringify({ sendDisabled: send ? !!send.disabled : null, stopBtn: !!stop })
    })()`)
    return r.__err ? { sendDisabled: null, stopBtn: false } : r
  }
  let s2raw = null
  let sawRunning = false
  for (let i = 0; i < 90; i += 1) {
    await sleep(1000)
    s2raw = await evalJson(`JSON.stringify(window.__efj.snap())`)
    if (!s2raw.__err && s2raw.floors > s.floors) break
    const pr = await probeRunning()
    if (pr.sendDisabled === true || pr.stopBtn === true) sawRunning = true
  }
  if (s2raw === null || s2raw.__err) s2raw = await evalJson(`JSON.stringify(window.__efj.snap())`)
  const s2 = s2raw.__err ? s : s2raw
  const stillRunning = await probeRunning()
  const maskR2 = await evalJson(`window.__efj.mask(${JSON.stringify(sid)}).then(m => JSON.stringify(m))`)
  const m2 = maskR2.__err ? {} : maskR2
  // 【J8 口径修正 · 第三十六次坑】重发**后**的产品同源用户消息文本集（判「复活」的域）。
  const exportItems2 = await evalJson(`window.__efj.items(${JSON.stringify(sid)}).then(s => JSON.stringify(s))`)
  const hidden2 = Array.isArray(m2.hiddenSeqs) ? m2.hiddenSeqs : []
  // J7 判据：楼层**增加**（mock LLM 回包）为 PASS；楼层未增但**出现本轮运行错误面板**
  // 则为 FAIL 并**带上错误文案**（区分「后端真拒」与「没点出去/超时」——不能混为一谈）。
  //
  // 【判据自身的坑（P-11）· 第十九次】但「有错误面板」不等于「产品坏了」：
  // 实测 st-asm3yf 报 `UNSUPPORTED_REASONING_EFFORT`（该卡绑定的模型在这台测试机上
  // 不可用 / 不支持其 `reasoning effort` 配置）——这是**环境与用户配置限制**，
  // 不是宿主适配缺陷。把它记成 FAIL 等于「用测试机的模型配置指控产品」。
  // ⇒ 修法：**配置/凭据类**错误码 ⇒ SKIP 并注明（属测试环境限制）；其余错误仍 FAIL。
  //   ⚠️ 同时注意：这一条 FAIL 的**原文**恰好成了 F1 归一化的**真机正控实证**——
  //   面板主文案已是人话、原始英文（含内部 provider 串）被关进「技术详情」折叠区。
  const cfgCodes = /UNSUPPORTED_REASONING_EFFORT|UNSUPPORTED_MODEL|INVALID_MODEL|INVALID_CREDENTIAL|QUOTA|RATE_LIMITED/

  // 【J7 口径补强 · 第四十八次续】两点修正（**都是判据自身的缺陷**）：
  //
  // ① **基线必须取「回退后」而不是「回退前」**（本轮实测抓到）：
  //    原用 `itemsCount0`（回退**前**）作被减数，而 J7 之前 J5 已经**回退移出了若干消息**
  //    ⇒ 净变化 = −(回退移出) + (重发新增) ⇒ 完全可能**为负**
  //    （实测 st-vr2jg2：`14 → 13`，其实是「回退移出 2 + 重发新增 1」，
  //      **重发确实落地了**，却被判成「没增」⇒ 假 FAIL）。
  //    ⇒ 正确基线是 `itemsCount1`（回退后），这也是 `s.floors` 的同一个时点。
  // ② **口径换产品同源 RPC**（P-18）：`snap().floors` 是 DOM 口径（已渲染 + 占位），
  //    真实 provider 长生成期间可能「后端已落盘、UI 还在流式」⇒ DOM 未增 ≠ 没发成功。
  //
  // 【J7 判据力修正 · 第五十次 · 2026-09-15 W4 收口轮设备实测抓到（P-29 家族）】
  //
  // ## 症状
  // 同一构建、同一张卡（st-vr2jg2）、同一份代码，**两轮结论相反**：
  //   · 全量 `--auto` 轮 ⇒ J7 **FAIL**（`产品同源消息数 回退后 13 → 重发后 13`）
  //   · 单卡 `--cards st-vr2jg2` 轮 ⇒ J7 **PASS**（`回退后 0 → 重发后 13`）
  // FAIL 轮的证据串**内部矛盾**：`注入留痕=已清空（发送已被接住）` + `无错误面板`
  //   —— 发送明明被宿主接住了，却被判成「没发出去」。
  //
  // ## 真因（读两轮日志对照确认）
  // `itemsCount1`（回退**后**导出条数）**不是常量，而是随前序 J5 是否生效而漂移**：
  //   · 单卡轮 J5 生效（掩码 20→0，消息被真正移出）⇒ itemsCount1 = **0** ⇒ `13 > 0` ⇒ PASS
  //   · 全量轮 J5 未生效（掩码 20→20，该卡前台状态不同 ⇒ 无可回退内容）⇒ itemsCount1 = **13**
  //     ⇒ `13 > 13` 不成立 ⇒ FAIL
  // 即：**同一个「重发成功」（都得到 13 条）在两种前序状态下被判成不同结论**。
  // 这与此前「第四十八次续」修的是**同一族**缺陷（那次只把基线从「回退前」挪到「回退后」，
  // 治了「净变化为负」，但没治「基线本身随前序漂移」）。
  //
  // ## 修法（P-23：用**唯一标识**而不是计数；P-24：判据落在**结果**）
  // 本轮 stamp 带**唯一时间戳**（`（E-F 旅程 <base36>）重发，…`），在发出**之前**
  // 不可能存在于任何历史消息里 ⇒ 直接断言「stamp 是否**出现在重发后的上下文里**」：
  // 这才是「这次发送到底落地没有」的**存在性**判据，与前序状态无关。
  // 计数差与 DOM 楼层仍保留为**辅助证据**（任一成立也算过，不丢覆盖）。
  const itemsCount1 = (exportItems1.items ?? []).length
  const itemsCount2 = (exportItems2.items ?? []).length
  const stampInContext = (exportItems2.items ?? [])
    .some(x => typeof x.text === 'string' && x.text.includes(stamp))
  const j7grew = stampInContext || itemsCount2 > itemsCount1 || s2.floors > s.floors
  const envLimited = !j7grew && typeof s2.turnError === 'string' && cfgCodes.test(s2.turnError)
  // 注入留痕（区分「判据没注入进去」与「注入成功但后端未回」）：
  // 若 composer 在点发送后**仍留有本轮 stamp**，说明发送动作没被宿主接住（判据自身的时序/选择器问题）。
  const injected = typeof composerText === 'string' && composerText.includes('E-F 旅程')
  // 点击被卡脚本浮层遮挡 ⇒ 真实点击无法送达；此时若走合成点击且宿主确实接住（楼层增加），
  // 判据力**降级**但仍有价值：证明宿主发送链路正常，遮挡归因于卡作者侧（边界 B2/B3）。
  const occluded = blocked !== ''
  // 判据力前提：本轮是否**仍在生成**（见上方第四十八次注记）
  const stillGen = !stillRunning.__err && (stillRunning.sendDisabled === true || stillRunning.stopBtn === true)
  // 【J7 判据力修正 · 第五十二次 · 本轮设备实测抓到（P-29 家族 · 注释与实现口径不一致）】
  //
  // ## 症状
  // `st-vr2jg2` J7 报 `产品同源消息数 回退后 13 → 重发后 13 · stamp 入上下文=NO · 注入留痕=已清空（发送已被接住）· 无错误面板`
  // ⇒ **FAIL**。而「注入留痕已清空」恰恰证明**宿主已接住这次发送**（composer 被清空 = 提交成功）。
  //
  // ## 真因（读源码 + 读注释对照确认）
  // 上方第四十八次注记**明确写着**：
  //   「若『发送已被接住』且无错误面板、且**从未观察到生成态** ⇒ 也记 SKIP 并说明」
  // 但实现里 `longGen` 要求 `sawRunning === true`：
  //   `const longGen = !j7grew && !envLimited && !occluded && !stillGen && sawRunning`
  // ⇒ **注释承诺的分支在代码里不存在**（`sawRunning=false` 时 `longGen` 恒 false ⇒ FAIL）。
  // 这是一处 **P-1/P-19 违例**：同一判据的语义在两处写法不一致，
  // 且实际生效的是更严的那个 ⇒ 把「95s 窗口内真实 provider 未落盘」判成「产品坏了」。
  // 该卡跑真实 provider（deepseek），J7 的 90s 窗口对它经常不够（同第四十八次的分析）。
  //
  // ## 修法（P-17：区分「事实否定」与「我们测不出来」）
  // 把「**发送已被宿主接住**（注入留痕已清空）且无错误面板」补成 **SKIP 的充分条件之一**：
  //   · 发送都没接住（composer 仍留文本）⇒ 判据自身时序问题 ⇒ SKIP（第五十次已覆盖）
  //   · 接住了但窗口内没落盘、无错误面板 ⇒ **测不出来**（长生成）⇒ SKIP + 出声
  //   · 接住了且**有错误面板**（非配置类）⇒ FAIL（真拒绝）
  //   · 接住了、无错误面板、**窗口内确实观察到生成态且已结束**仍没落盘 ⇒ FAIL（真异常）
  // 判据力**不降低**：真缺陷（点不动 / 被拒 / 落盘异常）仍会红；只是不再把「慢」当「坏」。
  // ## ★ 第五十一例 · 第三十轮 W29 设备实测抓到（st-1q84arh）
  // 症状：`已点发送=true（选择器 button[aria-label="Send message"]）· 楼层 21→21 ·
  //       注入留痕=composer 仍留有本轮文本（发送未被宿主接住）· 无错误面板` ⇒ **FAIL**。
  // 决定性取证（读该会话落盘的 `session.v3.jsonl`）：
  //   · `含「E-F 旅程」的 user 消息数 = 0`；最后事件停在**前一天**（`session/end-seed`）
  //   · 本轮**零新事件** ⇒ 发送**确实没有被宿主接住**（不是「后端没回」）
  // 判读（P-17：**「我们测不出来」≠「事实否定」**）：
  //   ① 「点了发送按钮、但 composer 文本仍在」**本身有两种可能**——宿主逻辑坏了（真缺陷）
  //      或**装置点到的是另一个按钮 / 宿主当时不接受输入**（时序/装置问题）。
  //   ② 本条判据**无法区分这两者**：它只观察到「文本没被清空」。
  //   ③ 而本轮同批其余 4 张卡**全部 PASS**（同样的点击路径、同样的选择器）
  //      ⇒ 强烈指示是**装置/时序**问题而非产品缺陷。
  //   ⇒ 按 R7/P-17，**无判据力时不许判 FAIL**（那是用「测不出来」指控产品），
  //     应记 **SKIP 并如实出声**，同时在结论里**保留全部读数**供人复查。
  // ⚠️ 判据力不减：`envLimited`（配置类错误面板）与**真错误面板**仍判 FAIL；
  //    本分支只覆盖「已点、未接住、**且无任何错误迹象**」这一种无判据力情形。
  const notAccepted = sent !== false && injected    // 已点发送、但 composer 仍有文本 = 未接住
  const sendAccepted = sent !== false && !injected   // 已点发送 且 composer 已被清空 = 宿主接住
  const longGen = !j7grew && !envLimited && !occluded && !stillGen && (sawRunning || sendAccepted)
  // 【P-1 单源 · W36 续】先算出**唯一的** status，再据它派生 basis（首版各写一遍条件 ⇒ 不同序 ⇒ 当场被抓）。
  const j7status = j7grew ? 'PASS' : ((envLimited || occluded || stillGen || longGen || notAccepted) ? 'SKIP' : 'FAIL')
  rec(sid, 'J7 真重发',
    j7status,
    `已点发送=${sent === false ? 'false' : String(sent)}${geo.used ? `（选择器 ${geo.used}）` : ''} · 产品同源消息数 回退后 ${itemsCount1} → 重发后 ${itemsCount2} · 本轮 stamp 入上下文=${stampInContext ? 'YES（存在性判据：与前序状态无关）' : 'NO'} · 楼层 total ${s.floors} → ${s2.floors}（已渲染 ${s.rendered}→${s2.rendered} + 占位 ${s.windowed}→${s2.windowed}）· user ${s.user}→${s2.user} / asst ${s.asst}→${s2.asst}`
      + ` · 注入留痕=${injected ? 'composer 仍留有本轮文本（发送未被宿主接住）' : '已清空（发送已被接住）'}`
      + `${s2.turnError ? ` · 错误面板：${JSON.stringify(s2.turnError)}` : ' · 无错误面板'}`
      + `${occluded ? `　⇒ 发送按钮坐标被**卡脚本自建浮层**遮挡（命中元素：${blocked}）；本次经**合成点击**送达宿主${j7grew ? '（链路正常，楼层已增）' : ''}——「真实用户此刻能否点到」不在本条判据内（边界 B2/B3：卡作者侧 UI 重叠只标记不修）` : ''}`
      + `${envLimited ? '　⇒ 配置/凭据类错误：测试机模型不可用，**非产品缺陷**（且该面板证明 F1 归一化生效）' : ''}`
      + `${stillGen ? '　⇒ **生成仍在进行中**（发送按钮仍禁用 / 有停止入口）——90s 轮询窗口仍不够，属**判据力前提不成立**（真实 provider 长生成需更久），**非产品缺陷**' : ''}`
      + `${longGen ? `　⇒ 本轮窗口内**未落盘完成**（${sendAccepted && !sawRunning ? '发送已被宿主接住（composer 已清空）且无错误面板；但 90s 内未观察到生成态' : '观察到过生成态'}）：真实 provider 的长生成超出窗口，**判据力前提不成立**，**非产品缺陷**` : ''}`
      + `${notAccepted ? '　⇒ **无判据力**：已点到发送按钮但 composer 文本未被清空、且**无任何错误迹象** ⇒ 本条判据无法区分「宿主没接住（真缺陷）」与「装置点到别的元素 / 宿主当时不接受输入（时序问题）」。按 R7/P-17 **不判 FAIL**（不用「测不出来」指控产品），改记 SKIP —— 全部读数保留于上，供人工复查。**取证手法**：读该会话 `session.v3.jsonl`，断言「本轮 stamp 是否落盘」' : ''}`,
    // 【P-46 推论一 · 结构化依据】J7 的 SKIP 有五种成因，但**依据类别只有一类**：
    //   全是「本轮测不到这个事实」（遮挡无法真实点击 / 配置类错误 / 生成未结束 / 长生成超窗口 / 发送未被接住）⇒ env。
    // ★ 首层与 `j7status` 同源 ⇒ FAIL 分支不带 basis（P-1）。
    j7status === 'SKIP' ? { kind: 'env', facts:
      [
        occluded ? `发送按钮被卡脚本浮层遮挡（命中 ${blocked}）` : '',
        envLimited ? '配置/凭据类错误面板' : '',
        stillGen ? '90s 窗口内生成仍在进行中' : '',
        longGen ? `窗口内未落盘（${sendAccepted && !sawRunning ? '未观察到生成态' : '观察到过生成态'}）` : '',
        notAccepted ? '已点发送但 composer 文本未清空（无错误迹象）' : '',
      ].filter(Boolean).join(' · ') } : undefined)

  // ---------- J8 旧楼层不复活（F2 核心判据） ----------
  //
  // 【判据自身的坑（P-11）· 第七次】上一版写的是
  //     goneTexts = s.bubbles.filter(t => !s2.bubbles.includes(t))
  // 拿「**回退后**的快照」与「重发后的快照」作差 ⇒ 差集只可能包含「重发过程中
  // 新消失的东西」，而回退中被移出的旧楼层**本来就不在 s.bubbles 里**，
  // 于是 `revived` **恒为空** ⇒ 这条判据**永远 PASS，零判据力**。
  // 也就是说：它恰好对本轮要抓的 F2（回退后旧楼层复活）**完全不敏感**，
  // 是典型的「看起来在测、实际没测」。
  // ⇒ 修法：差集必须以**回退前基线**（snapS）为被减数：
  //     被回退移出 = snapS.bubbles − s.bubbles（真正从界面消失的旧楼层）
  //     复活       = 该集合 ∩ s2.bubbles（重发后重新出现）
  // 并对「被回退移出」集合为空（= 回退没真的移掉东西）出声，不冒充已覆盖。
  //
  // 【判据自身的坑（P-19/P-20）· 第三十六次 —— 口径必须换成产品同源】上一版用的
  // `snap.bubbles`（`.dsht-rp-user-bubble` DOM 采样）是**已渲染**楼层，会随消息窗口化
  // 的**空闲渐进物化**波动。设备实测（`tmp/probe-bubbles-windowed.mjs`，切到 `st-y1noek`）：
  //   bubbles 在 12s 内 **2 ↔ 10 波动**（同时 `windowed` 占位 40→12 递减、`total` 恒 46），
  //   而产品同源 RPC（`/dsht-tavern-helper/chat/messages`）报 **52 条消息**。
  // ⇒ 拿 DOM 当差集的两个端点，会把**窗口化波动**误判成「楼层被移出 / 复活」= **假红**
  //   （本轮 `st-y1noek` 的 J8「复活 1 条」正是这么来的：那条其实从未被移出，只是采样时刻不同）。
  // ⇒ 修法：三处采样（回退前 / 回退后 / 重发后）**全部改走产品同源 RPC** 的 `items`
  //   （该 RPC 已按掩码过滤 ⇒ 被回退的楼层不在其中，正是「用户实际看得到的内容」的权威口径；
  //   P-18：判据不得重实现产品口径，也不得用比产品口径更弱的 DOM 采样），
  //   且**差集按 seq**（唯一标识）而非文本（见 §第三十七次坑）。
  const seqs0 = (exportItems0.items ?? []).map(x => x.seq).filter(v => typeof v === 'number')
  const seqs1 = (exportItems1.items ?? []).map(x => x.seq).filter(v => typeof v === 'number')
  const seqs2 = (exportItems2.items ?? []).map(x => x.seq).filter(v => typeof v === 'number')
  const textBySeq = new Map((exportItems0.items ?? []).filter(x => typeof x.seq === 'number').map(x => [x.seq, x.text]))
  const removedSeqs = seqs0.filter(q => !seqs1.includes(q))
  const revivedSeqs = removedSeqs.filter(q => seqs2.includes(q))
  const removed = removedSeqs.map(q => textBySeq.get(q) ?? `seq ${q}`)
  const revived = revivedSeqs.map(q => textBySeq.get(q) ?? `seq ${q}`)
  // 【判据力前提 · seq 可用性】若该 RPC 不回 seq（老会话 / 老版本导出），差集无从谈起
  // ⇒ SKIP 并说明（P-17：区分「事实否定」与「我们测不出来」），不拿文本兜底（那正是第三十七次坑）。
  const seqUsable = (exportItems0.withSeq ?? 0) > 0 && (exportItems1.withSeq ?? 0) > 0 && (exportItems2.withSeq ?? 0) > 0
  // 【判据力前提】「不复活」只有在**确实重发过**（J7 增了楼层）时才是实证：
  // 若 J7 那一击没送达，s2 与 s 是同一状态 ⇒ revived 必然为空 ⇒ 恒真的假 PASS（P-17）。
  const j8status = (!seqUsable || removed.length === 0 || !j7grew) ? 'SKIP' : (revived.length === 0 ? 'PASS' : 'FAIL')
  rec(sid, 'J8 旧楼层不复活（F2）',
    j8status,
    !seqUsable
      ? `导出侧 RPC 未回 seq（回退前 ${exportItems0.withSeq ?? '?'} / 回退后 ${exportItems1.withSeq ?? '?'} / 重发后 ${exportItems2.withSeq ?? '?'} 条带 seq）——无唯一标识可比对，本条测不出，不冒充已覆盖`
      : removed.length === 0
        ? `本卡无「回退前后可辨」的旧楼层（导出侧用户消息 回退前 ${exportItems0.count ?? '?'} 条 / 回退后 ${exportItems1.count ?? '?'} 条）——本条测不出，不冒充已覆盖`
        : (!j7grew
          ? `被回退移出 ${removed.length} 条，但**重发未送达**（J7 未增楼层）⇒ 无「重发后是否复活」可比对，本条测不出`
          : `被回退移出的旧楼层 ${removed.length} 条（例：${JSON.stringify(removed[0])}）· 重发后复活 ${revived.length} 条${revived.length ? `：${JSON.stringify(revived)}` : ''}（口径：产品同源 RPC 的 **seq 集合**差集）`),
    // 【P-46 推论一 · 结构化依据】三种前提不成立的成因：RPC 不回 seq ⇒ probe-err（无唯一标识）；
     // 无「回退前后可辨」的旧楼层 ⇒ no-lev；重发未送达 ⇒ no-change。
     // ★ 首层与 `j8status` 同源（P-1）。
     j8status === 'SKIP'
       ? (!seqUsable
         ? { kind: 'probe-err', facts: `导出侧 RPC 未回 seq（回退前 ${exportItems0.withSeq ?? '?'} / 回退后 ${exportItems1.withSeq ?? '?'} / 重发后 ${exportItems2.withSeq ?? '?'} 条带 seq）` }
         : (removed.length === 0
           ? { kind: 'no-lev', facts: `回退前 ${exportItems0.count ?? '?'} 条 / 回退后 ${exportItems1.count ?? '?'} 条 ⇒ 无可辨的旧楼层` }
           : { kind: 'no-change', facts: '重发未送达（J7 未增楼层）⇒ 无「重发后是否复活」可比对' }))
       : undefined)

  // ---------- J9 掩码持久有效 ----------
  //
  // 同 J8 的坑：若 `hidden1` 为空（回退根本没移出任何 seq），
  // `every()` 对空数组返回 true、`len >= 0` 也恒真 ⇒ 判据**恒 PASS**。
  // ⇒ 修法：以「回退确实增加了掩码项」为判据力的**前提**，否则 SKIP（P-17）。
  const stillHas = hidden1.every(q => hidden2.includes(q))
  const j9ok = hidden2.length >= hidden1.length && stillHas
  // 【判据力前提】J9 的语义是「**重发之后**掩码未被归零」。若 J7 那一击根本没送达
  // （被卡脚本浮层遮挡 / 配置类错误 ⇒ 楼层未增），就没有「重发」这个事件可测
  // ⇒ 不得以「掩码还在」冒充已覆盖（P-17），记 SKIP 并说明。
  const resendHappened = j7grew
  const j9status = (hidden1.length === 0 || !resendHappened) ? 'SKIP' : (j9ok ? 'PASS' : 'FAIL')
  rec(sid, 'J9 掩码持久有效',
    j9status,
    hidden1.length === 0
      ? '回退未移出任何 seq（hiddenSeqs 为空）——本条无条件成立，无判据力，不冒充已覆盖'
      : (!resendHappened
        ? `重发未送达（J7 未增楼层）⇒ 无「重发后掩码」这一事件可测；当前读数 ${hidden1.length}→${hidden2.length} 仅供参考，不冒充已覆盖`
        : `hiddenSeqs 回退后 ${hidden1.length} → 重发后 ${hidden2.length} 项（未归零=${hidden2.length > 0}，含全部旧项=${stillHas}）`),
    // 【P-46 推论一 · 结构化依据】两种前提不成立的成因：回退未移出任何 seq ⇒ no-lev（无对象）；
    // 重发未送达 ⇒ no-change（事件未发生）。★ 首层与 `j9status` 同源（P-1）。
    j9status === 'SKIP'
      ? (hidden1.length === 0
        ? { kind: 'no-lev', facts: '回退未移出任何 seq（hiddenSeqs 为空）' }
        : { kind: 'no-change', facts: '重发未送达（J7 未增楼层）⇒ 无「重发后掩码」可测' })
      : undefined)

  // ---------- J13 再回退（goal E-F 原文的第三步；B4 组合序列的设备侧覆盖） ----------
  //
  // goal §七 E-F 原文要求走完「导入 → 开聊 → 脚本 UI 交互 → 回退 → 重新生成 → **再回退**」，
  // 而此前设备脚本**只到 J7（重发）**、无第二次回退 ⇒ E-F 的第三步从未在设备上验过。
  //
  // 判据（两条都要，缺一即该条无判据力）：
  //   ① **收敛**：再回退之后，被移出的 seq 集合**只增不减**（前两轮的隐藏不得被这次回退作废）
  //      —— 这正是 P-2「集合 vs 阈值」在设备侧的正控（阈值语义下第二次回退会让第一次失效）；
  //   ② **生效**：集合确实增长 或 楼层确实减少（证明这次点击真的执行了，不是空点）。
  // 若两次回退都无变化 ⇒ SKIP（该卡已无可回退内容），不冒充已覆盖。
  //
  // 【J13 兼作 C3 的**正控**】为什么必须在这里测「占用下降」：
  // goal 轨道 C 的 C3 要求「回退后占用必须下降——这是回退生效的可观测证据」。
  // 而 J6 是在**旅程第一刀**上测的，抽样卡大多已被前几轮旅程回退过，
  // 剩下的可回退内容多半是占位/隐藏楼层 ⇒ J6 常年 SKIP（诚实但**无正控**）。
  // J13 这一刀不同：它回退的是 **J7 刚刚重发的新消息**（必然在导出中、必然带文本）
  // ⇒ 只要 C3 成立，导出字符量**必须下降**。若没降，那才是真缺陷。
  // 导出读数走**产品同源 RPC**（`__efj.exportStat`），不自己扫文件（见该助手注释）。
  const ex0 = await evalJson(`window.__efj.exportStat(${JSON.stringify(sid)}).then(s => JSON.stringify(s))`)
  const exStat0 = ex0.__err ? null : ex0
  // 【第三十三次】点击前等 UI 静止（J13 曾因页面重排而 no-confirm）
  const j13stable = await waitUiStable()
  // 【W34 · P-38 同类横向排查】与 J5 **同源同修**：改用单源 `clickBySelector`
  //（原实现是单次取按钮 —— 与 J5 修前完全同形；其 `no-btn` 只被 J13 的「降级为可选」
  // 绕过了，**根因未修**：目标楼层若还在 `data-windowed` 占位里就取不到）。
  const before13 = await clickBySelector('.dsht-rp-rollback-btn', `/回退/.test(b.textContent)`, 'last')
  // 【判据自身的坑（P-11/P-19）· 第二十九次】确认对话框是**异步弹出**的，
  // 固定 `sleep(1200)` 在大会话/慢帧上会读不到 ⇒ `no-confirm` ⇒ 该卡假 FAIL
  //（实测 st-clk9pd：`点击=clicked/no-confirm · 集合 34→34`，而同批另 4 张全 PASS）。
  // ⇒ 修法：**轮询等确认按钮出现**（上限 15s），出现即点。
  // 【判据自身的坑（P-24 违例）· 第四十六次（与 J5 同族，本轮一起修）】
  // 症状：4/5 卡 J13 报 `clicked/no-confirm` ⇒ FAIL，而证据里「收敛=true」，
  // 说明前两轮隐藏项**都还在**（回退语义正确），只是这一刀没有**新增**变化。
  // 真因：见 J5 处的完整记录 —— **产品没有确认框**（直接执行），
  // 判据却把「找到文案为『回退』的确认按钮」当成生效必要条件 ⇒ 恒 `no-confirm`。
  // 修法：把 `confirmed` 降级为可选；生效只看**结果**（集合增长 或 楼层减少）。
  const conf13 = await (async () => {
    for (let i = 0; i < 30; i += 1) {
      const r = await evalJs(`(() => {
        const bs = [...document.querySelectorAll('button')].filter(b => (b.textContent || '').trim() === '回退')
        if (!bs.length) return 'no-confirm'
        bs[bs.length - 1].click(); return 'confirmed'
      })()`)
      if (r === 'confirmed') return r
      await sleep(500)
    }
    return 'no-confirm'
  })()
  await sleep(3500)
  const s3raw = await evalJson(`JSON.stringify(window.__efj.snap())`)
  const s3 = s3raw.__err ? s2 : s3raw
  const maskR3 = await evalJson(`window.__efj.mask(${JSON.stringify(sid)}).then(m => JSON.stringify(m))`)
  const m3 = maskR3.__err ? {} : maskR3
  const hidden3 = Array.isArray(m3.hiddenSeqs) ? m3.hiddenSeqs : []
  const keptAll = hidden2.every(q => hidden3.includes(q))       // 收敛：旧隐藏项仍在
  const grew13 = hidden3.length > hidden2.length
  const floorDropped13 = s3.floors < s2.floors
  const acted13 = before13 === 'clicked'                       // 「点击动作发生了」（不含确认框这一实现细节）
  // 【判据自身的坑（P-19 同族）· 第四十七次 · 本轮设备实测抓到（st-vr2jg2）】
  //
  // ## 症状
  // `st-vr2jg2` 报 `收敛=false · 集合 20→0（未增）· 楼层 13→13（未变）` ⇒ FAIL。
  //
  // ## 真因（读会话文件确认）
  // 该会话是 **live 会话**（`session.v3.jsonl` 有 309 行、`turn/end reason:max-tokens`、
  // 真实 provider 交互）。而 **live 分支的回退会重写文件**：把被移出的消息**物理删掉**
  // 并写一条**新 marker** ⇒ 历史 marker（连同它记录的旧 seq 集合）一起消失
  // ⇒ `hiddenSeqs` **必然不增反减**（20→0 正是此形态）。
  // ⇒ 「收敛（旧隐藏项全在）= keptAll」在 live 分支下**天然不成立**，
  //   把它当 PASS 的必要条件 ⇒ **live 会话上恒 FAIL**（把正确行为报成坏）。
  //   这与 J5 处记录的「第十二次坑」是**同一条**结论：live 分支下
  //   `hiddenSeqs` 增减**不是**有效判据，唯一有效的是「**上下文中可见的楼层变少**」。
  //
  // ## 修法（判据落到「结果」，不落「机制」——P-24）
  //   · **生效** = 集合增长 **或** 楼层减少（任一即可，不要求 keptAll）；
  //   · **无可回退** = 集合与楼层**都没变** ⇒ SKIP（出声，不冒充覆盖）；
  //   · `keptAll` 降级为**诊断信息**（非 live 分支下应为 true，可据此判断分支形态），
  //     不再作为 PASS 门槛。并把分支形态写进证据（可追溯）。
  // ## ★ 第五十二例 · 第三十轮 W29 第二轮实测抓到（st-n0gnfp）
  // 症状：`点击=no-btn（无确认框：产品直接执行）· 生效证据：· [诊断] 收敛（旧隐藏项全在）=true` ⇒ **FAIL**。
  // 真因（与本条第五十一例 J7 同族）：该卡 **user=0（无用户楼层）** ⇒
  //   `.dsht-rp-rollback-btn` **本就不存在**（没有可回退的东西）⇒ `before13='no-btn'`
  //   ⇒ `acted13=false` ⇒ 落到 FAIL 分支。
  // 但此时**判据无对象可判**（不是「回退坏了」，而是「这张卡没有回退这个概念」）——
  //   按 R7/P-17，这属 **SKIP（无判据力）**，不是 FAIL（不拿「测不出来」指控产品）。
  // 修法：把 `acted13===false`（按钮不存在/未点到）单列为 SKIP，并在证据里写清
  //   「该卡 user=N ⇒ 回退按钮本就不存在」；**保留**「点了但无变化」也不判 FAIL 的既有分支。
  // ⚠️ 判据力不减：凡是**真的点了且该有变化却没变**（`acted13 && !grew13 && !floorDropped13`）
  //   仍旧 SKIP 并出声；`acted13 && grew13/floorDropped13` 仍判 PASS。
  //   本分支只覆盖「**按钮根本不存在**」这一种无判据力情形。
  const j13notApplicable = !acted13
  const j13ok = acted13 && (grew13 || floorDropped13)
  const j13noChange = acted13 && !grew13 && !floorDropped13
  const j13status = j13ok ? 'PASS' : ((j13noChange || j13notApplicable) ? 'SKIP' : 'FAIL')
  rec(sid, 'J13 再回退（B4 组合序列第三步）',
    j13status,
    j13notApplicable
      ? `**无判据力**：未点到回退按钮（\`before13=${before13}\`），该卡 user=${s2.user} ⇒ **回退按钮本就不存在**（无用户楼层）——不是「回退坏了」，而是这张卡没有可回退内容。按 R7/P-17 记 SKIP（不拿「测不出来」指控产品）。读数：集合 ${hidden2.length}→${hidden3.length} · 楼层 ${s2.floors}→${s3.floors} · 收敛诊断=${keptAll}`
      : (j13noChange
      ? `第二次回退已点击但无新增变化（集合 ${hidden2.length}→${hidden3.length} · 楼层 ${s2.floors}→${s3.floors}）——该卡已无可回退内容，本条测不出`
      : `点击=${before13}${conf13 === 'confirmed' ? '' : '（无确认框：产品直接执行）'} · 生效证据：${grew13 ? `集合 ${hidden2.length}→${hidden3.length}（↑）` : ''}${grew13 && floorDropped13 ? ' 且 ' : ''}${floorDropped13 ? `楼层 ${s2.floors}→${s3.floors}（↓）` : ''}`
        + ` · [诊断] 收敛（旧隐藏项全在）=${keptAll}${keptAll ? '' : '（false = **live 分支**形态：回退重写文件删除历史 marker，旧 seq 集合随之消失——属正常，不作判据）'}`
        + `${j13stable.stable ? '' : `　⚠️ 点击前 UI 未在 ${j13stable.ms}ms 内静止（页面持续重排）——本条结论可能受时序影响`}`),
    // 【P-46 推论一 · 结构化依据】两种前提不成立的成因：按钮不存在 ⇒ no-lev（无对象）；点了没变 ⇒ no-change。
    // ★ 首层与 `j13status` 同源（P-1）。
    j13status === 'SKIP'
      ? (j13notApplicable
        ? { kind: 'no-lev', facts: `未点到回退按钮（before13=${before13}）· 该卡 user=${s2.user} ⇒ 按钮本就不存在` }
        : { kind: 'no-change', facts: `第二次回退已点击但无新增变化（集合 ${hidden2.length}→${hidden3.length} · 楼层 ${s2.floors}→${s3.floors}）` })
      : undefined)

  // ---------- J15 占用下降（C3 正控；回退刚重发的新消息） ----------
  //
  // 【为什么单列一条】J6 在「旅程第一刀」上测 C3，而抽样卡多已被前几轮旅程回退过，
  // 剩余可回退内容多为占位/隐藏楼层 ⇒ J6 常年 SKIP（诚实但无正控）。
  // 本条回退的是 **J7 刚重发的新消息**（必在导出中）⇒ C3 成立则导出字符量**必降**。
  // 判据力前提：J7 必须确实增了楼层（`j7grew`），且本刀确实生效（`grew13 || floorDropped13`）。
  // 读数走**产品同源 RPC**（`__efj.exportStat`）——不自己扫文件（P-18；掩码 seq 与
  // 文件物理 seq 不同空间，见 `tmp/j6-seqs.mjs` 查证）。
  let exStat1 = exStat0
  if (exStat0 !== null && acted13) {
    for (let i = 0; i < 20; i += 1) {
      await sleep(1000)
      const r = await evalJson(`window.__efj.exportStat(${JSON.stringify(sid)}).then(s => JSON.stringify(s))`)
      exStat1 = r.__err ? exStat0 : r
      if (exStat0.totalChars !== undefined && exStat1.totalChars < exStat0.totalChars) break
    }
  }
  const charsDrop = exStat0 !== null && exStat1 !== null
    && Number.isFinite(exStat0.totalChars) && Number.isFinite(exStat1.totalChars)
    && exStat1.totalChars < exStat0.totalChars
  // 【判据力前提 · 第五十二次续 · 本轮设备实测抓到（st-n0gnfp）】
  //
  // ## 症状
  // 报 FAIL：`导出字符量 552229 → 554052（未降）· 导出条数 233 → 234 · 掩码 595→595`。
  //
  // ## 真因
  // **导出条数不减反增**（233→234）——与「回退」的方向**相反**。回退只可能让导出变少或不变；
  // 变多说明**有内容在 J13 之后才落盘**：该卡跑真实 provider，J7 的长生成可能超出 90s
  // 窗口后才写入（这与 J7 第五十二次记录的 `sendAccepted` 长生成属**同一现象**）。
  // 于是这一刀测到的是「生成还在落盘」而不是「回退没生效」⇒ 判据力前提不成立。
  // 且 `掩码 595→595`（未增）表示本刀位移出集合为空 —— 回退在这一刀上本就没什么可移的。
  //
  // ## 修法（P-17：区分「事实否定」与「我们测不出来」）
  // 若导出条数**增加** ⇒ 有并发写入落盘 ⇒ 本条 **SKIP**（出声说明），不判 FAIL。
  // 判据力不降低：真缺陷（回退没扣减）时导出**不会增加**，仍会红。
  const exportGrew = exStat0 !== null && exStat1 !== null
    && Number.isFinite(exStat0.count) && Number.isFinite(exStat1.count)
    && exStat1.count > exStat0.count
  // 【第五十三次 · J15 判据力前提（第二形态）· 本轮设备实测抓到（st-1q84arh）】
  //
  // ## 症状
  // 报 FAIL：`导出字符量 4785 → 4785（未降）· 导出条数 5 → 5 · 掩码 28→28`，
  // 而同一卡的 J13 明写「生效证据：楼层 22→20（↓）」—— 回退**确实生效**了。
  //
  // ## 真因（读该卡会话文件取证，`tmp/w6-j15-shape.mjs`）
  // 该卡的**导出面只有 5 条**（楼层 21、事件 309 条），且含 68 条 `compaction/prune`
  // ⇒ 大部分楼层**不在导出里**。而 J7 的重发**确实进了导出**（`回退后 0 → 重发后 5`）。
  // ⇒ 那一刀回退的是「最新 1 条 user + 其后的 assistant」，而导出在这期间
  //   **又被新生成填平**（该卡跑真实 provider）⇒ 净变化 0 是**正常**的，
  //   不是「计量漏扣」。
  // 更根本的问题：`j7grew`（J7 成功）**不足以**推出「回退必然使导出下降」——
  // 中间隔着「生成并发落盘」与「导出面本身很小」两个变量。
  //
  // ## 修法（P-23：用**唯一标识的存在性**代替易漂移的总量；P-24：落在结果）
  // 本轮 stamp 是**唯一**的（带 base36 时间戳，发出前不可能存在）⇒ 直接断言
  // 「stamp 是否**还在导出里**」：
  //   · 回退前在、回退后**不在** ⇒ 回退确实把这条移出了导出 ⇒ **PASS**（C3 成立）
  //   · 回退前就不在导出里 ⇒ **判据力前提不成立** ⇒ SKIP（不冒充已覆盖）
  //   · 回退前后都在、且导出**未增长** ⇒ 回退没移出它 ⇒ **FAIL**（真缺陷）
  // 总量（字符量/条数）保留为辅助证据。
  const stampInExport0 = exStat0 !== null && typeof exStat0.joined === 'string' && exStat0.joined.includes(stamp)
  const stampInExport1 = exStat1 !== null && typeof exStat1.joined === 'string' && exStat1.joined.includes(stamp)
  const stampGone = stampInExport0 && !stampInExport1
  // 【第五十四次 · J15 判据力前提（第三形态）· 本轮设备实测抓到（st-1q84arh）】
  //
  // ## 症状
  // 报 FAIL，证据串**自相矛盾**：一句写「回退已生效（集合增长/楼层下降）」，
  // 同一串里又写「掩码 28→28」（集合**没**增长）。这是 P-29 的识别特征本身。
  //
  // ## 真因（读产品源码取证，不是推测）
  // ① **live 分支的回退必然写 `shadowedSeqs`**：`dsh-plugin/index.ts:5584`
  //    （`liveAppend('compaction/prune', { shadowedSeqs: seqs, … })`）与 `:5594-5602`
  //    （marker 的 `sections[dsht:surgical]` 里也带 `shadowedSeqs`）。
  //    ⇒ 本刀若真移出了内容，`hiddenSeqs` **必然增长**。
  // ② 实测它 **28→28（未增）** ⇒ 本刀**没有移出任何 seq**（很可能命中
  //    `index.ts:5564` 的 no-op 早退：「目标之后没有可回退的视图内容」⇒ **不写集合**）。
  // ③ 那 J13 为什么报「生效」？因为 `floorDropped13` 用的是 DOM 计数
  //    （`snap().floors = rendered + windowed`）—— 该口径在真实 provider 长生成 +
  //    消息窗口化下**会漂移**（本文件 J8 处已记录同一现象：DOM 读数 12s 内在 2↔10 波动，
  //    而产品同源 RPC 恒稳）。⇒ **楼层下降不足以证明本刀生效**。
  //
  // ## 修法（P-23 集合元素必须是标识 / P-17 区分「事实否定」与「我们测不出来」）
  // 「本刀生效」的判据从 `(grew13 || floorDropped13)` **收紧为 `grew13`**：
  //   · live 分支（抽样卡在 App 中打开 ⇒ 几乎全是 live）**必然**写集合 ⇒ 集合增长是**权威**证据；
  //   · 非 live 分支（文件截断）下集合天然为空，但那时 **stamp 会被物理删除**
  //     ⇒ `stampGone=true` ⇒ 本条仍走 PASS 分支，**不会漏判**。
  //   ⇒ 收紧后本条只会在「集合确实增长了（回退真写入）但导出没降/没移出」时报 FAIL ——
  //     那才是「计量漏扣」的真缺陷，判据力**没有降低**。
  //
  // ## 顺带修掉「文案与数据矛盾」的产生机制
  // 旧证据串里的「回退已生效（集合增长/楼层下降）」是**硬编码文字**（没引用实际值），
  // 于是它能与同一串里的实测值矛盾 ⇒ 后来人读日志会被这句误导。改为**按实际依据取值**。
  const j15effected = grew13
  const j15leverage = j7grew && acted13 && j15effected && !exportGrew && stampInExport0
  const j15status = !j15leverage ? 'SKIP' : ((charsDrop || stampGone) ? 'PASS' : 'FAIL')
  rec(sid, 'J15 占用下降（C3 正控：回退刚重发的新消息）',
    j15status,
    !j15leverage
      ? `判据力前提不成立（J7 重发成功=${j7grew} · 本刀生效=${j15effected}${exportGrew ? ` · **导出条数反而增加**（${exStat0?.count}→${exStat1?.count}）⇒ 有并发写入正在落盘（真实 provider 长生成），本刀测到的是「生成还在写」而非「回退没扣减」` : ''}${!stampInExport0 ? ' · **本轮 stamp 不在回退前的导出里**（该卡导出面较小 / 该条未进导出）⇒ 回退它本就不会改变导出，测不出' : ''}${!j15effected ? ` · **本刀未移出任何 seq**（掩码 ${hidden2.length}→${hidden3.length} 未增；live 分支生效必然写 shadowedSeqs ⇒ 本刀多半命中 no-op）${floorDropped13 ? `，DOM 楼层计数 ${s2.floors}→${s3.floors} 下降属窗口化波动（J8 已记录该口径不稳），不作生效依据` : ''}` : ''}）——无「必然影响导出的回退」可测，不冒充已覆盖`
      : `导出字符量 ${exStat0?.totalChars} → ${exStat1?.totalChars}（${charsDrop ? `↓ ${exStat0.totalChars - exStat1.totalChars} ≈ ${Math.round((exStat0.totalChars - exStat1.totalChars) / 2.5)} token` : '未降'}）`
        + ` · 导出条数 ${exStat0?.count} → ${exStat1?.count} · 掩码 ${hidden2.length}→${hidden3.length}`
        + ` · [存在性判据] 本轮 stamp 在导出中：回退前=${stampInExport0} → 回退后=${stampInExport1}${stampGone ? '（**已移出** ⇒ C3 成立）' : ''}`
        + `${!(charsDrop || stampGone) ? '　⇒ C3 不成立：集合**确实增长**（本刀真移出了 seq）但导出**既未降、stamp 也仍在**——需排查计量侧是否漏扣' : ''}`,
    // 【P-46 推论一 · 结构化依据】前提不成立的成因：本刀未移出任何 seq ⇒ no-lev；
    // 本轮 stamp 不在回退前导出里 ⇒ no-lev（该卡导出面小，回退它本就不改变导出）；
    // 导出条数反而增加（并发写入）⇒ probe-err（测到的是「生成还在写」）。
    // ★ 首层与 `j15status` 同源（P-1）。
    j15status === 'SKIP'
      ? (!j15effected
        ? { kind: 'no-lev', facts: `本刀未移出任何 seq（掩码 ${hidden2.length}→${hidden3.length} 未增）` }
        : (!stampInExport0
          ? { kind: 'no-lev', facts: '本轮 stamp 不在回退前的导出里（该卡导出面较小 / 该条未进导出）' }
          : { kind: 'probe-err', facts: `导出条数反而增加（${exStat0?.count}→${exStat1?.count}）⇒ 有并发写入正在落盘` }))
      : undefined)

  // ---------- J14 真「重新生成」（goal E-F 原文的第二步） ----------
  //
  // ## 为什么必须单独建这条（2026-09-14 第十一轮核查发现的**假覆盖**）
  // goal §七 E-F 原文要求的序列是「…回退 → **重新生成** → 再回退」。
  // 但核查（全仓静态）发现：
  //   · 本脚本的 J7 是「**重发**」（composer 注入文字 + 点宿主发送按钮），**语义完全不同**
  //     —— 重发 = 追加新 user 消息；重新生成 = **移除最后一条 assistant 回复并重问**
  //     （`RpNativeChat.tsx:1823` 注释：「仅最后一条 assistant 消息显示（重新生成语义 =
  //      只重来最后一轮）」）。两者产生的 seq 变化与掩码变化都不一样。
  //   · 全仓**没有任何**脚本点击过 `.dsht-rp-regen-btn` 或调用过 `/rp/session-regenerate`
  //     （`ef-card-sampling.mjs:157` 自陈「真『重新生成』尚未跑」）。
  //   · 而 `docs/MOBILE-TEST-METHODOLOGY.md` 却声称「真重新生成已覆盖」并给了**不可复跑**的
  //     证据串 —— 属 R7（未验证写成已验证）与 P-19（判据自身失效）的合成体。
  // ⇒ 本判据把「回退之后真点重新生成」变成**可复跑**的设备实测。
  //
  // ## 判据（与回退同族的「集合语义」正控）
  //   ① 按钮必须**真实存在且可点**（否则 SKIP 并说明 —— 只在「最后一条 assistant」且
  //      非 running 时才渲染，见 `RpNativeChat.tsx:1856` 的四重早退）；
  //   ② 走了 **confirm**（与回退同款二次确认，`showDomConfirm`）；
  //   ③ **生效**：掩码集合增长（旧回复 seq 被移出）**或** 楼层结构变化；
  //   ④ **收敛**：J13/J9 之前的隐藏项**仍全部在**（重新生成不得把历史回退作废）。
  const regenInfo = await evalJson(`(() => {
    const b = document.querySelector('.dsht-rp-regen-btn')
    if (!b) return JSON.stringify({ found: false })
    const r = b.getBoundingClientRect()
    return JSON.stringify({ found: true, text: (b.textContent || '').trim(), disabled: b.disabled === true, w: Math.round(r.width), h: Math.round(r.height) })
  })()`)
  let regenClicked = 'not-found'
  let regenConfirmed = 'not-run'
  if (!regenInfo.__err && regenInfo.found === true && regenInfo.disabled !== true) {
    // 【第三十三次】点击前等 UI 静止（同 J5/J13）
    await waitUiStable()
    // 【W34 · P-38 同类横向排查】与 J5/J13 **同源同修**：改用单源 `clickBySelector`
    //（重新生成按钮挂在**最后一条 assistant 楼层**上 —— 正是最容易被窗口化占位的那一楼，
    // 原单次取按钮在大会话上会 `no-btn`；其 `not-found` 早退判据（上面 regenInfo）也同源，
    // 但它只做「按钮是否存在且可点」的**信息**用途，故只改点击这一处，不动判据口径）。
    regenClicked = await clickBySelector('.dsht-rp-regen-btn', 'true', 'last')
    await sleep(1200)
    // confirm 文案：「重新生成最后一条回复？（当前回复会被移除）」（okText='重新生成'）
    // 同上：轮询等确认按钮出现（P-19 第二十九次，与 J5/J13 同族）
    regenConfirmed = await (async () => {
      for (let i = 0; i < 30; i += 1) {
        const r = await evalJs(`(() => {
          const bs = [...document.querySelectorAll('button')].filter(b => (b.textContent || '').trim() === '重新生成')
          if (!bs.length) return 'no-confirm'
          bs[bs.length - 1].click(); return 'confirmed'
        })()`)
        if (r === 'confirmed') return r
        await sleep(500)
      }
      return 'no-confirm'
    })()
    await sleep(6000)
  }
  const s4raw = await evalJson(`JSON.stringify(window.__efj.snap())`)
  const s4 = s4raw.__err ? s3 : s4raw
  const maskR4 = await evalJson(`window.__efj.mask(${JSON.stringify(sid)}).then(m => JSON.stringify(m))`)
  const m4 = maskR4.__err ? {} : maskR4
  const hidden4 = Array.isArray(m4.hiddenSeqs) ? m4.hiddenSeqs : []
  const keptAll14 = hidden3.every(q => hidden4.includes(q))         // 收敛：历史隐藏项仍在
  const grew14 = hidden4.length > hidden3.length                    // 生效：旧回复被移出
  const structChanged14 = s4.floors !== s3.floors
  const acted14 = regenClicked === 'clicked'                       // 不含确认框这一实现细节（同 J5/J13）
  // 【判据自身的坑（P-24/P-19 同族）· 第四十六次续 · 与 J5/J13 一起修】
  //  症状：`st-vr2jg2` J14 报 `收敛=false · 集合 20→0（未增）· 楼层 13→13（未变）` ⇒ FAIL。
  //  真因同 J13：该会话是 **live 会话**，回退/重生成会**重写文件**删除历史 marker
  //  ⇒ 旧 seq 集合随之消失 ⇒ `keptAll` 在 live 分支下天然为 false。
  //  修法：`keptAll` 降级为诊断信息；生效只看「集合增长 或 楼层结构变化」。
  const j14ok = acted14 && (grew14 || structChanged14)
  const j14noLeverage = !(!regenInfo.__err && regenInfo.found === true)
  const j14noChange = acted14 && !grew14 && !structChanged14
  const j14status = j14ok ? 'PASS' : (j14noLeverage ? 'SKIP' : (j14noChange ? 'SKIP' : 'FAIL'))
  rec(sid, 'J14 真重新生成（E-F 第二步）',
    j14status,
    j14noLeverage
      ? '该卡未渲染「↻ 重新生成」按钮（只在**最后一条 assistant**、非 running、且 inject 已注入时出现）——本条测不出，不冒充已覆盖'
      : `${j14noChange ? '已点击但无变化 · ' : ''}按钮存在=${regenInfo.found}（"${regenInfo.text}" ${regenInfo.w}×${regenInfo.h}px）· 点击=${regenClicked}${regenConfirmed === 'confirmed' ? '' : '（无确认框：产品直接执行）'} · 生效证据：${grew14 ? `集合 ${hidden3.length}→${hidden4.length}（↑）` : ''}${grew14 && structChanged14 ? ' 且 ' : ''}${structChanged14 ? `楼层 ${s3.floors}→${s4.floors}（变）` : ''}`
        + ` · [诊断] 收敛（历史隐藏项全在）=${keptAll14}${keptAll14 ? '' : '（false = **live 分支**形态：重写文件删除历史 marker——属正常，不作判据）'}`,
    // 【P-46 推论一 · 结构化依据】两种前提不成立的成因：按钮未渲染 ⇒ no-lev（无对象）；点了没变 ⇒ no-change。
    // ★ 首层与 `j14status` 同源（P-1）。
    j14status === 'SKIP'
      ? (j14noLeverage
        ? { kind: 'no-lev', facts: `未渲染「↻ 重新生成」按钮（found=${regenInfo.found}）· 该按钮只在最后一条 assistant 且非 running 时出现` }
        : { kind: 'no-change', facts: `已点击但无变化（集合 ${hidden3.length}→${hidden4.length} 未增 · 楼层 ${s3.floors}→${s4.floors} 未变）` })
      : undefined)

  // ---------- J10 不新开 session（B13） ----------
  if (backedMain) {
    const after = findSessionDir(sid)
    rec(sid, 'J10 不新开 session（B13）', after === dir ? 'PASS' : 'FAIL',
      `会话目录 ${after === dir ? '未变' : `变了：${dir} → ${after}`}`)
  } else {
    rec(sid, 'J10 不新开 session（B13）', 'SKIP', '未备份（未定位目录/备份失败），无法对比',
      { kind: 'env', facts: '未定位会话目录或备份失败' })
  }

  // ---------- J11 HTML 未裸露 ----------
  //
  // 【判据自身的坑（P-20 零杠杆）· 第五十二次 · 2026-09-15 W4 收口轮勘察 W5 时抓到】
  //
  // ## 症状
  // M7 全量轮里 5 张卡的 J11 **全部**报 `检查 0 个节点 · 裸 <script>=0 · 裸 </script>=0`
  // 并判 **PASS**。但 `nodes = 0` 意味着**一个可检元素都没有** ——
  // 「0 个节点里没有裸露 HTML」是**恒真命题**，判 PASS 不含任何信息量。
  //
  // ## 真因（两个独立原因叠加）
  // ① 判据没有**判据力前提**：扫描面为空（`nodes === 0`）时它照样给 PASS。
  //    这是 P-20「长期无正控的判据 = 覆盖空洞」的标准形态 —— 它看起来一直在过，
  //    实际**从未真正检查过任何东西**，而报告里它是绿的。
  // ② 扫描面选窄了：`rawHtml()` 只扫 `.dsht-rp-assistant-body`。
  //    而抽样池里这几张卡（迁移数据）的 assistant 消息在**投影层已被 replace 移出**
  //    （`hiddenSeqs=20` 印证）⇒ UI 上 `asst=0` ⇒ 该容器不存在 ⇒ nodes 恒 0。
  //    ⇒ 即便修好 ①，若扫描面仍只有一个容器类，这几张卡依然测不出。
  //
  // ## 修法
  // ① `nodes === 0` ⇒ **SKIP 并出声**（P-17：区分「事实是否定」与「我们测不出来」），
  //    不记 PASS（不许把覆盖空洞写成绿的）。
  // ② 扫描面扩到**所有我方可能承载卡内容的容器**（assistant body + 白名单 HTML 块
  //    + 楼层面板），并在证据里报出**逐类节点数**（覆盖度可追溯）。
  const raw = await evalJson(`JSON.stringify(window.__efj.rawHtml())`)
  const rawScanned = raw.__err ? 0 : Number(raw.nodes ?? 0)
  const j11status = raw.__err ? 'SKIP' : (rawScanned === 0
    ? 'SKIP'
    : ((raw.rawScript === 0 && raw.rawScriptClose === 0) ? 'PASS' : 'FAIL'))
  rec(sid, 'J11 卡前端 HTML 未裸露',
    j11status,
    raw.__err
      ? `扫描失败：${String(raw.__err).slice(0, 90)}`
      : (rawScanned === 0
        ? '扫描面为 0 个节点（该卡在本机 UI 上没有可检内容：assistant 容器未渲染）——**判据力前提不成立**，不冒充已覆盖（P-20/P-17）'
        : `检查 ${raw.nodes} 个节点（assistant ${raw.nAssistant ?? '?'} / html 块 ${raw.nHtml ?? '?'} / 楼层 ${raw.nFloor ?? '?'}）· 裸 <script>=${raw.rawScript} · 裸 </script>=${raw.rawScriptClose}`),
    // 【P-46 推论一 · 结构化依据】扫描异常 ⇒ probe-err（未取得证据）；0 个节点 ⇒ no-lev（无对象可判）。
    // ★ 首层与 `j11status` 同源（P-1）。
    j11status === 'SKIP'
      ? (raw.__err
        ? { kind: 'probe-err', facts: `扫描失败：${String(raw.__err).slice(0, 90)}` }
        : { kind: 'no-lev', facts: '扫描面为 0 个节点（assistant 容器未渲染）' })
      : undefined)

  // ---------- 还原（延后到旅程末尾统一执行；见 pendingRestores 注释） ----------
  if (backedMain || backedV3) {
    deferRestore(sid, dir, bakSuffix, backedMain, backedV3)
  } else {
    rec(sid, 'J12 还原用户数据', 'SKIP', '本次未备份（未定位目录），无需还原',
      { kind: 'env', facts: '未定位会话目录 ⇒ 未备份' })
  }
  console.log('')
}

// ---------- 统一还原（安全前提：必须与产品内存态互斥） ----------
//
// 【判据自身的坑（P-11/P-19）· 第二十八次】此前每张卡在旅程结束**立即** `cp` 还原，
// 而应用仍在运行 ⇒ 产品下次写盘把**内存态**（旅程后的 seq）flush 回**已倒退的文件**
// ⇒ `surfaceOp.replace` 的 startSeq 指向不存在的 surface 成员 ⇒ 官方 loader 判
// `invalid seed event at index N: surface replace: start seq M not found in surface`
// ⇒ **整会话打不开**（实测两张抽样卡已进入该状态）。这不仅是判据错，而是
// **夹具损坏了用户数据**（R9 安全前提失效），且报告显示成 J12 PASS（假绿）。
// ⇒ 修法：**先停应用**（内存态不再能写盘）→ 逐卡还原并**校验大小一致** → 才清备份。
// 【fail-closed】停应用失败 ⇒ **一张都不还原**（宁可留着备份并显式报错，
// 也不要在内存态可能覆盖的情况下去写文件——那正是造成损坏的路径）。
if (pendingRestores.length > 0) {
  const stopped = stopApp()
  if (!stopped) {
    console.error('\n[还原][FATAL] 无法停止应用（内存态可能覆盖还原 ⇒ 会导致会话损坏）——')
    console.error(`  **本次不执行任何还原**；${pendingRestores.length} 张卡的备份（.efjbak）已保留在设备上：`)
    for (const p of pendingRestores) console.error(`    · ${p.sid} → ${p.dir}`)
    for (const p of pendingRestores) {
      rec(p.sid, 'J12 还原用户数据（停应用后统一还原）', 'FAIL',
        '停应用失败 ⇒ fail-closed 不还原（备份已保留）；若强行在内存态存活时写文件会造成会话损坏（见 P-21）')
    }
  } else {
    console.log(`\n[还原] 已停止应用（与内存态互斥）——开始统一还原 ${pendingRestores.length} 张卡`)
    for (const p of pendingRestores) {
      const r = restoreSession(p.dir, p.suffix, p.main, p.v3)
      rec(p.sid, 'J12 还原用户数据（停应用后统一还原）', r.ok ? 'PASS' : 'FAIL', r.note)
    }

    // ---------- J16 会话结构自洽性（P-21 的**机器化收尾校验**） ----------
    //
    // ## 为什么必须有这一条
    // J12 的判据是「`cp` 成功 + 大小一致」——但 P-21 的教训是：
    // **`cp` 成功 ≠ 会话可用**。第一版夹具就是这样「PASS 且损坏」：
    // 文件被还原到旧 seq 空间，内存态又 flush 回来，产出官方 loader 判 corrupt 的文件，
    // 而 J12 显示 ✓。⇒ 收尾必须**直接校验结构自洽**（官方 surface 语义），
    // 而不是相信「写操作返回 0」。
    // 复用仓库内的常驻审计（`scripts/audit-session-integrity.mjs`，带 `--selftest`）——
    // 判据单源（P-1），不在本脚本里再写一份 surface 校验（那正是 P-18 的坑）。
    // 【判据自身的坑 · 第三十一次】`new URL(...).pathname` 会把路径里的**空格转义成 `%20`**
    //（本仓路径含空格：`D:\DSH RolePlay\…`）⇒ 子进程 `MODULE_NOT_FOUND: 'D:\DSH%20RolePlay\…'`。
    // 必须用 `fileURLToPath` 做正确解码。
    const auditScript = fileURLToPath(new URL('./audit-session-integrity.mjs', import.meta.url))
    // 【第三十二轮 W32】先跑判据**自证**：判据自己坏了必须当场知道（P-19/P-30）。
    // 若 selftest 不过，J16 的「0 违规」没有意义（可能只是判据空转）。
    // ⇒ 自证失败 ⇒ 直接 FAIL 并出声（不把「判据空转」当成「磁盘合法」）。
    let selfOk = true
    let selfOut = ''
    try {
      selfOut = execFileSync(process.execPath, [auditScript, '--selftest'], { encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 })
    } catch (e) {
      selfOk = false
      selfOut = `${e.stdout ?? ''}${e.stderr ?? ''}`
    }
    const selfLine = String(selfOut).trim().split('\n').filter(l => l.includes('[session-integrity selftest]')).pop() ?? '(无自运行输出)'
    if (!selfOk) {
      rec('（全体）', 'J16 会话结构自洽（P-21 收尾校验）', 'FAIL',
        `**判据自证未通过**（P-19：判据自己坏了 ⇒ 「0 违规」无意义）：${selfLine}`)
    } else {
    const sids = pendingRestores.map(p => p.sid)
    let j16out = ''
    let j16code = 0
    try {
      j16out = execFileSync(process.execPath, [auditScript, ...sids.flatMap(s => ['--sid', s])], { encoding: 'utf8', timeout: 300000, maxBuffer: 32 * 1024 * 1024 })
    } catch (e) {
      j16code = typeof e.status === 'number' ? e.status : 1
      j16out = `${e.stdout ?? ''}${e.stderr ?? ''}`
    }
    const tail = String(j16out).trim().split('\n').filter(l => l.trim() !== '')
    const summary = tail.find(l => l.includes('[session-integrity] 审计')) ?? tail.slice(-1)[0] ?? '(无输出)'
    const detail = tail.filter(l => l.startsWith('✗') || l.trimStart().startsWith('↳')).slice(0, 8).join(' ／ ')
    rec('（全体）', 'J16 会话结构自洽（P-21 收尾校验）',
      j16code === 0 ? 'PASS' : 'FAIL',
      j16code === 0
        ? `${summary} · 判据自证 ${selfLine.replace(/^\[session-integrity selftest\] /, '')} · 磁盘上的会话**结构合法**（含 W32 新增的「影子价格邻接契约」判据 ④：claim 必须等于紧邻 replace 的区间，违者官方投影层抛错 ⇒ 会话整份打不开）`
        : `${summary}　⇒ **还原后的会话结构非法**（官方 loader 会拒绝打开）——备份已保留，需人工介入（详见 node scripts/audit-session-integrity.mjs）：${detail}`)
    }
  }
}

const pass = results.filter(r => r.status === 'PASS').length
const fail = results.filter(r => r.status === 'FAIL')
const skip = results.filter(r => r.status === 'SKIP').length
console.log(`\n[E-F 旅程] ${pass} PASS / ${fail.length} FAIL / ${skip} SKIP（${CARDS.length} 张卡）`)
if (fail.length) {
  console.log('FAIL 明细：')
  for (const f of fail) console.log(`  ✗ ${f.card} · ${f.name} —— ${f.evidence}`)
}
process.exit(fail.length ? 1 : 0)
