/**
 * 宿主环境 vendor 安装（host-vendor / vendor2）——复刻 TH third_party_object.initThirdPartyObject
 * + ST 自带全局。
 *
 * 背景：真酒馆助手（TH/JS-Slash-Runner）自己往宿主页注入全局——third_party_object.ts 里
 * globalThis.z = import * as z from 'zod'（zod v4 ^4.4.3 namespace）、globalThis.YAML；ST 宿主
 * 本身又自带 window.$（jQuery 3.5.1）/ window._（lodash）/ toastr / showdown。DSH webui 是
 * React 应用，这些全局一个都没有——脚本 iframe 放开 sandbox allow-same-origin 后（复刻真 TH
 * 同源形态，用户拍板），脚本里 window.parent.$ / window.parent.z 的取法（真 TH 脚本常态）
 * 需要宿主先有这些全局。
 *
 * vendor 源码：构建期 iife（scripts/build-rp-ui.mjs → th-host-vendor.gen.txt，lodash + jquery
 * + yaml + zod v4），client 启动时（client/index.tsx apply() 初始化处）经 installHostVendor
 * 求值一次；iife 内部同样用 ??= 缺失才装语义——双重保险，绝不覆盖宿主已有全局。
 */
/** 复刻的全局清单（缺失才装；z / Zod 双名字对齐真 TH 宿主形态） */
export declare const HOST_VENDOR_GLOBALS: readonly ["_", "$", "jQuery", "z", "Zod", "YAML"];
/**
 * 纯函数：宿主缺失哪些全局（「缺失才装」判定，抽出来供单测锚定）。
 * 判据 = 宿主 window 上该键 === undefined；null / 已有值一律视为已存在，绝不覆盖。
 */
export declare function missingHostGlobals(host: Record<string, unknown>): Array<(typeof HOST_VENDOR_GLOBALS)[number]>;
/**
 * client 启动时在宿主 window 补挂缺失全局（幂等）。
 * - 模块级一次性守卫 + iife 内 ??= 语义双保险：绝不覆盖宿主已有全局；
 * - 宿主全局齐全（ST 同款宿主等场景）时零开销跳过，不求值 vendor 源码；
 * - 返回安装前探明的缺失清单（可观测性：调用方 console.info 装了什么）。
 */
export declare function installHostVendor(host?: Record<string, unknown>): Array<(typeof HOST_VENDOR_GLOBALS)[number]>;
