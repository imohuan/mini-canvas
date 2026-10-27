import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'

// plugin-shell-slots-demo —— 自包含 ESM 产物（零裸模块名 import）。
// 给 manager.install({ url }) 用：宿主 fetch 文本 → import(data:text/javascript)。
// 所以必须内联全部依赖（vue 组件、canvas-render 的 useCanvasRender 等），不设 external。
export default defineConfig({
  plugins: [vue(), cssInjectedByJs()],
  // data: URL 里没有 process.env：把 NODE_ENV 替换掉（vite 默认只对 import.meta.env 做），
  // 否则内联进来的 Vue（dev 构建带 process.env.NODE_ENV 分支）在浏览器里直接 ReferenceError。
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: 'dist',
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'plugin-shell-slots-demo.esm.js',
    },
    cssCodeSplit: false,
    sourcemap: true,
  },
})
