import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'
import { fileURLToPath } from 'node:url'

// plugin-node-text —— lib 打包（UMD）供"第三方已打包 js"场景：宿主 <script> 载入后 installPlugin。
// - vue / 内核 / 渲染层 external（宿主只允许一份，见 docs/tmp/plugin-vite/02）。
// - cssInjectedByJs：把 .vue 的 <style> 内联进单份 js → 宿主只引一个文件即可（一般插件惯例）。
export default defineConfig({
  plugins: [vue(), cssInjectedByJs()],
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'MiniCanvasPluginNodeText',
      formats: ['umd'],
      fileName: () => 'plugin-node-text.js',
    },
    rollupOptions: {
      external: ['vue', '@mini-canvas/canvas-core-v2', '@mini-canvas/canvas-render'],
      output: {
        globals: {
          vue: 'Vue',
          '@mini-canvas/canvas-core-v2': 'MiniCanvasCore',
          '@mini-canvas/canvas-render': 'MiniCanvasRender',
        },
      },
    },
    cssCodeSplit: false,
    sourcemap: true,
  },
})
