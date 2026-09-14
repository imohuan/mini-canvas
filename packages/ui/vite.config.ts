import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// @mini-canvas/ui —— 画布展示应用：`pnpm dev` 打开根目录 index.html，
// 用 CanvasHost + 各插件渲染真实画布（本包是"用来显示画布"的应用，index.html 在包根、代码在 src/）。
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5288, // 独立端口，避开其它应用/demo 的端口
    strictPort: false,
    open: true,
  },
  // 让应用能 import 同 workspace 的源码插件/内核，交由 vite 直接转换源码 .ts/.vue
  optimizeDeps: {
    exclude: [
      '@mini-canvas/canvas-data',
      '@mini-canvas/canvas-render',
      '@mini-canvas/plugin-theme-default',
      '@mini-canvas/plugin-node-text',
      '@mini-canvas/plugin-node-image',
      '@mini-canvas/plugin-node-3d-preview',
      '@mini-canvas/plugin-node-image-compare',
      '@mini-canvas/plugin-tool-image-generation',
      '@mini-canvas/plugin-tool-text-generation',
      // 编辑器组件包：workspace 源码（内部用带 .ts 后缀的相对导入），与其它源码包一样交给 vite 转换
      'prosemirror-editor-bundle',
      '@mini-canvas/plugin-canvas-commands',
    ],
  },
})
