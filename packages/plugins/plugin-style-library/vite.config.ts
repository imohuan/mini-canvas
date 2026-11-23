import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'
import { fileURLToPath } from 'node:url'

// plugin-style-library —— 前端半 lib 打包（UMD）供「插件管理」/冷启动装配。
export default defineConfig({
  plugins: [vue(), cssInjectedByJs()],
  build: {
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'PlumePluginStyleLibrary',
      formats: ['umd'],
      fileName: () => 'plugin-style-library.js',
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
    sourcemap: false,
  },
})
