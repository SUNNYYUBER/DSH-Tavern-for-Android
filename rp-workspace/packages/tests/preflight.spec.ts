/**
 * 壳侧 pre-boot 静态预检（T-67）单测
 * ============================================================================
 * 被守护的东西：官方 `assertStoredIdentity` 强不变量
 *
 *     会话日志物理路径 === join(root, projectKey(header.cwd), encodeSegment(header.id), 文件名)
 *
 * 违反它 ⇒ `dsh-workspace` 在**插件树加载期**抛 `corrupt session log` ⇒ node exit 1 ⇒
 * 无限 crash-loop；而修复器全在插件体内，够不着（L88）。
 *
 * 本文件钉住三件事：
 *  ① **方向**：只按 `header.cwd` 的**字面值**搬目录 —— 绝不在预检里做 realpath 规范化，
 *     否则会造出一个**新的**违反态（心跳 61B 的半修复态就是这么来的，L87）。
 *  ② **失败模式**：目标已存在 / rename 失败 → 隔离（保证 app 一定起得来），**绝不删除**。
 *  ③ **反控**：搬迁失败时目录必须**原封不动**（rename 原子 ⇒ 状态不比此前更坏）；
 *     dryRun 必须真的不动手；DISABLE 开关必须真的能关。
 *  另有 `projectKey`/`encodeSegment` 与**官方实现**的逐输入等价性对质（手抄副本的防漂移闸门）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  expectedSessionDir, hasSessionLog, nodePreflightFs, resolveDshHome, runPreflight,
  shouldRunPreflight, toStatus, type PreflightFs, type PreflightReport,
} from '../src/dsht-preflight/index.ts'
import { encodeSegment, projectKey } from '../src/import/dsh-export.ts'

// ---------------------------------------------------------------------------
// 设备实测的黄金对：`--data-data-com.dshtavern.app-files-.dsh-rp--` 等形态取自真机
// `ls /data/data/com.dshtavern.app/files/.dsh/sessions`（stage3-device/hb61b/cwd-audit.raw）
// ---------------------------------------------------------------------------
const DEV_RP = '/data/data/com.dshtavern.app/files/.dsh/rp'
const DEV_RP_USER0 = '/data/user/0/com.dshtavern.app/files/.dsh/rp'

describe('expectedSessionDir —— 逐字复刻官方 sessionDir', () => {
  it('设备实测黄金对：规范形态与 /data/user/0 形态产出**不同**目录名（这正是缺陷的机理）', () => {
    expect(projectKey(DEV_RP)).toBe('--data-data-com.dshtavern.app-files-.dsh-rp--')
    expect(projectKey(DEV_RP_USER0)).toBe('--data-user-0-com.dshtavern.app-files-.dsh-rp--')
    expect(projectKey(DEV_RP)).not.toBe(projectKey(DEV_RP_USER0))
    expect(expectedSessionDir('/root', DEV_RP, 'session-1'))
      .toBe('/root/--data-data-com.dshtavern.app-files-.dsh-rp--/session-1')
  })

  it('cwd 缺失 ⇒ _no-cwd（官方 projectDir 语义）', () => {
    expect(expectedSessionDir('/r', undefined, 'abc')).toBe('/r/_no-cwd/abc')
  })

  it('会话 id 走 encodeSegment（`.`/`..`/`~` 转义）', () => {
    expect(expectedSessionDir('/r', '/p', 'a~b')).toBe('/r/--p--/a~007Eb')
    expect(expectedSessionDir('/r', undefined, '..')).toBe('/r/_no-cwd/~002E~002E')
  })

  it('判不了的输入返回 null（空 cwd / 空 id）—— 官方编码函数对空串抛错、我方副本没有守卫，故不能依赖抛错', () => {
    expect(expectedSessionDir('/r', '', 'abc')).toBeNull()
    expect(expectedSessionDir('/r', undefined, '')).toBeNull()
    // 反控：非空输入必须给得出路径（证明上面两条 null 不是因为函数整体失效）
    expect(expectedSessionDir('/r', '/p', 'ok')).not.toBeNull()
  })
})

describe('hasSessionLog —— 世代无关的文件名判据', () => {
  it('认所有世代日志，不认 .bak / 其它文件', () => {
    expect(hasSessionLog(['session.jsonl'])).toBe(true)
    expect(hasSessionLog(['session.v3.jsonl'])).toBe(true)
    expect(hasSessionLog(['session.v12.jsonl', 'a.txt'])).toBe(true)
    expect(hasSessionLog(['session.v3.jsonl.bak'])).toBe(false)
    expect(hasSessionLog(['session.jsonl.bak2'])).toBe(false)
    expect(hasSessionLog(['notes.md'])).toBe(false)
    expect(hasSessionLog([])).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 内存假 FS（含故障注入）—— 本项目纪律：防线自身先过正控/负控
// ---------------------------------------------------------------------------
class FakeFs implements PreflightFs {
  readonly dirs = new Set<string>()
  readonly files = new Map<string, string>()
  /** 源路径命中即抛（模拟 rename 失败） */
  renameThrowsFor: ((from: string) => boolean) | null = null
  readonly log: string[] = []

  constructor(root: string) { this.dirs.add(root) }

  addDir(p: string): void { this.dirs.add(p) }
  addFile(p: string, content: string): void {
    this.files.set(p, content)
    this.dirs.add(p.slice(0, p.lastIndexOf('/')))
  }

  async readdir(dir: string): Promise<string[]> {
    const out = new Set<string>()
    const prefix = `${dir}/`
    for (const d of this.dirs) if (d.startsWith(prefix)) out.add(d.slice(prefix.length).split('/')[0]!)
    for (const f of this.files.keys()) if (f.startsWith(prefix)) out.add(f.slice(prefix.length).split('/')[0]!)
    return [...out]
  }
  async readFirstLine(file: string): Promise<string | null> {
    const c = this.files.get(file)
    return c === undefined ? null : (c.split('\n')[0] ?? '')
  }
  async exists(p: string): Promise<boolean> { return this.dirs.has(p) || this.files.has(p) }
  async mkdirp(dir: string): Promise<void> {
    const parts = dir.split('/')
    for (let i = 1; i <= parts.length; i++) this.dirs.add(parts.slice(0, i).join('/') || '/')
  }
  async rename(from: string, to: string): Promise<void> {
    if (this.renameThrowsFor?.(from) === true) throw new Error('EXDEV: cross-device link not permitted')
    const dirMoves: string[] = []
    const fileMoves: string[] = []
    for (const d of this.dirs) if (d === from || d.startsWith(`${from}/`)) dirMoves.push(d)
    for (const f of this.files.keys()) if (f === from || f.startsWith(`${from}/`)) fileMoves.push(f)
    if (dirMoves.length === 0 && fileMoves.length === 0) throw new Error(`ENOENT: rename '${from}'`)
    const payloads = fileMoves.map(f => [f, this.files.get(f)!] as const)
    for (const d of dirMoves) this.dirs.delete(d)
    for (const f of fileMoves) this.files.delete(f)
    for (const d of dirMoves) this.dirs.add(to + d.slice(from.length))
    for (const [f, c] of payloads) this.files.set(to + f.slice(from.length), c)
    this.log.push(`${from} -> ${to}`)
  }
}

