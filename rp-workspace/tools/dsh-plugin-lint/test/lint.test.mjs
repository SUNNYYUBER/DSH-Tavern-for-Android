/**
 * lint.test.mjs —— dsh-plugin-lint 合成 fixtures 测试（node --test）
 * ============================================================================
 * 合成最小包模拟各踩雷模式；真实 5 包金标准回放见 test/golden-replay.mjs。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { lintPackage, scanSpecifiers } from '../lint.mjs'

/** 造一个最小包目录 */
function mkpkg (files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lint-test-'))
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, content)
  }
  return dir
}

const GOOD_PKG = JSON.stringify({
  name: 'dsh-good', version: '1.0.0', main: './lib/index.js', type: 'module',
  description: 'good', license: 'MIT',
  exports: { '.': './lib/index.js', './client': './lib/client.js' },
  dsh: { client: { platform: 'web' } },
  engines: { node: '>=22.19.0', dsh: '>=0.1.5-rc.1 <0.1.6' },
})

test('pass：干净包（cordis/官方包/node 内建 + engines.dsh + patch.yml）', () => {
  const dir = mkpkg({
    'package.json': GOOD_PKG,
    'cordis.patch.yml': '- insert:\n    - id: good\n      name: dsh-good\n',
    'lib/index.js': 'import { Context } from "cordis"\nimport fs from "node:fs"\nexport const x = 1\n',
    'lib/client.js': 'window.__ModuleLoader__.load({ id: "dsh-good", factory: (require) => { const r = require("react") } })\n',
  })
  const r = lintPackage(dir)
  assert.equal(r.verdict, 'pass', JSON.stringify(r.findings, null, 1))
})

test('fail ⑨：相对 import 缺文件（zhipu 案形态）', () => {
  const dir = mkpkg({
    'package.json': GOOD_PKG,
    'cordis.patch.yml': '- insert: []\n',
    'lib/index.js': 'import { x } from "./missing.js"\nexport { x }\n',
    'lib/client.js': '',
  })
  const r = lintPackage(dir)
  assert.equal(r.verdict, 'fail')
  assert.ok(r.findings.some(f => f.rule === 'S1-closure' && f.detail.includes('missing.js')))
})

test('fail：bare import 未声明', () => {
  const dir = mkpkg({
    'package.json': GOOD_PKG,
    'cordis.patch.yml': '- insert: []\n',
    'lib/index.js': 'import { zai } from "@earendil-works/pi-ai/providers/zai"\nexport { zai }\n',
    'lib/client.js': '',
  })
  const r = lintPackage(dir)
  assert.ok(r.findings.some(f => f.rule === 'S2-bare-undeclared' && f.detail.includes('@earendil-works/pi-ai')))
})

test('fail：两形态清单均无（装不上）', () => {
  const dir = mkpkg({
    'package.json': GOOD_PKG,
    'lib/index.js': 'export const x = 1\n',
    'lib/client.js': '',
  })
  const r = lintPackage(dir)
  assert.ok(r.findings.some(f => f.rule === 'S3-plugin-manifest'))
})

test('risk ⑧：client 侧 sessions.binding + getSnapshot().chat（turn-index 案形态）', () => {
  const dir = mkpkg({
    'package.json': GOOD_PKG,
    'cordis.patch.yml': '- insert: []\n',
    'lib/index.js': 'export const x = 1\n',
    'lib/client.js': 'const b = sessions.binding(id); const snap = b.session.getSnapshot(); const order = snap.chat.order\n',
  })
  const r = lintPackage(dir)
  assert.equal(r.verdict, 'risk')
  assert.ok(r.findings.filter(f => f.rule === 'N1-client-face').length >= 2)
})

test('risk ⑧：snapshot.nodes（outline 案形态）', () => {
  const dir = mkpkg({
    'package.json': GOOD_PKG,
    'cordis.patch.yml': '- insert: []\n',
    'lib/index.js': 'export const x = 1\n',
    'lib/client.js': 'for (const n of snapshot.nodes) console.log(n)\n',
  })
  const r = lintPackage(dir)
  assert.equal(r.verdict, 'risk')
  assert.ok(r.findings.some(f => f.typology === '⑧'))
})

test('risk：原生模块（A1）', () => {
  const dir = mkpkg({
    'package.json': GOOD_PKG,
    'cordis.patch.yml': '- insert: []\n',
    'lib/index.js': 'import sharp from "sharp"\nexport const x = 1\n',
    'lib/client.js': '',
  })
  const r = lintPackage(dir)
  assert.ok(r.findings.some(f => f.rule === 'A1-native-module' && f.detail.includes('sharp')))
})

test('info：spawn 白名单外工具（A2）；白名单内不报', () => {
  const dir = mkpkg({
    'package.json': GOOD_PKG,
    'cordis.patch.yml': '- insert: []\n',
    'lib/index.js': 'import { execFile } from "node:child_process"\nexecFile("ffmpeg", [])\nexecFile("bash", ["-c", "true"])\nexport const x = 1\n',
    'lib/client.js': '',
  })
  const r = lintPackage(dir)
  assert.ok(r.findings.some(f => f.rule === 'A2-subprocess-tool' && f.detail.includes('ffmpeg')))
  assert.ok(!r.findings.some(f => f.rule === 'A2-subprocess-tool' && f.detail.includes('"bash"')))
})

test('info：缺 engines.dsh（S4 不致命）', () => {
  const pkg = JSON.parse(GOOD_PKG); delete pkg.engines.dsh
  const dir = mkpkg({
    'package.json': JSON.stringify(pkg),
    'cordis.patch.yml': '- insert: []\n',
    'lib/index.js': 'export const x = 1\n',
    'lib/client.js': '',
  })
  const r = lintPackage(dir)
  assert.equal(r.verdict, 'pass')
  assert.ok(r.findings.some(f => f.rule === 'S4-engines-dsh'))
})

test('scanSpecifiers：静态/动态/require 三形态', () => {
  const specs = scanSpecifiers('import a from "./a.js"\nexport { b } from "./b.js"\nconst c = await import("./c.js")\nconst d = require("./d.js")\n')
  assert.deepEqual(specs.sort(), ['./a.js', './b.js', './c.js', './d.js'])
})

test('负控：react 系（client ModuleLoader external）不报 S2', () => {
  const dir = mkpkg({
    'package.json': GOOD_PKG,
    'cordis.patch.yml': '- insert: []\n',
    'lib/index.js': 'export const x = 1\n',
    'lib/client.js': 'const r = require("react"); const j = require("react/jsx-runtime")\n',
  })
  const r = lintPackage(dir)
  assert.ok(!r.findings.some(f => f.rule === 'S2-bare-undeclared'))
})
