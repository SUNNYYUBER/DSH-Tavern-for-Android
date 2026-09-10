/**
 * @deepseek-ai/dsh-win32-process — Android/Linux stub
 * ============================================================================
 * 【DSHT-ANDROID-WIN32-STUB】
 *
 * 背景（2026-09-10 心跳 41 实证）：
 *   DSH 0.1.5 的 `dsh-subprocess-local` 新增了**静态导入**：
 *     import { loadWin32ProcessBindings, probeCurrentTokenJobSupport }
 *       from "@deepseek-ai/dsh-win32-process";
 *     import { Win32Error, closeHandleChecked, isJobEmpty, loadWin32ProcessBindings,
 *              pollProcessExit, spawnCurrentTokenJobProcess, terminateJob }
 *       from "@deepseek-ai/dsh-win32-process";
 *   而 `pnpm install` 在非 win32 平台**不会安装**该包（平台过滤），
 *   导致模块解析失败 → SyntaxError → **整个 cordis plugin tree 加载崩溃**
 *   → DSH 启动失败（端口 3080 未监听）。
 *
 * 症状（实机 logcat）：
 *   failed to import loader entry subprocess (@deepseek-ai/dsh-subprocess-local):
 *   The requested module '@deepseek-ai/dsh-win32-process' does not provide
 *   an export named 'loadWin32ProcessBindings'
 *
 * 本 stub 的策略（与 stubs 六件套同款，"可加载但不可用"）：
 *   · 导出消费方需要的**全部 21 个符号**，保证静态导入可解析 → 模块树能加载
 *   · Win32 专属功能：**抛 Win32Error**（Android 上绝无合法调用点；
 *     真正走 Windows 沙箱的路径已被 stubs/dsh-sandbox-windows-acl 短路）
 *   · 探测类 API 返回"不支持"的安全默认值
 *
 * 合规边界：本文件是**新增的 stub 包**，不改动 DSH 官方源码（与其余 stub 一致）。
 * 消费方：
 *   · dsh-subprocess-local/lib/index.js + runner.js
 *   · dsh-sandbox-windows-acl/lib/types-*.js（该包本身已被 stub）
 */

/** Win32 API 调用失败。 */
export class Win32Error extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'Win32Error';
    this.code = code;
  }
}

/** Win32 ERROR_INSUFFICIENT_BUFFER 常量。 */
export const ERROR_INSUFFICIENT_BUFFER = 122;

// ---------------------------------------------------------------- 探测类（返回安全默认）
/**
 * 加载 Win32 进程绑定。Android/SELinux 环境无 Win32——
 * 返回空绑定对象，使调用方拿到稳定形状而非 undefined。
 */
export function loadWin32ProcessBindings() {
  return {};
}

/**
 * 探测当前令牌的 Job Object 支持。非 Windows 恒为"不支持"。
 * 返回形状与官方一致：`{ supported: boolean, ... }`
 */
export function probeCurrentTokenJobSupport() {
  return { supported: false };
}

/** 扩展绑定（0.1.2 时代 API，保留以兼容旧调用点）。 */
export function extendWin32ProcessBindings(bindings) {
  return { ...(bindings ?? {}) };
}

// ---------------------------------------------------------------- 功能类（抛错：Android 无合法调用点）
function win32Unavailable(api) {
  throw new Win32Error(
    `[DSHT-ANDROID-WIN32-STUB] ${api} is a Win32-only primitive and is unavailable on this platform ` +
    `(process.platform=${process.platform}). If you reached this, a Windows-only code path ` +
    `was not short-circuited — check stubs/dsh-sandbox-windows-acl.`,
  );
}

/** 分配指针槽位。 */
export function allocPtrSlot() { return win32Unavailable('allocPtrSlot'); }
/** 分配 uint32。 */
export function allocUint32() { return win32Unavailable('allocUint32'); }
/** 解码指针。 */
export function decodePtr() { return win32Unavailable('decodePtr'); }
/** 解码 uint32。 */
export function decodeUint32() { return win32Unavailable('decodeUint32'); }
/** 关闭句柄（带校验）。 */
export function closeHandleChecked() { return win32Unavailable('closeHandleChecked'); }
/** 排空管道。 */
export function drainPipe() { return win32Unavailable('drainPipe'); }
/** Job 是否为空。 */
export function isJobEmpty() { return win32Unavailable('isJobEmpty'); }
/** 指针是否为空。 */
export function isNullPtr() { return true; }
/** 轮询进程退出。 */
export function pollProcessExit() { return win32Unavailable('pollProcessExit'); }
/** 在当前令牌的 Job 中派生进程。 */
export function spawnCurrentTokenJobProcess() { return win32Unavailable('spawnCurrentTokenJobProcess'); }
/** 派生继承 Job 的进程。 */
export function spawnInheritedJobProcess() { return win32Unavailable('spawnInheritedJobProcess'); }
/** 派生带管道的进程。 */
export function spawnPipedProcess() { return win32Unavailable('spawnPipedProcess'); }
/** 终止 Job。 */
export function terminateJob() { return win32Unavailable('terminateJob'); }
/** 抛出最近一次 Win32 错误。 */
export function throwLastError() { return win32Unavailable('throwLastError'); }
/** 抛出指定 Win32 错误。 */
export function throwWin32() { return win32Unavailable('throwWin32'); }
/** 等待进程退出。 */
export function waitForProcessExit() { return win32Unavailable('waitForProcessExit'); }
