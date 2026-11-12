import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'
import { fileURLToPath } from 'node:url'
import { PLUGIN_DEFINE } from '../vite-plugin-lib'

// plugin-node-ui —— lib 打包（UMD）供"第三方已打包 js"场景：宿主 <script> 载入后 installPlugin。
// - vue / 内核 / 渲染层 external（宿主只允许一份，见 docs/tmp/plugin-vite/02）。
// - cssInjectedByJs：把 .vue 的 <style> 内联进单份 js → 宿主只引一个文件即可（一般插件惯例）。
export default defineConfig({
  plugins: [vue(), cssInjectedByJs()],
  // 内联的第三方库可能自带 process.env.NODE_ENV；浏览器没有 process，不替换会 ReferenceError。
  define: PLUGIN_DEFINE,
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'PlumePluginNodeUi',
      formats: ['umd'],
      fileName: () => 'plugin-node-ui.js',
    },
    rollupOptions: {
      external: ['vue', '@plume-canvas/canvas-data', '@plume-canvas/canvas-render'],
      output: {
        globals: {
          vue: 'Vue',
          '@plume-canvas/canvas-data': 'PlumeCore',
          '@plume-canvas/canvas-render': 'PlumeRender',
        },
      },
    },
    cssCodeSplit: false,
    sourcemap: true,
  },
})

