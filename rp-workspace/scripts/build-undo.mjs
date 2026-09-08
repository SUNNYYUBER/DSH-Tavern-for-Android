// build-undo.mjs — dsht-plugin-undo 独立通用插件构建（不进 DSHT runtime，供任意 DSH 部署使用）
// 产物（dist/dsht-plugin-undo/，可直接拷进任意 DSH profile 的 node_modules）：
//   lib/index.js   = host 侧（cordis node 插件，/dsht-undo/* 数据面）
//   lib/client.js  = 浏览器 wire 契约 CJS factory：
//     window.__ModuleLoader__.load({ id: 'dsht-plugin-undo', factory: (require) => { ... return module.exports; } });
//   package.json   = main + exports['./client'] + dsh.client 声明
//   README.md      = 安装方法
// 用法：node scripts/build-undo.mjs   （在 rp-workspace 任意 cwd 均可）
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// esbuild 从 packages/ 的 node_modules 解析（脚本自身目录无依赖）
const require = createRequire(resolve(dirname(fileURLToPath(import.meta.url)), '../packages/package.json'))
const { build } = require('esbuild')

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../packages/src/dsht-plugin-undo')
const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/dsht-plugin-undo')
const outdir = resolve(dist, 'lib')
rmSync(dist, { recursive: true, force: true })
mkdirSync(outdir, { recursive: true })

