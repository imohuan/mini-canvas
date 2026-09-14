import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  // 加 vue 插件：本包含 .vue 浮层组件（SelectionFrame / BoxSelectLayer）。
  // 框的几何虽已抽成纯逻辑单测，但"模板有没有把几何与配置真的贴到元素上"只有渲染才验得到 ——
  // 与 theme-default / node-text 等包同一套做法（SSR 拿真 HTML 断言）。
  plugins: [vue()],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
