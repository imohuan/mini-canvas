import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'
import { pluginLibBuild } from '../vite-plugin-lib'

// plugin-agent —— 前端半打 UMD（供插件管理从 cloud-server 清单加载），后台半由 build-server.mjs 单独产出。
export default defineConfig({
  plugins: [vue(), cssInjectedByJs()],
  build: pluginLibBuild(import.meta.url, { name: 'PlumePluginAgent' }),
})