const ROOT = '/dsh/sessions'
const headerLine = (fields: Record<string, unknown>): string =>
  `${JSON.stringify({ type: 'session', version: 3, ...fields })}\n{"type":"turn/start","seq":0}\n`

/** 造一棵 `<project>/<sdir>/session.v3.jsonl` 的树。 */
function tree(spec: Array<{ project: string; sdir: string; id: string; cwd?: string; gen?: string }>): FakeFs {
  const fs = new FakeFs(ROOT)
  for (const s of spec) {
    const file = `${ROOT}/${s.project}/${s.sdir}/${s.gen ?? 'session.v3.jsonl'}`
    fs.addFile(file, headerLine({ id: s.id, ...(s.cwd === undefined ? {} : { cwd: s.cwd }) }))
  }
  return fs
}

const outcomes = (r: PreflightReport): string[] => r.entries.map(e => `${e.outcome}:${e.project}/${e.sdir}`)

describe('runPreflight —— 判定与处置', () => {
  it('全部合规 ⇒ 零动作（happy path 不许"顺手优化"）', async () => {
    const cwd = DEV_RP
    const fs = tree([{ project: projectKey(cwd), sdir: 'session-1', id: 'session-1', cwd }])
    const r = await runPreflight({ root: ROOT, fs })
    expect([r.scanned, r.ok, r.repaired, r.quarantined, r.unreadable, r.failed]).toEqual([1, 1, 0, 0, 0, 0])
    expect(r.entries).toEqual([])
  })

  it('🔴 心跳 61B 的 crash-loop 形态（目录已规范化、header 仍是 /data/user/0 形态）⇒ 搬到 header 指定的位置', async () => {
    const fs = tree([{ project: projectKey(DEV_RP), sdir: 'session-16e10fc9', id: 'session-16e10fc9', cwd: DEV_RP_USER0 }])
    const r = await runPreflight({ root: ROOT, fs })
    expect(r.repaired).toBe(1)
    expect(r.ok).toBe(0)
    expect(fs.log).toEqual([`${ROOT}/${projectKey(DEV_RP)}/session-16e10fc9 -> ${ROOT}/${projectKey(DEV_RP_USER0)}/session-16e10fc9`])
    // 搬完必须自洽：再来一遍应判 ok（幂等 + 收敛）
    const r2 = await runPreflight({ root: ROOT, fs })
    expect([r2.ok, r2.repaired, r2.quarantined, r2.failed]).toEqual([1, 0, 0, 0])
  })

  it('⚠️ 方向纪律：目录名与 header 的「非规范」cwd 自洽时必须**不动**（不许自作聪明 realpath 规范化）', async () => {
    // 若预检"顺手"把 cwd 规范化成 /data/data/... 再算目标目录，就会搬出去、而 header 没改
    // ⇒ 造出一个**新的**违反态（正是心跳 61B 半修复态的成因，L87）。正确行为 = 判 ok。
    const fs = tree([{ project: projectKey(DEV_RP_USER0), sdir: 'ch-a1', id: 'ch-a1', cwd: DEV_RP_USER0 }])
    const r = await runPreflight({ root: ROOT, fs })
    expect([r.ok, r.repaired, r.quarantined, r.unreadable, r.failed]).toEqual([1, 0, 0, 0, 0])
    expect(fs.log).toEqual([])
  })

  it('会话 id 编码不符 ⇒ 一并纠正（目标 = projectKey + encodeSegment(id)）', async () => {
    const cwd = DEV_RP
    const fs = tree([{ project: projectKey(cwd), sdir: 'a~b', id: 'a~b', cwd }])
    const r = await runPreflight({ root: ROOT, fs })
    expect(r.repaired).toBe(1)
    expect(fs.log).toEqual([`${ROOT}/${projectKey(cwd)}/a~b -> ${ROOT}/${projectKey(cwd)}/a~007Eb`])
    expect(await fs.exists(`${ROOT}/${projectKey(cwd)}/a~007Eb/session.v3.jsonl`)).toBe(true)
  })

  it('cwd 缺失 ⇒ 目标 _no-cwd（与官方 projectDir 一致）', async () => {
    const fs = tree([{ project: '--wrong--', sdir: 'n1', id: 'n1' }])
    const r = await runPreflight({ root: ROOT, fs })
    expect(r.repaired).toBe(1)
    expect(fs.log).toEqual([`${ROOT}/--wrong--/n1 -> ${ROOT}/_no-cwd/n1`])
  })

  it('头行不可读/非 JSON/非 session header ⇒ unreadable 且**不动**（不猜）', async () => {
    const fs = new FakeFs(ROOT)
    fs.addFile(`${ROOT}/--p--/s-a/session.v3.jsonl`, 'not json at all\n')
    fs.addFile(`${ROOT}/--p--/s-b/session.v3.jsonl`, '{"type":"turn/start","seq":0}\n')
    fs.addFile(`${ROOT}/--p--/s-c/other.txt`, 'x\n')
    const r = await runPreflight({ root: ROOT, fs })
    expect([r.unreadable, r.repaired, r.quarantined, r.failed]).toEqual([2, 0, 0, 0])
    expect(r.scanned).toBe(2) // s-c 无会话日志 ⇒ 不进判定面
    expect(fs.log).toEqual([])
  })

  it('目标目录已存在 ⇒ **隔离**（不合并），且隔离区在 sessions/ 之外', async () => {
    const cwd = DEV_RP_USER0
    const fs = tree([
      { project: projectKey(DEV_RP), sdir: 's-x', id: 's-x', cwd },   // 违规：该去 user0 项目
      { project: projectKey(cwd), sdir: 's-x', id: 's-x', cwd },      // 目标位置已被占
    ])
    const r = await runPreflight({ root: ROOT, fs, now: () => new Date('2026-09-12T00:00:00Z') })
    expect(r.quarantined).toBe(1)
    expect(r.repaired).toBe(0)
    expect(fs.log[0]).toBe(
      `${ROOT}/${projectKey(DEV_RP)}/s-x -> /dsh/sessions-quarantine/2026-09-12T00-00-00-000Z/${projectKey(DEV_RP)}/s-x`,
    )
    const dest = fs.log[0]!.split(' -> ')[1]!
    // 隔离区必须**不在** sessions 根下：放里面会被官方当成 project 目录再枚举一次、再抛同样的错
    expect(dest.startsWith(`${ROOT}/`)).toBe(false)
    expect(dest.startsWith('/dsh/sessions-quarantine/')).toBe(true)
    // 被占目标**原样保留**（证明没有发生覆盖式合并）
    expect(await fs.exists(`${ROOT}/${projectKey(cwd)}/s-x/session.v3.jsonl`)).toBe(true)
  })

  it('rename 失败 + 隔离也失败 ⇒ failed 且目录**原封不动**（L87：状态不比此前更坏）', async () => {
    const cwd = DEV_RP_USER0
    const fs = tree([{ project: projectKey(DEV_RP), sdir: 's-y', id: 's-y', cwd }])
    fs.renameThrowsFor = from => from.includes('/s-y')
    const r = await runPreflight({ root: ROOT, fs })
    expect([r.failed, r.repaired, r.quarantined]).toEqual([1, 0, 0])
    expect(r.entries[0]!.detail).toContain('目录未动')
    expect(await fs.exists(`${ROOT}/${projectKey(DEV_RP)}/s-y/session.v3.jsonl`)).toBe(true)
  })

  it('第一次搬迁失败 ⇒ 退而隔离（目录唯一落点，不留半态）', async () => {
    const cwd = DEV_RP_USER0
    let calls = 0
    const fs = tree([{ project: projectKey(DEV_RP), sdir: 'half', id: 'half', cwd }])
    fs.renameThrowsFor = () => { calls += 1; return calls === 1 }
    const r = await runPreflight({ root: ROOT, fs })
    expect([r.quarantined, r.failed, r.repaired]).toEqual([1, 0, 0])
    expect(await fs.exists(`${ROOT}/${projectKey(DEV_RP)}/half/session.v3.jsonl`)).toBe(false)
    expect(outcomes(r).join()).toContain('quarantined')
  })

  it('dryRun ⇒ 只判定不动手（取证/自查用）', async () => {
    const fs = tree([{ project: projectKey(DEV_RP), sdir: 's-z', id: 's-z', cwd: DEV_RP_USER0 }])
    const r = await runPreflight({ root: ROOT, fs, dryRun: true })
    expect(r.repaired).toBe(1)
    expect(r.entries[0]!.detail).toContain('dry-run')
    expect(fs.log).toEqual([])
    expect(await fs.exists(`${ROOT}/${projectKey(DEV_RP)}/s-z/session.v3.jsonl`)).toBe(true)
  })

  it('非会话目录（无任何世代日志）不进判定面，也不产生噪声', async () => {
    const fs = new FakeFs(ROOT)
    fs.addFile(`${ROOT}/--p--/not-a-session/readme.txt`, 'x\n')
    const r = await runPreflight({ root: ROOT, fs })
    expect([r.scanned, r.unreadable, r.repaired]).toEqual([0, 0, 0])
    expect(r.entries).toEqual([])
  })
})

