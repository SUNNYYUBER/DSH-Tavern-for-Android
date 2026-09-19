// patch-resilient-list.mjs — dsh-session-persistence-jsonl listArtifacts 韧性补丁
// 单个坏身份/重复id会话文件不再崩掉 cordis init（boot-loop 根修）：
// 1) 自愈：重命名到 header 声明的物理路径；2) 兜底：跳过 + 告警。幂等：带标记跳过。
//
// ============================================================================
// 【2026-09-16 W24c · P-27 形态：同一条补丁要覆盖两代产物】
//
// 症状（本轮实测）：装 dsh 0.1.5 世代后本脚本报
//     ANCHOR MISMATCH ... count = 0
// ⇒ `throw "resilient-list 补丁失败"` ⇒ **整个构建中止**。
//
// 真因（读产物逐行确认，不是猜）：官方在 0.1.5 里**重构了 `listArtifacts`**：
//   · 0.1.2 世代（旧锚点）—— 循环体内**自己**调 `assertStoredIdentity(path, meta, …)`：
//         await this.assertStoredIdentity(path, meta, void 0, signal);
//         signal?.throwIfAborted();
//         if (ids.has(meta.id)) throw new Error(`duplicate JSONL session id "..." ...`);
//         ids.add(meta.id);
//         artifacts.push({ header: meta, path });
//   · 0.1.5 世代（新形态）—— identity 检查**搬进了 `readGenerationHeader`**，
//     循环体变成 try/catch 包裹的读取：
//         let header;
//         try {
//             header = await this.readGenerationHeader(selected, void 0, signal);
//         } catch (error) {
//             if (error instanceof SessionFormatUnsupportedError) continue;
//             throw error;                       // ← 身份不符仍会抛出去 ⇒ 仍会崩 boot
//         }
//         if (header === void 0) continue;
//         if (ids.has(header.id)) throw new Error(`duplicate JSONL session id "..." ...`);
//         ids.add(header.id);
//         artifacts.push({ header, path: selected.sourcePath });
//   · 变量名也从 `meta` 改成了 `header`，路径从裸 `path` 改成 `selected.sourcePath`。
//
// ⇒ 修法（本文件）：**按代次依次尝试两套锚点**，命中即替换；**两套都不中则 fail-closed**
//   并打印实际内容片段（不许静默通过 —— 那样下次官方再改形态就没人知道补丁没打上）。
//
// 自愈语义在新代次下的取舍（诚实记录）：
//   旧代次能在 catch 里拿到 `meta`（已解析的 header）；新代次抛错时 `header` 尚未赋值，
//   故本补丁在 catch 里**重新读首行**解析出 `cwd`/`id` 来算目标路径。
//   自愈成功后**本次不再把该条加入 artifacts**（跳过），而是让**下一次 boot** 自然读到
//   已归位的文件 —— 这样避免「改完路径还要重试读 header」这条更复杂、风险更高的路径。
//   若自愈不成功（或重读失败）⇒ 跳过 + 告警（原兜底语义不变）。
//
// 【为什么不引入 SessionId brand】旧代次传的是 `meta.id`（已是 branded 值），
//   新代次里我们在 catch 中从原始 JSON 取 `String(raw.id)`。实测 `logPath` 只把它
//   当字符串拼接用，故不强求 brand；不引入 `SessionId` 可避免「该符号在当前作用域
//   是否存在」这一额外假设（若不存在会被空 catch 吞掉 ⇒ 自愈静默失效）。
// ============================================================================
import { readFileSync, writeFileSync } from 'node:fs'

const FILES = [
  'D:/DSH RolePlay/rp-workspace/dsh-runtime-android/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js',
]
const MARKER = 'DSHT-RESILIENT-LIST'

