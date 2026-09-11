/**
 * dsht-preflight —— 壳侧 pre-boot 静态预检（T-67；心跳 62 落地）
 * ============================================================================
 * ## 它解决什么问题（L88：修复器的**位置**决定它能否救场）
 *
 * 官方不变量（`dsh-session-persistence-jsonl/lib/index.js:3220` `assertStoredIdentity`）：
 *
 *     会话日志的物理路径 === join(root, projectKey(header.cwd), encodeSegment(header.id), 文件名)
 *
 * 违反它时，`dsh-workspace` 在 **`[cordis.init]` 插件树加载期**（`listStoredHeaders` →
 * `listArtifacts` → `readGenerationHeader` → `assertStoredIdentity`）抛
 * `corrupt session log`，于是 `plugin tree failed to load` → `node exited with code 1`
 * → NodeService 的 watchdog 每 3 秒重启一次 → **无限 crash-loop，整机不可用**。
 *
 * 我方所有会话修复器都住在**插件体内**（`dsh-plugin/index.ts` 的启动即修）——
 * 插件树都加载失败了，它们根本没有机会执行。⇒ 存量损坏**不可自愈**。
 *
 * 本模块由 `NodeService.kt` 通过 `NODE_OPTIONS=--import <本文件>` 在 DSH 主入口
 * (`@deepseek-ai/dsh/lib/bin.js`) **之前**执行，只有一件事：
 * **把违反不变量的会话目录搬回它该在的位置**，让插件树能加载起来。
 *
 * ## 三条纪律（每条都对应一条已付代价的教训）
 *
 * 1. **不可逆动作最后做**（L87「半修复态比不修复更危险」）：本模块**只做一次
 *    `rename`**，全程**不写任何文件内容** —— 头行解析失败就什么都不做。
 *    绝不复刻 `repairSessionCwds` 的「改 cwd + 搬目录」两步写路径（那正是心跳 61B
 *    crash-loop 的成因：目录搬走了、header 没改）。header 的规范化仍由插件体内那个
 *    带 `.bak` + 原子写的修复器负责；两者方向一致，**两步收敛**（先满足不变量让 app 起得来，
 *    再由插件把 cwd 规范化并二次搬迁）。
 * 2. **绝不删除**（L68）：目标位置已存在时**隔离**（`mv` 到 `<dshHome>/sessions-quarantine/`），
 *    隔离区在 `sessions/` **之外** —— 放在里面会被当成 project 目录再枚举一遍、再抛一次同样的错。
 * 3. **fail-open**：预检自身的任何异常都不许拦住启动。一个"防守代码比被守护的东西更危险"的
 *    闸门（L69 家族）比没有闸门更糟。
 *
 * ## 为什么用 `header.cwd` 的**字面值**算目标路径（不做 realpath）
 *
 * 官方判据是 `path === generationLogPath(root, header.cwd, ...)` —— 用的是**头行里的字面 cwd**。
 * 若这里自行 realpath 规范化（`/data/user/0/<pkg>` → `/data/data/<pkg>`）得出目标目录，
 * 而 header 仍是旧形态，就会造出一个**新的**违反态（目录名 ≠ projectKey(header.cwd)）。
 * ⇒ 只按字面值搬，绝不"顺手"规范化。
 */