describe('进程入口闸门', () => {
  it('只在 DSH 主入口支线生效（NODE_OPTIONS 会被子进程继承）', () => {
    expect(shouldRunPreflight(['/node', '/x/node_modules/@deepseek-ai/dsh/lib/bin.js', 'web'], {})).toBe(true)
    expect(shouldRunPreflight(['/node', '/x/lib/ejs-worker.js'], {})).toBe(false)
    expect(shouldRunPreflight(['/node', '-e', '1'], {})).toBe(false)
    expect(shouldRunPreflight(['n', 'C:\\x\\@deepseek-ai\\dsh\\lib\\bin.js'], {})).toBe(true)
  })

  it('DSHT_PREFLIGHT_DISABLE=1 必须真的能关（反控开关：区分"没装"与"装没生效"）', () => {
    const argv = ['/node', '/x/@deepseek-ai/dsh/lib/bin.js']
    expect(shouldRunPreflight(argv, { DSHT_PREFLIGHT_DISABLE: '1' })).toBe(false)
    expect(shouldRunPreflight(argv, { DSHT_PREFLIGHT_DISABLE: '0' })).toBe(true)
  })

  it('DSH home 解析与官方/插件同优先级：$DSH_HOME > ~/.dsh', () => {
    // `$DSH_HOME` 分支走平台的 `resolve`（Android 上即 POSIX），故这里只断言**优先级与形态**，
    // 不钉死绝对前缀 —— 否则这条用例本身会变成"在 Windows 上必红"的假闸门。
    const custom = resolveDshHome({ DSH_HOME: '/custom/home' }, '/home/u')
    expect(custom.replace(/\\/g, '/')).toMatch(/\/custom\/home$/)
    expect(custom).not.toContain('.dsh')
    expect(resolveDshHome({ DSH_HOME: '  ' }, '/home/u')).toBe('/home/u/.dsh')
    expect(resolveDshHome({}, '/home/u')).toBe('/home/u/.dsh')
  })

  it('状态三态分账字段齐全（缺一个都意味着某类结果无处显形）', async () => {
    const fs = tree([{ project: '--p--', sdir: 'a', id: 'a' }])
    const rep = await runPreflight({ root: ROOT, fs })
    const s = toStatus(rep, '2026-09-12T00:00:00.000Z')
    expect(s.ts).toBe('2026-09-12T00:00:00.000Z')
    expect(s.root).toBe(ROOT)
    expect(Object.keys(s).sort()).toEqual(
      ['entries', 'failed', 'ok', 'quarantined', 'repaired', 'root', 'scanned', 'ts', 'unreadable'])
  })
})

