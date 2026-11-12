import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// 通用 Vue 渲染底座：Vue 与内核按 peer 处理。
export default defineConfig({
  plugins: [vue()],
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'PlumeVueRender',
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
