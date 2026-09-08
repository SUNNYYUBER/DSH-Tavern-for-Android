/**
 * P2#14 受管预设安装（digest + owner manifest 幂等安装）
 *
 * 参考 dsh-agent-rp src/preset.ts L107 installBundledAgentRpPreset（MIT）：
 * 预设目录带 `.dsht-rp-owner.json`（{owner, format:0, digest: sha256}），
 * 重装/升级时先比对当前内容与 manifest digest——
 * - 用户没动过（digest 一致）→ 幂等更新（staging 目录 + rename 原子替换）；
 * - 用户动过（digest 不一致 / owner=user / 无 manifest 的存量预设）→ 保留用户版本，
 *   返回 conflict 由调用方在响应/日志如实报告（force 可显式接管）。
 */

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

/** owner manifest 文件名（隐藏文件，随预设目录同生共死） */
export const PRESET_OWNER_MANIFEST = '.dsht-rp-owner.json'

/** dsht-import 受管（preset/import-st 路由产物）或用户已接管（preset/save 保存过） */
export type PresetOwner = 'dsht-rp:import-st' | 'user'

export interface PresetOwnerManifest {
  readonly owner: PresetOwner
  readonly format: 0
  readonly digest: string
}

/** 受管内容文件（preset.json、regex.json；manifest 不入列） */
export interface PresetContentFile {
  readonly name: string
  readonly content: string
}

/** 一次幂等安装的可观测结果 */
export type ManagedInstallResult =
  | { readonly outcome: 'created' | 'updated' | 'unchanged' }
  | {
      readonly outcome: 'conflict'
      /** unknown=存量/旁路直写（无 manifest）；user-owned=用户已保存接管；modified=受管内容被本地改动 */
      readonly reason: 'unknown' | 'user-owned' | 'modified'
    }

/** 内容 digest：文件名与内容配对进 sha256（排序无关） */
export function digestPresetFiles(files: readonly PresetContentFile[]): string {
  const hash = createHash('sha256')
  const sorted = [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const f of sorted) {
    hash.update(f.name)
    hash.update('\0')
    hash.update(f.content)
    hash.update('\0')
  }
  return hash.digest('hex')
}

/** 读目录内全部内容文件（manifest 除外；子目录记为空内容占位使 digest 变化） */
async function readDirContentFiles(dir: string): Promise<PresetContentFile[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: PresetContentFile[] = []
  for (const entry of entries) {
    if (entry.name === PRESET_OWNER_MANIFEST) continue
    if (entry.isDirectory()) {
      files.push({ name: `${entry.name}/`, content: '' })
      continue
    }
    files.push({ name: entry.name, content: await readFile(join(dir, entry.name), 'utf8') })
  }
  return files
}

/** 读 owner manifest；缺失或非法（owner/format/digest 形状不符）一律 null → 按未知来源保守处理 */
export async function readPresetOwnerManifest(dir: string): Promise<PresetOwnerManifest | null> {
  let value: unknown
  try {
    value = JSON.parse(await readFile(join(dir, PRESET_OWNER_MANIFEST), 'utf8'))
  } catch {
    return null
  }
  const record = value as Partial<PresetOwnerManifest> | null
  if ((record?.owner !== 'dsht-rp:import-st' && record?.owner !== 'user')
    || record.format !== 0 || typeof record.digest !== 'string') {
    return null
  }
  return record as PresetOwnerManifest
}

type ManagedStatus =
  | { readonly kind: 'absent' }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'user-owned'; readonly manifest: PresetOwnerManifest }
  | { readonly kind: 'unmodified'; readonly manifest: PresetOwnerManifest }
  | { readonly kind: 'modified'; readonly manifest: PresetOwnerManifest }

async function inspectManagedPreset(dir: string): Promise<ManagedStatus> {
  let files: PresetContentFile[]
  try {
    files = await readDirContentFiles(dir)
  } catch {
    return { kind: 'absent' } // 目录不存在
  }
  const manifest = await readPresetOwnerManifest(dir)
  if (!manifest) return { kind: 'unknown' }
  if (manifest.owner === 'user') return { kind: 'user-owned', manifest }
  return digestPresetFiles(files) === manifest.digest
    ? { kind: 'unmodified', manifest }
    : { kind: 'modified', manifest }
}

/**
 * 幂等安装/升级受管预设。
 * @param dir 目标预设目录（$DSH_HOME/rp-presets/<id>）
 * @param files 受管内容文件（preset.json + 可选 regex.json；不给的文件在升级时被移除）
 * @param owner 安装方标记（import-st 路由固定 'dsht-rp:import-st'）
 * @param force 显式接管：无视 conflict 强制覆盖（并把 owner 重写为安装方）
 */
export async function installManagedPreset(
  dir: string,
  files: readonly PresetContentFile[],
  owner: PresetOwner,
  options: { force?: boolean } = {},
): Promise<ManagedInstallResult> {
  const status = await inspectManagedPreset(dir)
  const sourceDigest = digestPresetFiles(files)
  if (status.kind !== 'absent' && options.force !== true) {
    if (status.kind === 'unknown') return { outcome: 'conflict', reason: 'unknown' }
    if (status.kind === 'user-owned') return { outcome: 'conflict', reason: 'user-owned' }
    if (status.kind === 'modified') return { outcome: 'conflict', reason: 'modified' }
    if (status.manifest.digest === sourceDigest) return { outcome: 'unchanged' }
  }

  const manifest: PresetOwnerManifest = { owner, format: 0, digest: sourceDigest }
  const parent = dirname(dir)
  const base = basename(dir)
  await mkdir(parent, { recursive: true })
  // staging 目录写完再 rename——目标目录从不出现半成品状态
  const staging = join(parent, `.${base}.install-${process.pid}-${randomUUID()}`)
  await mkdir(staging, { recursive: true })
  try {
    for (const f of files) {
      await writeFile(join(staging, f.name), f.content, 'utf8')
    }
    await writeFile(join(staging, PRESET_OWNER_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }

  if (status.kind === 'absent') {
    try {
      await rename(staging, dir)
      return { outcome: 'created' }
    } catch (error) {
      await rm(staging, { recursive: true, force: true })
      throw error
    }
  }

  // 已存在：先 rename 到 backup 再换入 staging，失败回滚
  const backup = join(parent, `.${base}.backup-${process.pid}-${randomUUID()}`)
  await rename(dir, backup)
  try {
    await rename(staging, dir)
  } catch (error) {
    await rename(backup, dir)
    await rm(staging, { recursive: true, force: true })
    throw error
  }
  await rm(backup, { recursive: true, force: true })
  return { outcome: 'updated' }
}

/**
 * 用户保存（preset/save）后标记用户接管：manifest owner=user + 当前内容 digest。
 * 之后 import-st 同 id 重装会得到 conflict(user-owned) 而非静默冲掉用户改动。
 */
export async function markPresetUserOwned(dir: string): Promise<void> {
  const files = await readDirContentFiles(dir)
  const manifest: PresetOwnerManifest = { owner: 'user', format: 0, digest: digestPresetFiles(files) }
  await writeFile(join(dir, PRESET_OWNER_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}
