import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // ui 包以"装配壳"身份存在：唯一测试目标是 src/__tests__/nodePluginsAssembly.test.ts
    // （多插件同时装载的整装仲裁，内核包不能反向依赖插件，只能在这一层验）。保留 passWithNoTests
    // 以便清空该目录时仍可按装配壳对待。
    passWithNoTests: true,
  },
})