import { appendFileSync, writeFileSync } from 'node:fs'
import { mkdir, open, readdir, rename, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
// ⚠️ 一律用 **posix** 路径语义，不用平台默认的 `node:path`。
// 理由两条：① 本模块**只在 Android 上运行**（由 NodeService 通过 NODE_OPTIONS 预加载），
// 设备上的会话树恒为 POSIX 路径；② 官方 `dsh-session-persistence-jsonl` 在 Android 上
// 也是 `node:path`（= POSIX），故 posix 与基准**逐字节一致**。
// 若用平台默认实现，同一段代码在 Windows 开发机上会产出 `\` 分隔的路径 —— 单测与设备行为
// 分叉，而"验证读侧 ≠ 运行时读侧"正是本项目反复付出代价的形态。
import { posix } from 'node:path'
// `resolve` 单独取**平台实现**：它只用于把 `$DSH_HOME` 规范成绝对路径（平台相关的一件事），
// 其余拼接/取名一律 posix（设备语义）。反例：若这里也用 posix.resolve，Windows 上
// `posix.resolve('C:/x')` 会得到 `/C:/x` —— 一个不存在的路径，于是"预检什么都没扫到"。
import { resolve } from 'node:path'

const { basename, dirname, join } = posix
import { encodeSegment, projectKey } from '../import/dsh-export.ts'
import { pickCurrentSessionFilename } from '../dsht-plugin-shared/session-surgery.ts'

/** 头行是**单行 JSON**，只探前 4 KiB —— 绝不为了读身份把 200MB 会话拉进内存。 */
export const HEADER_PROBE_BYTES = 4096

/** 隔离区目录名（在 `sessions/` 之外：放里面会被官方当成 project 目录重复枚举）。 */
export const QUARANTINE_DIRNAME = 'sessions-quarantine'

/** 当前世代日志文件名判据（与官方 `parseGenerationLogFilename` 的「非压缩」形态一致）。 */
const SESSION_LOG_RE = /^session(?:\.v\d+)?\.jsonl$/

export interface PreflightFs {
  readdir(dir: string): Promise<string[]>
  readFirstLine(file: string, maxBytes?: number): Promise<string | null>
  exists(path: string): Promise<boolean>
  mkdirp(dir: string): Promise<void>
  rename(from: string, to: string): Promise<void>
}

/** 真实 node 实现；单测注入假实现（含故障注入）。 */
export const nodePreflightFs: PreflightFs = {
  async readdir(dir) {
    try { return await readdir(dir) } catch { return [] }
  },
  async readFirstLine(file, maxBytes = HEADER_PROBE_BYTES) {
    let fh: Awaited<ReturnType<typeof open>> | null = null
    try {
      fh = await open(file, 'r')
      const buf = Buffer.alloc(maxBytes)
      const { bytesRead } = await fh.read(buf, 0, maxBytes, 0)
      const line = buf.subarray(0, bytesRead).toString('utf8').split('\n')[0] ?? ''
      return line.length > 0 ? line : null
    } catch {
      return null
    } finally {
      if (fh !== null) await fh.close().catch(() => undefined)
    }
  },
  async exists(path) {
    try { await stat(path); return true } catch { return false }
  },
  async mkdirp(dir) {
    await mkdir(dir, { recursive: true })
  },
  async rename(from, to) {
    await rename(from, to)
  },
}

export type PreflightOutcome = 'ok' | 'repaired' | 'quarantined' | 'unreadable' | 'failed'

export interface PreflightEntry {
  project: string
  sdir: string
  sessionId?: string
  headerCwd?: string
  expectedProject?: string
  outcome: Exclude<PreflightOutcome, 'ok'>
  detail: string
}

export interface PreflightReport {
  root: string
  /** 探测到的会话目录总数（含 ok） */
  scanned: number
  ok: number
  repaired: number
  quarantined: number
  /** 有会话日志但头行读不出/解析不出/无法定位 → **不动**（不猜） */
  unreadable: number
  failed: number
  /** 只含非 ok 项（ok 不逐条记录，避免 80+ 行噪声） */
  entries: PreflightEntry[]
}

/**
 * 一个会话目录**该在**的位置（纯函数，逐字复刻官方 `sessionDir`）。
 *
 * `cwd === undefined` ⇒ `_no-cwd`（官方 `projectDir` 语义：
 * `dsh-session-persistence-jsonl/lib/index.js` `function projectDir(root, cwd)`）。
 * 判不了 ⇒ 返回 `null`（**判不了就不动**，绝不猜）。两条判不了的输入：
 *  - `cwd === ''` / `id === ''`：官方两个编码函数对空串**抛错**（`cannot encode an empty
 *    path segment` / `cannot encode an empty project path`），但我方 `import/dsh-export.ts`
 *    的副本没有这两个守卫（返回 `''` / `--root--`）⇒ **不能依赖抛错**，必须在此显式拒绝。
 *  - 含非法码元导致编码抛错。
 */
export function expectedSessionDir(root: string, cwd: string | undefined, id: string): string | null {
  if (id === '') return null
  if (cwd !== undefined && cwd === '') return null
  try {
    const project = cwd === undefined ? '_no-cwd' : projectKey(cwd)
    return join(root, project, encodeSegment(id))
  } catch {
    return null
  }
}

/** 目录里是否存在**任意一代**会话日志（没有 ⇒ 它根本不是会话目录，不进判定面）。 */
export function hasSessionLog(entries: readonly string[]): boolean {
  return entries.some(name => SESSION_LOG_RE.test(name))
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * 扫描 `<root>/<project>/<sdir>/` 并对违反不变量的会话目录做**一次搬迁**。
 *
 * 纯 IO 编排 + 可注入 fs ⇒ 可单测、可故障注入（本项目的「枚举器/防线先过正控」纪律）。
 */
export async function runPreflight(opts: {
  root: string
  fs?: PreflightFs
  /** 不传则由 `now()` 生成；隔离目标 = `<quarantineRoot>/<project>/<sdir>` */
  quarantineRoot?: string
  now?: () => Date
  /** 只判定不动手（自查/取证用）。dryRun 下计为 repaired 但**不执行** rename。 */
  dryRun?: boolean
}): Promise<PreflightReport> {
  const fs = opts.fs ?? nodePreflightFs
  const dryRun = opts.dryRun === true
  const now = opts.now ?? (() => new Date())
  const stamp = now().toISOString().replace(/[:.]/g, '-')
  const quarantineRoot = opts.quarantineRoot ?? join(dirname(opts.root), QUARANTINE_DIRNAME, stamp)
  const report: PreflightReport = {
    root: opts.root, scanned: 0, ok: 0, repaired: 0, quarantined: 0, unreadable: 0, failed: 0, entries: [],
  }
  const push = (entry: PreflightEntry): void => { report.entries.push(entry) }

  const quarantine = async (project: string, sdir: string, sdirAbs: string, why: string): Promise<void> => {
    const dest = join(quarantineRoot, project, sdir)
    await fs.mkdirp(dirname(dest))
    await fs.rename(sdirAbs, dest)
    report.quarantined += 1
    push({ project, sdir, outcome: 'quarantined', detail: `${why} → 隔离到 ${dest}` })
  }

  const projects = await fs.readdir(opts.root)
  for (const project of projects) {
    const projectAbs = join(opts.root, project)
    const sdirs = await fs.readdir(projectAbs)
    for (const sdir of sdirs) {
      const sdirAbs = join(projectAbs, sdir)
      // 用「能否读出条目」区分目录与散落文件；非目录不进判定面（官方只枚举目录）。
      const inner = await fs.readdir(sdirAbs)
      if (inner.length === 0 && !await fs.exists(sdirAbs)) continue
      if (!hasSessionLog(inner)) continue
      report.scanned += 1

      const file = join(sdirAbs, pickCurrentSessionFilename(inner))
      const firstLine = await fs.readFirstLine(file)
      if (firstLine === null) {
        report.unreadable += 1
        push({ project, sdir, outcome: 'unreadable', detail: `头行不可读（${basename(file)}）；不动` })
        continue
      }
      let header: { type?: unknown; id?: unknown; cwd?: unknown }
      try {
        header = JSON.parse(firstLine) as { type?: unknown; id?: unknown; cwd?: unknown }
      } catch {
        report.unreadable += 1
        push({ project, sdir, outcome: 'unreadable', detail: '头行非 JSON；不动' })
        continue
      }
      if (header === null || typeof header !== 'object' || header.type !== 'session' || typeof header.id !== 'string') {
        report.unreadable += 1
        push({ project, sdir, outcome: 'unreadable', detail: '头行不是 session header（缺 type/id）；不动' })
        continue
      }
      const cwd = typeof header.cwd === 'string' ? header.cwd : undefined
      const expectedDir = expectedSessionDir(opts.root, cwd, header.id)
      if (expectedDir === null) {
        report.unreadable += 1
        push({ project, sdir, sessionId: header.id, headerCwd: cwd, outcome: 'unreadable', detail: 'cwd 为空或无法编码；不动' })
        continue
      }
      // 官方 `sameFile`（realpath 比对）容忍大小写别名；此处以大小写不敏感等价作为同一判据，
      // 避免在大小写不敏感的文件系统上把「同一个文件」误判成违规而搬走。
      const sameIgnoreCase = resolve(expectedDir).toLowerCase() === resolve(sdirAbs).toLowerCase()
      if (resolve(expectedDir) === resolve(sdirAbs) || sameIgnoreCase) {
        report.ok += 1
        continue
      }

      const expectedProject = basename(dirname(expectedDir))
      const entry: PreflightEntry = {
        project, sdir, sessionId: header.id, headerCwd: cwd, expectedProject, outcome: 'repaired',
        detail: `目录身份不符 → ${expectedProject}/${basename(expectedDir)}`,
      }
      if (dryRun) {
        report.repaired += 1
        push({ ...entry, detail: `${entry.detail}（dry-run，未动）` })
        continue
      }
      try {
        if (await fs.exists(expectedDir)) {
          // 目标已存在 ⇒ **不合并**（合并 = 两份会话互相覆盖，不可逆）。隔离保证 boot。
          await quarantine(project, sdir, sdirAbs, `目标目录已存在（${expectedProject}/${basename(expectedDir)}）`)
          continue
        }
        await fs.mkdirp(dirname(expectedDir))
        await fs.rename(sdirAbs, expectedDir)
        report.repaired += 1
        push(entry)
      } catch (e) {
        // rename 失败时对象**未被改动**（rename 是原子的）⇒ 状态不比此前更坏（L87）。
        // 退而求其次隔离，保证 app 一定起得来。
        try {
          await quarantine(project, sdir, sdirAbs, `搬迁失败（${messageOf(e)}）`)
        } catch (e2) {
          report.failed += 1
          push({ ...entry, outcome: 'failed', detail: `搬迁失败：${messageOf(e)}；隔离亦失败：${messageOf(e2)}；目录未动` })
        }
      }
    }
  }
  return report
}

// ---------------------------------------------------------------------------
// 进程入口（`NODE_OPTIONS=--import`）
// ---------------------------------------------------------------------------

const TAG = '[dsht-preflight]'

/** DSH home 解析，与官方 `resolveDshHome` / 我方插件同优先级：`$DSH_HOME` > `~/.dsh`。 */
export function resolveDshHome(env: NodeJS.ProcessEnv = process.env, homeDir?: string): string {
  const envHome = env.DSH_HOME?.trim()
  if (envHome !== undefined && envHome !== '') return resolve(envHome)
  return join(homeDir ?? homedir(), '.dsh')
}

/**
 * 是否该在本进程里跑预检。
 *
 * `NODE_OPTIONS` 会被**子进程继承**（插件 fork 出的 node 也会带上 `--import`），故必须设闸：
 * 只在 DSH 主入口 `@deepseek-ai/dsh/lib/bin.js` 这一支生效。
 * `DSHT_PREFLIGHT_DISABLE=1` = 应急/反控开关（**故意保留**：在没有它的情况下，
 * 「不装预检」与「预检没生效」无法区分 —— L42「有意跳过 ≠ 可以静默」）。
 */
export function shouldRunPreflight(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.DSHT_PREFLIGHT_DISABLE === '1') return false
  const entry = (argv[1] ?? '').replace(/\\/g, '/')
  return entry.endsWith('/@deepseek-ai/dsh/lib/bin.js')
}

/** 供外部（`/rp/*` 自查路由、设备探针）复用的状态读取面。 */
export interface PreflightStatus {
  ts: string
  root: string
  scanned: number
  ok: number
  repaired: number
  quarantined: number
  unreadable: number
  failed: number
  entries: PreflightEntry[]
}

export function toStatus(report: PreflightReport, ts: string, maxEntries = 50): PreflightStatus {
  return {
    ts,
    root: report.root,
    scanned: report.scanned,
    ok: report.ok,
    repaired: report.repaired,
    quarantined: report.quarantined,
    unreadable: report.unreadable,
    failed: report.failed,
    entries: report.entries.slice(0, maxEntries),
  }
}

/**
 * 始终写一份**覆盖式**状态文件（小、定长）—— 让「没做 / 做成了 / 失败了」三态都留痕，
 * 且在 app 起不来时也能从设备上直接读到（不依赖任何插件）。
 * 追加式日志只在**真的动了手或有 unreadable/failed** 时写，避免每次冷启都涨一行。
 */
function persist(dshHome: string, status: PreflightStatus, noisy: boolean, lines: string[]): void {
  try {
    writeFileSync(join(dshHome, 'dsht-preflight-status.json'), `${JSON.stringify(status, null, 2)}\n`)
  } catch { /* .dsh 尚未创建（首启）等 —— 状态文件是尽力而为，不是启动前提 */ }
  if (!noisy) return
  for (const line of lines) console.log(`${TAG} ${line}`)
  try {
    appendFileSync(join(dshHome, 'dsht-preflight.log'), `${status.ts} ${lines.join(' | ')}\n`)
  } catch { /* 同上 */ }
}

/**
 * 预检入口。**顶层 await**（本模块由 `--import` 预加载，node 会等它求值完成再跑主入口，
 * 否则会出现「预检还在搬目录、插件树已经开始枚举」的竞态）。
 */
export async function main(): Promise<void> {
  try {
    if (!shouldRunPreflight(process.argv)) return
    const dshHome = resolveDshHome()
    const root = join(dshHome, 'sessions')
    const report = await runPreflight({ root })
    const ts = new Date().toISOString()
    const status = toStatus(report, ts)
    const acted = report.repaired + report.quarantined + report.failed
    const lines: string[] = acted > 0 || report.unreadable > 0
      ? [
          `扫描 ${report.scanned} 个会话目录：ok=${report.ok} 搬迁=${report.repaired} 隔离=${report.quarantined} 不可读=${report.unreadable} 失败=${report.failed}`,
          ...report.entries.map(e => `${e.outcome} ${e.project}/${e.sdir}${e.sessionId === undefined ? '' : ` (${e.sessionId})`}: ${e.detail}`),
        ]
      : []
    persist(dshHome, status, lines.length > 0, lines)
  } catch (e) {
    // fail-open：预检异常绝不许拦住启动（本条日志本身也再包一层 try）。
    try { console.error(`${TAG} 预检异常（已忽略，不影响启动）：${messageOf(e)}`) } catch { /* ignore */ }
  }
}

await main()
