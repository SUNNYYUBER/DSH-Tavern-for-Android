// DSHTavern Android stub（ESM 入口）：sharp
// 原生 libvips（glibc）在 Android bionic 上无法加载；图片功能降级。
function makePipeline() {
  const api = {
    metadata: async () => {
      throw new Error('sharp is not available in the DSHTavern Android build');
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
export default sharp;
export { sharp };
