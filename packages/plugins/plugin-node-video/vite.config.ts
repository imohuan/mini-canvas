import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'
import { fileURLToPath } from 'node:url'
import { HOST_EXTERNALS, HOST_GLOBALS, PLUGIN_DEFINE } from '../vite-plugin-lib'

// plugin-node-video —— 与 plugin-node-image 同一套 lib 打包（UMD，css 内联）。
// vue / 内核 external（宿主只允许一份）；@plume-canvas/plugin-bottom-bar 同样由宿主
// 提供唯一运行时（既有装配依赖），打进插件会出现两份底栏注册表。
export default defineConfig({
  plugins: [vue(), cssInjectedByJs()],
  // 内联的第三方库可能自带 process.env.NODE_ENV；浏览器没有 process，不替换会 ReferenceError。
  define: PLUGIN_DEFINE,
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'PlumePluginNodeVideo',
      formats: ['umd'],
      fileName: () => 'plugin-node-video.js',
    },
    rollupOptions: {
      external: [
        ...HOST_EXTERNALS,
        '@plume-canvas/plugin-bottom-bar',
      ],
      output: {
        globals: {
          ...HOST_GLOBALS,
          '@plume-canvas/plugin-bottom-bar': 'PlumePluginBottomBar',
        },
      },
    },
    cssCodeSplit: false,
    sourcemap: true,
  },
})
