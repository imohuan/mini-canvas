import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { catalogPlugin } from './catalogPlugin.mjs'
import { fileURLToPath } from 'node:url'
import { uiKitDebugLocPlugin } from '@mini-canvas/ui-kit-shadcn/vite-plugin-debug-loc'

// @mini-canvas/ui —— 画布展示应用：`pnpm dev` 打开根目录 index.html，
// 用 CanvasHost + 各插件渲染真实画布（本包是"用来显示画布"的应用，index.html 在包根、代码在 src/）。
export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    // 开发期在本 dev server 就地提供插件清单与产物（/plugin-catalog.json + /plugins/**），
    // 这样单开 ui dev 也能用插件管理；生产形态由 cloud-server 提供同两条路由。
    catalogPlugin({ pluginsDir: '../../packages/plugins' }),
    // 放在最后：enforce:'pre' 的 transform 仍会先于 vue 插件跑，改的是原始 SFC。
    // 只在 vite serve 生效（插件内部 apply:'serve'）；生产构建不会打标。
    uiKitDebugLocPlugin({ root: fileURLToPath(new URL('../..', import.meta.url)) }),
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
        // 多 Agent 并行开发时各用各的后台：启动前设置 MINI_CANVAS_BACKEND，
        // 不设置才回落到默认的 8865。
        target: process.env.MINI_CANVAS_BACKEND || 'http://localhost:8865',
        changeOrigin: true,
        /**
         * 代理不是"另一个网站"，而是开发页面的同源后端入口 —— 请求到了这里，
         * 就按**它转发的那个页面**算来源。
         *
         * 为什么不能原样转发浏览器带来的 Origin：后台的来源白名单只认显式配置
         * （默认只有 http://localhost:5288）。多 Agent 并行时前端会在 5299 / 5300
         * 这类端口上跑，浏览器发 `Origin: http://localhost:5299`，代理原样带过去
         * 就被后台判成 origin-not-trusted → 导出节点包 403（用户 2026-11-05 实测）。
         * 让代理用目标地址作为 Origin，等于承认"这个页面本来就走这条同源通道"；
         * 其它网站也走不到这台机器的开发代理上。
         */
        configure: (proxy) => {
          // 同源化：代理转发时把 Origin 改写成后台地址。
          // 为什么不用 `headers` 选项：http-proxy 的 headers 只在**没有** Origin 时补，
          // 浏览器带来的 `Origin: http://localhost:5299` 会原样透过去，后台照样 403。
          // 预检（OPTIONS）也要改：预检不过，带 x-admin-token 的请求根本发不出去。
          proxy.on('proxyReq', (req: { setHeader(name: string, value: string): void }) => {
            req.setHeader('origin', process.env.MINI_CANVAS_BACKEND || 'http://localhost:8865')
          })
        },
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
    // 冷启动一次构建齐：下面这些依赖来自 `exclude` 里的 workspace 源码包。
    //
    // 为什么必须显式 include：vite 的依赖扫描不进入 exclude 的包，只有页面真正
    // import 到某个源码包时才在源码里发现它用到的第三方库；此时 vite 会重新
    // pre-bundle，但浏览器手上还是旧 hash 的地址 —— 表现就是刷新时
    // `504 (Outdated Optimize Dep)` + `ERR_ABORTED`，随后被迫整页刷新。
    //
    // 写法 `包 > 依赖` 是官方支持的（让 vite 从该包的 node_modules 解析）：
    // cn / reka-ui 这类只在 ui-kit-shadcn 的依赖里，写在 ui 顶层会解析不到。
    // 加/删下面任何一个源码包的第三方依赖时，记得同步这一份（有配置守卫测试）。
    include: [
      // ui 自己直接用的（动态 import 的那几个尤其容易漏）
      'vue',
      'vue-router',
      '@vue-flow/core',
      // vue-draggable-plus 只在 plugin-bottom-bar 的依赖里（ui 顶层解析不到）
      '@mini-canvas/plugin-bottom-bar > vue-draggable-plus',
      'lucide-vue-next',
      'motion-v',
      'imagesloaded',
      'masonry-layout',
      // 组织/格式组件（@mini-canvas/ui-kit-shadcn）
      '@mini-canvas/ui-kit-shadcn > cn',
      '@mini-canvas/ui-kit-shadcn > reka-ui',
      '@mini-canvas/ui-kit-shadcn > @vueuse/core',
      '@mini-canvas/ui-kit-shadcn > class-variance-authority',
      '@mini-canvas/ui-kit-shadcn > vue-sonner',
      '@mini-canvas/ui-kit-shadcn > @lucide/vue',
      '@mini-canvas/ui-kit-shadcn > @vuelor/picker',
      // 默认主题的通用组件半边（plugin-theme-components）
      '@mini-canvas/plugin-theme-components > @ckpack/vue-color',
      // 3D 节点（plugin-node-3d-preview）
      '@mini-canvas/plugin-node-3d-preview > three',
      // 富文本编辑器（prosemirror-editor-bundle）
      'prosemirror-editor-bundle > prosemirror-view',
      'prosemirror-editor-bundle > prosemirror-state',
      'prosemirror-editor-bundle > prosemirror-model',
      'prosemirror-editor-bundle > prosemirror-commands',
      'prosemirror-editor-bundle > prosemirror-history',
      'prosemirror-editor-bundle > prosemirror-keymap',
      'prosemirror-editor-bundle > prosemirror-schema-basic',
    ],
    exclude: [
    '@mini-canvas/canvas-data',
    '@mini-canvas/canvas-render',
    '@mini-canvas/kernel',
    '@mini-canvas/canvas-base',
    '@mini-canvas/ui-kit-shadcn',
    '@mini-canvas/plugin-theme-components',
    '@mini-canvas/plugin-theme-canvas',
    '@mini-canvas/theme-contract',
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
