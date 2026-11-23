import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'
import { fileURLToPath } from 'node:url'

// plugin-node-text —— lib 打包（UMD）供"第三方已打包 js"场景：宿主 <script> 载入后 installPlugin。
// - vue / 内核 / 渲染层 external（宿主只允许一份，见 docs/tmp/plugin-vite/02）。
// - cssInjectedByJs：把 .vue 的 <style> 内联进单份 js → 宿主只引一个文件即可（一般插件惯例）。
export default defineConfig({
  plugins: [vue(), cssInjectedByJs()],
  // 内联的第三方库可能自带 process.env.NODE_ENV；浏览器没有 process，不替换会 ReferenceError。
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'PlumePluginNodeText',
      formats: ['umd'],
      fileName: () => 'plugin-node-text.js',
    },
    rollupOptions: {
      // 富文本编辑器不再由本插件使用：文本编辑走主题 UI 目录按名取（useUiComponent）。
      // 这里只 external「宿主只允许一份」的共享运行时。
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
