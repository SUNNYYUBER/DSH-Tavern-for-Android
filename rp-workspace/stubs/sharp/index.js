// DSHTavern Android stub：sharp
// 原生 libvips 二进制（glibc）在 Android bionic 上无法加载；图片处理降级：
// 附件探测/解码路径抛出受控错误（attachment-local 捕获后标记 INVALID_IMAGE），
// 不阻塞 web 服务启动。
"use strict";
function makePipeline() {
  const api = {
    metadata: async () => {
      throw new Error("sharp is not available in the DSHTavern Android build");
    },
    raw: () => api,
    toBuffer: async () => Buffer.alloc(0),
    toFile: async () => ({}),
    resize: () => api,
    rotate: () => api,
    composite: () => api,
    jpeg: () => api,
    png: () => api,
    webp: () => api,
    avif: () => api,
    clone: () => makePipeline(),
  };
  return api;
}
function sharp() {
  return makePipeline();
}
sharp.format = {};
sharp.versions = {};
sharp.cache = () => ({ items: 0, memory: 0 });
sharp.concurrency = () => 1;
sharp.counters = () => ({ queue: 0, process: 0 });
sharp.queue = () => 0;
module.exports = sharp;
module.exports.default = sharp;
