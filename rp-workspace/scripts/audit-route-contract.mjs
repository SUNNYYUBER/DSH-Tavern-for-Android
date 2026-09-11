#!/usr/bin/env node
/**
 * audit-route-contract.mjs —— 前后端「路由契约」一致性审计（静态）
 *
 * 起因（2026-09-11 心跳 46，实机实证的静默失败）：
 * `/dsht-rp/rp/build-info` 只挂在服务端 **GET 块**，而前端 `rpApi()` **恒为 POST**
 * → 实机 POST 恒 404，客户端 `.catch(() => setBuildInfo(null))` 把它吞成"没有数据"。
 * 后果：「我装的到底是不是最新包」这个专门为用户痛点做的功能**上线三天从未生效**，
 * 而 `apply-platform-patches.py --check`、单测、构建断言**全部通过**
 * —— 因为那些检查的语义是"标记/产物是否存在"，不是"前后端是否对得上"。
 *
 * 本脚本补的正是这一环：把「前端怎么调」与「后端怎么挂」摆到一起比对。
 *
 * 判据（**只看方法，不看路径前缀**——前缀由 helper 决定）：
 *   前端 rpApi/thApi/memApi 恒为 POST ⇒ 服务端必须在该文件的 **POST 区**里出现该路径。
 *   若某路径**只**出现在 GET 区 → 前端调用必然 404（= 静默失败），报错。
 *
 * 【心跳 63C 扩域 · 从"挂错 method"扩到"路径根本不存在"】
 *   起因是又一个上线后从未生效的功能（实机实证）：
 *   `SessionsPanel.tsx` 调 `rpApi('sessions-audit')` / `'sessions-archive'` / `'sessions-autoclean'`
 *   —— 都**少了 `rp/` 前缀**，而服务端挂的是 `/rp/sessions-*` ⇒ `/dsht-rp/sessions-audit` **恒 404**
 *   `{"error":"unknown endpoint"}`，被 `catch { setNote('审计失败：…') }` 吞成一句提示
 *   ⇒ **整个「会话管理」面板（审计 / 归档 / 自动清理）从未可用**（三个按钮 `disabled` 恒真，
 *   因为 `forkedCount`/`emptyCount` 都来自永远为 null 的 `sessions`）。
 *   ⚠️ 旧版本**抓不到**它：旧版把「服务端完全找不到该路径」降级成一条 `checked` 说明
 *   （原文注释：「可能是别的前缀/动态拼接」）而**不计违约** ⇒ **防线自己给自己留了一个整类盲区**。
 *   （L44 同族：防线必须能抓到自己该抓的东西。这是**同一文件里的第二次**。）
 *   现改为：**找不到 = 违约**。动态拼接仍由字面量判据自然排除（正则只认字面量实参）。
 *
 * 用法：node scripts/audit-route-contract.mjs      （退出码 0 = 无违约）
 *       node scripts/audit-route-contract.mjs -v   （同时列出全部已核对路由）
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// 【心跳 63C】自检（L44：防线自身必须先过正控）
//   本脚本是过程式的 ⇒ 自检用**子进程跑自己**，源码根指向 `fixtures/route-contract`。
//   样本里放了 4 个已知形态：1 个 OK + 3 个**应当报违约**（缺前缀 / 只在 GET / 完全不存在）。
//   为什么必须内建：本轮正是"防线自己有整类盲区"才漏掉了 3 个恒 404 的路由（心跳 63C）。
// ---------------------------------------------------------------------------
if (process.argv.includes('--selftest')) {
  const { spawnSync } = await import('node:child_process')
  const selfPath = fileURLToPath(import.meta.url)
  const fx = resolve(dirname(selfPath), 'fixtures/route-contract/packages/src')
  if (!existsSync(fx)) { console.error(`[selftest] 找不到样本目录：${fx}`); process.exit(2) }
  const r = spawnSync(process.execPath, [selfPath], { env: { ...process.env, DSHT_AUDIT_SRC: fx }, encoding: 'utf8' })
  const out = (r.stdout ?? '') + (r.stderr ?? '')
  const cases = [
    ['缺前缀样本被判违约', out.includes("rpApi('/sessions-audit')")],
    ['只在 GET 区被判违约', out.includes("rpApi('/rp/only-get')")],
    ['完全不存在被判违约', out.includes("rpApi('/rp/never-mounted')")],
    ['POST 区可用的样本**不**被误报', !out.includes("rpApi('/rp/ok-post')")],
    ['违约计数 = 3', /发现 3 处契约违约/.test(out)],
    ['退出码 = 1', r.status === 1],
  ]
  for (const [name, ok] of cases) console.log(`[selftest] ${ok ? 'PASS' : 'FAIL'}  ${name}`)
  const allOk = cases.every(c => c[1])
  console.log(`[selftest] ${allOk ? 'PASS' : 'FAIL'}`)
  if (!allOk) { console.log('--- 子进程输出 ---\n' + out) }
  process.exit(allOk ? 0 : 1)
}

const WS = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// 允许覆盖源码根（负向对照用：拿 git HEAD 的旧文件跑一遍，必须能报出已知违约）
const SRC = process.env.DSHT_AUDIT_SRC ? resolve(process.env.DSHT_AUDIT_SRC) : join(WS, 'packages/src')
const VERBOSE = process.argv.includes('-v')

/** 客户端 helper → 服务端实现文件 */
const PAIRS = [
  { helper: 'rpApi', server: join(SRC, 'dsh-plugin/index.ts'), label: 'dsht-rp-plugin' },
  { helper: 'thApi', server: join(SRC, 'dsht-plugin-tavern-helper/index.ts'), label: 'dsht-tavern-helper' },
  { helper: 'memApi', server: join(SRC, 'dsht-plugin-memory/index.ts'), label: 'dsht-plugin-memory' },
]

