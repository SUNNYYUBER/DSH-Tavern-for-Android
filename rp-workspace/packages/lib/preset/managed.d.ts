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
/** owner manifest 文件名（隐藏文件，随预设目录同生共死） */
export declare const PRESET_OWNER_MANIFEST = ".dsht-rp-owner.json";
/** dsht-import 受管（preset/import-st 路由产物）或用户已接管（preset/save 保存过） */
export type PresetOwner = 'dsht-rp:import-st' | 'user';
export interface PresetOwnerManifest {
    readonly owner: PresetOwner;
    readonly format: 0;
    readonly digest: string;
}
/** 受管内容文件（preset.json、regex.json；manifest 不入列） */
export interface PresetContentFile {
    readonly name: string;
    readonly content: string;
}
/** 一次幂等安装的可观测结果 */
export type ManagedInstallResult = {
    readonly outcome: 'created' | 'updated' | 'unchanged';
} | {
    readonly outcome: 'conflict';
    /** unknown=存量/旁路直写（无 manifest）；user-owned=用户已保存接管；modified=受管内容被本地改动 */
    readonly reason: 'unknown' | 'user-owned' | 'modified';
};
/** 内容 digest：文件名与内容配对进 sha256（排序无关） */
export declare function digestPresetFiles(files: readonly PresetContentFile[]): string;
/** 读 owner manifest；缺失或非法（owner/format/digest 形状不符）一律 null → 按未知来源保守处理 */
export declare function readPresetOwnerManifest(dir: string): Promise<PresetOwnerManifest | null>;
/**
 * 幂等安装/升级受管预设。
 * @param dir 目标预设目录（$DSH_HOME/rp-presets/<id>）
 * @param files 受管内容文件（preset.json + 可选 regex.json；不给的文件在升级时被移除）
 * @param owner 安装方标记（import-st 路由固定 'dsht-rp:import-st'）
 * @param force 显式接管：无视 conflict 强制覆盖（并把 owner 重写为安装方）
 */
export declare function installManagedPreset(dir: string, files: readonly PresetContentFile[], owner: PresetOwner, options?: {
    force?: boolean;
}): Promise<ManagedInstallResult>;
/**
 * 用户保存（preset/save）后标记用户接管：manifest owner=user + 当前内容 digest。
 * 之后 import-st 同 id 重装会得到 conflict(user-owned) 而非静默冲掉用户改动。
 */
export declare function markPresetUserOwned(dir: string): Promise<void>;
