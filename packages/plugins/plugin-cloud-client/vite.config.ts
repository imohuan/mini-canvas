import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// plugin-cloud-client —— 打成自包含 ESM（单文件、零 import）。
//
// 为什么必须零 import：这个插件是经 manager.install({ url }) 从 cloud-server 加载的，
// 宿主那条路是 fetch 文本 → import(data:text/javascript,...)。data: URL 里
// 裸模块名（vue / @mini-canvas/...）解析不了，一旦产物里留下它们，浏览器里直接炸。
//
// 代价是"可能与数据层漂移"——所以所有常量就地内联（由测试与数据层逐字比对，改岔了立刻红）；
// 好在它一行界面都不画（底栏的皮由 plugin-bottom-bar 提供、历史弹窗由 ui 提供），
// 所以真的不需要 Vue。
export default defineConfig({
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'plugin-cloud-client.js',
    },
    // 不设 external：全部内联，产物必须自给自足
    cssCodeSplit: false,
    sourcemap: true,
  },
})
