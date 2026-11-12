import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'
import { fileURLToPath } from 'node:url'
import { PLUGIN_DEFINE } from '../vite-plugin-lib'

// plugin-theme-components —— 默认主题的「通用组件」半边。
//   pnpm build → lib 打包（UMD），供"已打包 js 主题插件"场景；
//   cssInjectedByJs：样式随 js 一起注入（宿主不一定有单独加载 css 的入口）。
export default defineConfig({
  plugins: [vue(), cssInjectedByJs()],
  // 第三方依赖（reka-ui / @vuelor/picker）内联后自带 process.env.NODE_ENV，
  // 不替换就会在浏览器里 ReferenceError: process is not defined。
  define: PLUGIN_DEFINE,
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'PlumePluginThemeComponents',
      formats: ['umd'],
      fileName: () => 'plugin-theme-components.js',
    },
    rollupOptions: {
      external: ['vue', '@plume-canvas/canvas-data', '@plume-canvas/canvas-render'],
      output: {
        globals: {
          vue: 'Vue',
          '@plume-canvas/canvas-data': 'PlumeCore',
          '@plume-canvas/canvas-render': 'PlumeRender',
        },
      },
    },
    cssCodeSplit: false,
    sourcemap: true,
  },
})
