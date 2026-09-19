#!/usr/bin/env node
/**
 * audit-impl-duplication.mjs —— 「同一功能多实现」结构性审计（F5 / D4）
 * ============================================================================
 * ## 为什么需要这条闸门
 * 用户原话：「回退插件是纯自研的，在另一台 DSH 上也有一个副本，要是改插件的话两边都要改」。
 * 这句话是**架构缺陷的自白**——同一功能多份实现、靠「记得两边都改」维持，
 * 而「靠人记，必然漏」（主仓 docs/F5-MULTI-IMPLEMENTATION-AUDIT.md §一）。
 *
 * 本闸门把「多实现」变成**机器可查**的信号。它查两类：
 *
 * ### 判据 1：动作语义路由在多插件里重复定义
 * 同一动作名（rollback / regenerate / edit / …）出现在**两个及以上**插件的路由
 * 声明里 → 报出，要求人工确认是否属于**已显式裁决**的「权威 + 降级」组合。
 * 已裁决的组合在白名单里（须写明理由），其余一律报警。
 *
 * ### 判据 2：共享模块被各自复制（而非 import 同一份）
 * 若同一函数名在**多个包**内以 `function <name>(` 形式出现（非同文件、且不在
 * 白名单），说明逻辑被复制而非共享 → 报出。复制即必然漂移（P-1b）。
 *
 * ### 判据 4：**不同名**的函数体逐字相同（判据 2 的盲区）
 * 判据 2 只比名字。而 2026-09-14 实测查出的三组真实复制**全部不同名**：
 * `isValidMemorySessionId` ≡ `isValidTablesSessionId`（安全判据）、
 * `neutralizeMacros` ≡ `escapeResidualMacros`、`encodeSeg` ≡ `encodePointerSeg`。
 * 名字不同 ⇒ 判据 2 永远不报 ⇒ **改一处漏一处的风险完全不可见**。
 * 本判据改比「函数体归一化指纹」：去注释、折叠空白、剥掉函数名，同指纹跨包出现即报。
 * 复制体即便改名也躲不过（这正是本判据要拦的行为）。
 *
 * ## 为什么是「报出待确认」而不是「直接判违规」
 * 「是否属于同一语义」需要理解代码，无法纯机械判定。本闸门只负责
 * **把候选摊到桌面上**，让「新增了重复实现」在提交时就被看见；
 * 语义层面的裁决仍由人写进 F5 文档（这是诚实的边界，见文末「局限」）。
 *
 * ## 正控 / 负控（--selftest）
 * 正控：构造含重复路由与重复函数名的语料 → 必须被报；
 * 负控：把重复消掉 → 必须一条不报；
 * 零控：空语料 → 必须 0 报（防恒真）。
 * 锚点缺失（找不到插件目录）→ **fail-closed** 退出 1，不许静默放行。
 *
 * 用法：
 *   node scripts/audit-impl-duplication.mjs            # 审计（退出码 0 = 无未裁决重复）
 *   node scripts/audit-impl-duplication.mjs -v         # 列出全部候选（含已裁决）
 *   node scripts/audit-impl-duplication.mjs --selftest # 正控/负控/零控自检（退出码 3 = 失败）
 * 退出码：0 = 无未裁决重复；1 = 有未裁决重复（fail-closed）；3 = selftest 失败
 *   ★ W76 修：原只写「0 / 3」而实现里主流程是 `process.exit(1)`（有未裁决重复）
 *     ⇒ 补 1（**P-75** 双向：实现的每个码都必须被声明）
 * ============================================================================
 */
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'
import process from 'node:process'
// ★ W44：自证分数行的**单源输出契约**（P-1）—— 见 `selftest-summary.mjs` 头注
import { reportSelftest } from './selftest-summary.mjs'

const WS = join(import.meta.dirname, '..')
const SRC = join(WS, 'packages', 'src')
/** 设备探针目录（W31 新增判据 7 的扫描面 —— 此前本门禁**只扫 src**，
 *  对 scripts/ 下的逐字复制**结构性看不见**，属 P-11 元级缺口）。 */
const SCRIPTS = join(WS, 'scripts')

/**
 * 已裁决的「权威 + 降级」组合白名单。
 * 每条的 `why` 必须写清：为什么允许重复、谁是权威、谁是降级。
 * 加白名单 = 承认这是**有意的多实现**，不是遗漏。
 */
const DECIDED = [
  {
    action: 'rollback',
    plugins: ['dsh-plugin', 'dsht-plugin-undo'],
    why: '权威=dsh-plugin（live 逻辑回退：compaction 影子化 + marker replace，事件留日志）；'
      + '降级=dsht-plugin-undo（文件截断，供无 rp 插件的部署；live 一律 409）。'
      + '见 docs/F5-MULTI-IMPLEMENTATION-AUDIT.md §2.1。',
  },
  {
    action: 'regenerate',
    plugins: ['dsh-plugin', 'dsht-plugin-undo'],
    why: '同上：dsh-plugin 权威（含变量回滚 + 帧内状态一致性），dsht-plugin-undo 为无 rp 部署的降级路径。',
  },
  {
    action: 'edit',
    plugins: ['dsh-plugin', 'dsht-plugin-undo'],
    why: '同上：dsh-plugin 权威，dsht-plugin-undo 为降级路径。',
  },
]

/** 函数名复制检测的白名单（同名但**语义面不同**，非重复实现）。
 *  注意：加白名单前必须真读过两份实现，确认它们不是同一语义——
 *  「看着像重复但其实不是」与「确实是重复」必须分清，否则白名单会变成掩盖问题的工具。 */
