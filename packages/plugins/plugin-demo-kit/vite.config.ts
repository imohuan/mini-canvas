import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'
import { pluginLibBuild } from '../vite-plugin-lib'

// plugin-demo-kit —— 四套开发演示合并后的**唯一**产物（UMD），供「插件管理」按需安装。
//
// external / globals 走共享表（../vite-plugin-lib）——唯一事实源，与其它可装卸插件同一份。
// 本插件不 import 任何其它插件：展厅里的小画布直接用宿主已装的主题注册表
// （CanvasProvider 的 theme-registry 入参），所以这里不需要任何 theme 包的特例。
export default defineConfig(({ command }) => {
  if (command === 'serve') {
    return {
      plugins: [vue()],
      server: { port: 5318, strictPort: true, open: false },
      optimizeDeps: {
        exclude: [
          '@plume-canvas/canvas-data',
          '@plume-canvas/canvas-render',
          '@plume-canvas/plugin-sdk',
          '@plume-canvas/kernel',
          '@plume-canvas/ui-kit',
        ],
      },
    }
  }

  return {
    plugins: [vue(), cssInjectedByJs()],
    build: pluginLibBuild(import.meta.url, { name: 'PlumePluginDemoKit' }),
  }
})