// ---------------------------------------------------------------------------
// 真 fs 集成：证明合成 IO 路径（open + 4 KiB 探测、mkdir -p、rename）真的能用
// ---------------------------------------------------------------------------
describe('nodePreflightFs 真 fs 集成', () => {
  it('端到端：临时目录里造一个违规会话 → 搬到 header 指定位置，内容逐字节不变，且幂等', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsht-preflight-'))
    const sessions = join(home, 'sessions')
    const wrongProject = projectKey(DEV_RP)
    const rightProject = projectKey(DEV_RP_USER0)
    const sdir = join(sessions, wrongProject, 'session-e2e')
    await mkdir(sdir, { recursive: true })
    const payload = `${headerLine({ id: 'session-e2e', cwd: DEV_RP_USER0 })}{"type":"turn/end","seq":1}\n`
    await writeFile(join(sdir, 'session.v3.jsonl'), payload, 'utf8')

    const report = await runPreflight({ root: sessions })
    expect([report.scanned, report.ok, report.repaired, report.failed]).toEqual([1, 0, 1, 0])
    const moved = join(sessions, rightProject, 'session-e2e', 'session.v3.jsonl')
    expect(existsSync(moved)).toBe(true)
    expect(existsSync(join(sdir, 'session.v3.jsonl'))).toBe(false)
    expect(readFileSync(moved, 'utf8')).toBe(payload) // 逐字节不变（预检绝不改内容）
    const again = await runPreflight({ root: sessions })
    expect([again.ok, again.repaired]).toEqual([1, 0])
  })

  it('4 KiB 探测：头行超长时截断，不把整个大文件读进内存', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsht-preflight-big-'))
    const p = join(home, 'big.jsonl')
    await writeFile(p, `${'x'.repeat(10000)}\n`, 'utf8')
    const line = await nodePreflightFs.readFirstLine(p)
    expect(line).not.toBeNull()
    expect(line!.length).toBe(4096)
  })
})

