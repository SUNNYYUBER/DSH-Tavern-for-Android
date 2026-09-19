#!/usr/bin/env node
/**
 * ef-sentinel-family.mjs —— **暂存/占位哨兵同类排查**（P-34 机器化，第二十三轮 W6 续）
 * ============================================================================
 * ## 为什么需要这个脚本
 * W6 收尾时设备探针在真实会话上抓到一处真缺陷：`display-compiler.ts` /
 * `output-protocol.ts` 的**暂存哨兵**原为**裸控制字符**（`\x01F<n>\x01` / `\x00<n>\x00`），
 * 被用户正文里的**字面量**撞车 ⇒ 用户内容凭空消失 8 字（⇒ 固化为 **P-34**）。
 *
 * 修完那两处后留下一个**未收口项**（§6.17f）：
 * > 「用不可见字符 + 短 ASCII 前缀当占位」是一个**可复制的写法**，
 * > 全仓是否还有别处同形？未穷举。
 *
 * 本脚本把这项从「人工排查」变成「常驻机器判据」。
 *
 * ## 判据（P-34 的两条规则，对**每一处**哨兵适用）
 *   ① **码位**：定界符必须是正文里不可能出现的码位（私用区 U+E000…U+F8FF 等）
 *   ② **越界**：还原时下标越界必须**原样保留**（不得 `?? ''` 静默删内容）
 *
 * ## 三件套（P-30：静态判据必须自带正控 + 负控）
 *   A. **判据自证**：扫描规则本身的正负控（合成样本进得了扫描器、对照样本进不去）
 *   B. **覆盖断言**（P-20 零杠杆防线）：已知的每一处哨兵都**必须在**扫描结果里 ——
 *      否则扫描规则写错会「报全清」的假绿
 *   C. **动态验证**：对每处哨兵**真实调用**其 protect/restore，注入同形串与越界下标
 *
 * ## 用法
 *   node scripts/ef-sentinel-family.mjs              # 全跑（自证 → 覆盖 → 动态）
 *   node scripts/ef-sentinel-family.mjs --selftest   # 只跑判据自证
 *
 * 退出码：0 全 PASS；1 有 FAIL；2 判据自证未通过（结论不可信，P-30）
 */
import process from 'node:process'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, sep, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 注意：不用 `new URL(...).pathname` —— Windows 上它带前导 `/` 且**百分号未解码**
//（本仓库路径含空格 ⇒ `%20` ⇒ 所有 readFileSync 都 ENOENT）。这是判据自身的坑（P-29）。
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')                 // 仓库根
const SRC = join(ROOT, 'rp-workspace', 'packages', 'src')
const HAS = (f) => process.argv.slice(2).includes(f)

let fail = 0
const rec = (name, ok, detail = '') => {
  if (!ok) fail += 1
  console.log(`  ${ok ? 'PASS' : '**FAIL**'} ${name}${detail ? `\n        ${detail}` : ''}`)
}

// ---------------------------------------------------------------------------
// A. 判据自证（P-30）
//
// 扫描规则是「在源码里找**裸控制字符定界 + 短 ASCII 标识 + 数字下标**的串字面量」。
// 正控 / 负控样本必须**覆盖真实失效形态**（本轮教训：负控样本不能取自「正确行为」）。
// ---------------------------------------------------------------------------
/**
 * 哨兵的**真正形态**：一个**还原正则字面量**，其源码里含裸控制字符转义。
 *
 * ## 为什么不用更宽的「任何含裸控制字符的串」（首版写错的地方）
 * 首版把扫描面定成「行内有 `\u0000`/`\x01`」，结果报出 2 处**假红**：
 *   · `lore/safe-regex.ts` 的 NUL 是**内部缓存键分隔符**（`flags\0pattern`）——
 *     它只进 `Map`，从不写回正文、也没有任何还原逻辑 ⇒ **不可能被正文撞车**；
 *   · `dsh-plugin/ext-asset.ts` 的 NUL 是**路径段安全校验**（含 NUL 即拒），
 *     语义与哨兵相反。
 * ⇒ 判据过宽会把「与缺陷无关的写法」一起报红，属 P-20 的反面（判据没有杠杆）。
 *
 * ## 为什么「还原正则」是准确的判别特征
 * P-34 的失效链是「**生成**哨兵 → 写回正文 → **按哨兵还原**」。
 * 只有存在**还原正则**，正文里长得像哨兵的串才会被**消费**（篡改/删除）。
 * 缓存键、校验串都没有还原步骤 ⇒ 与缺陷无关。
 * 故判据锚在「含裸控制字符转义的**正则字面量**」上。
 */
