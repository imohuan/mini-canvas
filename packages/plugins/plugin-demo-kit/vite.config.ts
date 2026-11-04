import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'
import { pluginLibBuild } from '../vite-plugin-lib'

// plugin-demo-kit —— 四套开发演示合并后的**唯一**产物（UMD），供「插件管理」按需安装。
// 另带一个独立的主题工作台预览页（`pnpm -C packages/plugins/plugin-demo-kit dev` → /theme-lab.html）：
// dev 时才挂到 vite 的 root/服务配置上，build 走共享的 UMD 配置，两边互不影响。
//
// external / globals 走共享表（../vite-plugin-lib）——唯一事实源，与其它可装卸插件同一份。
//
// 特别说明 @mini-canvas/plugin-theme-components 为什么**不** external（与 node-image 那几件不同）：
// 共享表里 external 的判据是「宿主只允许一份，多一份就出事」。本插件用到的主题模块不是这样 ——
// 它在 GalleryCanvasStage 里只被喂给**一块嵌在展厅里的独立小画布**（自己的 Context、自己的内存
// 存储、不进主画布的注册表）。所以它根本不参与主画布的任何注册，打进本产物不会造出「两份节点壳
// 抢同一个槽」那种问题。反过来，若 external 掉它，宿主必须额外把 MiniCanvasPluginThemeDefault
// 全局挂到 window 才装得上 —— 而宿主其实把主题当**源码**冷启动装配（packages/ui/src/assembly.ts），
// 并不存在这个全局，装上去只会「找不到依赖」直接炸。
// vue / @vue-flow/core / 内核那批仍然 external：它们是块内小画布与展厅共享的真运行时。
export default defineConfig(({ command }) => {
  if (command === 'serve') {
    return {
      plugins: [vue()],
      server: { port: 5318, strictPort: true, open: false },
      optimizeDeps: {
        exclude: [
          '@mini-canvas/canvas-data',
          '@mini-canvas/canvas-render',
          '@mini-canvas/canvas-base',
          '@mini-canvas/kernel',
          '@mini-canvas/ui-kit-shadcn',
          '@mini-canvas/plugin-theme-components',
          '@mini-canvas/plugin-theme-canvas',
          '@mini-canvas/plugin-multi-select',
          '@mini-canvas/plugin-align-guide',
          '@mini-canvas/plugin-edge-cutting',
        ],
      },
    }
  }

  return {
    plugins: [vue(), cssInjectedByJs()],
    build: pluginLibBuild(import.meta.url, { name: 'MiniCanvasPluginDemoKit' }),
  }
})

