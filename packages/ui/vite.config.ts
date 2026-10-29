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
    // 启动服务时不要自动弹浏览器：由人或代理手动打开页面（用户 2026-10-30 明确要求）
    open: false,
    // /api 转给 cloud-server（8865）：dev 下前端同源相对路径才能真正打到后台，
    // 否则全部回落 index.html（表现为「列表空 / 建文件夹没反应」）。
    proxy: {
      '/api': {
        target: 'http://localhost:8865',
        changeOrigin: true,
        // 把后台的 CORS 头**原样**带回来。
        //
        // 这里曾经是写死 `'*'` 的：那时可视化节点的沙箱页自己发请求，需要放宽 CORS。
        // 2026-10-20 之后沙箱页改成宿主代发，后台也把 CORS 收紧成同源白名单；
        // 再写死 `*` 会把后台的严格头覆盖掉，dev 与生产行为不一致（表现为
        // 「生产挡住了，dev 没挡住」）—— 所以只透传，不加工。
        // 需要的额外 Origin 由后台的 --trusted-origin 显式放行（见 docs/cloud-server/admin-auth）。
      },
    },
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
    '@mini-canvas/plugin-node-ui',
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
