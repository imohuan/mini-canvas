import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'
import { fileURLToPath } from 'node:url'

// plugin-theme-default —— 单配置双模式（vite 一次只跑一个模式，用 command 分支合并两套）：
//   pnpm dev    → command === 'serve'：独立预览 dev server（root=demo-web，打开浏览器自看主题效果）
//   pnpm build  → command === 'build'：lib 打包（UMD）供"已打包 js 主题插件"场景
// 之前拆 vite.config.ts(vite build) + vite.demo.config.ts(vite dev)，二者不冲突，合并成一文件。
// 注意：cssInjectedByJs 只在 lib 生效；root/server/optimizeDeps 只在 dev 有意义，天然互不干扰。
export default defineConfig(({ command }) => {
  const isDev = command === 'serve'

  // —— 独立预览 dev server：打开 demo-web，页面自己 mount 自己的 vue + VueFlow（不跟主画布连）→ 无双 vue 问题 ——
  if (isDev) {
    return {
      plugins: [vue()],
      root: 'demo-web',
      server: {
        port: 5310,
        strictPort: true,
        // 启动服务时不要自动弹浏览器：由人或代理手动打开页面
        open: false,
      },
      // 让 demo 能 import 同 workspace 的源码包（canvas-data / canvas-render）。
      // 注：demo 不再 import 节点插件（步骤 7 断环：本包 devDeps 里不再有 node-text/node-image，
      // 预览改用 demo-web 自带的示例节点类型，见 demo-web/demoNodePlugin.ts）。
      optimizeDeps: {
        exclude: [
          '@mini-canvas/canvas-data',
          '@mini-canvas/canvas-render',
        ],
      },
    }
  }

  // —— lib 打包（UMD）：vue/@vue-flow/内核 external，css 内联 ——
  return {
    plugins: [vue(), cssInjectedByJs()],
    build: {
      lib: {
        entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
        name: 'MiniCanvasPluginThemeDefault',
        formats: ['umd'],
        fileName: () => 'plugin-theme-default.js',
      },
      rollupOptions: {
        external: ['vue', '@vue-flow/core', '@mini-canvas/canvas-data', '@mini-canvas/canvas-render'],
        output: {
          globals: {
            vue: 'Vue',
            '@vue-flow/core': 'VueFlow',
            '@mini-canvas/canvas-data': 'MiniCanvasCore',
            '@mini-canvas/canvas-render': 'MiniCanvasRender',
          },
        },
      },
      cssCodeSplit: false,
      sourcemap: true,
    },
  }
})
