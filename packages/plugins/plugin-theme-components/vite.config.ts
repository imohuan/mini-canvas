import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'
import { fileURLToPath } from 'node:url'

// plugin-theme-components —— 默认主题的「通用组件」半边。
//   pnpm build → lib 打包（UMD），供"已打包 js 主题插件"场景；
//   cssInjectedByJs：样式随 js 一起注入（宿主不一定有单独加载 css 的入口）。
export default defineConfig({
  plugins: [vue(), cssInjectedByJs()],
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'MiniCanvasPluginThemeComponents',
      formats: ['umd'],
      fileName: () => 'plugin-theme-components.js',
    },
    rollupOptions: {
      external: ['vue', '@mini-canvas/canvas-data', '@mini-canvas/canvas-render'],
      output: {
        globals: {
          vue: 'Vue',
          '@mini-canvas/canvas-data': 'MiniCanvasCore',
          '@mini-canvas/canvas-render': 'MiniCanvasRender',
        },
      },
    },
    cssCodeSplit: false,
    sourcemap: true,
  },
})
