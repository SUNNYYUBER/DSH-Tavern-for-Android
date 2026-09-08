// build-mobile.mjs — dsht-plugin-mobile 构建（DSH client bundle wire 契约，与 build-rp-ui.mjs 同款）
// 产物 lib/client.js = CJS factory：
//   window.__ModuleLoader__.load({ id: 'dsht-plugin-mobile', factory: (require) => { ... return module.exports; } });
// externals 走 shell 模块表（platform.ts PLATFORM_MODULES 基线），require() 在浏览器由模块表应答。
// 用法：node scripts/build-mobile.mjs   （在 rp-workspace\packages 下或任意 cwd 均可）
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// esbuild 从 packages/ 的 node_modules 解析（脚本自身目录无依赖）
const require = createRequire(resolve(dirname(fileURLToPath(import.meta.url)), '../packages/package.json'))
const { build } = require('esbuild')

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../packages/src/dsht-plugin-mobile')
const outdir = resolve(pkgRoot, 'lib')
mkdirSync(outdir, { recursive: true })

// node 侧主入口（空壳：cordis Loader node 半边激活用）
const nodeEntry = await build({
  entryPoints: [resolve(pkgRoot, 'index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: resolve(outdir, 'index.js'),
  logLevel: 'warning',
})

// 浏览器侧 client bundle（wire 契约 CJS factory）
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
    // banner 模块 id 与包名一致（ClientModuleRegistry 按包名登记）。
    js: `window.__ModuleLoader__.load({ id: "dsht-plugin-mobile", factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
  },
  footer: {
    js: `return module.exports; } });`,
  },
  logLevel: 'info',
})

if (result.errors.length > 0 || nodeEntry.errors.length > 0) process.exit(1)
console.log(`dsht-plugin-mobile: lib/index.js (node shell) + lib/client.js (browser wire) built`)