const FN_ALLOW = new Map([
  [
    'readVarPath',
    '两侧语义面不同：dsht-plugin-shared/macros.ts 的版本走 parseVarPath（点号+JSONPointer 双兼容，'
    + '含 trim/空段过滤）；dsht-rp-ui/client/macros-display.ts 的版本是**显示期专用**轻量取值'
    + '（只吃 JSONPointer 与点号，不做 trim）。前者是变量引擎语义，后者是渲染兜底。',
  ],
  [
    'registerMacro',
    '两侧语义面不同：dsht-plugin-shared/macros.ts 是宿主侧宏注册表（供引擎求值）；'
    + 'dsht-rp-ui/client/th-shim.ts 是**卡脚本运行时的 TH API 面**（复刻酒馆助手 registerMacro，'
    + '脚本调用入口，需按 TH 契约行为）。前者是我方引擎内部，后者是对外兼容 API。',
  ],
  [
    'unregisterMacro',
    '同 registerMacro：宿主侧注册表 vs 卡脚本 TH API 面，不可合并。',
  ],
  [
    'parseJsonPatches',
    '两侧语义面不同（**这条最关键，别被名字骗了**）：state/mvu.ts 是 MVU 变量补丁语义'
    + '（从 `\\u003cJSONPatch\\u003e` 块提取 + op 白名单过滤 + insert 的 index 并入 path）；'
    + 'dsht-rp-ui/client/output-protocol.ts 是**显示期宽松解析**（把任意 JSON 数组当 patch 列表展示，'
    + '不做 op 校验、不做 insert 语义）。前者决定变量怎么变，后者决定怎么显示。',
  ],
  [
    'sessionEventAt',
    '两侧语义面不同：dsh-plugin 的版本读 host 侧 session 事件（0.1.2 eventAt / 旧 events）；'
    + 'dsht-plugin-memory 刻意**自包含**（其文件头注释明示「本插件自包含（不引 @deepseek-ai 运行时依赖），'
    + '故各自持有一份」，避免记忆插件被宿主 API 变更牵连）。属**有意的解耦**，非复制疏忽。'
    + '若将来宿主 API 稳定，可评估合并。',
  ],
  [
    'sessionEventsSnapshot',
    '同 sessionEventAt：dsht-plugin-memory 有意自包含。',
  ],
  [
    'resolveDshHome',
    '两侧语义面不同：dsht-plugin-shared/http.ts 是 HTTP 层的 home 解析（含 env 覆盖）；'
    + 'dsht-preflight/index.ts 是**启动前置检查**阶段的探测（在 shared 加载链之前，'
    + '刻意不复用以免形成初始化顺序依赖）。',
  ],
])

/** 要追踪的动作语义关键词（路由名里的动词） */
const ACTION_WORDS = ['rollback', 'regenerate', 'edit', 'fork', 'variant', 'undo']

/**
 * 判据 4 白名单：**不同名但函数体逐字相同**、且经人工读过两份实现确认「语义面确实不同」的组合。
 * 键 = `fingerprint(body)`（与 audit 内部同一算法）。当前为空——2026-09-14 查出的三组
 * 真实复制已全部收口为「单源 import + 同义别名」，不再需要豁免。
 * 加一条之前必须真读两份实现：白名单是最后手段，不是掩盖问题的工具。
 */
const BODY_ALLOW = new Set([])

/**
 * 括号配对（跳过字符串/模板串/注释），返回与 s[openIdx] 配对的下标；不匹配 → -1。
 * 自研而非正则：函数体可含嵌套花括号、字符串里的括号、整段模板串（style.ts 即此形态）。
 */
function matchBracket(s, openIdx) {
  const open = s[openIdx]
  const close = open === '{' ? '}' : open === '(' ? ')' : open === '[' ? ']' : null
  if (close === null) return -1
  let depth = 0
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i]
    if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; continue }
    if (c === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); i = e === -1 ? s.length : e + 1; continue }
    if (c === "'" || c === '"' || c === '`') {
      i++
      while (i < s.length && s[i] !== c) { if (s[i] === '\\') i++; i++ }
      continue
    }
    if (c === open) depth++
    else if (c === close) { depth--; if (depth === 0) return i }
  }
  return -1
}

/** 归一化函数体：去注释 + 折叠空白。**不**做标识符重命名——判据是「逐字复制」而非「近似」。 */
function normalizeBody(body) {
  return body
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 判据 4 的指纹 = 归一化后的函数体（**不含函数名**，故改名躲不过）。 */
function fingerprint(body) {
  return normalizeBody(body)
}

/**
 * 提取 `function <name>(…) { body }` 形态的函数体。
 *
 * ## 已知盲区（诚实标注，不是遗漏）
 * ① 箭头函数 / 内联表达式形态（`const f = (a) => …`）未覆盖；
 * ② 局部变量改名、语句重排的**近似**复制无法判定（那需要 AST + 近似匹配，
 *    会引入大量误报，本闸门刻意不做——宁缺毋滥）；
 * ③ 只判「跨包」重复（与判据 2 同口径）。
 * 盲区 ① 的兜底：真实发现的三组复制都是 `function` 声明形态（见文件头判据 4 说明），
 * 若将来出现箭头形态的复制，本判据会漏——届时应扩到 AST 而非继续加正则。
 */
function extractBodies(text) {
  const out = []
  const re = /(?:^|[\s;}])(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g
  let m
  while ((m = re.exec(text)) !== null) {
    const parenIdx = m.index + m[0].length - 1
    if (text[parenIdx] !== '(') continue
    const closeParen = matchBracket(text, parenIdx)
    if (closeParen === -1) continue
    const braceIdx = text.indexOf('{', closeParen)
    if (braceIdx === -1) continue
    // 返回类型标注里出现 ';'（如 `): { a: string }` 之后仍无花括号体）→ 不是函数体，跳过
    if (text.slice(closeParen + 1, braceIdx).includes(';')) continue
    const closeBrace = matchBracket(text, braceIdx)
    if (closeBrace === -1) continue
    out.push({ name: m[1], body: text.slice(braceIdx + 1, closeBrace) })
  }
  return out
}

/**
 * 递归收集源文件（跳过派生目录）。
 *
 * 【W31 改】原硬编码只收 `.ts`/`.tsx` —— 而判据 7 要扫 `scripts/*.mjs`
 *  ⇒ 加 `exts` 参数（默认保持原口径，不影响既有调用点）。
 *  ★ 若不加参数而直接复用，判据 7 会「扫 0 个」⇒ **零样本冒充通过**（P-30 最危险形态）。
 */
function walk(dir, out = [], exts = ['.ts', '.tsx']) {
  for (const name of readdirSync(dir)) {
    if (name === 'lib' || name === 'dist' || name === 'node_modules') continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out, exts)
    else if (exts.some(e => name.endsWith(e))) out.push(full)
  }
  return out
}

