// build-rp-ui.mjs — dsht-rp-ui 构建（DSH client bundle wire 契约）
// 产物 lib/client.js = CJS factory：
//   window.__ModuleLoader__.load({ id: 'dsht-rp-ui', factory: (require) => { ... return module.exports; } });
// externals 走 shell 模块表（platform.ts PLATFORM_MODULES 基线），require() 在浏览器由模块表应答。
// 用法：node scripts/build-rp-ui.mjs   （在 rp-workspace\packages 下或任意 cwd 均可）
import { mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// esbuild 从 packages/ 的 node_modules 解析（脚本自身目录无依赖）
const require = createRequire(resolve(dirname(fileURLToPath(import.meta.url)), '../packages/package.json'))
const { build } = require('esbuild')

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../packages/src/dsht-rp-ui')
const outdir = resolve(pkgRoot, 'lib')
mkdirSync(outdir, { recursive: true })

// ---------------------------------------------------------------------------
// TH 脚本 iframe vendor（jQuery + zod v4）——构建期 iife，产物 th-vendor.gen.txt（生成物）。
// 根因：真酒馆助手（JS-Slash-Runner）的脚本 iframe 与宿主 same-origin，predefine.js 从
// 宿主合并全局（含 z = zod v4），parent_jquery.js 直接 window.$ = window.parent.$；
// RpScriptHost 已放开 sandbox allow-same-origin（用户拍板：复刻真 TH 同源形态），iframe 内
// 仍内嵌本 vendor 保证 window.$/jQuery/Zod/z 独立就绪（不依赖宿主注入时序）。
// 「变量结构 0628」卡深层报错的根因即 zod 版本：真 TH 往宿主页注入的 z 是 zod v4
//（third_party_object.ts globalThis.z = import * as z from 'zod'，^4.4.3，.prefault 原生存在），
// 旧 vendor 用的是 zod 3.25.76（v3 API 面）。现在对齐真 TH 形态：import * as z（v4 包主导出
// 即 v4 全量 namespace）。实测（zod 4.5.4）：
//   - .prefault 原生存在（v4 新 API）→ 下方垫的 if 条件自动跳过；
//   - .loose 也原生存在（v4 保留的实例兼容方法，语义 = passthrough）→ 同样自动跳过；
//   - 垫必须挂在「实例真实原型」上：v4 root namespace 导出的 ZodObject 类与
//     z.object({...}) 实例的实际原型不是同一对象，挂 root 导出类原型打不中（实测）。
//   垫保留为跨版本兜底（真环境 zod 大版本随 TH 漂移，v3/v4 都不炸）：
//   .loose()     = v4 等价 z.looseObject 同 shape 重建；无 looseObject 时退 .passthrough()（v3）
//   .prefault(v) = 输入 undefined 时以 v 预填再走原 schema（preprocess 近似，v3 无原生）
// 版本锚定：jquery 固定 3.7.1（npm --no-save 安装，勿升 4——ST 宿主 $ 是 jQuery 3，v4 移除
// $.trim/$.type/$.fn.bind 等废弃 API，第三方脚本兼容风险大）；zod ^4.4.3（真 TH 同款大版本）。
// zod 同时挂 z / Zod 两个名字（防脚本两种取法）；__dshtThVendor 标记对象供测试/排障探针
//（zod 字段 = 构建期读到的包版本，v4 形态 = 4.x）。
// ---------------------------------------------------------------------------
const vendorPkgVersion = (name) => {
  try {
    return JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), `../packages/node_modules/${name}/package.json`), 'utf8')).version ?? ''
  } catch {
    return ''
  }
}
const zodPkgVersion = vendorPkgVersion('zod')
const yamlPkgVersion = vendorPkgVersion('yaml')
const vendorEntrySource = `
import jQuery from 'jquery';
import * as z from 'zod';
import * as YAML from 'yaml';
window.$ = jQuery;
window.jQuery = jQuery;
// YAML 全局（真 TH 经 predefine 从宿主合并 globalThis.YAML；MVU bundle 顶层 YAML.parse）。
window.YAML = window.YAML ?? YAML;
// jQuery UI 组件文件是「AMD 或全局 jQuery」双模式：esbuild 打包后引用裸全局 jQuery。
// ES import 会提升——组件先于 window.jQuery 赋值执行 → ReferenceError。
// 用 require() 延迟到赋值之后（esbuild 会把 require 解析为已打包模块，调用点求值）。
// jQuery UI 单组件文件的全局模式不带依赖（core.js 是 AMD-only 弃用垫片不能用）——
// 基座按序手挂：version($.ui) → data/plugin/ie → widget($.widget) → mouse($.ui.mouse) → 组件
require('jquery-ui/ui/version.js');
require('jquery-ui/ui/data.js');
require('jquery-ui/ui/plugin.js');
require('jquery-ui/ui/ie.js');
require('jquery-ui/ui/widget.js');
require('jquery-ui/ui/widgets/mouse.js');
require('jquery-ui/ui/widgets/draggable.js');
require('jquery-ui/ui/widgets/droppable.js');
require('jquery-ui/ui/widgets/sortable.js');
require('jquery-ui/ui/widgets/resizable.js');
window.Zod = z;
window.z = z;
// ---- zod 跨版本兼容垫已删除（v4.4+ 原生有 loose/prefault，垫是给旧 zod 3.25 vendor 写的）----
// 注意：zod v4 的方法挂载是「原型惰性 getter」——首次访问 proto.method 才 bind 并缓存为
// 原型自有属性，this 从此钉死在触发访问的对象上。任何「typeof proto.method 判断后再决定
// 是否装垫」的守卫访问都会把方法毒化到原型（this=原型 → this._zod undefined → 实例调用
// .loose() 炸 reading 'def'，.strict() 炸 reading 'constr'）。今后禁止对 zod 原型做探测。
window.__dshtThVendor = { tag: 'dsht-th-vendor/2', jquery: String((jQuery && jQuery.fn && jQuery.fn.jquery) || ''), zod: ${JSON.stringify(zodPkgVersion)} };
`