// ============================================================================
// 【2026-09-16 W26 · P-41 第四例】幂等判据从「marker 子串存在」改锚到「主体语义已生效」
//
// ## 症状（决定性实验 `tmp/w26-probe-resilient-idem.mjs` 实测，非推测）
// 夹具里预置一行 `/* DSHT-RESILIENT-LIST-IMPORT: rename 用于身份自愈 */`（其余逐字不变）
// ⇒ 主体锚点**原样保留**、脚本 exit 0、输出 `补 import rename: …`（看起来成功）
// ⇒ **主体补丁静默丢失**：下一次官方再改形态不会有人发现，boot-loop 会复发。
// 杠杆（同夹具删掉那一行注释）⇒ 立刻回到 `patched: …（命中代次：dsh 0.1.5 …）`
// ⇒ 差异只来自那行注释 ⇒ 根因锁定。
//
// ## 根因
// `MARKER = 'DSHT-RESILIENT-LIST'` 是 `IMPORT_MARK = 'DSHT-RESILIENT-LIST-IMPORT'` 的
// **真前缀**，而判据是 `t.includes(MARKER)`。于是「另一个标记存在」被读成「主体已打」
// ⇒ **代理量与事实脱钩**（P-41 家族：marker / 版本号 / 包名都是代理量）。
//
// ## 修法（按 P-41：追问「真正决定结果的那个事实是什么」，把判据改锚到它）
// 真正的事实是：**`listArtifacts` 的循环体已经是韧性形态**（自愈 + 跳过告警）。
// 用两代 REPL 共有的语义片段判定 —— 它不依赖 marker 字面量，也不受别的步骤改写影响。
// 根因侧同时**把 import 标记改名**（`DSHT-RESILIENT-IMPORT`，不再与主体 marker 互为前缀），
// 使「子串误判」这条通道本身消失；并由常驻判据四（`audit-build-path-parity.py`）
// 守住「任意两个 marker 不得互为子串」。
//
// ## 诚实边界：历史产物里可能残留旧名
// 改名前打过的 runtime 产物，其 import 行注释里仍是旧名；`ensureRenameImport` 在
// `rename` 已 import 时不重写该行 ⇒ 旧名会残留到**下一次完整构建**（ps1 的
// `pnpm install` 重建 node_modules 后由新名覆盖）。
// 这不影响幂等（判据已改锚到语义），也**不影响判据四**（它扫脚本源码、不扫产物）；
// 但若在产物里 grep 到旧名，那是**改名前的遗留**，不是第二种形态。
// ============================================================================
/** 主体补丁的语义特征（两代 REPL 共有；用于幂等判定，**不看 marker**） */
function bodyApplied (t) {
  return t.includes('healed session log identity') &&
         t.includes('skipping session log with mismatched identity')
}

const T = '\t'

// ---- 旧代次（dsh 0.1.2）锚点 ----
const ORIG_012 = [
  `${T}${T}${T}${T}await this.assertStoredIdentity(path, meta, void 0, signal);`,
  `${T}${T}${T}${T}signal?.throwIfAborted();`,
  `${T}${T}${T}${T}if (ids.has(meta.id)) throw new Error(\`duplicate JSONL session id "\${meta.id}" appears in multiple project directories\`);`,
  `${T}${T}${T}${T}ids.add(meta.id);`,
  `${T}${T}${T}${T}artifacts.push({`,
  `${T}${T}${T}${T}${T}header: meta,`,
  `${T}${T}${T}${T}${T}path`,
  `${T}${T}${T}${T}});`,
].join('\n')