/** 归一化成「包名」：packages/src/<pkg>/... → <pkg>；packages/src/dsh-plugin/... → dsh-plugin */
function pkgOf(absPath) {
  const rel = relative(SRC, absPath).split(sep)
  return rel[0] ?? ''
}

/**
 * 审计：返回 { actionHits, fnHits, undecided }
 * 输入是虚拟文件列表（便于 selftest 构造语料）。
 */
export function audit(files) {
  // ---- 判据 1：动作语义路由在多插件里出现 ----
  /** action → Set<pkg> */
  const byAction = new Map()
  for (const f of files) {
    const pkg = pkgOf(f.path)
    // 只看**路由声明行**，避免注释/文档里的提及造成误报
    for (const line of f.text.split('\n')) {
      if (!/sub\s*===?\s*['"]|subPath\s*===?\s*['"]|\bpath\s*:\s*['"]/.test(line)) continue
      for (const w of ACTION_WORDS) {
        const re = new RegExp(`['"][^'"]*${w}[^'"]*['"]`, 'i')
        if (re.test(line)) {
          if (!byAction.has(w)) byAction.set(w, new Set())
          byAction.get(w).add(pkg)
        }
      }
    }
  }
  const actionHits = []
  for (const [action, pkgs] of byAction) {
    if (pkgs.size < 2) continue
    actionHits.push({ action, plugins: [...pkgs].sort() })
  }

  // ---- 判据 2：函数名在多个包里重复出现 ----
  /** fnName → Set<'pkg|file'> */
  const byFn = new Map()
  for (const f of files) {
    const pkg = pkgOf(f.path)
    const relFile = relative(SRC, f.path).split(sep).join('/')
    for (const m of f.text.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
      const name = m[1]
      if (name === undefined || name.length < 6) continue // 短名噪声大
      if (!byFn.has(name)) byFn.set(name, new Set())
      byFn.get(name).add(`${pkg}|${relFile}`)
    }
  }
  const fnHits = []
  for (const [name, places] of byFn) {
    const pkgs = new Set([...places].map(p => p.split('|')[0]))
    if (pkgs.size < 2) continue
    fnHits.push({ name, pkgCount: pkgs.size, places: [...places].sort(), allowed: FN_ALLOW.has(name) })
  }
  // 已读实并裁决为「语义面不同」的函数**不再计入未裁决**，但仍在 -v 里列出（可复查）。
  const fnUndecided = fnHits.filter(h => !h.allowed)

  // ---- 判据 4：不同名但函数体逐字相同（判据 2 的盲区） ----
  /** fingerprint → Set<'pkg|file|fnName'> */
  const byBody = new Map()
  for (const f of files) {
    const pkg = pkgOf(f.path)
    const relFile = relative(SRC, f.path).split(sep).join('/')
    for (const { name, body } of extractBodies(f.text)) {
      const fp = fingerprint(body)
      // 过短的函数体（如 `return null`）无信息量，跨包必然撞车 → 噪声。要求有实质内容。
      if (fp.length < 40) continue
      if (!byBody.has(fp)) byBody.set(fp, new Set())
      byBody.get(fp).add(`${pkg}|${relFile}|${name}`)
    }
  }
  const bodyHits = []
  for (const [fp, places] of byBody) {
    const pkgs = new Set([...places].map(p => p.split('|')[0]))
    if (pkgs.size < 2) continue // 同包内重复不算（可能是同文件的重载/局部工具）
    // 同一函数在两包里出现是「同名复制」，已由判据 2 覆盖 → 此处只报**不同名**的
    const names = new Set([...places].map(p => p.split('|')[2]))
    if (names.size < 2) continue
    bodyHits.push({ fingerprint: fp, names: [...names].sort(), pkgs: [...pkgs].sort(), places: [...places].sort() })
  }
  const bodyUndecided = bodyHits.filter(h => !BODY_ALLOW.has(h.fingerprint))

  // ---- 未裁决的动作重复 ----
  const decidedKey = new Set(DECIDED.map(d => `${d.action}|${d.plugins.join(',')}`))
  const undecided = actionHits.filter(h => !decidedKey.has(`${h.action}|${h.plugins.join(',')}`))

  // ---- 白名单腐烂检测：条目已不再命中 ⇒ 说明重复已被消除，白名单该删 ----
  // 防「白名单只增不减」变成永久豁免（P-1 的护栏自身也会腐化）。
  // 注意判据必须是「跨包同名」仍在，而不是「函数名仍存在」——后者在重复被消除、只剩一份时
  // 依然为真，会漏掉最该删的那种情形。
  const dupFnNames = new Set(fnHits.map(h => h.name))
  const staleAllow = [...FN_ALLOW.keys()].filter(n => !dupFnNames.has(n))

  return { actionHits, fnHits, fnUndecided, undecided, staleAllow, bodyHits, bodyUndecided }
}

// ---------------------------------------------------------------- 自检

