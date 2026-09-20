#!/usr/bin/env node
/**
 * deb-unpack.mjs — 解 deb 到目录（ar 拆 data.tar.* → tar 解开）
 * 用法：node scripts/deb-unpack.mjs <deb 文件> <目标目录>
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { parseAr } from './fetch-native-libs.mjs'

const [deb, outDir] = process.argv.slice(2)
if (!deb || !outDir) { console.error('用法：node scripts/deb-unpack.mjs <deb> <目录>'); process.exit(2) }
const members = parseAr(fs.readFileSync(deb))
const data = members.find(m => m.name.startsWith('data.tar'))
if (!data) throw new Error('找不到 data.tar.*')
fs.mkdirSync(outDir, { recursive: true })
const dp = path.join(outDir, data.name)
fs.writeFileSync(dp, data.data)
execFileSync('tar', ['-xf', dp, '-C', outDir], { stdio: 'inherit' })
fs.rmSync(dp, { force: true })
console.log(`解包完成：${path.basename(deb)} → ${outDir}`)