const REGEX_LITERAL = /\/(?:[^/\\\n[]|\\.|\[(?:[^\]\\]|\\.)*\])+\/[gimsuy]*/g
const CTRL_IN_RE = /\\u00[01][0-9a-fA-F]|\\x0[01]/i

/**
 * 取源文件的**非注释代码行**（注释里提到旧形态是**文档**，不算缺陷；
 * 首版自证把注释算进去 ⇒ 4 条回归锁全假红 —— 又一种「判据自身的实现假设」）。
 */
function codeLines(rel) {
  const p = join(SRC, rel)
  if (!existsSync(p)) throw new Error(`源码不存在：${rel}`)
  return readFileSync(p, 'utf8').split(/\r?\n/)
    .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
}

function selftest() {
  console.log('[1/3] 判据自证（P-30：扫描规则自身的正负控）')
  const checks = [
    // 正控：真实失效形态（还原正则里含裸控制字符）必须被扫到
    ['正控·还原正则含 \\u0000 被扫到',
      () => [...'text.replace(/\\u0000EJS_PRE_(\\d+)\\u0000/g, ...)'.matchAll(REGEX_LITERAL)].some(m => CTRL_IN_RE.test(m[0]))],
    ['正控·还原正则含 \\x01 被扫到',
      () => [...'work.replace(/\\x01F(\\d+)\\x01/g, ...)'.matchAll(REGEX_LITERAL)].some(m => CTRL_IN_RE.test(m[0]))],
    // 负控·真实**误报形态**（必须不被扫到 —— 这两个是本轮实测报出的假红）
    ['负控·内部缓存键（无还原步骤）不计为缺陷',
      () => ![...'const cacheKey = `${flags}\\u0000${pattern}`'.matchAll(REGEX_LITERAL)].some(m => CTRL_IN_RE.test(m[0]))],
    ['负控·路径校验（含 NUL 即拒）不计为缺陷',
      () => ![...'if (seg.includes(\'\\\\\') || seg.includes(\'\\u0000\')) {'.matchAll(REGEX_LITERAL)].some(m => CTRL_IN_RE.test(m[0]))],
    ['负控·私用区还原正则不计为缺陷',
      () => ![...'work.replace(/\\uE000DSHT_RP_FENCE_(\\d+)\\uE001/gu, ...)'.matchAll(REGEX_LITERAL)].some(m => CTRL_IN_RE.test(m[0]))],
    ['负控·普通正则不计为缺陷',
      () => ![...'const re = /abc(\\d+)/g'.matchAll(REGEX_LITERAL)].some(m => CTRL_IN_RE.test(m[0]))],
    // 回归锁：已修好的四处**代码行**里旧形态必须不再出现
    ['回归锁·旧围栏形态 \\x01F$ 已消失',
      () => !codeLines('dsht-rp-ui/src/client/display-compiler.ts').some(l => /`\\x01F\$/.test(l))],
    ['回归锁·旧段落形态 \\x00$ 已消失',
      () => !codeLines('dsht-rp-ui/src/client/display-compiler.ts').some(l => /`\\x00\$/.test(l))],
    ['回归锁·旧 EJS 形态 NUL+EJS_PRE_ 已消失',
      () => !codeLines('dsht-plugin-prompt-template/ejs.ts').some(l => /\\u0000EJS_PRE_/.test(l))],
    ['回归锁·旧中性化形态 NUL+DSHT_M 已消失',
      () => !codeLines('preset/compiler.ts').some(l => /\\u0000DSHT_M/.test(l))],
  ]
  for (const [name, fn] of checks) {
    let ok = false
    try { ok = Boolean(fn()) } catch (e) { ok = false; console.log(`        （抛错：${e?.message}）`) }
    rec(name, ok)
  }
  console.log(`      自证 ${checks.length - fail}/${checks.length}`)
  return fail
}

const selfFail = selftest()
if (HAS('--selftest')) process.exit(selfFail === 0 ? 0 : 2)
if (selfFail > 0) {
  console.error('[ef-sentinel-family] 判据自证未通过 ⇒ 结论不可信，拒绝继续（P-30）')
  process.exit(2)
}

// ---------------------------------------------------------------------------
// B. 静态扫描 + 覆盖断言（P-20：判据必须自带杠杆）
// ---------------------------------------------------------------------------
console.log('\n[2/3] 静态扫描（全仓 TS 源码里含裸控制字符的**还原正则**）')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'lib' || name === 'dist') continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(p)
  }
  return out
}

