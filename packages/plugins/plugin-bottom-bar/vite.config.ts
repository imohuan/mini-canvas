import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'
import { fileURLToPath } from 'node:url'

// plugin-bottom-bar —— lib 打包（UMD + CSS 注入）供热重载/插件管理加载。
// external / globals：宿主共享运行时只此一份，打进插件会出现双实例。
export default defineConfig({
  plugins: [vue(), cssInjectedByJs()],
  build: {
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'PlumePluginBottomBar',
      formats: ['umd'],
      fileName: () => 'plugin-bottom-bar.js',
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

