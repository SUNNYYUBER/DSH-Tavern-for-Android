#!/usr/bin/env node
/**
 * verify-resilient-list.mjs —— DSHT-RESILIENT-LIST 补丁的**行为回归**（T-87 心跳 77 新增）
 * ============================================================================
 * ## 为什么需要它（L145 的直接产物）
 * `patch-resilient-list.mjs` 此前**只有锚点断言**（`count !== 1` ⇒ exit 1）。
 * 锚点断言能发现"补丁没打上"，但**不能发现"打上了却没效果"** ——
 * 例如 0.1.5 重构后，锚点匹配到了无关片段、或替换后的代码路径根本没被执行。
 * 而这条补丁守的是 **C2 契约**：**单个坏会话文件不得崩掉整个 runtime**。
 * 它失效的形态是设备上的 **boot-loop**（App 卡启动屏），代价极高。
 *
 * ## 判据（4 项，全部为**行为**判据，非文本判据）
 * 构造三种会话目录，调真实的 `listArtifacts`：
 *   ① 正常会话（header.id 与所在目录名一致，cwd 与目录可对应）→ **必须被列出**
 *   ② **身份漂移**（header 声称的 id/cwd 与物理位置不符，且目标路径不存在）
 *      → 必须**自愈**（重命名到 header 声明的路径）或至少**跳过**，**绝不上抛**
 *   ③ **重复 id**（同一 id 出现在两个 project 目录）→ 必须**跳过 + 告警**，**绝不上抛**
 *   ④ 三条合在一起跑 ⇒ **整体不上抛**，且正常会话仍被列出（不能"为了容错把好的也丢了"）
 *
 * ## 反控（--negative-control）
 * 把补丁文件**临时还原成未打补丁形态**（用脚本里的 ORIG 锚点做逆替换），
 * 跑同一场景 ⇒ 期望 **必然上抛**（`corrupt session log ...`）。
 * 若未打补丁也不上抛，说明本脚本的样本**不能构造出该故障**（探针失效，L142 同族）——
 * 那时 ③ 的"绿"是假的，必须报红。
 *
 * 用法：
 *   node scripts/verify-resilient-list.mjs                    # 行为回归（要求 4 项全过）
 *   node scripts/verify-resilient-list.mjs --negative-control  # 证明判据能报红
 */
import process from 'node:process'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { zstdCompressSync } from 'node:zlib'
import { createRequire } from 'node:module'

import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WS = path.resolve(HERE, '..')
const RT = path.join(WS, 'dsh-runtime-android', 'node_modules')
const TARGET = path.join(RT, '@deepseek-ai', 'dsh-session-persistence-jsonl', 'lib', 'index.js')
const CORDIS = path.join(RT, '@deepseek-ai', 'cordis', 'lib', 'index.js')

const NEGCTL = process.argv.includes('--negative-control')

// 会话日志的 header 是**独立 zstd 帧**，帧内明文必须恰好一行（以 \n 结尾，见 assertZstdHeaderFrame）。
// 文件名代际后缀：v3 → session.v3.jsonl.zstd。
const LOGNAME = 'session.v3.jsonl.zstd'
const headerBytes = (id, cwd) => zstdCompressSync(Buffer.from(
  JSON.stringify({ type: 'session', version: 3, id, createdAt: 1, isSeeded: false, delegationDepth: 0, cwd }) + '\n', 'utf8'))

/** 造一个隔离的会话根（三种样本） */
function seed (root) {
  fs.rmSync(root, { recursive: true, force: true })
  const A = '--p-a--'
  const B = '--p-b--'
  const cwd = '/tmp/proj'
  // ① 正常：目录名 = id，且 header.cwd 与 project 目录一致
  fs.mkdirSync(path.join(root, A, 'ok-1'), { recursive: true })
  fs.writeFileSync(path.join(root, A, 'ok-1', LOGNAME), headerBytes('ok-1', cwd))
  // ② 身份漂移：物理目录叫 wrong-2，header 却声称 id=drift-2 ⇒ 校验必失败
  fs.mkdirSync(path.join(root, A, 'wrong-2'), { recursive: true })
  fs.writeFileSync(path.join(root, A, 'wrong-2', LOGNAME), headerBytes('drift-2', cwd))
  // ③ 重复 id：同一 id 出现在两个 project 目录
  fs.mkdirSync(path.join(root, A, 'dup-3'), { recursive: true })
  fs.writeFileSync(path.join(root, A, 'dup-3', LOGNAME), headerBytes('dup-3', cwd))
  fs.mkdirSync(path.join(root, B, 'dup-3'), { recursive: true })
  fs.writeFileSync(path.join(root, B, 'dup-3', LOGNAME), headerBytes('dup-3', cwd))
  return { A, B }
}

