import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { uiKitDocsPlugin } from './vite'

/**
 * ui-kit 独立开发服务：组件、预览页、Markdown 文档都在本包内。
 */
export default defineConfig({
  plugins: [
    vue(),
    uiKitDocsPlugin(fileURLToPath(new URL('./docs', import.meta.url))),
  ],
  server: {
    port: 5293,
    strictPort: false,
    // 启动服务时不要自动弹浏览器：由人或代理手动打开页面
    open: false,
  },
})
