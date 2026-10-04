import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// 与 plugin-align-guide 同款：起 Vue 编译链，让 .vue 的 SSR 渲染契约可测。
export default defineConfig({
  plugins: [vue()],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})

