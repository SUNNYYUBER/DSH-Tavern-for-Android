// DSHTavern sharp 降级模块（**仅 PC android-sim 验证期临时替换**）
//
// ## 用途变更（2026-09-21 W-5）
// 真机路径**不再用本文件**：W-5 已接入 `@img/sharp-wasm32`，sharp 主包在 Android
// 自动回退 wasm（官方 dist/sharp.cjs:102-108 的兜底分支），实测 19/19 判据通过。
// 但 PC 的 android-sim 验证（Step 4）里，sharp 主包会尝试加载 **linux glibc 的
// .node 预编译产物**，而 Windows node 无法 dlopen Linux .so ⇒ sim 期间临时用本
// 模块顶替，验完由构建脚本还原上游原版（与 stubs/node-pty-sim 同款处置）。
//
// ## ★ 收紧为「纯受控报错」（消除静默失败面）
// 原实现把 `toBuffer()` / `toFile()` / `resize()` 等写成**静默空实现**
// （返回空 Buffer / 空对象 / 链式空转）。它当前之所以安全，**仅仅因为**
// `dsh-attachment-local` 契约性地先调 `metadata()` 探测；一旦上游新增一条
// 「不先探测直接编码」的调用点，就会静默产出 0 字节 buffer 并被当成合法图片。
//
// 本项目对此有明确纪律（见 `host-st-surface.ts` 的 CROP 处置：
// 「**不实现** → 显式 reject + 记台账，**绝不返回假图片**」），
// 故本文件全部方法统一抛错 —— 「要么正确，要么出声」。
"use strict";

const UNAVAILABLE = "sharp is not available during PC android-sim verification (real image pipeline uses @img/sharp-wasm32 on Android)";

function unavailable() {
  throw new Error(UNAVAILABLE);
}

function makePipeline() {
  // 链式方法也抛错——**不做空转**（空转会让调用方以为处理成功了）
  return {
    metadata: async () => { throw new Error(UNAVAILABLE); },
    raw: unavailable,
    toBuffer: async () => { throw new Error(UNAVAILABLE); },
    toFile: async () => { throw new Error(UNAVAILABLE); },
    resize: unavailable,
    rotate: unavailable,
    composite: unavailable,
    jpeg: unavailable,
    png: unavailable,
    webp: unavailable,
    avif: unavailable,
    clone: unavailable,
  };
}

function sharp() {
  return makePipeline();
}

// 静态属性保持「可读的空值」而不是抛错：调用方常在模块级探测它们，
// 抛错会让 import 整个失败（而我们要的是「调用时才出声」）。
sharp.format = {};
sharp.versions = {};
sharp.cache = () => ({ items: 0, memory: 0 });
sharp.concurrency = () => 1;
sharp.counters = () => ({ queue: 0, process: 0 });
sharp.queue = () => 0;
module.exports = sharp;
module.exports.default = sharp;
