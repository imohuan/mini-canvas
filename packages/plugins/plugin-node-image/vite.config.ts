import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'
import { fileURLToPath } from 'node:url'

// plugin-node-image —— lib 打包（UMD）供"第三方已打包 js"场景。
// vue / 内核 external（宿主只允许一份）；css 内联进单份 js。
// prosemirror-editor-bundle 也是"宿主只允许一份"的共享运行时（编辑器实例、prosemirror 依赖都在里面，
// 打进插件会造成两套 prosemirror 状态 → @ 引用/文档序列化不一致），故与 vue/内核同列 external。
export default defineConfig({
  plugins: [vue(), cssInjectedByJs()],
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'MiniCanvasPluginNodeImage',
      formats: ['umd'],
      fileName: () => 'plugin-node-image.js',
    },
    rollupOptions: {
      // plugin-theme-default 同为"宿主只允许一份"的共享运行时（它提供 Select/Dropdown 等通用 UI 组件，
      // 打进插件会造成两份组件定义、样式重复），故与 vue/内核同列 external。
      external: [
        'vue',
        '@mini-canvas/canvas-data',
        '@mini-canvas/canvas-render',
        '@mini-canvas/plugin-theme-default',
        'prosemirror-editor-bundle',
      ],
      output: {
        globals: {
          vue: 'Vue',
          '@mini-canvas/canvas-data': 'MiniCanvasCore',
          '@mini-canvas/canvas-render': 'MiniCanvasRender',
          '@mini-canvas/plugin-theme-default': 'MiniCanvasPluginThemeDefault',
          'prosemirror-editor-bundle': 'ProseMirrorEditorBundle',
        },
      },
    },
    cssCodeSplit: false,
    sourcemap: true,
  },
})
