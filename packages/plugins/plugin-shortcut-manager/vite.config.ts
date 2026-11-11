import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'
import { pluginLibBuild } from '../vite-plugin-lib'

// plugin-shortcut-manager —— lib 打包（UMD + CSS 注入）。
// 以前只有源码与测试：界面在 dev 下直接 import 源码能跑，但发布包的构建版按目录装载，
// 没有产物 = 设置页缺少「快捷键」整页（2026-11-11 实测）。
// external / globals 走共享表（../vite-plugin-lib），与其它插件同一份事实源。
export default defineConfig({
  plugins: [vue(), cssInjectedByJs()],
  build: pluginLibBuild(import.meta.url, { name: 'PlumePluginShortcutManager' }),
})
