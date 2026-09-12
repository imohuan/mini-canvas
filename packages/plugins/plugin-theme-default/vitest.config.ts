import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  // 加 vue 插件：本包含 .vue 组件（BaseNode/BaseTitle 等），要测渲染行为必须能编译 SFC。
  plugins: [vue()],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
