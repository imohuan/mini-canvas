import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'
import { fileURLToPath } from 'node:url'

// plugin-hot-reload —— lib 打包（UMD）供「插件管理」从 npm 安装到发布版。
//
// 为什么它也要能打包：发布版界面**不含**任何插件（build 分支不 import 源码包），
// 调试页只能作为外部插件装进来。装进来后它读的是 cloud-server 现成的
// /api/kv/config 与 /api/plugin-presence —— 这两条在发布版里本来就有，
// 缺的只是「谁来读、谁来回装」这一侧。
//
// external / globals：宿主共享运行时只此一份，打进插件会出现双实例。
export default defineConfig({
  plugins: [vue(), cssInjectedByJs()],
  build: {
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'PlumePluginHotReload',
      formats: ['umd'],
      // 发布规范：前端半统一叫 web.js（plugin-assets.mjs 与安装路由都按这个名字认）。
      fileName: () => 'web.js',
    },
    rollupOptions: {
      external: ['vue', '@vue-flow/core', '@plume-canvas/editor', '@plume-canvas/kernel', '@plume-canvas/plugin-sdk', '@plume-canvas/canvas-data', '@plume-canvas/canvas-render', '@plume-canvas/ui-kit'],
      output: {
        globals: {
        'vue': 'Vue',
        '@vue-flow/core': 'VueFlow',
        '@plume-canvas/editor': 'ProseMirrorEditorBundle',
        '@plume-canvas/kernel': 'PlumeKernel',
        '@plume-canvas/plugin-sdk': 'PlumeBase',
        '@plume-canvas/canvas-data': 'PlumeCore',
        '@plume-canvas/canvas-render': 'PlumeRender',
        '@plume-canvas/ui-kit': 'PlumeUiKit',
        },
        exports: 'named',
      },
    },
    cssCodeSplit: false,
    sourcemap: true,
  },
})
