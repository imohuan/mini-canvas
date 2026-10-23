import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  // 设置页是 .vue 单文件组件：测试要从入口 import 插件本体，必须能编译 vue 文件。
  plugins: [vue()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
  },
})
