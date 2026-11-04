import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'
import { fileURLToPath } from 'node:url'

// plugin-theme-canvas —— 默认主题的「画布外观」半边（节点壳 / 连线 / 背景）。
// 与 components 半边各自独立打包；两边互不 import，只共享 @mini-canvas/theme-contract 的纯数据。
export default defineConfig({
  plugins: [vue(), cssInjectedByJs()],
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'MiniCanvasPluginThemeCanvas',
      formats: ['umd'],
      fileName: () => 'plugin-theme-canvas.js',
    },
    rollupOptions: {
      external: ['vue', '@vue-flow/core', '@mini-canvas/canvas-data', '@mini-canvas/canvas-render'],
      output: {
        globals: {
          vue: 'Vue',
          '@vue-flow/core': 'VueFlow',
          '@mini-canvas/canvas-data': 'MiniCanvasCore',
          '@mini-canvas/canvas-render': 'MiniCanvasRender',
        },
      },
    },
    cssCodeSplit: false,
    sourcemap: true,
  },
})
