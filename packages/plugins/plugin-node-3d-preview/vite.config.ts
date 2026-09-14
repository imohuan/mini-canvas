import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'
import { fileURLToPath } from 'node:url'

// plugin-node-3d-preview —— lib 打包（UMD）供"第三方已打包 js"场景。
// vue / 内核 / three external（宿主只允许一份 three，避免多实例）；css 内联进单份 js。
export default defineConfig({
  plugins: [vue(), cssInjectedByJs()],
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'MiniCanvasPluginNode3dPreview',
      formats: ['umd'],
      fileName: () => 'plugin-node-3d-preview.js',
    },
    rollupOptions: {
      external: ['vue', 'three', '@mini-canvas/canvas-data', '@mini-canvas/canvas-base', '@mini-canvas/canvas-render'],
      output: {
        globals: {
          vue: 'Vue',
          three: 'THREE',
          '@mini-canvas/canvas-data': 'MiniCanvasCore',
          '@mini-canvas/canvas-base': 'MiniCanvasBase',
          '@mini-canvas/canvas-render': 'MiniCanvasRender',
        },
      },
    },
    cssCodeSplit: false,
    sourcemap: true,
  },
})
