import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'MiniCanvasPluginBottomBar',
      fileName: 'plugin-bottom-bar',
    },
    rollupOptions: {
      external: ['vue', '@mini-canvas/kernel', '@mini-canvas/canvas-data', '@mini-canvas/canvas-base', '@mini-canvas/canvas-render', 'prosemirror-editor-bundle'],
      output: { globals: { vue: 'Vue' } },
    },
  },
})

