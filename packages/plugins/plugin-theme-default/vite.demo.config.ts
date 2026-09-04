import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// plugin-theme-default 独立预览 dev server：pnpm dev 打开 demo-web 自看主题效果。
// 这个页面自己 mount 自己的 vue + VueFlow（不跟主画布连）→ 无双 vue 问题。
export default defineConfig({
  plugins: [vue()],
  root: 'demo-web',
  server: {
    port: 5310,
    strictPort: true,
    open: true,
  },
  // 让 demo 能 import 同 workspace 的其他源码插件(text/image)
  optimizeDeps: { exclude: ['@mini-canvas/plugin-node-text', '@mini-canvas/plugin-node-image', '@mini-canvas/canvas-core-v2'] },
})