/** 客户端源码根（所有 .ts/.tsx） */
function walk(dir, out = []) {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

// ---------------------------------------------------------------------------
// 1. 收集前端调用
// ---------------------------------------------------------------------------
const clientFiles = walk(join(SRC, 'dsht-rp-ui/src')).concat(walk(join(SRC, 'dsh-plugin/client')))
const clientCalls = new Map() // path → { helper, files:Set }
for (const f of clientFiles) {
  const text = readFileSync(f, 'utf8')
  for (const m of text.matchAll(/\b(rpApi|thApi|memApi)\s*(?:<[^>]*>)?\s*\(\s*['"`]([^'"`]+)['"`]/g)) {
    const helper = m[1]
    // 归一化：去前导斜杠、去 query
    let path = m[2].replace(/^\//, '').split('?')[0]
    if (path === '' || path.includes('${')) continue
    if (!path.startsWith('/')) path = '/' + path
    const key = `${helper} ${path}`
    if (!clientCalls.has(key)) clientCalls.set(key, { helper, path, files: new Set() })
    clientCalls.get(key).files.add(f.slice(SRC.length + 1))
  }
}

// ---------------------------------------------------------------------------
// 2. 划分服务端的 GET 区 / POST 区（按行号切，不做括号匹配——稳健且够用）
// ---------------------------------------------------------------------------
function regions(text) {
  const lines = text.split('\n')
  const getGuard = lines.findIndex(l => /req\.method\s*===\s*'GET'/.test(l))
  const postGuard = lines.findIndex(l => /req\.method\s*!==\s*'POST'/.test(l))
  return { lines, getGuard, postGuard }
}

/** 该文件里某路径是否出现在 POST 区 */
function pathsInPostRegion(text, reqPath) {
  const { lines, getGuard, postGuard } = regions(text)
  if (postGuard < 0) return null // 该文件没有 POST 分发块
  const found = { get: false, post: false }
  const needle = `'${reqPath}'`
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (!l.includes(needle)) continue
    // 只在做路由匹配的行上算（sub === / subPath ===）
    if (!/\b(sub|subPath)\s*===/.test(l)) continue
    if (getGuard >= 0 && i > getGuard && i < postGuard) found.get = true
    else if (i > postGuard) found.post = true
    else found.post = true // GET 守卫之前/无守卫 → 视为 POST 侧（宽松，避免误报）
  }
  return found
}

// ---------------------------------------------------------------------------
// 3. 比对
// ---------------------------------------------------------------------------
const violations = []
const checked = []
for (const { helper, server, label } of PAIRS) {
  if (!existsSync(server)) continue
  const text = readFileSync(server, 'utf8')
  for (const [key, call] of clientCalls) {
    if (call.helper !== helper) continue
    const where = pathsInPostRegion(text, call.path)
    if (where === null) continue
    const hitAny = where.get || where.post
    if (!hitAny) {
      // 【心跳 63C】**找不到 = 违约**（旧版在此 `continue` → 整类盲区，实战漏掉了 3 个恒 404 的路由）
      violations.push({ ...call, label, missing: true })
      checked.push({ ...call, label, verdict: 'VIOLATION（服务端完全没有该路径 → POST 必然 404）' })
      continue
    }
    if (where.post) {
      checked.push({ ...call, label, verdict: 'OK（POST 区可见）' })
    } else {
      violations.push({ ...call, label })
      checked.push({ ...call, label, verdict: 'VIOLATION（只在 GET 区 → POST 必然 404）' })
    }
  }
}

// ---------------------------------------------------------------------------
// 4. 报告
// ---------------------------------------------------------------------------
console.log('=== 前后端路由契约审计（客户端 POST × 服务端路由挂载区）===')
console.log(`前端调用点：${clientCalls.size} 个唯一路由`)
if (VERBOSE) {
  for (const c of checked) console.log(`  · ${c.helper} ${c.path}  [${c.label}]  ${c.verdict}`)
}
console.log('')
if (violations.length === 0) {
  console.log('✅ 无违约：所有前端 POST 调用在服务端 POST 区都能找到挂载点')
  process.exit(0)
}
console.log(`🔴 发现 ${violations.length} 处契约违约（前端 POST → 服务端不匹配）：`)
for (const v of violations) {
  console.log(`  ✗ ${v.helper}('${v.path}')  ← 服务端 ${v.label} ${v.missing ? '**没有这个路径**（前缀/拼写不一致？）' : '只在 GET 区'}`)
  console.log(`      调用点：${[...v.files].join(', ')}`)
}
console.log('')
console.log('处置：路径不存在 → 对齐前后端字面量（改前端或后端，**只改一侧**，勿留两套别名）；')
console.log('      只在 GET 区 → 把该路由同时挂到 POST 区（推荐抽单实现供两侧共用），或让前端改用 GET。')
process.exit(1)
