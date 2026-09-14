import { defineConfig } from 'vite'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'
import { fileURLToPath } from 'node:url'

// plugin-tool-text-generation —— lib 打包（UMD）供"第三方已打包 js"场景。
// vue / 内核 external（宿主只允许一份）。
export default defineConfig({
  plugins: [cssInjectedByJs()],
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'MiniCanvasPluginToolTextGeneration',
      formats: ['umd'],
      fileName: () => 'plugin-tool-text-generation.js',
    },
    rollupOptions: {
      external: ['vue', '@mini-canvas/canvas-data', '@mini-canvas/canvas-base'],
      output: {
        globals: {
          vue: 'Vue',
          '@mini-canvas/canvas-data': 'MiniCanvasCore',
          '@mini-canvas/canvas-base': 'MiniCanvasBase',
        },
      },
    },
    cssCodeSplit: false,
    sourcemap: true,
  },
})
