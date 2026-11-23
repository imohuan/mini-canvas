import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'
import { fileURLToPath } from 'node:url'

// plugin-demo-kit —— 四套开发演示合并后的**唯一**产物（UMD），供「插件管理」按需安装。
//
// external / globals：宿主共享运行时只此一份，打进插件会出现双实例。
// 本插件不 import 任何其它插件：展厅里的小画布直接用宿主已装的主题注册表
// （CanvasProvider 的 theme-registry 入参），所以这里不需要任何 theme 包的特例。
export default defineConfig(({ command }) => {
  if (command === 'serve') {
    return {
      plugins: [vue()],
      server: { port: 5318, strictPort: true, open: false },
      optimizeDeps: {
        exclude: [
          '@plume-canvas/canvas-data',
          '@plume-canvas/canvas-render',
          '@plume-canvas/plugin-sdk',
          '@plume-canvas/kernel',
          '@plume-canvas/ui-kit',
        ],
      },
    }
  }

  return {
    plugins: [vue(), cssInjectedByJs()],
  build: {
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'PlumePluginDemoKit',
      formats: ['umd'],
      fileName: () => 'plugin-demo-kit.js',
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
  }
})