function selftest() {
  const mk = (pkg, file, text) => ({ path: join(SRC, pkg, file), text })

  // 正控 1：同一动作在两个**未被裁决**的包出现 → 必须被报且列入 undecided
  // （注意：不能用 dsh-plugin + dsht-plugin-undo —— 那一对已在 DECIDED 白名单里，
  //   用它做正控会让「未裁决」判据失效，是无效用例）
  const dupAction = [
    mk('pkg-alpha', 'index.ts', `if (sub === '/thing/rollback') { return }` + '\n'),
    mk('pkg-beta', 'index.ts', `if (sub === '/x/rollback') { return }` + '\n'),
  ]
  const r1 = audit(dupAction)
  const ok1 = r1.actionHits.length === 1 && r1.undecided.length === 1
  console.log(`${ok1 ? '[ok]' : '[FAIL]'} 正控1：跨包动作路由重复被报 ${JSON.stringify(r1.actionHits)}（期望 1 条且未裁决）`)

  // 正控 1b：白名单里的组合**不应**被列入 undecided（证明白名单真的生效）
  const decidedPair = [
    mk('dsh-plugin', 'index.ts', `if (sub === '/rp/session-rollback') { return }` + '\n'),
    mk('dsht-plugin-undo', 'index.ts', `if (sub === '/rollback') { return }` + '\n'),
  ]
  const r1b = audit(decidedPair)
  const ok1b = r1b.actionHits.length === 1 && r1b.undecided.length === 0
  console.log(`${ok1b ? '[ok]' : '[FAIL]'} 正控1b：已裁决组合被识别为已裁决（undecided=${r1b.undecided.length}，期望 0）`)

  // 负控 1：只在一个包出现 → 不报
  const single = [mk('pkg-alpha', 'index.ts', `if (sub === '/thing/rollback') { return }` + '\n')]
  const r2 = audit(single)
  const ok2 = r2.actionHits.length === 0
  console.log(`${ok2 ? '[ok]' : '[FAIL]'} 负控1：单包动作不报（实际 ${r2.actionHits.length}）`)

  // 正控 2：同名函数出现在两个包 → 必须被报
  const dupFn = [
    mk('pkga', 'a.ts', `export function computeSomethingLong(a: number) { return a }\n`),
    mk('pkgb', 'b.ts', `export function computeSomethingLong(b: number) { return b }\n`),
  ]
  const r3 = audit(dupFn)
  const ok3 = r3.fnHits.length === 1 && r3.fnHits[0].name === 'computeSomethingLong'
    && r3.fnUndecided.length === 1
  console.log(`${ok3 ? '[ok]' : '[FAIL]'} 正控2：跨包同名函数被报 ${JSON.stringify(r3.fnHits.map(f => f.name))}`)

  // 正控 2b：白名单里的函数名**不应**计入未裁决（证明 FN_ALLOW 真的生效，
  // 而不是「定义了却没人用」——那也是一种静默失效的护栏）
  const allowHit = [
    mk('pkga', 'a.ts', `function parseJsonPatches(x: string) { return x }\n`),
    mk('pkgb', 'b.ts', `function parseJsonPatches(y: string) { return y }\n`),
  ]
  const r3b = audit(allowHit)
  const ok3b = r3b.fnHits.length === 1 && r3b.fnUndecided.length === 0
  console.log(`${ok3b ? '[ok]' : '[FAIL]'} 正控2b：白名单函数被识别为已裁决（fnUndecided=${r3b.fnUndecided.length}，期望 0）`)

  // 负控 2：同包内同名（非同文件也算同包）→ 不报
  const samePkg = [
    mk('pkga', 'a.ts', `function computeSomethingLong() {}\n`),
    mk('pkga', 'b.ts', `function computeSomethingLong() {}\n`),
  ]
  const r4 = audit(samePkg)
  const ok4 = r4.fnHits.length === 0
  console.log(`${ok4 ? '[ok]' : '[FAIL]'} 负控2：同包内同名不报（实际 ${r4.fnHits.length}）`)

  // 零控：空输入 → 0 报（防恒真）
  const r5 = audit([])
  const ok5 = r5.actionHits.length === 0 && r5.fnHits.length === 0
  console.log(`${ok5 ? '[ok]' : '[FAIL]'} 零控：空语料 0 报`)

  // 正控 3：注释/文档里的动作词**不**该被当作路由（避免误报）
  const commentOnly = [
    mk('pkga', 'a.ts', `// 这里讨论 rollback 的语义\nconst x = 1\n`),
    mk('pkgb', 'b.ts', `// 这里也讨论 rollback 的语义\nconst y = 2\n`),
  ]
  const r6 = audit(commentOnly)
  const ok6 = r6.actionHits.length === 0
  console.log(`${ok6 ? '[ok]' : '[FAIL]'} 正控3（反向）：纯注释提及不算重复实现（实际 ${r6.actionHits.length}）`)

  // 判据 3 自检：用临时目录构造「主仓 + 副本」两态
  const tmpA = mkdtempSync(join(tmpdir(), 'f5-dup-a-'))
  const tmpB = mkdtempSync(join(tmpdir(), 'f5-dup-b-'))
  const tmpC = mkdtempSync(join(tmpdir(), 'f5-dup-c-'))
  mkdirSync(tmpA, { recursive: true }); mkdirSync(tmpB, { recursive: true }); mkdirSync(tmpC, { recursive: true })
  // 正控 3：两侧一致 → 不报漂移
  writeFileSync(join(tmpA, 'SEMANTICS.md'), 'same\n')
  writeFileSync(join(tmpB, 'SEMANTICS.md'), 'same\n')
  const dSame = checkCrossDeployDocs([{ name: 'x', main: join(tmpA, 'SEMANTICS.md'), replica: tmpB }])
  const ok7 = dSame.checked.length === 1 && dSame.drifted.length === 0
  console.log(`${ok7 ? '[ok]' : '[FAIL]'} 正控4：两侧文档一致时不报漂移（checked=${dSame.checked.length}）`)
  // 正控 4（反向）：两侧内容不同 → **必须**报漂移（这是 R9 要拦的真实情形）
  writeFileSync(join(tmpC, 'SEMANTICS.md'), 'different\n')
  const dDrift = checkCrossDeployDocs([{ name: 'x', main: join(tmpA, 'SEMANTICS.md'), replica: tmpC }])
  const ok8 = dDrift.drifted.length === 1
  console.log(`${ok8 ? '[ok]' : '[FAIL]'} 正控5：两侧文档不一致时被报漂移（drifted=${dDrift.drifted.length}，期望 1）`)
  // 负控 3：副本不在本机 → 计入 missing（出声），**不算漂移**（不许把「没副本」当失败）
  const dNoReplica = checkCrossDeployDocs([{ name: 'x', main: join(tmpA, 'SEMANTICS.md'), replica: join(tmpA, 'nope') }])
  const ok9 = dNoReplica.missing.length === 1 && dNoReplica.drifted.length === 0
  console.log(`${ok9 ? '[ok]' : '[FAIL]'} 负控3：副本缺失记为 missing 而非 drift（missing=${dNoReplica.missing.length}）`)

  // 判据 4 正控：**不同名**但函数体逐字相同（判据 2 的盲区）→ 必须被报
  // 语料刻意用两个不同函数名 + 完全相同的长函数体（模拟 isValidMemorySessionId ≡ isValidTablesSessionId）
  const dupBody = [
    mk('pkga', 'a.ts', 'export function alphaGuard(id: unknown): boolean {\n'
      + '  return typeof id === "string" && id.length > 0 && id.length <= 120\n'
      + '    && !id.includes("/") && !id.includes("\\\\") && !id.includes("..")\n'
      + '}\n'),
    mk('pkgb', 'b.ts', 'export function betaGuard(id: unknown): boolean {\n'
      + '  return typeof id === "string" && id.length > 0 && id.length <= 120\n'
      + '    && !id.includes("/") && !id.includes("\\\\") && !id.includes("..")\n'
      + '}\n'),
  ]
  const r7 = audit(dupBody)
  const ok10 = r7.bodyHits.length === 1 && r7.bodyUndecided.length === 1
    && r7.bodyHits[0].names.join(',') === 'alphaGuard,betaGuard'
  console.log(`${ok10 ? '[ok]' : '[FAIL]'} 正控6：不同名逐字复制被报 ${JSON.stringify(r7.bodyHits.map(h => h.names))}`)

  // 负控 4：**同名**函数体相同 → 判据 2 已覆盖，判据 4 不重复报（避免双报噪音）
  const sameNameDup = [
    mk('pkga', 'a.ts', 'export function computeSomethingLong(a: number): number {\n  return a * 2 + 1\n}\n'),
    mk('pkgb', 'b.ts', 'export function computeSomethingLong(a: number): number {\n  return a * 2 + 1\n}\n'),
  ]
  const r8 = audit(sameNameDup)
  const ok11 = r8.fnHits.length === 1 && r8.bodyHits.length === 0
  console.log(`${ok11 ? '[ok]' : '[FAIL]'} 负控4：同名复制只由判据2报一次（bodyHits=${r8.bodyHits.length}，期望 0）`)

  // 负控 5：名称不同、**函数体也不同** → 不报（防「只要跨包就报」的恒真）
  const diffBody = [
    mk('pkga', 'a.ts', 'export function alphaGuard(id: unknown): boolean {\n  return typeof id === "string" && id.length > 0 && id.length <= 120\n}\n'),
    mk('pkgb', 'b.ts', 'export function betaGuard(id: unknown): boolean {\n  return typeof id === "number" && Number.isInteger(id) && id >= 0 && id < 1e6\n}\n'),
  ]
  const r9 = audit(diffBody)
  const ok12 = r9.bodyHits.length === 0
  console.log(`${ok12 ? '[ok]' : '[FAIL]'} 负控5：不同名且函数体不同不报（实际 ${r9.bodyHits.length}）`)

  // 零控 2：空语料 → 判据 4 也 0 报
  const r10 = audit([])
  const ok13 = r10.bodyHits.length === 0
  console.log(`${ok13 ? '[ok]' : '[FAIL]'} 零控2：空语料判据4 0 报`)

  // ★ W44：返回值从「一个布尔」改为「**计数**」（真值），因为原先的收尾
  //   `console.log(ok ? '[F5 selftest] 15/15 PASS' : ...)` **把通过数写死成字面量 15**
  //   —— 那是 **P-41** 的形态（「代理量」代替事实）：新增/删除一条判据时，
  //   报告上的数字**不会跟着变**，于是「文档声明 vs 实际」永远无法被机器对照。
  const results = [
    ['ok1', ok1], ['ok1b', ok1b], ['ok2', ok2], ['ok3', ok3], ['ok3b', ok3b], ['ok4', ok4],
    ['ok5', ok5], ['ok6', ok6], ['ok7', ok7], ['ok8', ok8], ['ok9', ok9], ['ok10', ok10],
    ['ok11', ok11], ['ok12', ok12], ['ok13', ok13]
  ]
  return { all: results.every(([, v]) => v), pass: results.filter(([, v]) => v).length, total: results.length }
}

