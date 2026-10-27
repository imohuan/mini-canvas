import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'

// plugin-shell-slots-demo —— 外壳插槽演示：打成自包含 UMD（external 只有 vue），
// 供「插件管理」或手动 script 装载；CSS 由 cssInjectedByJs 运行时注入（同 hot-reload-demo）。
export default defineConfig({
  plugins: [vue(), cssInjectedByJs()],
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'MiniCanvasPluginShellSlotsDemo',
      formats: ['umd'] as const,
      fileName: () => 'plugin-shell-slots-demo.umd.js',
    },
    rollupOptions: {
      external: ['vue'],
      // named 导出：UMD 产物把 name/inject/apply 挂在 MiniCanvasPluginShellSlotsDemo 上
      //（插件管理 / script 装载读这个全局），避免 default/named 混用的歧义警告。
      output: { globals: { vue: 'Vue' }, exports: 'named' },
    },
    cssCodeSplit: false,
    sourcemap: true,
  },
})
