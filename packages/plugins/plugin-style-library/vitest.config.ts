import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  // 组件测试要真实渲染 .vue；没有这个插件，import 会被当成普通 JS 解析。
  plugins: [vue()],
  test: {
    // 默认 node（纯数据层）；弹窗 / 详情这类 Teleport 组件用文件头 happy-dom 覆盖。
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