// ---------------------------------------------------------------- 判据 3：划界文档跨部署同源

/**
 * 跨部署「划界文档」清单：同一份划界说明在两处部署中**必须逐字相同**。
 *
 * ## 为什么这也算 F5（多实现）的一部分
 * F5 发现回退功能有两套实现（主仓 live 逻辑回退 + 副本文件截断）。裁决方式是
 * **显式划界**，写在 `SEMANTICS.md` 里。但如果两份划界文档本身措辞不同，
 * 就又制造了一个需要人工比对的漂移点——**「划界说明」本身就是事实来源（SSOT）**，
 * 它也必须单源。（实测：初版两份用了不同措辞，靠人眼看不出差异，属静默漂移。）
 *
 * ## 副本不存在时怎么办
 * 副本在仓库外（goal 边界 B8：可读可同步，但不作为主仓依赖）。
 * 故：**副本不存在 → 跳过并出声**（不是静默放行，也不 fail）；
 * **副本存在但不一致 → 失败**（这正是 R9 要拦的情形：改了主仓没同步副本）。
 */
const CROSS_DEPLOY_DOCS = [
  {
    name: 'dsht-plugin-undo 语义边界',
    main: join(SRC, 'dsht-plugin-undo', 'SEMANTICS.md'),
    // 可用 DSHT_UNDO_REPLICA_DIR 覆盖（不同机器的部署目录不同）
    replica: process.env.DSHT_UNDO_REPLICA_DIR
      ?? 'D:\\SillyTavern-1.16.0\\SillyTavern（now using）\\SillyTavern-1.16.0\\.a Agent RolePlay Project\\.dsh-home\\profiles\\web\\node_modules\\dsht-plugin-undo',
  },
]