// node 侧主入口（host：/dsht-undo/rollback + /dsht-undo/regenerate 数据面）
const nodeEntry = await build({
  entryPoints: [resolve(pkgRoot, 'index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: resolve(outdir, 'index.js'),
  logLevel: 'warning',
})

// 浏览器侧 client bundle（wire 契约 CJS factory，banner 形态与 build-rp-ui.mjs 同款）
const result = await build({
  entryPoints: [resolve(pkgRoot, 'client/index.tsx')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  outfile: resolve(outdir, 'client.js'),
  sourcemap: false,
  minify: false,
  external: [
    // DSH shell 冻结模块表基线（packages/client/web/src/platform.ts PLATFORM_MODULES）
    'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-ui-primitives',
  ],
  banner: {
    // wire 契约（tsdown.client.ts clientConfig 的 banner/intro 合体）：
    // factory 参数 require 由模块表应答；module/exports 局部变量遮蔽全局。
    js: `window.__ModuleLoader__.load({ id: "dsht-plugin-undo", factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
  },
  footer: {
    js: `return module.exports; } });`,
  },
  logLevel: 'info',
})

if (result.errors.length > 0 || nodeEntry.errors.length > 0) process.exit(1)

// 合并 package.json（main + exports['./client'] + dsh.client 声明）
writeFileSync(resolve(dist, 'package.json'), JSON.stringify({
  name: 'dsht-plugin-undo',
  version: '1.1.0',
  description: 'DSH 通用「回退 / 重新生成」插件：原 session 原地截断 + 按 turn 工作区文件快照恢复，绝不开新分支/新 session（host /dsht-undo/* + 原生会话 UI 按钮）',
  type: 'module',
  main: 'lib/index.js',
  exports: {
    '.': './lib/index.js',
    './client': './lib/client.js',
    './package.json': './package.json',
  },
  dsh: {
    client: {
      platform: 'web',
    },
  },
}, null, 2) + '\n')

writeFileSync(resolve(dist, 'README.md'), `# dsht-plugin-undo

DSH 通用「回退 / 重新生成」插件（独立于 DSHTavern，任何 DSH 部署可用）。

**核心契约：回退与重新生成都在原 session 原地完成，绝不开新分支/新 session。**

## 功能

- **↩ 回退到此处**（每条 user 气泡下方）：\`POST /dsht-undo/rollback {sessionId, keepThroughSeq}\`
  —— session.jsonl 截断到 keepThroughSeq（含）：header 保留、事件只留 \`seq <= keepThroughSeq\`；
  截断前自动备份 \`session.jsonl.bak\`。
- **↻ 重新生成**（最后一条 assistant 消息）：\`POST /dsht-undo/regenerate {sessionId}\`
  —— 找最后一条 user/message 的 seq，截断其后全部事件，返回 \`{truncatedTo, lastUserText}\`；
  客户端拿 lastUserText 调 \`session.prompt\`（queue 模式）重发。
- live session（正在打开/运行中）拒绝截盘，返回 409 —— 先在 DSH 里关闭该会话再操作。

## 文件改动回退（按 turn 工作区快照）

快照捕获机制移植自 dsh-turn-rewind，但恢复 UX 是**原地恢复**（不开分支、不弹 fork 对话框）：

- 每轮（turn）第一个模型 step 前，对会话 cwd 所在 git 工作树的
  「受跟踪 + 未忽略」文件做整树 before 快照；内容以 sha256 寻址存
  \`$DSH_HOME/undo/file-history/blobs/\`（跨 turn/会话去重，未变化文件零增量），
  turn 锚点清单存 \`$DSH_HOME/undo/file-history/snapshots/<sessionId>/<turn>.json\`。
- \`/dsht-undo/rollback\` 与 \`/dsht-undo/regenerate\` 截断 session.jsonl 后，
  把截断点之后 turn 的快照**逆序整批恢复**（diff 当前工作树：被改/被删的写回
  before 内容，该 turn 新增的删除），净效果 = 工作区回到被截轮次开始前。
  响应体带 \`fileSnapshots: { turns, restored, deleted, errors }\`；
  恢复 best-effort——单文件失败记入 errors，不掀翻已完成的截断。
- 捕获失败（非 git 目录、超限等）只记 host 日志，绝不阻塞用户消息。

### 配置项（cordis.patch.yml 插件条目的 config，全部可选）

| 键 | 默认 | 说明 |
| --- | --- | --- |
| \`enabled\` | \`true\` | \`false\` 整体关闭文件快照（rollback/regenerate 只截断） |
| \`maxFiles\` | \`100000\` | 单快照最大文件数（超限该 turn 无快照） |
| \`maxFileBytes\` | \`16777216\` | 单文件最大字节（16MB） |
| \`maxSnapshotBytes\` | \`536870912\` | 单快照聚合最大字节（512MB） |
| \`maxTurnsPerSession\` | \`30\` | 每会话保留的 turn 快照数（超出裁最旧） |
| \`excludePrefixes\` | \`[]\` | 清点层排除前缀（仓库相对，目录以 \`/\` 结尾，如 \`_pipeline/\`）；被排除路径永不快照、永不回退 |

例：

\`\`\`yaml
- insert:
    - id: dsht-undo
      name: 'dsht-plugin-undo'
      config:
        maxFiles: 100000
        excludePrefixes: ['_pipeline/']
\`\`\`

## 安装

1. 把本目录整个拷进目标 DSH profile 的 node_modules：
   \`$DSH_HOME/profiles/<profile>/node_modules/dsht-plugin-undo/\`
   （\`$DSH_HOME\` 缺省 \`~/.dsh\`；web profile 即 \`profiles/web\`）
2. 在该 profile 的 \`cordis.patch.yml\` 里加一行插件声明（无此文件则新建）：

   \`\`\`yaml
   - insert:
       - id: dsht-undo
         name: 'dsht-plugin-undo'
   \`\`\`

3. 重启 DSH。host 日志出现 \`[dsht-plugin-undo] data plane on webServer route /dsht-undo/*\`
   即挂载成功；会话界面 user 气泡下出现「↩ 回退到此处」、最后一条回复出现「↻ 重新生成」。

## 卸载

删 node_modules/dsht-plugin-undo 与 cordis.patch.yml 里对应三行即可——
user 节点 shadowing 消失，官方渲染器复位，DSH 原生功能完整。

## 恢复误操作

每次截断前在同目录留有 \`session.jsonl.bak\`（截断前的完整内容）；
需要恢复时关闭会话，用 .bak 覆盖回 session.jsonl 即可。
`)

console.log(`dsht-plugin-undo: dist/dsht-plugin-undo/ (lib/index.js + lib/client.js + package.json + README.md) built`)
