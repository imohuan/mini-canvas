import { defineConfig } from 'vitest/config'

// 本包是纯逻辑（把后台包成工具），无 .vue → node 环境即可，不引 plugin-vue
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