/** 在**指定的模块文件**上跑一次 listArtifacts（用临时副本，避免同一路径被 ESM 缓存） */
async function runScenario (moduleFile, root) {
  // ⚠️ ESM 按 URL 缓存 ⇒ 必须换一个唯一路径才能在同一进程里跑"打补丁/未打补丁"两版。
  // ⚠️ 副本必须落在**原包目录内**（同目录不同名）：该 bundle 里有裸导入（`@deepseek-ai/...`），
  //    挪到 os.tmpdir() 会因找不到 node_modules 而 ERR_MODULE_NOT_FOUND（实测踩到）。
  const dir = path.dirname(moduleFile)
  const copy = path.join(dir, `_verify-copy-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
  fs.copyFileSync(moduleFile, copy)
  try {
    const mod = await import(pathToFileURL(copy).href)
    const { Context } = await import(pathToFileURL(CORDIS).href)
    const ctx = new Context()
    const be = new mod.default(ctx, { root, compression: 'zstd' })
    const warns = []
    const origWarn = console.warn
    console.warn = (...a) => { warns.push(a.join(' ')) }
    let artifacts = null
    let threw = null
    try {
      artifacts = await be.listArtifacts()
    } catch (e) {
      threw = e
    } finally {
      console.warn = origWarn
    }
    return { artifacts, threw, warns }
  } finally {
    fs.rmSync(copy, { force: true })
  }
}

const results = []
const check = (ok, label, extra = '') => {
  results.push({ ok, label })
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `  — ${extra}` : ''}`)
}

const root = path.join(os.tmpdir(), `resilient-behavior-${process.pid}`)

