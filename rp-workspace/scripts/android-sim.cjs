// DSHTavern PC 安卓条件模拟：preload 时把平台伪装成 Android/linux。
// 用法：node -r android-sim.cjs node_modules/@deepseek-ai/dsh/lib/bin.js web --no-open
// 原理：Cordis 的 disabled: !!js process.platform === 'win32' 在组合加载时执行，
// patch 后 PC 走 linux 插件路径（sandbox-windows-acl 不加载、tool-bash 启用），
// 配合 stubs 后的 runtime 即为 Android 行为的高保真 JS 层模拟（native 已全 stub）。
"use strict";
Object.defineProperty(process, "platform", { value: "linux", configurable: true });
Object.defineProperty(process, "arch", { value: "arm64", configurable: true });
// Android 上 DSH 看到的环境（与 NodeService.kt 一致）
process.env.HOME = process.env.HOME || "/data/data/com.dshtavern.app/files";
// sim 标记：真实 OS 是 Windows 时，POSIX-only 代码路径（如目录 fsync）据此降级——
// 真机 Android 无此变量，行为不受影响（storage-json fsyncDirectory 补丁消费）
process.env.DSHT_ANDROID_SIM = "1";
console.log("[android-sim] process.platform=linux arch=arm64 (DSHTavern Android condition simulation)");
