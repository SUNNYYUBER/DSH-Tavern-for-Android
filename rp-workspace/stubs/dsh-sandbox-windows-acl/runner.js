// DSHTavern Android stub：dsh-sandbox-windows-acl/runner（win32 CLI 入口）
// 原 runner 用 koffi 施加 Windows ACL 限制——Android 上不可用；以 125 退出
// （与 LAUNCHER_FAILURE_EXIT 语义一致：launcher 级失败）。
"use strict";
console.error("dsh-sandbox-windows-acl runner is not available in the DSHTavern Android build");
process.exit(125);
