import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { hotReloadManifest } from '../vite-plugin-lib'

// plugin-hot-reload-demo —— 热重载试验台：故意打成**自包含 UMD**（external 只有 vue），
// 装到画布后画布右上角有一块显眼卡片；改 src 重新 build，热重载链路应让卡片自动变样。
//
// 为什么这个包不做任何"聪明"的 HMR：它就是给**最笨的那条链**当靶子的 ——
//   改源码 → vite build（人工或 --watch）→ 产物文件变了 → cloud-server 的 SSE 推一条
//   → 前端热重载管理器收到 → window.MiniCanvasPlugin.reload('hot-reload-demo') → 卡片变样。
// 全链路任何一环断了，这条最直的链都会红 —— 正是测试要的。
export default defineConfig({
  plugins: [
    vue(),
    // 声明本插件的 watch 服务 SSE 地址：构建时写进 dist/hot-reload.json，
    // 前端热重载管理器读到就自动登记（免后台、免手填链接）。
    hotReloadManifest('http://localhost:5333/sse'),
  ],
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'MiniCanvasPluginHotReloadDemo',
      formats: ['umd'] as const,
      fileName: () => 'plugin-hot-reload-demo.js',
    },
    rollupOptions: {
      external: ['vue'],
      output: { globals: { vue: 'Vue' } },
    },
    cssCodeSplit: false,
    sourcemap: true,
  },
})
