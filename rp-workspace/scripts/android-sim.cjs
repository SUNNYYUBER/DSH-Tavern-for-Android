// DSHTavern PC 安卓条件模拟：preload 时把平台伪装成 Android/linux。
// 用法：node -r android-sim.cjs node_modules/@deepseek-ai/dsh/lib/bin.js web --no-open
// 原理：Cordis 的 disabled: !!js process.platform === 'win32' 在组合加载时执行，
// patch 后 PC 走 linux 插件路径（sandbox-windows-acl 不加载、tool-bash 启用），
// 配合 stubs 后的 runtime 即为 Android 行为的高保真 JS 层模拟。
"use strict";
Object.defineProperty(process, "platform", { value: "linux", configurable: true });
// 【2026-09-21 W-1 修订】arch **不再伪装成 arm64**，改为跟随 host。
// 原因：W-1 之前 native 全 stub，arch 伪装无副作用；W-1 换成真 node-pty 后，
// arch=arm64 会让 node-pty 去找 `prebuilds/linux-arm64/pty.node`——那是 aarch64 ELF，
// 在 x64 构建机上 `require` 必报 "Cannot find module"（Node 对架构不符的 .node 报此错），
// 于是 `dsh-subprocess-local` 插件加载失败、整个 plugin tree 崩（本轮实测）。
// 真实平台分支只取决于 `platform`（linux vs win32），arch 伪装对判据无贡献。
Object.defineProperty(process, "arch", { value: process.arch, configurable: true });
// Android 上 DSH 看到的环境（与 NodeService.kt 一致）
process.env.HOME = process.env.HOME || "/data/data/com.dshtavern.app/files";
// sim 标记：真实 OS 是 Windows 时，POSIX-only 代码路径（如目录 fsync）据此降级——
// 真机 Android 无此变量，行为不受影响（storage-json fsyncDirectory 补丁消费）
process.env.DSHT_ANDROID_SIM = "1";
console.log(`[android-sim] process.platform=linux arch=${process.arch} (DSHTavern Android condition simulation)`);
