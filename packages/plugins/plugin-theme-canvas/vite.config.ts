import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'
import { fileURLToPath } from 'node:url'
import { PLUGIN_DEFINE } from '../vite-plugin-lib'

// plugin-theme-canvas —— 默认主题的「画布外观」半边（节点壳 / 连线 / 背景）。
// 与 components 半边各自独立打包；两边互不 import，只共享 @plume-canvas/theme-contract 的纯数据。
export default defineConfig({
  plugins: [vue(), cssInjectedByJs()],
  // 内联的第三方依赖（ui-kit-shadcn → reka-ui）带 process.env.NODE_ENV，
  // 不替换浏览器里会 ReferenceError: process is not defined。
  define: PLUGIN_DEFINE,
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'PlumePluginThemeCanvas',
      formats: ['umd'],
      fileName: () => 'plugin-theme-canvas.js',
    },
    rollupOptions: {
      external: ['vue', '@vue-flow/core', '@plume-canvas/canvas-data', '@plume-canvas/canvas-render'],
      output: {
        globals: {
          vue: 'Vue',
          '@vue-flow/core': 'VueFlow',
          '@plume-canvas/canvas-data': 'PlumeCore',
          '@plume-canvas/canvas-render': 'PlumeRender',
        },
      },
    },
    cssCodeSplit: false,
    sourcemap: true,
  },
})
