// DSHTavern Android stub：node-pty（**仅供 PC android-sim 验证临时替换**）
//
// 【为什么还存在这个文件】W-1 已用 NDK 自编译真 node-pty（prebuilds/android-*），
// 真机路径**不再用 stub**。但 PC 上的 android-sim 验证（Step 4）把
// process.platform 伪装成 linux ⇒ node-pty 会去找 `prebuilds/linux-x64/pty.node`，
// 而那是 **glibc 编译的 Linux .so，Windows node 无法 dlopen**（报 "Cannot find module"）。
// ⇒ sim 验证期间必须临时用本 stub 顶替 JS 层，验完由构建脚本还原上游原版。
// 这不是「降级」，而是「PC 无法承载真 PTY」的如实处置。
"use strict";

function unavailable() {
  throw new Error("node-pty native module is stubbed during PC android-sim verification (real PTY is Android-only)");
}

class PtyStub {
  constructor() {
    throw new Error("node-pty is stubbed during PC android-sim verification");
  }
}

function spawn() {
  unavailable();
}

module.exports = {
  spawn,
  Pty: PtyStub,
  write: unavailable,
  kill: unavailable,
  resize: unavailable,
  clear: unavailable,
  pause: unavailable,
  resume: unavailable,
};
module.exports.default = module.exports;
