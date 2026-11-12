import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'
import { fileURLToPath } from 'node:url'
import { PLUGIN_DEFINE } from '../vite-plugin-lib'

// plugin-node-image-compare —— lib 打包（UMD）供"第三方已打包 js"场景。
// vue / 内核 external（宿主只允许一份）；css 内联进单份 js。
export default defineConfig({
  plugins: [vue(), cssInjectedByJs()],
  // 内联的第三方库可能自带 process.env.NODE_ENV；浏览器没有 process，不替换会 ReferenceError。
  define: PLUGIN_DEFINE,
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'PlumePluginNodeImageCompare',
      formats: ['umd'],
      fileName: () => 'plugin-node-image-compare.js',
    },
    rollupOptions: {
      external: ['vue', '@plume-canvas/canvas-data', '@plume-canvas/canvas-base', '@plume-canvas/canvas-render'],
      output: {
        globals: {
          vue: 'Vue',
          '@plume-canvas/canvas-data': 'PlumeCore',
          '@plume-canvas/canvas-base': 'PlumeBase',
          '@plume-canvas/canvas-render': 'PlumeRender',
        },
      },
    },
    cssCodeSplit: false,
    sourcemap: true,
  },
})
