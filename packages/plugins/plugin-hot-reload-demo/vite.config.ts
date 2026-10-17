import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'

// plugin-hot-reload-demo —— 热重载试验台：故意打成**自包含 UMD**（external 只有 vue），
// 装到画布后画布右上角有一块显眼卡片；改 src 重新 build，热重载链路应让卡片自动变样。
//
// 热重载链路（KV 门铃，最终形态）：
//   pnpm watch → 盯 src/ → 变了自动 pnpm build → 成功后 PUT 一个 KV 门铃
//   → 后台现成的 KV 通道推 SSE → 画布热重载监听 HEAD 对比产物 → 变了才重装。
// 本 vite.config 只负责"怎么打包"，通知逻辑全在 scripts/watch.mjs —— 两件事分开。
export default defineConfig({
  // cssInjectedByJs：CSS 打进 js（运行时注入 <style>）。为什么必须：
  // 插件经 <script> 装载，宿主只拉 js 一个文件 —— 若 CSS 拆成单独 .css（vite 默认），
  // 没有任何东西会去加载它，scoped 样式全部失效（真机踩到：卡片裸奔无样式）。
  plugins: [vue(), cssInjectedByJs()],
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
