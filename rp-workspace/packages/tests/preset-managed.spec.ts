import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  PRESET_OWNER_MANIFEST,
  digestPresetFiles,
  installManagedPreset,
  markPresetUserOwned,
  readPresetOwnerManifest,
  type PresetContentFile,
} from '../src/preset/managed.ts'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsht-managed-preset-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const dir = (id = 'st-fox'): string => join(root, 'rp-presets', id)
const filesV1 = (): PresetContentFile[] => [
  { name: 'preset.json', content: JSON.stringify({ schemaVersion: 1, id: 'st-fox', v: 1 }, null, 1) },
  { name: 'regex.json', content: JSON.stringify({ scripts: [{ id: 'r1' }] }, null, 1) },
]
const filesV2 = (): PresetContentFile[] => [
  { name: 'preset.json', content: JSON.stringify({ schemaVersion: 1, id: 'st-fox', v: 2 }, null, 1) },
]

describe('P2#14 受管预设：digest + owner manifest 幂等安装（参考 dsh-agent-rp preset.ts L107，MIT）', () => {
  it('首装 created：文件 + manifest 落盘，manifest digest 与内容一致', async () => {
    const files = filesV1()
    const r = await installManagedPreset(dir(), files, 'dsht-rp:import-st')
    expect(r).toEqual({ outcome: 'created' })
    expect(await readdir(dir())).toEqual(expect.arrayContaining(['preset.json', 'regex.json', PRESET_OWNER_MANIFEST]))
    const manifest = await readPresetOwnerManifest(dir())
    expect(manifest?.owner).toBe('dsht-rp:import-st')
    expect(manifest?.format).toBe(0)
    expect(manifest?.digest).toBe(digestPresetFiles(files))
  })

  it('同内容重装 unchanged：幂等，不产生 staging/backup 残留', async () => {
    await installManagedPreset(dir(), filesV1(), 'dsht-rp:import-st')
    const r = await installManagedPreset(dir(), filesV1(), 'dsht-rp:import-st')
    expect(r).toEqual({ outcome: 'unchanged' })
    const siblings = await readdir(join(root, 'rp-presets'))
    expect(siblings.filter(n => n.startsWith('.'))).toEqual([])
  })

  it('受管未动 + 新内容 → updated；不再给的文件（regex.json）随整目录替换移除', async () => {
    await installManagedPreset(dir(), filesV1(), 'dsht-rp:import-st')
    const r = await installManagedPreset(dir(), filesV2(), 'dsht-rp:import-st')
    expect(r).toEqual({ outcome: 'updated' })
    const entries = await readdir(dir())
    expect(entries).toContain('preset.json')
    expect(entries).not.toContain('regex.json') // 整目录原子替换，旧受管文件清掉
    expect(JSON.parse(await readFile(join(dir(), 'preset.json'), 'utf8')).v).toBe(2)
    expect((await readPresetOwnerManifest(dir()))?.digest).toBe(digestPresetFiles(filesV2()))
  })

  it('用户手改受管文件 → conflict(modified)，用户版本原样保留', async () => {
    await installManagedPreset(dir(), filesV1(), 'dsht-rp:import-st')
    const edited = JSON.stringify({ schemaVersion: 1, id: 'st-fox', v: 1, userNote: '我改的' }, null, 1)
    await writeFile(join(dir(), 'preset.json'), edited, 'utf8')
    const r = await installManagedPreset(dir(), filesV2(), 'dsht-rp:import-st')
    expect(r).toEqual({ outcome: 'conflict', reason: 'modified' })
    expect(await readFile(join(dir(), 'preset.json'), 'utf8')).toBe(edited) // 未被冲掉
  })

  it('目录多出未登记文件 → conflict(modified)（保守视作本地改动）', async () => {
    await installManagedPreset(dir(), filesV1(), 'dsht-rp:import-st')
    await writeFile(join(dir(), 'notes.txt'), '用户自己的笔记', 'utf8')
    const r = await installManagedPreset(dir(), filesV2(), 'dsht-rp:import-st')
    expect(r).toEqual({ outcome: 'conflict', reason: 'modified' })
  })

  it('preset/save 后（markPresetUserOwned）→ conflict(user-owned)，导入不冲掉用户接管的预设', async () => {
    await installManagedPreset(dir(), filesV1(), 'dsht-rp:import-st')
    await markPresetUserOwned(dir()) // 模拟 /preset/save 用户保存
    expect((await readPresetOwnerManifest(dir()))?.owner).toBe('user')
    const r = await installManagedPreset(dir(), filesV2(), 'dsht-rp:import-st')
    expect(r).toEqual({ outcome: 'conflict', reason: 'user-owned' })
    expect(JSON.parse(await readFile(join(dir(), 'preset.json'), 'utf8')).v).toBe(1)
  })

  it('存量无 manifest 预设 → conflict(unknown) 保守保留', async () => {
    const legacy = JSON.stringify({ schemaVersion: 1, id: 'st-fox', legacy: true }, null, 1)
    const { mkdir } = await import('node:fs/promises')
    await mkdir(dir(), { recursive: true })
    await writeFile(join(dir(), 'preset.json'), legacy, 'utf8')
    const r = await installManagedPreset(dir(), filesV2(), 'dsht-rp:import-st')
    expect(r).toEqual({ outcome: 'conflict', reason: 'unknown' })
    expect(await readFile(join(dir(), 'preset.json'), 'utf8')).toBe(legacy)
  })

  it('manifest 非法（形状不符）→ 按未知来源 conflict(unknown)', async () => {
    await installManagedPreset(dir(), filesV1(), 'dsht-rp:import-st')
    await writeFile(join(dir(), PRESET_OWNER_MANIFEST), '{"owner":"someone-else"}', 'utf8')
    const r = await installManagedPreset(dir(), filesV2(), 'dsht-rp:import-st')
    expect(r).toEqual({ outcome: 'conflict', reason: 'unknown' })
  })

  it('force:true 显式接管：冲突被无视，内容覆盖且 owner 重写为安装方', async () => {
    await installManagedPreset(dir(), filesV1(), 'dsht-rp:import-st')
    await markPresetUserOwned(dir())
    const r = await installManagedPreset(dir(), filesV2(), 'dsht-rp:import-st', { force: true })
    expect(r).toEqual({ outcome: 'updated' })
    expect(JSON.parse(await readFile(join(dir(), 'preset.json'), 'utf8')).v).toBe(2)
    expect((await readPresetOwnerManifest(dir()))?.owner).toBe('dsht-rp:import-st')
  })

  it('digest 与文件顺序无关；内容不同 digest 不同', () => {
    const a = filesV1()
    const b = [...filesV1()].reverse()
    expect(digestPresetFiles(a)).toBe(digestPresetFiles(b))
    expect(digestPresetFiles(a)).not.toBe(digestPresetFiles(filesV2()))
  })
})
