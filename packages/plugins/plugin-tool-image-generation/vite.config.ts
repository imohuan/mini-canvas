import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// plugin-tool-image-generation —— lib 打包（UMD）供"第三方已打包 js"场景：宿主 <script> 载入后 installPlugin。
// - vue / 内核 external（宿主只允许一份，与兄弟插件包同一约定）。
// - 本包无 .vue/CSS，故不挂 plugin-vue 与 css 内联插件。
export default defineConfig({
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'MiniCanvasPluginToolImageGeneration',
      formats: ['umd'],
      fileName: () => 'plugin-tool-image-generation.js',
    },
    rollupOptions: {
      external: ['vue', '@mini-canvas/canvas-data', '@mini-canvas/canvas-base'],
      output: {
        globals: {
          vue: 'Vue',
          '@mini-canvas/canvas-data': 'MiniCanvasCore',
          '@mini-canvas/canvas-base': 'MiniCanvasBase',
        },
      },
    },
    cssCodeSplit: false,
    sourcemap: true,
  },
})
