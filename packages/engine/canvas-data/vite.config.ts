import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// 数据层打成 ESM；vue 是 peer，不进产物。
export default defineConfig({
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'PlumeCanvasData',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      external: ['vue', '@plume-canvas/kernel'],
    },
  },
})
