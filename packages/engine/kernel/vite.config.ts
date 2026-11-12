import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// 纯 TS 内核打成 ESM：产物是单文件，供 npm 发布与外部宿主按 ESM 引入。
export default defineConfig({
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'PlumeKernel',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: true,
  },
})
