// setup-pc-verify.mjs — T2.5 运行时验证环境搭建（隔离 home，不动用户真实 ~/.dsh）
// 产物：pc-verify-home/.dsh/{profiles/web（插件挂载）, rp/rp-prototest（工作区）,
//       sessions/.../session.jsonl（含输出协议内容 + 变体链的手工会话）}
import { mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ws = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const home = join(ws, 'pc-verify-home')
const dsh = join(home, '.dsh')

rmSync(home, { recursive: true, force: true })

// ---- 1. 插件挂载（NodeService.ensureRpPluginPatch 的 PC 等价物）----
const webProfile = join(dsh, 'profiles', 'web')
const r10Pkg = (n) => ({ name: n, src: join(ws, 'dsh-runtime-android', 'node_modules', n), files: ['lib/index.js'], pkg: `{"name":"${n}","version":"1.0.0","type":"module","main":"lib/index.js"}` })
const pluginPkgs = [
  // 插件合并（用户定案）：dsht-rp-plugin 单包装双面——lib/index.js（node 宿主，runtime 产物）
  // + lib/client.js（浏览器 wire，刚构建的 dsht-rp-ui lib）；assets 整树（import-center + skills + dsht-adapter）
  { name: 'dsht-rp-plugin', src: join(ws, 'dsh-runtime-android', 'node_modules', 'dsht-rp-plugin'), files: ['lib/index.js'], dirs: ['assets'], extra: [{ src: join(ws, 'packages', 'src', 'dsht-rp-ui', 'lib', 'client.js'), dst: 'lib/client.js' }], pkg: '{"name":"dsht-rp-plugin","version":"1.0.0","type":"module","main":"lib/index.js","exports":{".":"./lib/index.js","./client":"./lib/client.js","./package.json":"./package.json"},"dsh":{"client":{"platform":"web","external":["@deepseek-ai/dsh-client-ui-sidebar","@deepseek-ai/dsh-client-ui-layout","@deepseek-ai/dsh-client-ui-conversation","@deepseek-ai/dsh-client-ui-settings-plugins"]}}}' },
  // R10 三大插件（产物在 runtime node_modules，build-dsht.ps1 Step 4.72 esbuild 直出）
  r10Pkg('dsht-plugin-mvu'),
  r10Pkg('dsht-plugin-tavern-helper'),
  r10Pkg('dsht-plugin-prompt-template'),
  // P2#13：dsht-plugin-mobile（宿主无关移动端适配，双面形态；build-dsht.ps1 Step 4.77 产物在 runtime node_modules）
  { name: 'dsht-plugin-mobile', src: join(ws, 'dsh-runtime-android', 'node_modules', 'dsht-plugin-mobile'), files: ['lib/index.js', 'lib/client.js'], pkg: '{"name":"dsht-plugin-mobile","version":"1.0.0","type":"module","main":"lib/index.js","exports":{".":"./lib/index.js","./client":"./lib/client.js","./package.json":"./package.json"},"dsh":{"client":{"platform":"web","external":["@deepseek-ai/dsh-client-ui-layout"]}}}' },
]
for (const p of pluginPkgs) {
  const dst = join(webProfile, 'node_modules', p.name)
  mkdirSync(join(dst, 'lib'), { recursive: true })
  writeFileSync(join(dst, 'package.json'), p.pkg)
  for (const f of p.files) cpSync(join(p.src, f), join(dst, f))
  for (const e of p.extra ?? []) cpSync(e.src, join(dst, e.dst))
  for (const d of p.dirs ?? []) cpSync(join(p.src, d), join(dst, d), { recursive: true })
}
writeFileSync(join(webProfile, 'cordis.patch.yml'), `# DSHTavern RP 插件（单包双面 dsht-rp-plugin + R10 三大插件 + dsht-plugin-mobile）
- insert:
    - id: dsht-rp
      name: 'dsht-rp-plugin'
    - id: dsht-mvu
      name: 'dsht-plugin-mvu'
    - id: dsht-tavern-helper
      name: 'dsht-plugin-tavern-helper'
    - id: dsht-prompt-template
      name: 'dsht-plugin-prompt-template'
    - id: dsht-mobile
      name: 'dsht-plugin-mobile'
`)

// ---- 2. RP 工作区（rp.json：输出协议配置 + 世界书）----
const slug = 'rp-prototest'
const rpDir = join(dsh, 'rp', slug)
mkdirSync(rpDir, { recursive: true })
writeFileSync(join(rpDir, 'rp.json'), JSON.stringify({
  schemaVersion: 1,
  characterName: '协议测试角色',
  books: [{ name: '测试书', lorePath: join('skills', 'wb-prototest-x1', 'references', 'lore.json').replaceAll('\\', '/') }],
  trigger: { scanDepth: 2, matchWholeWords: false, budgetPercent: 25, budgetCap: 6000 },
  macros: { char: '协议测试角色', user: '测试者' },
  firstMes: '（开场白）风铃作响，{{char}}从书页间抬起头，窗外的雨刚刚停。她朝你微微点头：「……要坐这边吗？」',
  outputProtocol: {
    actionTags: ['a', 'selection'],
    wrapTags: ['content'],
    statusTags: ['status', 'StatusBlock'],
  },
}, null, 2))
const bookDir = join(dsh, 'skills', 'wb-prototest-x1')
mkdirSync(join(bookDir, 'references'), { recursive: true })
writeFileSync(join(bookDir, 'SKILL.md'), `---
name: wb-prototest-x1
description: T2.5 验证用世界书
---

测试世界书。
`)
writeFileSync(join(bookDir, 'references', 'lore.json'), JSON.stringify({
  entries: [
    { id: 1, comment: '咖啡厅', content: '一间安静的路边咖啡厅。', keys: ['咖啡厅'], secondaryKeys: [], constant: false, position: 1, depth: 4, order: 0, enabled: true, excludeRecursion: false, preventRecursion: false, probability: 100 },
  ],
}))

// ---- 2.5. 角色卡 preset（.agent-presets/<slug>/：agent.cordis.yml + preset.yml）----
const presetDir = join(dsh, '.agent-presets', slug)
mkdirSync(presetDir, { recursive: true })
const personaText = [
  '你正在进行角色扮演。你扮演「协议测试角色」，用户扮演对话中的主角。',
  '# 角色设定\n一位在咖啡厅看书的少女。',
  '# 行为准则\n- 全程保持角色。\n- 回复中按输出协议携带状态栏与行动选项。',
].join('\n\n')
writeFileSync(join(presetDir, 'agent.cordis.yml'), [
  '# T2.5 验证用角色 preset',
  '- id: persona',
  "  name: '@deepseek-ai/dsh-persona'",
  '  config:',
  '    text: |-',
  ...personaText.split('\n').map(l => (l === '' ? '' : '      ' + l)),
  '    complete: true',
  '    includeRuntimeContext: false',
  '',
  '- id: skill-filesystem',
  "  name: '@deepseek-ai/dsh-skill-filesystem'",
  '',
].join('\n'))
writeFileSync(join(presetDir, 'preset.yml'), 'name: 协议测试角色\ndescription: T2.5 验证角色\norder: 100\n\n')

// ---- 3. 手工会话（输出协议内容 + 变体链）----
// 官方 projectKey/encodeSegment 同款算法（session-persistence-jsonl/format.ts）
function projectKey(cwd) {
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  const slug2 = readable.replace(/^-+/, '') || 'root'
  return `--${slug2.slice(0, 251)}--`
}
const sessionId = 't25-verify-001'
const cwd = rpDir
const sessionDir = join(dsh, 'sessions', projectKey(cwd), sessionId)
mkdirSync(sessionDir, { recursive: true })

const lines = []
let seq = 0
const t0 = Date.now() - 3600_000
const emit = (type, data, surfaceOp, sourceEventSeqs) => {
  const ev = { type, seq, time: t0 + seq * 1000, data }
  if (surfaceOp !== undefined) {
    ev.surfaceOp = surfaceOp
    if (sourceEventSeqs !== undefined) ev.sourceEventSeqs = sourceEventSeqs
  }
  lines.push(JSON.stringify(ev))
  seq++
}
lines.push(JSON.stringify({ type: 'session', version: 0, id: sessionId, createdAt: t0, cwd, delegationDepth: 0 }))

// turn 1：user 消息 → 两个变体（append + replace 链）
emit('turn/start', { turn: 1 })
emit('user/message', { id: `u-${sessionId}-1`, role: 'user', content: [{ type: 'text', text: '我推门走进咖啡厅。' }], source: { kind: 'user' } }, 'append')

const v1 = `<content>风铃作响，她抬起头。</content>
<UpdateVariable> <Analysis> - Time advanced: same morning. - Cloud Dream's favorability increases. </Analysis> <JSONPatch> [ { "op": "delta", "path": "/云梦璃/好感度", "value": 3 } ] </JSONPatch> </UpdateVariable>
<details> <summary>实时总结</summary> - 她抬起头与我对视。 - 气氛安静而微妙。 </details>
<foreshadowings> <details> <summary>当前伏笔</summary> - 她手里的书是空的。 </details> </foreshadowings>
<status>好感度：5\n气氛：安静</status><a>问她刚才在想什么</a><a>点一杯咖啡</a>`
const v2 = '<content>门上的铃铛轻轻响了一声，她放下手里的书。</content><StatusBlock>好感度：6</StatusBlock><selection>坐到她对面</selection>'

emit('step/start', { turn: 1, step: 1 })
emit('assistant/message', { turn: 1, step: 1, message: { id: `a-${sessionId}-1`, role: 'assistant', content: [{ type: 'text', text: v1 }], source: { kind: 'model', provider: 'dsht-test', model: 't25' } } }, 'append')
emit('step/end', { turn: 1, step: 1 })
emit('step/start', { turn: 1, step: 2 })
emit('assistant/message', { turn: 1, step: 2, message: { id: `a-${sessionId}-2`, role: 'assistant', content: [{ type: 'text', text: v2 }], source: { kind: 'model', provider: 'dsht-test', model: 't25' } } }, { op: 'replace', start: 3, end: 3 }, [3])
emit('step/end', { turn: 1, step: 2 })
emit('turn/end', { turn: 1, reason: { kind: 'completed' } })

writeFileSync(join(sessionDir, 'session.jsonl'), lines.join('\n') + '\n')

console.log(`pc-verify-home 就绪：
  home      = ${home}
  cwd       = ${cwd}
  session   = ${sessionDir}\\session.jsonl
  sessionId = ${sessionId}
启动（PowerShell）：
  $env:HOME='${home}'; $env:DSH_HOME='${dsh}'
  cd dsh-runtime-android
  node -r ..\\scripts\\android-sim.cjs node_modules\\@deepseek-ai\\dsh\\lib\\bin.js web --no-open --port 3090`)
