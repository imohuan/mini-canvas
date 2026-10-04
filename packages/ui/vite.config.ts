import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { catalogPlugin } from './catalogPlugin.mjs'

// @mini-canvas/ui —— 画布展示应用：`pnpm dev` 打开根目录 index.html，
// 用 CanvasHost + 各插件渲染真实画布（本包是"用来显示画布"的应用，index.html 在包根、代码在 src/）。
export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    // 开发期在本 dev server 就地提供插件清单与产物（/plugin-catalog.json + /plugins/**），
    // 这样单开 ui dev 也能用插件管理；生产形态由 cloud-server 提供同两条路由。
    catalogPlugin({ pluginsDir: '../../packages/plugins' }),
  ],
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
    '@mini-canvas/kernel',
    '@mini-canvas/canvas-base',
    '@mini-canvas/plugin-theme-default',
    '@mini-canvas/plugin-node-text',
    '@mini-canvas/plugin-node-image',
    '@mini-canvas/plugin-node-3d-preview',
    '@mini-canvas/plugin-node-image-compare',
    '@mini-canvas/plugin-tool-image-generation',
    '@mini-canvas/plugin-tool-text-generation',
    '@mini-canvas/plugin-group',
    '@mini-canvas/plugin-multi-select',
    '@mini-canvas/plugin-auto-layout',
    '@mini-canvas/plugin-align-guide',
    '@mini-canvas/plugin-align-arrange',
    '@mini-canvas/plugin-context-menu',
    '@mini-canvas/plugin-clipboard',
    '@mini-canvas/plugin-canvas-export',
    '@mini-canvas/plugin-node-find',
    '@mini-canvas/plugin-mini-map',
    '@mini-canvas/plugin-shortcut-manager',
    '@mini-canvas/plugin-edge-cutting',
    '@mini-canvas/plugin-cloud-client',
    '@mini-canvas/canvas-base',
      // 编辑器组件包：workspace 源码（内部用带 .ts 后缀的相对导入），与其它源码包一样交给 vite 转换
      'prosemirror-editor-bundle',
    ],
  },
})
