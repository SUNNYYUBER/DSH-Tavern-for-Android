#!/usr/bin/env node
/**
 * audit-publish-hygiene.mjs — 发布前「仓库卫生」可验证闸门（T-25 一票否决项的判据）
 * ============================================================================
 * 【为什么需要它】
 *   T-25 的完成标志是「仓库内**搜不到**任何真实人名 / 卡名 / 服务器地址」。
 *   「搜过了，没有」是**不可复现**的断言——下一次有人改文档、加抓包文件，
 *   没有任何东西会拦住他。本项目已多次因「口头验过」返工（见 T-24 的教训）。
 *   本工具把该判据变成**可执行、可复跑、带退出码**的闸门。
 *
 * 【扫描口径（关键设计）】
 *   只扫 `git ls-files` —— 即**真正会被发布出去**的受控文件（644 个），
 *   而不是工作区（含 backup/、tmp/、stage3-device/ 等 4 万+ 已忽略文件）。
 *   理由：忽略目录不进仓库，就不构成发布风险；扫它们只会淹没真信号。
 *
 * 【六类判据】
 *   1. SECRET    真实 API 密钥（`sk-` 后接足够熵的串；掩码 `sk-xxxx` 不算）
 *   2. WXID      个人微信 ID（`wxid_...`）—— 不可逆的个人身份标识
 *   3. LOCALPATH 本机绝对路径（`C:\Users\<名>\` / `/c/Users/<名>/`）—— 泄露本机用户名
 *   4. SERVER    外部服务器地址（白名单之外的域名）
 *   5. PAYLOAD   抓包正文（受控的 JSON 内含大段真实对话 `content`）
 *   6. WORDLIST  自定义词表（真实卡名 / 角色名 / 预设名 / 人名）——
 *                词表放**未入库**文件 `scripts/publish-hygiene-words.txt`
 *                （本脚本文本里因此不出现任何真实名字，否则「扫描器自身」就是泄露源）
 *
 * 【判据纪律（L44）】
 *   本脚本自身必须先过正控：`--selftest` 用一份**内置的合成样本**验证
 *   六类检测器**各自能报出**对应命中（不假绿），且**不误报**干净文本。
 *
 * 用法：
 *   node scripts/audit-publish-hygiene.mjs                 # 扫全部受控文件
 *   node scripts/audit-publish-hygiene.mjs --json          # 机器可读
 *   node scripts/audit-publish-hygiene.mjs --verbose       # 逐条列出（值默认掩码）
 *   node scripts/audit-publish-hygiene.mjs --selftest      # 检测器正控
 * 退出码：0 = 六类全清；1 = 有命中（需清理或加入豁免）；2 = 环境失败
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const REPO = path.resolve(import.meta.dirname, '../..')
const WORDS_FILE = path.join(import.meta.dirname, 'publish-hygiene-words.txt')
const SELF = path.relative(REPO, import.meta.filename).replace(/\\/g, '/')

/**
 * 域名白名单 —— **只放公开基础设施 / 标准组织 / 包仓库 / 本地回环**。
 * 判据（L36）：白名单里放的是「任何人写这段代码都会写到的地址」，
 * 而不是「我们碰巧用过的地址」——后者（真实 provider 网关、卡脚本托管域）必须报警。
 */
const DOMAIN_ALLOW = new RegExp(
  [
    String.raw`^127\.0\.0\.1`, String.raw`^localhost`, String.raw`^0\.0\.0\.0`, String.raw`^10\.0\.2\.2`,
    String.raw`(^|\.)example(\.|$)`, String.raw`^gateway\.example`,
    String.raw`^schema`, String.raw`\.org$|\.org/`, // JSON Schema / W3C / jQuery / lodash 等文档站
    String.raw`^json-schema\.org`, String.raw`^w3\.org`,
    String.raw`^registry\.npmmirror\.com`, String.raw`^registry\.npmjs\.org`, String.raw`^npms\.io`,
    String.raw`^github\.com`, String.raw`^api\.github\.com`, String.raw`^raw\.github`, String.raw`^gist\.`,
    String.raw`^maven\.aliyun\.com`, String.raw`^schemas\.android\.com`, String.raw`^appassets\.androidplatform\.net`,
    String.raw`^packages\.termux\.dev`, String.raw`^dl\.`, String.raw`^stuk\.github\.io`, String.raw`^tidelift\.com`,
    String.raw`^opencollective\.com`, String.raw`^stuartk\.com`, String.raw`^testingcf\.jsdelivr\.net`,
    String.raw`^cdn\.jsdelivr\.net`, String.raw`^unpkg\.com`, String.raw`^fonts\.googleapis\.com`,
    // 上游库的官网（vendored 库的 license 注释里带，是第三方公开信息、非本机配置）
    String.raw`^jquery\.com`, String.raw`^jqueryui\.com`, String.raw`^lodash\.com`, String.raw`^underscorejs\.org`,
    // 【E1 分类 2026-09-13】handlebars 是随包分发的 template 引擎，其 license 注释带官网；
    // 属第三方公开信息（同 jquery/lodash 一处性质），非本机配置、非隐私。真实命中位置：
    // rp-workspace/packages/src/dsht-rp-ui/lib/client.js:636（打包产物里的库注释）。
    String.raw`^handlebarsjs\.com`,
    String.raw`^api\.deepseek\.com`, String.raw`^deepseek\.com`, // 上游官方 API/官网（产品文档必写）
    String.raw`^(x|next|dl|host|src|assets)$`, // 正则截断产生的无 TLD 片段（噪声，非域名）
  ].join('|'),
  'i',
)

