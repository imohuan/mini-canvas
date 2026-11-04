import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  // 卡片降级测试要真实渲染 .vue；没有这个插件，import 会被当成普通 JS 解析。
  plugins: [vue()],
  test: {
    // SSR 渲染卡片需要 vue/server-renderer 的 DOM-free 路径，node 环境足够。
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
