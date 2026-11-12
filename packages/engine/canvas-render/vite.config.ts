import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// 渲染层打成 ESM：Vue / VueFlow / 上游引擎包都按 peer 处理，不进产物。
export default defineConfig({
  plugins: [vue()],
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'PlumeCanvasRender',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      external: [
        'vue',
        '@vue-flow/core',
        '@plume-canvas/kernel',
        '@plume-canvas/canvas-data',
        '@plume-canvas/vue-render',
      ],
    },
  },
})
