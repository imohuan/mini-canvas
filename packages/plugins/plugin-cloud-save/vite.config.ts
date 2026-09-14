import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// plugin-cloud-save —— 打成**自包含 ESM**（单文件、零 import）。
//
// 为什么不是 UMD、也不设 external：这个插件是经 `manager.install({ url })` 从
// cloud-server 加载的，而宿主那条路是 fetch 文本 → `import(data:text/javascript,...)`。
// data: URL 里 **裸模块名（'vue'/'@mini-canvas/...'）解析不了**，UMD 又会去找全局变量——
// 两条都会在浏览器里炸。本插件纯逻辑（不做 UI、不用 Vue），所有用到的常量都就地内联，
// 于是可以做到"零 import"，怎么加载都能跑。
// 常量与数据层的一致性由 keys.test.ts 盯着（和 canvas-data 的导出逐字比对）。
export default defineConfig({
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'plugin-cloud-save.js',
    },
    // 不设 external：全部内联，产物必须自给自足
    cssCodeSplit: false,
    sourcemap: true,
  },
})