const files = walk(SRC)
const hits = []
let scannedRe = 0            // 扫描器**实际识别到的正则字面量**总数（P-20 杠杆）
for (const f of files) {
  const rel = relative(SRC, f).split(sep).join('/')
  const lines = readFileSync(f, 'utf8').split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    // 注释里提到旧形态是**文档**，不算缺陷
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue
    for (const m of line.matchAll(REGEX_LITERAL)) {
      scannedRe += 1
      if (CTRL_IN_RE.test(m[0])) hits.push({ file: rel, line: i + 1, text: line.trim().slice(0, 120) })
    }
  }
}

// 覆盖断言：四处已知哨兵文件必须在扫描面内（否则「扫描规则写错」会伪装成全清）
const KNOWN_GUARDED = [
  'dsht-rp-ui/src/client/display-compiler.ts',
  'dsht-rp-ui/src/client/output-protocol.ts',
  'dsht-plugin-prompt-template/ejs.ts',
  'preset/compiler.ts',
]
for (const rel of KNOWN_GUARDED) {
  if (!files.some(f => relative(SRC, f).split(sep).join('/') === rel)) {
    rec(`覆盖断言·扫描面必须含 ${rel}`, false, '该文件未被扫描到 ⇒ 扫描规则或目录结构已漂移')
  }
}
// 【P-20 杠杆】扫描器必须**真的在工作**：正则字面量识别数远大于 0。
// 否则「正则写错 ⇒ 恒 0 命中」会伪装成「全仓干净」的假绿（这是本探针最危险的失效形态）。
rec(`覆盖断言·扫描器在工作（识别到正则字面量 ${scannedRe} 个，要求 ≥ 100）`, scannedRe >= 100,
  scannedRe < 100 ? '扫描正则可能已失效 ⇒ 「命中 0 处」不可信' : '')
console.log(`      扫描 ${files.length} 个 TS 文件（正则字面量 ${scannedRe} 个），命中裸控制字符哨兵 ${hits.length} 处`)
for (const h of hits) console.log(`        · ${h.file}:${h.line}  ${h.text}`)
rec('无裸控制字符哨兵残留（P-34 第一类）', hits.length === 0,
  hits.length > 0 ? '上述位置仍在用「正文里可能出现的码位」当哨兵 ⇒ 会被正文撞车' : '')

// ---------------------------------------------------------------------------
// C. 动态验证：真实调用每处哨兵的 protect → restore（含同形串 + 越界下标）
// ---------------------------------------------------------------------------
console.log('\n[3/3] 动态验证（真实调用，正控 = 同形串原样保留；负控 = 真占位符仍还原）')

const { protectPreBlocks, restorePreBlocks } = await import('../packages/src/dsht-plugin-prompt-template/ejs.ts')
const { neutralizePromptVariables } = await import('../packages/src/preset/compiler.ts')

{
  const t1 = '<pre>AAA</pre>用户写的：\u0000EJS_PRE_0\u0000结束'
  const p1 = protectPreBlocks(t1)
  rec('ejs <pre> 哨兵：旧 NUL 形态同形串原样保留', restorePreBlocks(p1.text, p1.blocks) === t1)

  const t2 = '<pre>BBB</pre>前\u0000EJS_PRE_99\u0000后'
  const p2 = protectPreBlocks(t2)
  rec('ejs <pre> 哨兵：越界下标原样保留（不得静默删）', restorePreBlocks(p2.text, p2.blocks) === t2)

  const t3 = '<pre>CCC</pre>中间<pre>DDD</pre>尾巴'
  const p3 = protectPreBlocks(t3)
  rec('负控·ejs <pre> 真占位符仍正确还原', restorePreBlocks(p3.text, p3.blocks) === t3)
}

{
  const t = '卡作者写的：\u0000DSHT_M\u0000 与 \u0000DSHT_C\u0000 结束'
  rec('preset 中性化哨兵：旧 NUL 形态同形串原样保留', neutralizePromptVariables(t) === t)
  rec('负控·preset 真 {{model}} 仍受保护', neutralizePromptVariables('前{{model}}后') === '前{{model}}后')
  rec('负控·preset 其它宏仍全角化', neutralizePromptVariables('{{setvar::x::y}}') === '｛｛setvar::x::y｝｝')
}

console.log(`\n[ef-sentinel-family] ${fail === 0 ? '全 PASS' : `${fail} FAIL`}`)
process.exit(fail === 0 ? 0 : 1)