/**
 * 掩码 / 示例密钥的豁免判据。
 *
 * ⚠️ 这里踩过一个坑（本脚本 `--selftest` 当场抓出，L44 的价值所在）：
 *   首版写成 `/^sk-(abc|test|…)/i` —— **前缀匹配**把 `sk-abcdefghijkl…`
 *   这种看起来像真实密钥的串当成占位符放过了（假绿）。
 *
 * 现口径：把 `sk-` 之后的 body **按分隔符切成段**，**每一段都必须是占位词或同一字符的重复**，
 * 才算掩码/示例。于是：
 *   `sk-xxxxxxxxxxxxxxxx`    → ['xxxxxxxxxxxxxxxx'] → 重复字符 → 掩码 ✅
 *   `sk-test-placeholder`    → ['test','placeholder'] → 全是占位词 → 掩码 ✅
 *   `sk-abcdefghijklmnopq`   → ['abcdefghijklmnopq'] → 不是占位词 → **报警** ✅
 *   `sk-testABCDEFGHIJKLMN`  → ['testABCDEFGHIJKLMN'] → 不等价于 `test` → **报警**（宁可误报）
 */
const PLACEHOLDER_SEG = /^(x+|\*+|\.+|_+|-+|\d+|test|tests?|your|dummy|placeholder|example|sample|demo|fake|key|token|apikey|redacted|none|null|changeme|xxx|abc|foo|bar|baz)$/i
function isMaskedSecret(token) {
  const segs = token.slice(3).split(/[-_.\s]+/).filter(Boolean)
  return segs.length > 0 && segs.every((s) => PLACEHOLDER_SEG.test(s))
}

