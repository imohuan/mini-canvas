import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'
import { pluginLibBuild } from '../vite-plugin-lib'

// plugin-style-library —— 前端半 lib 打包（UMD）供「插件管理」/冷启动装配。
export default defineConfig({
  plugins: [vue(), cssInjectedByJs()],
  build: pluginLibBuild(import.meta.url, { name: 'MiniCanvasPluginStyleLibrary', sourcemap: false }),
})
