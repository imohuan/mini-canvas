import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// @mini-canvas/ui —— 独立演示/开发服务：`pnpm dev` 打开 dev/index.html，
// 用 CanvasHost + 各插件 + 设置面板 渲染真实画布，自看最终效果（取代被删的 canvas-core-v2/demo-web）。
export default defineConfig({
  plugins: [vue()],
  root: 'dev',
  server: {
    port: 5288, // 独立端口，避开其它 demo 的 5199/5173/5310
    strictPort: false,
    open: true,
  },
  // 让 dev 能 import 同 workspace 的源码插件/内核，交由 vite 直接转换源码 .ts/.vue
  optimizeDeps: {
    exclude: [
      '@mini-canvas/canvas-core-v2',
      '@mini-canvas/canvas-render',
      '@mini-canvas/plugin-theme-default',
      '@mini-canvas/plugin-node-text',
      '@mini-canvas/plugin-node-image',
      '@mini-canvas/plugin-canvas-commands',
    ],
  },
})
