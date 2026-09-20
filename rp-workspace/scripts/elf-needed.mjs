#!/usr/bin/env node
/**
 * elf-needed.mjs — 解析 ELF64 的 DT_NEEDED（动态依赖库清单）
 * 用法：node scripts/elf-needed.mjs <elf 文件> [...]
 * 只读 ELF header/program headers/dynamic section，不执行任何代码。
 */
import fs from 'node:fs'

function needed (file) {
  const buf = fs.readFileSync(file)
  if (buf.readUInt32LE(0) !== 0x464c457f) throw new Error('不是 ELF')
  if (buf[4] !== 2) throw new Error('只支持 ELF64')
  const le = true
  const r16 = (o) => le ? buf.readUInt16LE(o) : buf.readUInt16BE(o)
  const r64 = (o) => le ? Number(buf.readBigUInt64LE(o)) : Number(buf.readBigUInt64BE(o))
  const phoff = r64(0x20), phentsize = r16(0x36), phnum = r16(0x38)
  // 找 PT_DYNAMIC (2)
  let dynOff = 0, dynSize = 0
  for (let i = 0; i < phnum; i++) {
    const o = phoff + i * phentsize
    if (buf.readUInt32LE(o) === 2) { dynOff = r64(o + 8); dynSize = r64(o + 32); break }
  }
  if (!dynOff) return { interp: null, needed: [], runpath: [] }
  // INTERP (PT_INTERP=3)
  let interp = null
  for (let i = 0; i < phnum; i++) {
    const o = phoff + i * phentsize
    if (buf.readUInt32LE(o) === 3) { const off = r64(o + 8), sz = r64(o + 32); interp = buf.toString('utf8', off, off + sz - 1); break }
  }
  // 扫 dynamic：DT_NEEDED(1) / DT_STRTAB(5) / DT_STRSZ(10) / DT_RUNPATH(29) / DT_RPATH(15)
  let strtab = 0, strsz = 0
  const tags = []
  for (let o = dynOff; o < dynOff + dynSize; o += 16) {
    const tag = Number(buf.readBigInt64LE(o))
    const val = r64(o + 8)
    if (tag === 0) break
    if (tag === 5) strtab = val
    else if (tag === 10) strsz = val
    else tags.push([tag, val])
  }
  // vaddr → file offset（经 PT_LOAD (1) 映射）
  const loads = []
  for (let i = 0; i < phnum; i++) {
    const o = phoff + i * phentsize
    if (buf.readUInt32LE(o) === 1) loads.push({ vaddr: r64(o + 16), off: r64(o + 8), filesz: r64(o + 32) })
  }
  const v2o = (v) => { for (const l of loads) { if (v >= l.vaddr && v < l.vaddr + l.filesz) return l.off + (v - l.vaddr) } return -1 }
  const strOff = v2o(strtab)
  const readStr = (at) => { const o = strOff + at; let e = o; while (buf[e] !== 0) e++; return buf.toString('utf8', o, e) }
  const needed = [], runpath = []
  for (const [tag, val] of tags) {
    if (tag === 1) needed.push(readStr(val))
    else if (tag === 29 || tag === 15) runpath.push(readStr(val))
  }
  return { interp, needed, runpath }
}

for (const f of process.argv.slice(2)) {
  try {
    const r = needed(f)
    console.log(`${f.split(/[\\/]/).pop()}`)
    console.log(`  interp:  ${r.interp}`)
    console.log(`  needed:  ${r.needed.join(', ') || '(静态)'}`)
    if (r.runpath.length) console.log(`  runpath: ${r.runpath.join(' | ')}`)
  } catch (e) { console.log(`${f}: ${e.message}`) }
}
