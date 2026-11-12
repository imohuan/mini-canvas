import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { uiKitDebugLocPlugin } from './src/vite-plugin-debug-loc'

export default defineConfig(({ command, mode }) => ({
  // lib 模式：给 npm 发布产出库；其它模式仍保留组件库预览页。
  ...(mode === 'lib'
    ? {
        build: {
          lib: {
            entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
            name: 'PlumeUiKit',
            formats: ['es'] as const,
            fileName: () => 'index.js',
          },
          outDir: 'dist',
          emptyOutDir: true,
          cssCodeSplit: false,
          rollupOptions: {
            external: ['vue', 'reka-ui', '@vueuse/core', 'vue-sonner'],
            output: { assetFileNames: 'styles.css' },
          },
        },
      }
    : {}),
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
    port: 5295,
    strictPort: false,
    // 启动服务时不要自动弹浏览器：由人或代理手动打开页面
    open: false,
  },
}))
