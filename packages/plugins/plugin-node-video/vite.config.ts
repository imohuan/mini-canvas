import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'
import { fileURLToPath } from 'node:url'

// plugin-node-video —— 与 plugin-node-image 同一套 lib 打包（UMD，css 内联）。
// vue / 内核 external（宿主只允许一份）；@plume-canvas/plugin-bottom-bar 同样由宿主
// 提供唯一运行时（既有装配依赖），打进插件会出现两份底栏注册表。
export default defineConfig({
  plugins: [vue(), cssInjectedByJs()],
  // 内联的第三方库可能自带 process.env.NODE_ENV；浏览器没有 process，不替换会 ReferenceError。
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'PlumePluginNodeVideo',
      formats: ['umd'],
      fileName: () => 'plugin-node-video.js',
    },
    rollupOptions: {
      external: ['vue', '@vue-flow/core', '@plume-canvas/editor', '@plume-canvas/kernel', '@plume-canvas/plugin-sdk', '@plume-canvas/canvas-data', '@plume-canvas/canvas-render', '@plume-canvas/ui-kit', '@plume-canvas/plugin-bottom-bar'],
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
          '@plume-canvas/plugin-bottom-bar': 'PlumePluginBottomBar',
          },
      },
    },
    cssCodeSplit: false,
    sourcemap: true,
  },
})