const REPL_012 = [
  `${T}${T}${T}${T}/* ${MARKER}: 单个坏身份/重复id会话文件不致命——先自愈（重命名到 header 声明的物理路径），`,
  `${T}${T}${T}${T}   失败则跳过并告警；绝不允许一条坏文件让 cordis init 崩溃 boot-loop 整个 runtime`,
  `${T}${T}${T}${T}   （实机实证：手机端任务卡死强杀重启后 st-w82dal 身份漂移 → listArtifacts throw → node exit 1 死循环） */`,
  `${T}${T}${T}${T}let effectivePath = path;`,
  `${T}${T}${T}${T}try {`,
  `${T}${T}${T}${T}${T}await this.assertStoredIdentity(path, meta, void 0, signal);`,
  `${T}${T}${T}${T}} catch (identityError) {`,
  `${T}${T}${T}${T}${T}let healed = false;`,
  `${T}${T}${T}${T}${T}try {`,
  `${T}${T}${T}${T}${T}${T}const expectedHealPath = logPath(this.root, meta.cwd, meta.id, this.compression);`,
  `${T}${T}${T}${T}${T}${T}if (expectedHealPath && expectedHealPath !== path && !(await this.exists(expectedHealPath))) {`,
  `${T}${T}${T}${T}${T}${T}${T}await mkdir(dirname(expectedHealPath), { recursive: true });`,
  `${T}${T}${T}${T}${T}${T}${T}await rename(path, expectedHealPath);`,
  `${T}${T}${T}${T}${T}${T}${T}effectivePath = expectedHealPath;`,
  `${T}${T}${T}${T}${T}${T}${T}healed = true;`,
  `${T}${T}${T}${T}${T}${T}${T}console.warn(\`\${this.name}: healed session log identity: \${path} -> \${expectedHealPath}\`);`,
  `${T}${T}${T}${T}${T}${T}}`,
  `${T}${T}${T}${T}${T}} catch {}`,
  `${T}${T}${T}${T}${T}if (!healed) {`,
  `${T}${T}${T}${T}${T}${T}console.warn(\`\${this.name}: skipping session log with mismatched identity: \${path}\`);`,
  `${T}${T}${T}${T}${T}${T}continue;`,
  `${T}${T}${T}${T}${T}}`,
  `${T}${T}${T}${T}}`,
  `${T}${T}${T}${T}signal?.throwIfAborted();`,
  `${T}${T}${T}${T}if (ids.has(meta.id)) {`,
  `${T}${T}${T}${T}${T}console.warn(\`\${this.name}: skipping duplicate session id "\${meta.id}" at \${effectivePath}\`);`,
  `${T}${T}${T}${T}${T}continue;`,
  `${T}${T}${T}${T}}`,
  `${T}${T}${T}${T}ids.add(meta.id);`,
  `${T}${T}${T}${T}artifacts.push({`,
  `${T}${T}${T}${T}${T}header: meta,`,
  `${T}${T}${T}${T}${T}path: effectivePath`,
  `${T}${T}${T}${T}});`,
].join('\n')

// ---- 新代次（dsh 0.1.5）锚点 ----
const ORIG_015 = [
  `${T}${T}${T}${T}let header;`,
  `${T}${T}${T}${T}try {`,
  `${T}${T}${T}${T}${T}header = await this.readGenerationHeader(selected, void 0, signal);`,
  `${T}${T}${T}${T}} catch (error) {`,
  `${T}${T}${T}${T}${T}if (error instanceof SessionFormatUnsupportedError) continue;`,
  `${T}${T}${T}${T}${T}throw error;`,
  `${T}${T}${T}${T}}`,
  `${T}${T}${T}${T}if (header === void 0) continue;`,
  `${T}${T}${T}${T}if (ids.has(header.id)) throw new Error(\`duplicate JSONL session id "\${header.id}" appears in multiple project directories\`);`,
  `${T}${T}${T}${T}ids.add(header.id);`,
  `${T}${T}${T}${T}artifacts.push({`,
  `${T}${T}${T}${T}${T}header,`,
  `${T}${T}${T}${T}${T}path: selected.sourcePath`,
  `${T}${T}${T}${T}});`,
].join('\n')

