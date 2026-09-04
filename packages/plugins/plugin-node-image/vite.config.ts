import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'
import { fileURLToPath } from 'node:url'

// plugin-node-image —— lib 打包（UMD）供"第三方已打包 js"场景。
// vue / 内核 external（宿主只允许一份）；css 内联进单份 js。
export default defineConfig({
  plugins: [vue(), cssInjectedByJs()],
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'MiniCanvasPluginNodeImage',
      formats: ['umd'],
      fileName: () => 'plugin-node-image.js',
    },
    rollupOptions: {
      external: ['vue', '@mini-canvas/canvas-core-v2'],
      output: {
        globals: {
          vue: 'Vue',
          '@mini-canvas/canvas-core-v2': 'MiniCanvasCore',
        },
      },
    },
    cssCodeSplit: false,
    sourcemap: true,
  },
})