/**
 * 校验跨部署文档同源。返回 { checked, missing, drifted }。
 * 输入可注入（selftest 用）。
 */
export function checkCrossDeployDocs(docs = CROSS_DEPLOY_DOCS) {
  const checked = []
  const missing = []
  const drifted = []
  for (const d of docs) {
    const replicaFile = join(d.replica, 'SEMANTICS.md')
    if (!existsSync(d.main)) { missing.push(`${d.name}（主仓缺失）`); continue }
    if (!existsSync(replicaFile)) { missing.push(`${d.name}（副本不在本机）`); continue }
    const a = readFileSync(d.main, 'utf8')
    const b = readFileSync(replicaFile, 'utf8')
    checked.push(d.name)
    if (a !== b) drifted.push({ name: d.name, main: d.main, replica: replicaFile })
  }
  return { checked, missing, drifted }
}

// ---------------------------------------------------------------- main

if (!existsSync(SRC)) {
  console.error(`[F5] 源码目录不存在：${SRC}`)
  console.error('     ⇒ fail-closed：锚点缺失时报错退出，不许静默放行（否则闸门会随路径变更悄悄失效）')
  process.exit(1)
}

const args = process.argv.slice(2)
if (args.includes('--selftest')) {
  const r = selftest()
  console.log(r.all ? `\n[F5 selftest] ${r.pass}/${r.total} PASS` : `\n[F5 selftest] ${r.pass}/${r.total} FAIL`)
  // ★ W44：统一自证输出契约（单源 `selftest-summary.mjs`）
  reportSelftest('f5b', r.pass, r.total)
  process.exit(r.all ? 0 : 3)
}

// ---- 判据 3：跨部署划界文档同源 ----
const cross = checkCrossDeployDocs()

// ---- 判据 7（W31 新增）：设备探针里**逐字重复的 CDP 求值器** ----
//
// 【为什么加这一条（P-11 元级形态）】
//  本门禁原先**只扫 `packages/src`**，因此对 `scripts/` 下的重复**结构性看不见**。
//  W30/W31 实测正好撞上：`ef-touch-targets.mjs` 与 `ef-font-scale.mjs` 里的 `ev()`
//  是**逐字同构的两份拷贝**，连「`tries/gap` 只在抛异常时重试 ⇒ 表达式返回 false
//  等于只查一次」这个缺陷都一模一样 —— 修一处**不会**传导到另一处。
//  ⇒ 收口到单源 `scripts/cdp-eval.mjs`，并用本判据守「不得再逐字复制」。
//
// 【★ 判据口径的收窄过程（P-38 三段式，值得记）】
//  首版口径是「**任何**同时出现 `webSocketDebuggerUrl` + `Runtime.evaluate` 的文件」
//  —— 结果一次报出 **80 处**，把 `cdp-boot` / `dsht-*` / `hb*` 这些**各自独立的一次性
//  调试脚本**全部算成违规。那不是缺陷，而是**本判据范围过宽**：按 P-38 的原话，
//  「过宽 ⇒ 大量假红，而假红会**训练人忽略报警**（比漏报更危险）」。
//  ⇒ 收窄到**真目标**：找的是「**同一个语义被多份实现**」，而不是「用了同一套 API」。
//    判据改为**函数级**：抽出函数体 → 只保留「同时含两个 CDP 特征」的 →
//    按**归一化指纹**分组 → **同一指纹出现在 ≥2 个文件**才报红（= 逐字复制）。
//  ⇒ 各写各的调试脚本不会命中；逐字复制必命中。
//
// 【正负控（P-30）】见 `selftestCaseProbeEval()`。
const CDP_EVAL_SELFTEST_EXEMPT = new Set(['cdp-eval.mjs'])   // 单源自身豁免

/** 抽出「函数体」：`function name(...) {…}` 与 `const name = (…) => {…}` / `= async (…) => {…}` 两种形态。 */
function extractFnBodiesForCdp (text) {
  const out = []
  // 形态 1：function 声明（复用既有 extractBodies 的口径）
  for (const b of extractBodies(text)) out.push(b)
  // 形态 2：箭头函数赋值（`const ev = async (expr, …) => { … }`）
  const re = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/g
  let m
  while ((m = re.exec(text)) !== null) {
    const braceIdx = text.indexOf('{', m.index + m[0].length - 1)
    if (braceIdx === -1) continue
    const closeBrace = matchBracket(text, braceIdx)
    if (closeBrace === -1) continue
    out.push({ name: m[1], body: text.slice(braceIdx + 1, closeBrace) })
  }
  return out
}

/**
 * 找「逐字重复的 CDP 求值器」：返回 `[{ fp, places: ['file|fn', …] }]`，只含**跨 ≥2 文件**的组。
 */
