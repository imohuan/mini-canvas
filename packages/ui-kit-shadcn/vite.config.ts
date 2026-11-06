import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { uiKitDebugLocPlugin } from './src/vite-plugin-debug-loc'

export default defineConfig(({ command }) => ({
  /**
   * 成品应用用 iframe 打开 /ui-kit/：构建产物要挂在这个子路径，
   * 且资源引用带同一前缀（否则 iframe 里的 assets 会指到站点根）。
   * dev server 也按这个 base 服务，ui 的代理保留 /ui-kit 前缀直接转发。
   */
  base: '/ui-kit/',
  plugins: [
    // 组件库自己的预览页也可以用同一套调试标记（仅 dev）。
    ...(command === 'serve' ? [uiKitDebugLocPlugin({ root: fileURLToPath(new URL('../..', import.meta.url)) })] : []),
    vue(),
    tailwindcss(),
  ],
  // 预览页与依赖必须共用同一份 Vue。pnpm 会把 @lucide/vue、@vuelor/picker 装到
  // 不同 peer 上下文里，各自各带一份 Vue；不统一时 Lucide 图标的 inject 会拿到
  // 另一份运行时的空上下文，表现为整页白屏。
  resolve: {
    dedupe: ['vue', 'reka-ui', '@vueuse/core'],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // 固定端口：项目页「组件库」用 iframe 指它，端口漂移就会白屏。
    // 端口被占时由 vite 报错，而不是悄悄换一个（换端口 = 页面找不到）。
    port: 5295,
    strictPort: true,
    // 启动服务时不要自动弹浏览器：由人或代理手动打开页面
    open: false,
  },
}))