// ---------------------------------------------------------------------------
// 防漂移：`import/dsh-export.ts` 里的 projectKey/encodeSegment 是**官方实现的手抄副本**
// ⇒ 逐输入对质（L44「枚举器必须先过正控」；L61「同一语义多份副本」）
// ---------------------------------------------------------------------------
const OFFICIAL_JSONL = fileURLToPath(new URL(
  '../../dsh-runtime-android/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js',
  import.meta.url,
))

/** 从官方打包产物里抠出一个顶层 function 声明并求值（官方只 `export default`，无法直接 import）。 */
function extractFn(source: string, name: string): ((arg: string) => string) | null {
  const sig = new RegExp(`function ${name}\\(([^)]*)\\)`).exec(source)
  if (sig === null) return null
  const start = source.indexOf(`function ${name}(`)
  let depth = 0
  let i = source.indexOf('{', start)
  const from = i
  for (; i < source.length; i++) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') { depth -= 1; if (depth === 0) { i += 1; break } }
  }
  // 形参名必须沿用原文（官方是 `cwd` / `raw`），否则函数体内引用的是未定义标识符 —— 
  // 这本身是个反面教材：先过正控才发现的（L44）。
  return new Function(`return function ${name}(${sig[1]!})${source.slice(from, i)}`)() as (arg: string) => string
}

