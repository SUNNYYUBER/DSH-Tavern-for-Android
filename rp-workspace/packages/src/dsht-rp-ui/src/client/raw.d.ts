// `?raw` 文本导入的类型声明（Vite/esbuild rawTextPlugin 双侧约定）：
// build-rp-ui.mjs 的 rawTextPlugin 把 ?raw 后缀的导入按 text loader 内嵌为字符串；
// vitest 走 Vite 原生 ?raw 支持。这里只补 TS 侧的模块形状。
declare module '*?raw' {
  const src: string
  export default src
}
