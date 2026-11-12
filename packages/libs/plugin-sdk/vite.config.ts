import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// 插件作者入口：纯 TS 薄层，打成 ESM。
export default defineConfig({
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'PlumePluginSdk',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      external: ['vue', '@plume-canvas/kernel', '@plume-canvas/canvas-data'],
    },
  },
})
