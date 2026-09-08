// DSHTavern Android stub：@deepseek-ai/dsh-sandbox-windows-acl
// 该包为 win32 专属（koffi FFI + Windows 安全描述符），且在模块顶层调用 koffi.pointer
// —— 不 stub 则任何平台加载 dsh-sandbox-local 即崩。
// Android/linux 不会真正调用这些 API（调用即抛错）；此处仅保证模块可加载。
"use strict";

export class Win32Error extends Error {
  constructor(message) {
    super(message ?? "Win32Error (DSHTavern Android stub)");
    this.name = "Win32Error";
  }
}

export class AclWriteGrant {
  constructor() {
    throw new Error("AclWriteGrant is not available in the DSHTavern Android build (win32-only)");
  }
}

export function tempWriteSid() {
  throw new Error("tempWriteSid is not available in the DSHTavern Android build (win32-only)");
}

export function workspaceWriteSid() {
  throw new Error("workspaceWriteSid is not available in the DSHTavern Android build (win32-only)");
}

export function assertTempRootOutsideWorkspace() {
  throw new Error("assertTempRootOutsideWorkspace is not available in the DSHTavern Android build (win32-only)");
}

export function quoteArg(arg) {
  // 纯字符串处理，无害实现（与上游语义近似：空格/引号安全引用）
  if (arg === "") return '""';
  if (/[\s"]/.test(arg)) return '"' + arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '"$1"') + '"';
  return arg;
}

export class AclSandbox {
  constructor() {
    throw new Error("AclSandbox is not available in the DSHTavern Android build (win32-only)");
  }
}

export default {
  Win32Error, AclWriteGrant, AclSandbox,
  tempWriteSid, workspaceWriteSid,
  assertTempRootOutsideWorkspace, quoteArg,
};