// ---------------------------------------------------------------------------
// 宿主 vendor（host-vendor，vendor2）——构建期 iife，产物 th-host-vendor.gen.txt（生成物）。
// 这次不是塞 iframe：dsht-rp-ui client 启动时（client/index.tsx apply() 初始化处，经
// client/host-vendor.ts 的 installHostVendor 求值本源码）在宿主 window 上补挂缺失的全局：
//   window._ ??= lodash、window.$ ??= jQuery、window.jQuery ??= jQuery、
//   window.z ??= zod(v4 namespace)、window.Zod ??= zod、window.YAML ??= YAML
// 复刻对象：TH third_party_object.initThirdPartyObject 往宿主页注入 globalThis.z（zod v4）/
// globalThis.YAML，加上 ST 宿主自带 window.$（jQuery 3）/ window._（lodash）——DSH webui 是
// React 应用这些全局一个都没有；sandbox 放开同源后脚本里 window.parent.$ / window.parent.z
// 的取法（真 TH 脚本常态）需要宿主先有。??= 语义 = 只在 undefined 时装，绝不覆盖宿主已有。
// __dshtHostVendor 标记对象供测试/排障探针（含四包版本）。
// ---------------------------------------------------------------------------
const hostVendorEntrySource = `
import lodash from 'lodash';
import jQuery from 'jquery';
import * as zod from 'zod';
import * as YAML from 'yaml';
// jQuery UI 同款 require() 延迟（见 vendorEntrySource 注释）；同源放开后脚本拿 parent.$
// 时 draggable 等组件已在宿主 jQuery 上就绪。widget/mouse/version 依赖链按序先挂
window._ = window._ ?? lodash;
window.$ = window.$ ?? jQuery;
window.jQuery = window.jQuery ?? jQuery;
require('jquery-ui/ui/version.js');
require('jquery-ui/ui/data.js');
require('jquery-ui/ui/plugin.js');
require('jquery-ui/ui/ie.js');
require('jquery-ui/ui/widget.js');
require('jquery-ui/ui/widgets/mouse.js');
require('jquery-ui/ui/widgets/draggable.js');
require('jquery-ui/ui/widgets/droppable.js');
require('jquery-ui/ui/widgets/sortable.js');
require('jquery-ui/ui/widgets/resizable.js');
window.z = window.z ?? zod;
window.Zod = window.Zod ?? zod;
window.YAML = window.YAML ?? YAML;
window.__dshtHostVendor = { tag: 'dsht-host-vendor/1', lodash: String((lodash && lodash.VERSION) || ''), jquery: String((jQuery && jQuery.fn && jQuery.fn.jquery) || ''), zod: ${JSON.stringify(zodPkgVersion)}, yaml: ${JSON.stringify(yamlPkgVersion)} };
`

