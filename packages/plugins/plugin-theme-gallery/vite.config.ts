import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { pluginLibBuild } from '../vite-plugin-lib'

// plugin-theme-gallery —— lib 打包（UMD）供「插件管理」加载。
export default defineConfig({
  plugins: [vue()],
  build: pluginLibBuild(import.meta.url, { name: 'MiniCanvasPluginThemeGallery' }),
})