const REPL_015 = [
  `${T}${T}${T}${T}let header;`,
  `${T}${T}${T}${T}let effectivePath = selected.sourcePath;`,
  `${T}${T}${T}${T}try {`,
  `${T}${T}${T}${T}${T}header = await this.readGenerationHeader(selected, void 0, signal);`,
  `${T}${T}${T}${T}} catch (error) {`,
  `${T}${T}${T}${T}${T}if (error instanceof SessionFormatUnsupportedError) continue;`,
  `${T}${T}${T}${T}${T}/* ${MARKER}: 单条坏身份会话文件不致命——先尽力自愈（重命名到 header 声明的物理路径），`,
  `${T}${T}${T}${T}${T}   失败则跳过并告警；绝不允许一条坏文件让 cordis init 崩溃 boot-loop 整个 runtime`,
  `${T}${T}${T}${T}${T}   （实机实证：手机端任务卡死强杀重启后 st-w82dal 身份漂移 → listArtifacts throw → node exit 1 死循环）`,
  `${T}${T}${T}${T}${T}   注：0.1.5 起 identity 检查在 readGenerationHeader 内，抛错时 header 尚未赋值`,
  `${T}${T}${T}${T}${T}   ⇒ 这里重读首行取 cwd/id 来算目标路径；自愈成功后本次跳过，下次 boot 自然读到已归位文件 */`,
  `${T}${T}${T}${T}${T}let healed = false;`,
  `${T}${T}${T}${T}${T}try {`,
  `${T}${T}${T}${T}${T}${T}const firstLine = this.compression === "zstd" ? await this.readFirstZstdLine(effectivePath, signal) : await this.readFirstLine(effectivePath, signal);`,
  `${T}${T}${T}${T}${T}${T}if (firstLine !== void 0) {`,
  `${T}${T}${T}${T}${T}${T}${T}const rawHeader = JSON.parse(firstLine);`,
  `${T}${T}${T}${T}${T}${T}${T}const want = logPath(this.root, rawHeader.cwd, String(rawHeader.id), this.compression);`,
  `${T}${T}${T}${T}${T}${T}${T}if (want && want !== effectivePath && !(await this.exists(want))) {`,
  `${T}${T}${T}${T}${T}${T}${T}${T}await mkdir(dirname(want), { recursive: true });`,
  `${T}${T}${T}${T}${T}${T}${T}${T}await rename(effectivePath, want);`,
  `${T}${T}${T}${T}${T}${T}${T}${T}effectivePath = want;`,
  `${T}${T}${T}${T}${T}${T}${T}${T}healed = true;`,
  `${T}${T}${T}${T}${T}${T}${T}${T}console.warn(\`\${this.name}: healed session log identity: \${selected.sourcePath} -> \${want}\`);`,
  `${T}${T}${T}${T}${T}${T}${T}}`,
  `${T}${T}${T}${T}${T}${T}}`,
  `${T}${T}${T}${T}${T}} catch {}`,
  `${T}${T}${T}${T}${T}if (!healed) {`,
  `${T}${T}${T}${T}${T}${T}console.warn(\`\${this.name}: skipping session log with mismatched identity: \${effectivePath} (\${String(error?.message ?? error)})\`);`,
  `${T}${T}${T}${T}${T}${T}continue;`,
  `${T}${T}${T}${T}${T}}`,
  `${T}${T}${T}${T}${T}/* 自愈成功：本次不加入 artifacts（下轮 boot 自然读到已归位文件），避免「改路径后重试读 header」的额外风险 */`,
  `${T}${T}${T}${T}${T}continue;`,
  `${T}${T}${T}${T}}`,
  `${T}${T}${T}${T}if (header === void 0) continue;`,
  `${T}${T}${T}${T}if (ids.has(header.id)) {`,
  `${T}${T}${T}${T}${T}console.warn(\`\${this.name}: skipping duplicate session id "\${header.id}" at \${effectivePath}\`);`,
  `${T}${T}${T}${T}${T}continue;`,
  `${T}${T}${T}${T}}`,
  `${T}${T}${T}${T}ids.add(header.id);`,
  `${T}${T}${T}${T}artifacts.push({`,
  `${T}${T}${T}${T}${T}header,`,
  `${T}${T}${T}${T}${T}path: effectivePath`,
  `${T}${T}${T}${T}});`,
].join('\n')

/** 两代锚点表（顺序：新代在前，因为它更可能是当前 runtime） */
const VARIANTS = [
  { gen: 'dsh 0.1.5（identity 检查在 readGenerationHeader 内）', orig: ORIG_015, repl: REPL_015 },
  { gen: 'dsh 0.1.2（循环体内直接 assertStoredIdentity）', orig: ORIG_012, repl: REPL_012 },
]

/**
 * 自愈用到的 `rename` 必须**在该模块里可解析**。
 * 旧代次（0.1.2）的 import 行本就含 `rename`；新代次（0.1.5）**不含**（它改用
 * `publishNewFileWin32` + `internals.fs.link` 两条发布路径，`rename` 不再被官方引用）。
 * ⇒ 本补丁若不补 import，`rename` 会是 **ReferenceError**，而它落在 `catch {}` 里
 *   ⇒ **自愈静默失效**（正是 P-3 最忌讳的形态：功能没了但看不出来）。
 * ⇒ 显式补 import（幂等：已含则跳过）；**补不上则 fail-closed**，不静默放过。
 */
