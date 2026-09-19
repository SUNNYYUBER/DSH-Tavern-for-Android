#!/usr/bin/env node
/**
 * session-guard.mjs —— **写型设备探针的会话数据守护（单源）**
 * =============================================================================
 * ## 为什么有它（P-48 第二类 / R18 / P-1）
 * 有些设备探针**必须对用户真实卡的会话真跑回退类 RPC**（`rp/session-rollback` 等）
 * 才能验证「回退是否真的生效、掩码是否持久」—— 而这类 RPC 是**不可逆**的
 * （非 live 路径**截断文件**；live 路径写 replace + 掩码）。
 *
 * W39 按 **P-38 三段式**穷举「会改用户会话数据的装置」，抓到 **2 处真实缺陷**：
 *   · `scripts/ef-rollback-live.mjs`
 *   · `scripts/b2-live-rollback-test.mjs`
 * 两者都会对显式传入的真实 sid **真执行** `rp/session-rollback`，却
 * **零备份、零还原、零中止兜底** ⇒ 一旦跑到一半出错，**用户的会话永久停在被回退的状态**。
 * 这违反 **R18**（改动设备数据前必须声明影响域并先备份）。
 *
 * ## 为什么抽成单源（而不是在两个脚本里各写一份）
 * ① **P-1**：同一语义只允许一处权威实现；
 * ② 本仓有**常驻闸门**（`audit-impl-duplication.mjs` 判据 7「函数体逐字重复」）——
 *    两份逐字拷贝会**当场报红**（W38 的 `ev()` 双拷贝正是这么被抓到的）；
 * ③ W36 的 M7 已经把「备份 → 停应用 → 还原 → 校验」这套流程**验证过**（含负控），
 *    这里的实现与它**同口径**（备份后缀、大小校验、失败保留备份供人工恢复）。
 *
 * ## 用法
 * ```js
 * import { makeSessionGuard } from './session-guard.mjs'
 * const guard = makeSessionGuard({ adb: ADB, pkg: PKG, sid: SID, yes: YES })
 * guard.install()                       // 注册全部中止路径兜底（幂等）
 * if (!guard.backup()) { … }            // 写型动作**之前**必须先备份（成功才继续）
 * … 执行回退类 RPC …
 * guard.restore('normal')               // 正常收尾（幂等；exit 那次会跳过）
 * ```
 *
 * ## 安全语义（与 M7 同口径，逐条有实测依据）
 *   ① **先备份再写**：`backup()` 返回 `false` 时调用方**必须**中止（fail-closed）；
 *   ② **停应用后还原**：live 会话有「立即耐久 barrier」，应用存活时 `cp` 还原会被内存态
 *      覆盖成 corrupt（P-21 实测）⇒ `restore()` 内部先 `am force-stop`；
 *   ③ **还原后校验**：备份与还原后文件**大小逐一致**才算成功；不一致 ⇒ 出声 + **保留备份**；
 *   ④ **幂等**：可被多个中止路径重复调用（P-46 推论二：不许重复还原）；
 *   ⑤ **成功也出声**：打印触发路径 —— 否则「兜底真的跑了」与「压根没改过」不可分（P-48 纪律③）。
 */
import { execFileSync } from 'node:child_process'

/** 备份后缀（与 M7 `ef-journey-all.mjs` 同口径；两者互不覆盖） */
export const BAK_SUFFIX = '.sgardbak'

