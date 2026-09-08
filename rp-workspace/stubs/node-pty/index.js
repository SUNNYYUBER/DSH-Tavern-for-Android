// DSHTavern Android stub：node-pty
// 原生 prebuild（linux-arm64 为 glibc 编译）在 Android bionic 上 dlopen 失败，
// 而 subprocess-local 顶层静态 import node-pty —— 不 stub 则整个启动链崩。
// Android 上 PTY 能力降级：spawn 抛受控错误；DSH 的 bash 工具走 child_process
// 路径（subprocess-local 同时 import 了 node:child_process 的 spawn）不受影响。
"use strict";

function unavailable() {
  throw new Error("node-pty is not available in the DSHTavern Android build (bionic cannot load glibc prebuilds)");
}

class PtyStub {
  constructor() {
    throw new Error("node-pty is not available in the DSHTavern Android build");
  }
}

function spawn() {
  unavailable();
}

module.exports = {
  spawn,
  Pty: PtyStub,
  // node-pty 其他导出一并占位
  write: unavailable,
  kill: unavailable,
  resize: unavailable,
  clear: unavailable,
  pause: unavailable,
  resume: unavailable,
};
module.exports.default = module.exports;