let officialSource: string | null = null
try {
  officialSource = readFileSync(OFFICIAL_JSONL, 'utf8')
} catch {
  officialSource = null
  // 不静默：明确告知这条闸门本轮没跑，避免被当成绿的（L42「有意跳过 ≠ 可以静默」）
  console.warn(`[preflight.spec] 官方包不在 staging（${OFFICIAL_JSONL}）→ 等价性对质本轮跳过`)
}
const noOfficial = officialSource === null

const PROJECT_KEY_CORPUS = [
  DEV_RP, DEV_RP_USER0, '/', '//', 'C:\\work\\demo', 'rp/_start', 'a/b:c',
  '/data/data/com.dshtavern.app/files/.dsh/rp-import/_adapter',
  'x~y', 'plain-ID_1.2', '/a//b/', 'Z:/deep/nest/', 'ends/', '/double//slash',
]
const SEGMENT_CORPUS = ['a~b', 'a/b', '..', '.', 'plain-ID_1.2', '路径/中文', 'a b', '~', 'C:']
const diffWith = (impl: (s: string) => string, official: (s: string) => string, corpus: string[]): unknown[] =>
  corpus.filter(s => {
    let a: string, b: string
    try { a = impl(s) } catch (e) { a = `throw:${(e as Error).message}` }
    try { b = official(s) } catch (e) { b = `throw:${(e as Error).message}` }
    return a !== b
  })

describe('projectKey / encodeSegment 与官方实现逐输入等价（防手抄漂移）', () => {
  it.skipIf(noOfficial)('projectKey 逐输入一致', () => {
    const official = extractFn(officialSource!, 'projectKey')
    expect(official).not.toBeNull()
    expect(diffWith(projectKey, official!, PROJECT_KEY_CORPUS)).toEqual([])
  })

  it.skipIf(noOfficial)('encodeSegment 逐输入一致', () => {
    const official = extractFn(officialSource!, 'encodeSegment')
    expect(official).not.toBeNull()
    expect(diffWith(encodeSegment, official!, SEGMENT_CORPUS)).toEqual([])
  })

  it('已知差异（有意登记）：空串 —— 官方抛错，我方副本返回 ""/--root--', () => {
    if (!noOfficial) {
      const official = extractFn(officialSource!, 'projectKey')!
      expect(() => official('')).toThrow(/empty project path/)
      expect(() => extractFn(officialSource!, 'encodeSegment')!('')).toThrow(/empty path segment/)
    }
    expect(projectKey('')).toBe('--root--')             // 我方副本的既有行为（不改，避免波及其它调用方）
    expect(encodeSegment('')).toBe('')
    expect(expectedSessionDir('/r', '', 'x')).toBeNull() // 预检层不依赖抛错，显式判 null
    expect(expectedSessionDir('/r', '/p', '')).toBeNull()
  })
})
