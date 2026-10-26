import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'
import { pluginLibBuild } from '../vite-plugin-lib'

// plugin-bottom-bar —— lib 打包（UMD + CSS 注入）供热重载/插件管理加载。
// external / globals 走共享表（../vite-plugin-lib），与其它插件同一份事实源。
export default defineConfig({
  plugins: [vue(), cssInjectedByJs()],
  build: pluginLibBuild(import.meta.url, { name: 'MiniCanvasPluginBottomBar' }),
})

