import { defineConfig } from 'vitest/config'

// 本包是**纯逻辑**（无 .vue、无 DOM）：只测工具注册/参数 schema/HTTP 组装与轮询映射。
// 因此不挂 @vitejs/plugin-vue，environment 用 node。
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
