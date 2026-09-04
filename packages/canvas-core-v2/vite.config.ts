import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// canvas-core-v2 独立演示/开发服务：跑 `pnpm dev` 打开 demo-web/index.html
export default defineConfig({
  plugins: [vue()],
  root: 'demo-web',
  server: {
    port: 5199, // 避开老版前端 5173
    strictPort: false,
  },
  optimizeDeps: {
    include: ['vue', '@vue-flow/core', 'pinia'],
  },
})