function findDuplicatedCdpEval (files2) {
  const byFp = new Map()
  for (const f of files2) {
    const rel = relative(SCRIPTS, f.path).split(sep).join('/')
    if (CDP_EVAL_SELFTEST_EXEMPT.has(rel)) continue          // 单源豁免
    for (const { name, body } of extractFnBodiesForCdp(f.text)) {
      if (!body.includes('webSocketDebuggerUrl')) continue    // 特征①：自己连 CDP target
      if (!/Runtime\.evaluate/.test(body)) continue           // 特征②：自己做求值
      const fp = fingerprint(body)
      if (fp.length < 40) continue                            // 过短无信息量（与判据 4 同口径）
      if (!byFp.has(fp)) byFp.set(fp, new Set())
      byFp.get(fp).add(`${rel}|${name}`)
    }
  }
  const hits = []
  for (const [fp, places] of byFp) {
    const fs = new Set([...places].map(p => p.split('|')[0]))
    if (fs.size >= 2) hits.push({ fp, places: [...places].sort() })
  }
  return hits
}

function selftestCaseProbeEval () {
  // 正控：两份**逐字相同**的 ev() 分处两个文件 ⇒ 必须报出
  const evBody = `
    let lastErr = null
    for (let i = 0; i < tries; i++) {
      try {
        const targets = await (await fetch('http://127.0.0.1:9333/json')).json()
        const page = targets.find(t => t.type === 'page')
        const ws = new WebSocket(page.webSocketDebuggerUrl)
        await send('Runtime.evaluate', { expression: expr })
        return r.result?.value
      } catch (e) { lastErr = e }
    }`
  const dup = [
    { path: join(SCRIPTS, 'a-fake.mjs'), text: `async function ev (expr, tries) {${evBody}\n}` },
    { path: join(SCRIPTS, 'b-fake.mjs'), text: `async function evaluate (expr, tries) {${evBody}\n}` },
  ]
  // 负控 1：两份**各写各的**（体不同）⇒ 不报
  const distinct = [
    { path: join(SCRIPTS, 'c-fake.mjs'), text: `async function ev (e) { const t = await f(); const ws = new WebSocket(t.webSocketDebuggerUrl); return (await send('Runtime.evaluate', { expression: e })).result.value }` },
    { path: join(SCRIPTS, 'd-fake.mjs'), text: `async function go (e) { while (1) { try { const page = (await (await fetch(u)).json())[0]; const ws = new WebSocket(page.webSocketDebuggerUrl); const r = await ws.send('Runtime.evaluate', { expression: e, awaitPromise: true }); return r.result?.value } catch {} } }` },
  ]
  // 负控 2：单源模块自身豁免
  const single = [{ path: join(SCRIPTS, 'cdp-eval.mjs'), text: `async function ev (expr) { const ws = new WebSocket(p.webSocketDebuggerUrl); await send('Runtime.evaluate', {}) }` }]
  // 负控 3：只连 CDP 不求值（如纯 dump 脚本）⇒ 不报
  const noEval = [
    { path: join(SCRIPTS, 'e-fake.mjs'), text: `async function dump () { const ws = new WebSocket(p.webSocketDebuggerUrl); await ws.send('Page.captureScreenshot', {}) }` },
    { path: join(SCRIPTS, 'f-fake.mjs'), text: `async function dump2 () { const ws = new WebSocket(p.webSocketDebuggerUrl); await ws.send('Page.captureScreenshot', {}) }` },
  ]
  const a = findDuplicatedCdpEval(dup).length === 1
  const b = findDuplicatedCdpEval(distinct).length === 0
  const c = findDuplicatedCdpEval(single).length === 0
  const d = findDuplicatedCdpEval(noEval).length === 0
  return [{ ok: a, label: '正控：两份逐字相同的 CDP 求值器 ⇒ 报出 1 组' },
    { ok: b, label: '负控：各写各的求值器（体不同）⇒ 不报' },
    { ok: c, label: '负控：单源模块 cdp-eval.mjs 自身豁免' },
    { ok: d, label: '负控：只连 CDP 不求值 ⇒ 不报' }]
}

const files = walk(SRC).map(p => ({ path: p, text: readFileSync(p, 'utf8') }))
const { actionHits, fnHits, fnUndecided, undecided, staleAllow, bodyHits, bodyUndecided } = audit(files)

const verbose = args.includes('-v')
if (verbose) {
  console.log(`--- 全部动作语义跨包候选（${actionHits.length}）---`)
  for (const h of actionHits) console.log(`  ${h.action}: ${h.plugins.join(' + ')}`)
  console.log(`--- 全部跨包同名函数候选（${fnHits.length}）---`)
  for (const h of fnHits) {
    console.log(`  ${h.name}（${h.pkgCount} 个包）${h.allowed ? ' [已裁决：语义面不同]' : ' ⚠ 未裁决'}`)
    if (!h.allowed) for (const p of h.places) console.log(`      ${p}`)
  }
  console.log(`--- 跨部署划界文档（${cross.checked.length} 校验 / ${cross.missing.length} 跳过）---`)
  for (const n of cross.checked) console.log(`  ${n} 两侧一致`)
  console.log(`--- 全部「不同名但函数体逐字相同」候选（${bodyHits.length}）---`)
  for (const h of bodyHits) {
    console.log(`  ${h.names.join(' ≡ ')}（${h.pkgs.join(' + ')}）`)
    for (const p of h.places) console.log(`      ${p}`)
  }
}

console.log(`[F5] 扫 ${files.length} 个源文件；动作语义跨包候选 ${actionHits.length} 条（已裁决 ${actionHits.length - undecided.length}）；`
  + `跨包同名函数候选 ${fnHits.length} 条（已裁决 ${fnHits.length - fnUndecided.length}）；`
  + `不同名逐字复制候选 ${bodyHits.length} 条（已裁决 ${bodyHits.length - bodyUndecided.length}）；`
  + `跨部署划界文档 ${cross.checked.length} 项同源`)

