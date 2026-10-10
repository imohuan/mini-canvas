// 文件：packages/docs/public/examples/canvas-render/canvas-host/vite.config.ts
// 格式：TypeScript 模块（Vite 配置）
// 位置：项目根目录 —— workspace 源码包不要预打包
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  optimizeDeps: {
    exclude: [
      '@mini-canvas/kernel',
      '@mini-canvas/canvas-data',
      '@mini-canvas/canvas-render',
      '@mini-canvas/plugin-theme-default',
      '@mini-canvas/plugin-node-text',
    ],
  },
})