const IMPORT_MARK = 'DSHT-RESILIENT-IMPORT'

/** 给 `node:fs/promises` 的 import 补 `rename`（幂等；返回是否成功） */
function ensureRenameImport (t, file) {
  const m = /import \{([^}]*)\} from "node:fs\/promises";/.exec(t)
  if (m === null) {
    console.error('  ⚠️ 未找到 node:fs/promises 的 import 行 —— 无法补 rename（自愈会退化为静默跳过）:', file)
    return null
  }
  const names = m[1].split(',').map(s => s.trim()).filter(Boolean)
  if (names.includes('rename')) return { text: t, changed: false }
  names.push('rename')
  names.sort((a, b) => a.localeCompare(b))
  const line = `import { ${names.join(', ')} } from "node:fs/promises"; /* ${IMPORT_MARK}: rename 用于身份自愈 */`
  return { text: t.replace(m[0], line), changed: true }
}

let failed = 0
for (const f of FILES) {
  let t
  try {
    t = readFileSync(f, 'utf8')
  } catch (e) {
    console.error('READ FAILED:', f, String(e?.message ?? e))
    failed += 1
    continue
  }
  if (bodyApplied(t)) {
    // 已打过主体补丁：仍需确认 import 就位（防止「主体打了但 import 没补」的半打状态）
    const imp = ensureRenameImport(t, f)
    if (imp === null) { failed += 1; continue }
    if (imp.changed) { writeFileSync(f, imp.text); console.log('补 import rename:', f) }
    else console.log('already patched:', f)
    continue
  }
  // ★半打状态检测（P-41 第四例的守门）：marker 写得有、但**主体语义不在** ——
  // 这正是「被别的步骤抹掉/被前缀误判」之后的样子。**绝不许静默跳过**（那正是修前的缺陷：
  // exit 0、输出像成功，而 boot-loop 防线已消失）。出声 + 继续往下按锚点尝试恢复；
  // 若锚点也不在，下游 ANCHOR MISMATCH 会 fail-closed 并打印实际片段。
  if (t.includes(MARKER)) {
    console.error(`WARN HALF-PATCHED in ${f}：文件含 ${MARKER} 标记但主体语义不在`)
    console.error('  ⇒ 可能被其它步骤改写，或该标记是 IMPORT_MARK 的前缀被误读 —— 尝试按锚点重新打上')
  }

  let applied = null
  for (const v of VARIANTS) {
    const count = t.split(v.orig).length - 1
    if (count === 1) { applied = v; break }
    if (count > 1) {
      console.error(`ANCHOR AMBIGUOUS in ${f}（${v.gen}）count = ${count} —— 锚点不唯一，拒绝替换`)
      failed += 1
      applied = null
      break
    }
  }
  if (applied === null) {
    // fail-closed：两代锚点都不中 ⇒ 出声并打印实际片段（供人判断官方又改成什么样了）
    console.error('ANCHOR MISMATCH in', f, '—— 两代锚点（0.1.5 / 0.1.2）都不匹配')
    const anchor = 'if (ids.has('
    const i = t.indexOf(anchor)
    if (i >= 0) {
      console.error('  实际内容片段（含 `if (ids.has(` 起）:')
      console.error(t.slice(Math.max(0, i - 700), i + 400).split('\n').map(l => '    ' + l).join('\n'))
    } else {
      console.error('  连 `if (ids.has(` 都找不到 —— 该函数可能已被官方整体重写/改名')
    }
    console.error('  ⇒ 请按官方新形态更新本脚本的 VARIANTS（勿直接跳过：这条补丁失效会导致 boot-loop 复发）')
    failed += 1
    continue
  }
  t = t.replace(applied.orig, applied.repl)
  const imp = ensureRenameImport(t, f)
  if (imp === null) { failed += 1; continue }
  t = imp.text
  writeFileSync(f, t)
  console.log(`patched: ${f}（命中代次：${applied.gen}${imp.changed ? ' + 补 rename import' : ''}）`)
}

process.exit(failed === 0 ? 0 : 1)
