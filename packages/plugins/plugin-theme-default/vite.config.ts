import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'
import { fileURLToPath } from 'node:url'

// plugin-theme-default —— lib 打包（UMD）供"已打包 js 主题插件"场景。vue/@vue-flow/内核 external，css 内联。
export default defineConfig({
  plugins: [vue(), cssInjectedByJs()],
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'MiniCanvasPluginThemeDefault',
      formats: ['umd'],
      fileName: () => 'plugin-theme-default.js',
    },
    rollupOptions: {
      external: ['vue', '@vue-flow/core', '@mini-canvas/canvas-core-v2'],
      output: {
        globals: {
          vue: 'Vue',
          '@vue-flow/core': 'VueFlow',
          '@mini-canvas/canvas-core-v2': 'MiniCanvasCore',
        },
      },
    },
    cssCodeSplit: false,
    sourcemap: true,
  },
})
