import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'
import { fileURLToPath } from 'node:url'
import { HOST_EXTERNALS, HOST_GLOBALS } from '../vite-plugin-lib'

// plugin-node-video —— 与 plugin-node-image 同一套 lib 打包（UMD，css 内联）。
// vue / 内核 external（宿主只允许一份）；@mini-canvas/plugin-bottom-bar 同样由宿主
// 提供唯一运行时（既有装配依赖），打进插件会出现两份底栏注册表。
export default defineConfig({
  plugins: [vue(), cssInjectedByJs()],
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'MiniCanvasPluginNodeVideo',
      formats: ['umd'],
      fileName: () => 'plugin-node-video.js',
    },
    rollupOptions: {
      external: [
        ...HOST_EXTERNALS,
        '@mini-canvas/plugin-bottom-bar',
      ],
      output: {
        globals: {
          ...HOST_GLOBALS,
          '@mini-canvas/plugin-bottom-bar': 'MiniCanvasPluginBottomBar',
        },
      },
    },
    cssCodeSplit: false,
    sourcemap: true,
  },
})