export function makeSessionGuard ({ adb, pkg, sid, yes = true, log = console.log, err = console.error }) {
  const runAs = (...args) => {
    try {
      return execFileSync(adb, ['shell', 'run-as', pkg, ...args],
        { encoding: 'utf8', timeout: 30000, maxBuffer: 96 * 1024 * 1024 })
    } catch (e) {
      return `__ADBERR__ ${String(e.message).slice(0, 200)}`
    }
  }
  /** find 输出里取第一个 `files/…` 路径（过滤 adb/shell 杂音行） */
  const pickPath = (out) =>
    String(out).trim().split('\n').map(l => l.trim()).filter(l => l.startsWith('files/')).pop() ?? ''
  /** 会话目录：先按名直查（`sessions/<projectKey>/<sid>`），再试无 projectKey 层 */
  const findDir = () => {
    const p1 = pickPath(runAs('find', 'files/.dsh/sessions', '-maxdepth', '3', '-type', 'd', '-name', sid))
    if (p1 !== '') return p1
    return pickPath(runAs('ls', '-d', `files/.dsh/sessions/${sid}`))
  }
  // run-as 的 cwd 不是 files/ 根 ⇒ 必须用**绝对路径**（否则 cp 报 No such file，P-11 第二十一次坑）
  const abs = (rel) => `/data/data/${pkg}/${rel}`

  let dir = ''
  let backedMain = false
  let backedV3 = false
  let dirtied = false
  let restored = false

  /** 备份（**写型动作之前必须调用**；返回是否成功）。
   *
   * 【P-48 纪律②】「备份写盘」与「登记已被我改动」**同一处** ——
   * 不留「已备份但登记为未改」的窗口（否则兜底会以为无需还原，W36 实测残留 2 个备份）。 */
  const backup = () => {
    if (!yes) { log('[守护] dry-run（未传 --yes）⇒ 不备份、不写') ; return false }
    dir = findDir()
    if (dir === '') { err('[守护][FATAL] 未定位会话目录 ⇒ 无法备份 ⇒ **拒绝执行写型动作**（R18）') ; return false }
    const a = abs(dir)
    runAs('rm', '-f', `${a}/session.jsonl${BAK_SUFFIX}`, `${a}/session.v3.jsonl${BAK_SUFFIX}`)
    const r1 = runAs('cp', `${a}/session.jsonl`, `${a}/session.jsonl${BAK_SUFFIX}`)
    backedMain = !String(r1).includes('__ADBERR__') && String(r1).trim() === ''
    const hasV3 = String(runAs('ls', `${a}/session.v3.jsonl`)).includes('session.v3.jsonl')
    if (hasV3) {
      const r2 = runAs('cp', `${a}/session.v3.jsonl`, `${a}/session.v3.jsonl${BAK_SUFFIX}`)
      backedV3 = !String(r2).includes('__ADBERR__') && String(r2).trim() === ''
    }
    const ok = backedMain && (hasV3 ? backedV3 : true)
    if (ok) dirtied = true          // ← 登记与写盘同一处（P-1）
    log(`[守护] 备份 ${dir}：session.jsonl${backedMain ? '✓' : '✗'}`
      + `${hasV3 ? ` · session.v3.jsonl${backedV3 ? '✓' : '✗'}` : ' · 无 session.v3.jsonl（非 live 写入态，正常）'}`)
    return ok
  }

  /** 停应用（使内存态不再能写盘）——`am force-stop` 必须走**非 run-as** 的 adb shell */
  const stopApp = () => {
    try {
      const out = execFileSync(adb, ['shell', 'am', 'force-stop', pkg], { encoding: 'utf8', timeout: 30000 })
      if (String(out).trim() === '') return true
      return !/SecurityException|Permission Denial/.test(String(out))
    } catch { return false }
  }

  /** 还原（幂等；可被任何中止路径调用） */
  const restore = (reason) => {
    if (!dirtied || restored) return { ok: true, skipped: true }
    if (!stopApp()) {
      err('[守护][FATAL] 停应用失败 ⇒ **不还原**（内存态可能覆盖 ⇒ 会损坏会话）；备份已保留：'
        + `${dir}（后缀 ${BAK_SUFFIX}）请人工恢复`)
      return { ok: false, skipped: false }
    }
    const a = abs(dir)
    const problems = []
    const verify = (name) => {
      const s = Number(String(runAs('stat', '-c', '%s', `${a}/${name}${BAK_SUFFIX}`)).trim())
      const d = Number(String(runAs('stat', '-c', '%s', `${a}/${name}`)).trim())
      if (!Number.isFinite(s) || !Number.isFinite(d) || s !== d) problems.push(`${name} 大小不符（备份 ${s} vs 已还原 ${d}）`)
    }
    if (backedMain) {
      runAs('cp', `${a}/session.jsonl${BAK_SUFFIX}`, `${a}/session.jsonl`)
      verify('session.jsonl')
    }
    if (backedV3) {
      runAs('cp', `${a}/session.v3.jsonl${BAK_SUFFIX}`, `${a}/session.v3.jsonl`)
      verify('session.v3.jsonl')
    }
    restored = true
    const ok = problems.length === 0
    if (ok) {
      // 【P-48 纪律③ · 自证】**成功也出声**，且带**触发路径**（否则「兜底跑了」与「没改过」不可分）
      log(`[守护] 会话已还原并校验一致、清理备份（触发路径：${reason}）`)
      runAs('rm', '-f', `${a}/session.jsonl${BAK_SUFFIX}`, `${a}/session.v3.jsonl${BAK_SUFFIX}`)
    } else {
      err(`[守护][FATAL] 还原未通过校验（${problems.join('；')}）—— **备份已保留**供人工恢复：${dir}`)
    }
    return { ok, skipped: false }
  }

  /** 注册全部中止路径兜底（幂等；重复调用无副作用） */
  let installed = false
  const install = () => {
    if (installed) return
    installed = true
    process.on('exit', () => { restore('exit') })
    for (const sig of ['SIGINT', 'SIGTERM']) {
      process.on(sig, () => { restore(sig); process.exit(130) })
    }
    process.on('uncaughtException', (e) => {
      err(`[FATAL] 未捕获异常：${String(e && e.message).slice(0, 300)}`)
      restore('uncaughtException')
      process.exit(1)
    })
    process.on('unhandledRejection', (e) => {
      err(`[FATAL] 未处理的 Promise 拒绝：${String(e && (e.message || e)).slice(0, 300)}`)
      restore('unhandledRejection')
      process.exit(1)
    })
  }

  return {
    install,
    backup,
    restore,
    /** 供被测脚本展示/断言用 */
    state: () => ({ dir, backedMain, backedV3, dirtied, restored }),
  }
}