if (NEGCTL) {
  // ---- 反控：把目标文件临时还原成"未打补丁"形态 ----
  // ⚠️ 逆替换必须**逐字精确**（不能用正则模糊匹配）——首版用 `/(...catch...)[\s\S]*?}/`
  //    删块，结果切坏了语法（`SyntaxError: Unexpected identifier 'header'`），
  //    反控自己先崩了、根本没测到判据（L144 同族：兜底工具自身也要保证正确性）。
  //    故这里直接引用 `patch-resilient-list.mjs` 导出的锚点常量做**字符串精确逆替换**。
  const bak = TARGET + '.negctl-bak'
  fs.copyFileSync(TARGET, bak)
  try {
    let t = fs.readFileSync(TARGET, 'utf8')

    // ② 身份校验：把 0.1.5 形态的 try/catch 整段还原为「裸 await + return」（= 未打补丁）
    const PATCHED_IDENTITY = [
      '\t\t/* ' + 'DSHT-RESILIENT-LIST' + ': 单个坏身份会话文件不致命——先自愈（重命名到 header 声明的物理路径），',
      '\t\t   自愈不成则跳过并告警（返回 void 0，调用方 listArtifacts 视作 continue）；',
      '\t\t   绝不允许一条坏文件让 cordis init 崩溃 boot-loop 整个 runtime',
      '\t\t   （实机实证：手机端任务卡死强杀重启后 st-w82dal 身份漂移 → listArtifacts throw → node exit 1 死循环） */',
      '\t\ttry {',
      '\t\t\tawait this.assertStoredIdentity(selected.sourcePath, selected.sourceVersion, header, expectedId, signal);',
      '\t\t} catch (identityError) {',
      '\t\t\tif (await this.healStoredIdentity(selected, header, signal)) return header;',
      '\t\t\tconsole.warn(`${this.name}: skipping session log with mismatched identity: ${selected.sourcePath}`);',
      '\t\t\treturn void 0;',
      '\t\t}',
      '\t\treturn header;',
    ].join('\n')
    const RAW_IDENTITY = [
      '\t\tawait this.assertStoredIdentity(selected.sourcePath, selected.sourceVersion, header, expectedId, signal);',
      '\t\treturn header;',
    ].join('\n')

    // ③ 重复 id：把「跳过 + 告警」还原为「抛错」
    const PATCHED_DUP = [
      '\t\t\t\tif (ids.has(header.id)) {',
      '\t\t\t\t\t/* ' + 'DSHT-RESILIENT-LIST' + ': 重复 id 只跳过并告警，不炸 cordis init */',
      '\t\t\t\t\tconsole.warn(`${this.name}: skipping duplicate session id "${header.id}" at ${selected.sourcePath}`);',
      '\t\t\t\t\tcontinue;',
      '\t\t\t\t}',
    ].join('\n')
    const RAW_DUP = '\t\t\t\tif (ids.has(header.id)) throw new Error(`duplicate JSONL session id "${header.id}" appears in multiple project directories`);'

    const missing = []
    if (!t.includes(PATCHED_IDENTITY)) missing.push('身份校验段')
    if (!t.includes(PATCHED_DUP)) missing.push('重复 id 段')
    if (missing.length > 0) {
      console.error(`[negctl] 未找到补丁段（${missing.join('、')}）—— 目标文件可能未打补丁，反控无法进行，不能据此下结论`)
      process.exit(2)
    }
    t = t.replace(PATCHED_IDENTITY, RAW_IDENTITY).replace(PATCHED_DUP, RAW_DUP)
    fs.writeFileSync(TARGET, t)
    console.log('[negctl] 已临时还原为"未打补丁"形态（身份校验裸 await + 重复 id 抛错），期望 listArtifacts **必须上抛**…\n')

    seed(root)
    const r = await runScenario(TARGET, root)
    const threw = r.threw !== null
    console.log(`  未打补丁时：${threw ? `上抛 ✓（${String(r.threw.message).slice(0, 90)}）` : '没上抛 ✗'}`)
    if (!threw) {
      console.log('\n[negctl] FAIL —— 未打补丁也不上抛 ⇒ 本脚本的样本构造不出该故障（探针失效，L142 同族）')
      process.exitCode = 1
    } else {
      console.log('\n[negctl] PASS —— 判据能报红（未打补丁必抛）')
      process.exitCode = 0
    }
  } finally {
    fs.copyFileSync(bak, TARGET)
    fs.unlinkSync(bak)
    console.log('[negctl] 已还原补丁文件')
    fs.rmSync(root, { recursive: true, force: true })
  }
} else {
  // ---- 正式：行为回归 ----
  seed(root)
  const r = await runScenario(TARGET, root)
  const ids = r.artifacts ? r.artifacts.map((a) => a.header.id).sort() : []

  check(r.threw === null, '判据1 三种样本（正常/身份漂移/重复id）合跑时 listArtifacts **不上抛**',
    r.threw ? `❌ 抛错：${String(r.threw.message).slice(0, 140)}` : '')

  check(ids.includes('ok-1'), '判据2 正常会话仍被列出（容错不能把好的也丢掉）', `实得 ids=${JSON.stringify(ids)}`)

  check(ids.includes('drift-2') || ids.includes('dup-3'),
    '判据3 身份漂移/重复 id 的会话被**自愈或跳过**（进了列表或至少没炸）',
    `ids=${JSON.stringify(ids)}`)

  check(r.warns.length >= 1,
    '判据4 至少在降级路径上**出声**（console.warn —— 不许静默）',
    `${r.warns.length} 条：${r.warns.map((w) => w.slice(0, 70)).join(' | ') || '（无）'}`)

  fs.rmSync(root, { recursive: true, force: true })

  const pass = results.filter((x) => x.ok).length
  console.log(`\n[verify-resilient-list] ${pass}/${results.length} PASS`)
  process.exit(pass === results.length ? 0 : 1)
}
