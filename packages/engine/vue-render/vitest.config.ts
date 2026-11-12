import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  // 搬进来的 SlotComposer / SlotAnchor / SettingsHost / SettingsShell 都是 .vue：
  // 单测要能直接 import 组件，必须挂 Vue 插件（canvas-render 原来也是这么配的）。
  plugins: [vue()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