// 出声（非静默）：副本不在本机时明示「这项本回合没校验」，避免误以为已覆盖
for (const m of cross.missing) console.log(`[F5] ⓘ 跳过（不是失败）：${m}`)
if (cross.drifted.length > 0) {
  console.log(`\n[F5] ❌ 跨部署划界文档已漂移 ${cross.drifted.length} 项（R9：改主仓必须同轮同步副本）：`)
  for (const d of cross.drifted) {
    console.log(`  ⚠ ${d.name}`)
    console.log(`      主仓：${d.main}`)
    console.log(`      副本：${d.replica}`)
  }
  console.log('  处置：把主仓那份**整文件覆盖**到副本（划界说明本身就是 SSOT，两侧必须逐字相同）。')
  process.exit(1)
}

if (staleAllow.length > 0) {
  console.log(`\n[F5] ⚠ 白名单腐烂 ${staleAllow.length} 条（已不再命中，说明重复已被消除 ⇒ 应从 FN_ALLOW 删除）：`)
  for (const n of staleAllow) console.log(`  ${n}`)
}

// ---- 判据 7 执行（W31）：设备探针不得自建 CDP 求值 ----
//  ★ 扫描面必须显式给 `.mjs` —— 默认口径是 `.ts/.tsx`，那样会「扫 0 个」= 零样本冒充通过。
const probeFiles = walk(SCRIPTS, [], ['.mjs']).map(p => ({ path: p, text: readFileSync(p, 'utf8') }))
const selfBuilt = findDuplicatedCdpEval(probeFiles)
const probeSelftest = selftestCaseProbeEval()
const probeSelftestBad = probeSelftest.filter(r => !r.ok)
// 【P-30：0 样本不是「全部通过」】扫描面为空 ⇒ 判据无判据力 ⇒ 一律报红并出声。
const probeNoSample = probeFiles.length === 0

const total = undecided.length + fnUndecided.length + bodyUndecided.length
  + selfBuilt.length + probeSelftestBad.length + (probeNoSample ? 1 : 0)
if (total === 0) {
  console.log(`[F5] PASS —— 无未裁决的「同一功能多实现」`)
  console.log(`[F5] 判据7（探针 CDP 求值单源）：扫 ${probeFiles.length} 个 scripts/*.mjs ⇒ **逐字重复**的求值器 ${selfBuilt.length} 组；`
    + `自带正负控 ${probeSelftest.filter(r => r.ok).length}/${probeSelftest.length} PASS`)
  process.exit(0)
}

if (probeNoSample) {
  console.log('\n[F5] ❌ 判据7 扫描面为 0 个 scripts/*.mjs —— 判据无判据力（不是「全部通过」）：')
  console.log('  检查 walk(SCRIPTS, [], [\'.mjs\']) 的路径与扩展名口径是否仍成立。')
}
if (selfBuilt.length > 0) {
  console.log(`\n[F5] ⚠ 判据7：${selfBuilt.length} 组**逐字重复的 CDP 求值器**（缺陷会随拷贝一起复制）：`)
  for (const h of selfBuilt) {
    console.log(`  ⚠ 同一函数体出现在 ${h.places.length} 处：`)
    for (const p of h.places) console.log(`      ${p}`)
  }
  console.log('  处置：收敛到单源 `scripts/cdp-eval.mjs`（`import { makeEv, pollUntil }`）。')
  console.log('        （背景：W30 实测两份逐字同构的 ev() 连「tries/gap 只在 catch 重试 ⇒ 返回 false 等于只查一次」'
    + '这个缺陷都一模一样；而本门禁原先只扫 src、不扫 scripts ⇒ 结构性看不见。）')
}
if (probeSelftestBad.length > 0) {
  console.log(`\n[F5] ❌ 判据7 的自带正负控失败 ${probeSelftestBad.length} 条（判据本身不可信）：`)
  for (const r of probeSelftestBad) console.log(`  ✗ ${r.label}`)
}

if (undecided.length > 0) {
  console.log(`\n[F5] 需人工裁决 ${undecided.length} 条动作重复（若确属「权威 + 降级」，请加进本脚本的 DECIDED 并写明理由）：`)
  for (const h of undecided) {
    console.log(`  ⚠ ${h.action}: ${h.plugins.join(' + ')}`)
  }
}
if (fnUndecided.length > 0) {
  console.log(`\n[F5] 需人工裁决 ${fnUndecided.length} 条函数复制（先读两份实现再决定：收口 or 加 FN_ALLOW）：`)
  for (const h of fnUndecided) {
    console.log(`  ⚠ ${h.name}（${h.pkgCount} 个包）`)
    for (const p of h.places) console.log(`      ${p}`)
  }
}
if (bodyUndecided.length > 0) {
  console.log(`\n[F5] ⚠ 需人工裁决 ${bodyUndecided.length} 条「**不同名**但函数体逐字相同」（判据 2 的名字比对盲区）：`)
  for (const h of bodyUndecided) {
    console.log(`  ⚠ ${h.names.join(' ≡ ')}（${h.pkgs.join(' + ')}）`)
    for (const p of h.places) console.log(`      ${p}`)
  }
  console.log('  处置：这类**改名也躲不过**，通常确实是复制——收敛成单源（共享模块 + 同义别名）优先；')
  console.log('        确属「语义面不同」才加 BODY_ALLOW（须附 why，且必须在 F5 文档登记）。')
}
console.log('\n处置：① 若为重复实现 → 收敛成单源（共享同一模块）；')
console.log('      ② 若确属有意的「权威 + 降级」/「语义面不同」→ 加进 DECIDED / FN_ALLOW（附 why），')
console.log('         并在 docs/F5-MULTI-IMPLEMENTATION-AUDIT.md 登记。')
process.exit(1)
