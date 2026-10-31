import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'
import { pluginLibBuild } from '../vite-plugin-lib'

// plugin-ui-demo —— 示例插件的 UMD 产物，供「设置 → 插件」按需安装。
//
// 它是**演示件**，不是产品冷启动能力：产物名与运行时名一致采用 demo-ui-slots，
// 避免在插件清单、全局名和卸载键之间出现三套叫法。
export default defineConfig({
  plugins: [vue(), cssInjectedByJs()],
  build: pluginLibBuild(import.meta.url, { name: 'MiniCanvasPluginDemoUiSlots' }),
})
