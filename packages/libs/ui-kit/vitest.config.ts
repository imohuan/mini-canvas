import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

// 组件库自己的单测：需要 Vue 单文件组件支持与 DOM 环境（弹层 / 焦点 / 事件）。
export default defineConfig({
  plugins: [vue()],
  resolve: {
    dedupe: ['vue', 'reka-ui', '@vueuse/core'],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // 与其它包一致：纯 node 环境。这些测试只读源码 / 渲染字符串，不碰 DOM。
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
