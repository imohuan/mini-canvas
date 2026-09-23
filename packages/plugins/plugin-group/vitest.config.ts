import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  // 加 vue 插件：本包含 .vue 组件（GroupContent / GroupTopToolbar）。
  // 上控制栏"有没有真的渲染出来"只有渲染才验得到 —— 与 multi-select / theme-default 同一套做法。
  plugins: [vue()],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
