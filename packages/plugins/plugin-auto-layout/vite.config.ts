import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'
import { pluginLibBuild } from '../vite-plugin-lib'

// plugin-auto-layout —— lib 打包（UMD）供「插件管理」从云服务清单加载。
// external / globals 走共享表（../vite-plugin-lib），与其它插件同一份事实源。
export default defineConfig({
  plugins: [vue(), cssInjectedByJs()],
  build: pluginLibBuild(import.meta.url, { name: 'MiniCanvasPluginAutoLayout' }),
})
