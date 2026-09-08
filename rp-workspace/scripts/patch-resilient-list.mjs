// patch-resilient-list.mjs — dsh-session-persistence-jsonl listArtifacts 韧性补丁
// 单个坏身份/重复id会话文件不再崩掉 cordis init（boot-loop 根修）：
// 1) 自愈：重命名到 header 声明的物理路径；2) 兜底：跳过 + 告警。
import { readFileSync, writeFileSync } from 'node:fs'

const FILES = [
  'D:/DSH RolePlay/rp-workspace/dsh-runtime-android/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js',
]
const MARKER = 'DSHT-RESILIENT-LIST'

const ORIG = [
  '\t\t\t\tawait this.assertStoredIdentity(path, meta, void 0, signal);',
  '\t\t\t\tsignal?.throwIfAborted();',
  '\t\t\t\tif (ids.has(meta.id)) throw new Error(`duplicate JSONL session id "${meta.id}" appears in multiple project directories`);',
  '\t\t\t\tids.add(meta.id);',
  '\t\t\t\tartifacts.push({',
  '\t\t\t\t\theader: meta,',
  '\t\t\t\t\tpath',
  '\t\t\t\t});',
].join('\n')

const REPL = [
  '\t\t\t\t/* ' + MARKER + ': 单个坏身份/重复id会话文件不致命——先自愈（重命名到 header 声明的物理路径），',
  '\t\t\t\t   失败则跳过并告警；绝不允许一条坏文件让 cordis init 崩溃 boot-loop 整个 runtime',
  '\t\t\t\t   （实机实证：手机端任务卡死强杀重启后 st-w82dal 身份漂移 → listArtifacts throw → node exit 1 死循环） */',
  '\t\t\t\tlet effectivePath = path;',
  '\t\t\t\ttry {',
  '\t\t\t\t\tawait this.assertStoredIdentity(path, meta, void 0, signal);',
  '\t\t\t\t} catch (identityError) {',
  '\t\t\t\t\tlet healed = false;',
  '\t\t\t\t\ttry {',
  '\t\t\t\t\t\tconst expectedHealPath = logPath(this.root, meta.cwd, meta.id, this.compression);',
  '\t\t\t\t\t\tif (expectedHealPath && expectedHealPath !== path && !(await this.exists(expectedHealPath))) {',
  '\t\t\t\t\t\t\tawait mkdir(dirname(expectedHealPath), { recursive: true });',
  '\t\t\t\t\t\t\tawait rename(path, expectedHealPath);',
  '\t\t\t\t\t\t\teffectivePath = expectedHealPath;',
  '\t\t\t\t\t\t\thealed = true;',
  '\t\t\t\t\t\t\tconsole.warn(`${this.name}: healed session log identity: ${path} -> ${expectedHealPath}`);',
  '\t\t\t\t\t\t}',
  '\t\t\t\t\t} catch {}',
  '\t\t\t\t\tif (!healed) {',
  '\t\t\t\t\t\tconsole.warn(`${this.name}: skipping session log with mismatched identity: ${path}`);',
  '\t\t\t\t\t\tcontinue;',
  '\t\t\t\t\t}',
  '\t\t\t\t}',
  '\t\t\t\tsignal?.throwIfAborted();',
  '\t\t\t\tif (ids.has(meta.id)) {',
  '\t\t\t\t\tconsole.warn(`${this.name}: skipping duplicate session id "${meta.id}" at ${effectivePath}`);',
  '\t\t\t\t\tcontinue;',
  '\t\t\t\t}',
  '\t\t\t\tids.add(meta.id);',
  '\t\t\t\tartifacts.push({',
  '\t\t\t\t\theader: meta,',
  '\t\t\t\t\tpath: effectivePath',
  '\t\t\t\t});',
].join('\n')

for (const f of FILES) {
  let t = readFileSync(f, 'utf8')
  if (t.includes(MARKER)) { console.log('already patched:', f); continue }
  const count = t.split(ORIG).length - 1
  if (count !== 1) { console.error('ANCHOR MISMATCH in', f, 'count =', count); process.exit(1) }
  t = t.replace(ORIG, REPL)
  writeFileSync(f, t)
  console.log('patched:', f)
}
