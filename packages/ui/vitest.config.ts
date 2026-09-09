import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // ui 包是 demo 装配壳（App.vue + main.ts，无纯逻辑单测目标）；空测试集视为通过
    passWithNoTests: true,
  },
})


