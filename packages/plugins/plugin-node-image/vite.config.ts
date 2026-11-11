import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'
import { fileURLToPath } from 'node:url'
import { HOST_EXTERNALS, HOST_GLOBALS } from '../vite-plugin-lib'

// plugin-node-image —— lib 打包（UMD）供"第三方已打包 js"场景。
// vue / 内核 external（宿主只允许一份）；css 内联进单份 js。
// prosemirror-editor-bundle 也是"宿主只允许一份"的共享运行时（编辑器实例、prosemirror 依赖都在里面，
// 打进插件会造成两套 prosemirror 状态 → @ 引用/文档序列化不一致），故与 vue/内核同列 external。
export default defineConfig({
  plugins: [vue(), cssInjectedByJs()],
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'PlumePluginNodeImage',
      formats: ['umd'],
      fileName: () => 'plugin-node-image.js',
    },
    rollupOptions: {
      // plugin-theme-components 同为"宿主只允许一份"的共享运行时（它提供 Select/Dropdown 等通用 UI 组件，
      // 打进插件会造成两份组件定义、样式重复）。
      // 注：T07 起本插件的生产代码不再 import theme-default（UI 走主题可替换目录按名取），
      // 它只因**测试**装载真实主题而留在 devDependencies；是否 external 已不影响产物。
      external: [
        ...HOST_EXTERNALS,
      ],
      output: {
        globals: {
          ...HOST_GLOBALS,
        },
      },
    },
    cssCodeSplit: false,
    sourcemap: true,
  },
})
