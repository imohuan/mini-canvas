import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

// plugin-node-text —— lib 打包（UMD）供"第三方已打包 js"场景：宿主 <script> 载入后 installPlugin。
// 关键：vue / 内核 external 掉（宿主只允许一份，见 docs/tmp/plugin-vite/02）。
export default defineConfig({
  plugins: [vue()],
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'MiniCanvasPluginNodeText',
      formats: ['umd'],
      fileName: () => 'plugin-node-text.js',
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
