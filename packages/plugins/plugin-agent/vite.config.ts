import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'
import { fileURLToPath } from 'node:url'

// plugin-agent —— 前端半打 UMD（供插件管理从 cloud-server 清单加载），后台半由 build-server.mjs 单独产出。
export default defineConfig({
  plugins: [vue(), cssInjectedByJs()],
  build: {
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'PlumePluginAgent',
      formats: ['umd'],
      fileName: () => 'plugin-agent.js',
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
