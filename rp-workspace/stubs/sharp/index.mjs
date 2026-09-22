// DSHTavern sharp 降级模块（ESM 入口，**仅 PC android-sim 验证期临时替换**）
// 与 index.js 同源同语义；用途与「收紧为纯受控报错」的理由见 index.js 头注。
const UNAVAILABLE = 'sharp is not available during PC android-sim verification (real image pipeline uses @img/sharp-wasm32 on Android)';

function unavailable() {
  throw new Error(UNAVAILABLE);
}

function makePipeline() {
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

sharp.format = {};
sharp.versions = {};
sharp.cache = () => ({ items: 0, memory: 0 });
sharp.concurrency = () => 1;
sharp.counters = () => ({ queue: 0, process: 0 });
sharp.queue = () => 0;

export default sharp;
export { sharp };