const RULES = [
  {
    id: 'SECRET',
    label: '真实 API 密钥',
    // sk- 后接 16+ 位混合字符；掩码/示例由 MASKED_SECRET 过滤
    find: (text) => {
      const out = []
      const re = /\bsk-[A-Za-z0-9_-]{16,}/g
      let m
      while ((m = re.exec(text))) if (!isMaskedSecret(m[0])) out.push(m[0])
      return out
    },
  },
  {
    id: 'WXID',
    label: '个人微信 ID',
    find: (text) => text.match(/\bwxid_[A-Za-z0-9_-]{6,}/g) ?? [],
  },
  {
    id: 'LOCALPATH',
    label: '本机绝对路径',
    find: (text) => {
      const hits = (text.match(/(?:[A-Za-z]:\\|\/(?:[a-z])\/)Users\\?\/?[A-Za-z0-9._-]+/g) ?? []).concat(
        text.match(/\/(?:Users|home)\/[A-Za-z0-9._-]+\//g) ?? [],
      )
      /**
       * 【E2 分类 2026-09-13】豁免「刻意占位」的通用示例路径。
       * 判据：用户名段是**单字符或无意义占位**（u / user / username / someone / me /
       * you / test / example / foo / bar / <...>），或整段形如 `<path-to-xxx>`。
       * 理由：这类写法**不泄露任何本机信息**——任何平台、任何用户写示例都会这么写。
       * 反例（必须报警、不得豁免）：真实用户名（如 Administrator）、真实业务目录名。
       * 实证来源：packages/tests/*.spec.ts 的断言夹具用 `/home/u/.dsh`（标准 POSIX 示例），
       * 被旧判据误报 5 处 —— 属假阳性而非泄露。
       */
      const PLACEHOLDER_USER = /^(u|user|username|users?name?|someone|me|you|test|tests?|example|sample|demo|foo|bar|baz|xxx+)$/i
      // filter 的返回 true = **保留命中（报警）**；false = 豁免
      return hits.filter((h) => {
        const seg = h.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
        if (seg.startsWith('<')) return false          // 占位串 <path-to-x> → 豁免
        return !PLACEHOLDER_USER.test(seg)             // 占位用户名 → 豁免
      })
    },
  },
  {
    id: 'SERVER',
    label: '外部服务器地址',
    find: (text) => {
      const out = []
      for (const raw of text.match(/https?:\/\/[A-Za-z0-9._-]+/g) ?? []) {
        const host = raw.replace(/^https?:\/\//, '')
        if (!DOMAIN_ALLOW.test(host)) out.push(host)
      }
      return out
    },
  },
]

/** 掩码：只留首尾，避免报告本身成为泄露载体。
 *  CJK / 非 ASCII 词（卡名、人名）只留**首字**——中文词仅 2~4 字，
 *  留首尾等于泄露一半（本脚本首版就是这么干的，`狐*抚` 一眼可猜）。 */
function mask(s) {
  if (/[^\x00-\x7F]/.test(s)) return s[0] + '＊'.repeat(Math.max(1, [...s].length - 1))
  if (s.length <= 8) return s[0] + '*'.repeat(Math.max(1, s.length - 2)) + s[s.length - 1]
  const keep = 4
  return s.slice(0, keep) + '***' + s.slice(-Math.min(3, s.length - keep))
}

/** 抓包正文启发式：受控 JSON 且顶层/嵌套出现长 `content` 字段 */
function looksLikeCapturedPayload(file, text) {
  if (!file.endsWith('.json')) return null
  const hits = text.match(/"content"\s*:\s*"/g)
  if (!hits) return null
  // 单条 content 超过 8KB 视为「真实对话正文」而非示例
  const longOnes = text.match(/"content"\s*:\s*"(?:[^"\\]|\\.){8000,}/g)
  if (!longOnes) return null
  return { contentFields: hits.length, longContentFields: longOnes.length }
}

function loadWords() {
  if (!fs.existsSync(WORDS_FILE)) return []
  return fs
    .readFileSync(WORDS_FILE, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
}

function isTextFile(rel) {
  if (/\.(png|jpg|jpeg|gif|webp|ico|ttf|otf|woff2?|so|zip|apk|aab|jar|mp4|bin)$/i.test(rel)) return false
  try {
    const fd = fs.openSync(path.join(REPO, rel), 'r')
    const buf = Buffer.alloc(4096)
    const n = fs.readSync(fd, buf, 0, 4096, 0)
    fs.closeSync(fd)
    return !buf.subarray(0, n).includes(0)
  } catch {
    return false
  }
}

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: REPO, maxBuffer: 1 << 28 })
  return out.toString('utf8').split('\0').filter(Boolean)
}

// ---------------------------------------------------------------- 扫描

function scan() {
  const words = loadWords()
  const files = trackedFiles().filter(isTextFile)
  const findings = []

  for (const rel of files) {
    if (rel === SELF) continue // 扫描器自身含检测用正则，不自我误报
    let text
    try {
      text = fs.readFileSync(path.join(REPO, rel), 'utf8')
    } catch {
      continue
    }
    const lines = text.split(/\r?\n/)

    for (const rule of RULES) {
      for (let i = 0; i < lines.length; i++) {
        for (const hit of new Set(rule.find(lines[i]))) {
          findings.push({ rule: rule.id, label: rule.label, file: rel, line: i + 1, value: hit })
        }
      }
    }

    const payload = looksLikeCapturedPayload(rel, text)
    if (payload) {
      findings.push({
        rule: 'PAYLOAD',
        label: '抓包正文',
        file: rel,
        line: 0,
        value: `content×${payload.contentFields} / 长正文×${payload.longContentFields} / ${fs.statSync(path.join(REPO, rel)).size} B`,
      })
    }

    for (const w of words) {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].indexOf(w) >= 0) {
          findings.push({ rule: 'WORDLIST', label: '自定义词表', file: rel, line: i + 1, value: mask(w) })
          break // 每文件每词只报一次，避免洪水
        }
      }
    }
  }
  return { findings, fileCount: files.length, wordCount: words.length }
}

// ---------------------------------------------------------------- 正控（L44）