// vendor / host-vendor 先于主构建生成：主构建以文本形式内嵌它们（?raw → 见下方 rawTextPlugin）
const vendorBuild = await build({
  stdin: {
    contents: vendorEntrySource,
    sourcefile: 'th-vendor-entry.mjs',
    loader: 'js',
    resolveDir: resolve(pkgRoot, 'src/client'), // node_modules 解析起点（向上找到 packages/node_modules）
  },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  outfile: resolve(pkgRoot, 'src/client/th-vendor.gen.txt'),
  logLevel: 'warning',
})

// host-vendor（vendor2，宿主全局注入）同款构建：iife 源码字符串 → th-host-vendor.gen.txt
const hostVendorBuild = await build({
  stdin: {
    contents: hostVendorEntrySource,
    sourcefile: 'th-host-vendor-entry.mjs',
    loader: 'js',
    resolveDir: resolve(pkgRoot, 'src/client'), // node_modules 解析起点（向上找到 packages/node_modules）
  },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  outfile: resolve(pkgRoot, 'src/client/th-host-vendor.gen.txt'),
  logLevel: 'warning',
})

// ?raw 文本导入（Vite 原生约定，esbuild 无）——th-shim.ts `import src from './th-vendor.gen.txt?raw'`
const rawTextPlugin = {
  name: 'raw-text',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (args) => ({
      path: resolve(args.resolveDir, args.path.replace(/\?raw$/, '')),
      namespace: 'raw-text',
    }))
    b.onLoad({ filter: /.*/, namespace: 'raw-text' }, (args) => ({
      contents: readFileSync(args.path, 'utf8'),
      loader: 'text',
    }))
  },
}

// node 侧主入口（空壳：cordis Loader node 半边激活用）
const nodeEntry = await build({
  entryPoints: [resolve(pkgRoot, 'src/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: resolve(outdir, 'index.js'),
  logLevel: 'warning',
})

// 浏览器侧 client bundle（wire 契约 CJS factory）
const result = await build({
  entryPoints: [resolve(pkgRoot, 'src/client/index.tsx')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  outfile: resolve(outdir, 'client.js'),
  sourcemap: false,
  minify: false,
  plugins: [rawTextPlugin], // th-shim.ts 的 './th-vendor.gen.txt?raw' 文本导入
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
    // 插件合并（用户定案）：浏览器半边并入 dsht-rp-plugin 单包，模块表 id 同步改名。
    js: `window.__ModuleLoader__.load({ id: "dsht-rp-plugin", factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
  },
  footer: {
    js: `return module.exports; } });`,
  },
  logLevel: 'info',
})

if (result.errors.length > 0 || nodeEntry.errors.length > 0 || vendorBuild.errors.length > 0 || hostVendorBuild.errors.length > 0) process.exit(1)
const vendorBytes = readFileSync(resolve(pkgRoot, 'src/client/th-vendor.gen.txt'), 'utf8').length
const hostVendorBytes = readFileSync(resolve(pkgRoot, 'src/client/th-host-vendor.gen.txt'), 'utf8').length
console.log(`dsht-rp-ui: lib/index.js (node shell) + lib/client.js (browser wire) built; th-vendor.gen.txt = ${(vendorBytes / 1024).toFixed(1)}KB; th-host-vendor.gen.txt = ${(hostVendorBytes / 1024).toFixed(1)}KB`)
