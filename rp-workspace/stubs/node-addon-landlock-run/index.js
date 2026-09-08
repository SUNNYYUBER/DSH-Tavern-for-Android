// DSHTavern Android stub：@deepseek-ai/node-addon-landlock-run
// 原生 launcher（C 二进制，glibc）在 Android bionic 上不存在；
// probe() 返回 'unusable' 是诚实语义（Android 内核无 Landlock），
// DSH 的 SandboxUnavailableError 降级路径会接管——沙箱标记不可用但服务可启动。
"use strict";
export const LAUNCHER_BIN = "landlock-run";
export const LAUNCHER_FAILURE_EXIT = 125;

export function launcherPath(_resolvePackageJson) {
  // 指向一个永远不存在的路径（与上游"包不可解析时的 fallback"行为一致）
  return "/nonexistent/landlock-run";
}

export function grantArgs(grants) {
  const args = [];
  for (const ro of grants?.readOnly ?? []) args.push("--ro", ro);
  for (const rw of grants?.readWrite ?? []) args.push("--rw", rw);
  return args;
}

export function probe(_launcher, _options) {
  return "unusable";
}
export default { LAUNCHER_BIN, LAUNCHER_FAILURE_EXIT, launcherPath, grantArgs, probe };