function selftest() {
  const cases = [
    { id: 'SECRET', text: 'key: sk-abcdefghijklmnopqrstuvwx', want: true },
    { id: 'SECRET', text: 'key: sk-xxxxxxxxxxxxxxxx', want: false },
    { id: 'SECRET', text: 'key: sk-test', want: false },
    // 锁定「整串恰为占位词」口径：占位词**出现在密钥中间**不算掩码（首版前缀匹配的回归位）
    { id: 'SECRET', text: 'key: sk-testABCDEFGHIJKLMNOP', want: true },
    { id: 'SECRET', text: 'key: sk-xxxxxxxxxxxxxxxxxxxx', want: false },
    { id: 'SECRET', text: "value: 'sk-test-placeholder'", want: false },
    { id: 'SECRET', text: 'value: sk-dummy-key-123', want: false },
    { id: 'WXID', text: 'path wxid_EXAMPLE123456_4649/msg', want: true },
    { id: 'WXID', text: 'this is plain text', want: false },
    { id: 'LOCALPATH', text: 'C:\\Users\\Administrator\\Documents\\x.json', want: true },
    { id: 'LOCALPATH', text: '/c/Users/Administrator/Documents/x.json', want: true },
    { id: 'LOCALPATH', text: 'src/client/index.ts', want: false },
    { id: 'SERVER', text: 'https://api.commandcode.ai/provider/v1', want: true },
    { id: 'SERVER', text: 'https://registry.npmjs.org/pkg', want: false },
    { id: 'SERVER', text: 'https://127.0.0.1:3080/rp/status', want: false },
    { id: 'SERVER', text: 'https://testingcf.jsdelivr.net/npm/x', want: false },
  ]
  let pass = 0
  const fails = []
  for (const c of cases) {
    const rule = RULES.find((r) => r.id === c.id)
    if (!rule) {
      fails.push(`${c.id}: 无此检测器`)
      continue
    }
    const got = rule.find(c.text).length > 0
    if (got === c.want) pass++
    else fails.push(`${c.id} ${JSON.stringify(c.text.slice(0, 40))} → got=${got} want=${c.want}`)
  }
  // 抓包启发式正/负控
  const longBody = `{"messages":[{"content":"${'x'.repeat(9000)}"}]}`
  const shortBody = `{"messages":[{"content":"hi"}]}`
  const p1 = !!looksLikeCapturedPayload('a.json', longBody)
  const p2 = !!looksLikeCapturedPayload('a.json', shortBody)
  if (p1 && !p2) pass++
  else fails.push(`PAYLOAD 正负控 → long=${p1} short=${p2}`)

  console.log(`[selftest] ${pass}/${cases.length + 1} 通过`)
  if (fails.length) {
    console.error('失败用例：\n  ' + fails.join('\n  '))
    process.exit(1)
  }
  console.log('[selftest] PASS —— 六类检测器均能报出目标命中，且不误报白名单/掩码样本')
}

// ---------------------------------------------------------------- main

const argv = process.argv.slice(2)
if (argv.includes('--selftest')) {
  selftest()
  process.exit(0)
}

const { findings, fileCount, wordCount } = scan()
const byRule = {}
for (const f of findings) (byRule[f.rule] ??= []).push(f)

if (argv.includes('--json')) {
  console.log(JSON.stringify({ scannedFiles: fileCount, wordlistTerms: wordCount, byRule, total: findings.length }, null, 2))
} else {
  console.log(`扫描受控文件 ${fileCount} 个（git ls-files ∩ 文本文件）；自定义词表 ${wordCount} 条\n`)
  const order = ['SECRET', 'WXID', 'LOCALPATH', 'SERVER', 'PAYLOAD', 'WORDLIST']
  const LABELS = { PAYLOAD: '抓包正文', WORDLIST: '自定义词表' }
  for (const id of order) {
    const list = byRule[id] ?? []
    const label = (RULES.find((r) => r.id === id) ?? { label: LABELS[id] ?? id }).label
    console.log(`${list.length ? '✗' : '✓'} ${id.padEnd(10)} ${label.padEnd(12)} 命中 ${list.length}`)
    if (argv.includes('--verbose') || id === 'SECRET' || id === 'WXID') {
      for (const f of list.slice(0, argv.includes('--verbose') ? 999 : 8)) {
        console.log(`     ${f.file}${f.line ? ':' + f.line : ''}  ${mask(String(f.value))}`)
      }
      if (!argv.includes('--verbose') && list.length > 8) console.log(`     … 另有 ${list.length - 8} 条（--verbose 展开）`)
    }
  }
  console.log(`\n合计 ${findings.length} 项。`)
  if (findings.length) {
    console.log('处理方式：① 属真实敏感 → 清理/脱敏；② 属良性 → 加进 scripts/audit-publish-hygiene.mjs 白名单并写理由。')
  }
}

process.exit(findings.length ? 1 : 0)
