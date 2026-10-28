import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'

// plugin-shell-slots-demo —— ESM 产物（外部化宿主运行时）。
// 给 manager.install({ url }) 用：宿主 fetch 文本 → import(data:text/javascript)。
//
// 为什么必须 external 掉 vue / canvas-render 等宿主运行时（2026-10-28 实测）：
// 内联会产生**第二份** canvas-render 模块实例，provide/inject 的 key 即使是
// Symbol.for（全局注册表）也命中不了 —— inject 要的是**同一份模块里的那个对象**。
// 表现就是外壳槽组件 setup 抛“缺少画布上下文”。external 后从 window 全局取
// （sharedGlobals 已挂 MiniCanvasRender 等），插件与宿主共享同一份 provide 实例。
export default defineConfig({
  plugins: [vue(), cssInjectedByJs()],
  // data: URL 里没有 process.env：把 NODE_ENV 替换掉（vite 默认只对 import.meta.env 做），
  // 否则内联进来的 Vue（dev 构建带 process.env.NODE_ENV 分支）在浏览器里直接 ReferenceError。
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    // 正式装载链路（pluginManager.install({ url }) / e2e）读的是 dist-esm，
    // 与 UMD 的 dist 分开：UMD 供「插件管理」脚本装载，ESM 供 import(data:) 装载。
    // 两个产物必须各自有稳定目录，否则重新构建会把对方覆盖掉。
    outDir: 'dist-esm',
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'plugin-shell-slots-demo.esm.js',
    },
    rollupOptions: {
      // ESM 产物改成**完全自包含**（内联 vue/canvas-render）：manager.install({url}) 走
      // data:URL import，裸模块名（vue 等）在 data:URL 里解析不了（浏览器无 import map）。
      // 之前 external 掉是为了共享 provide/inject —— 现在共享问题改由"自包含 + 字符串 key
      // + window.MiniCanvasUI.getContext() 兜底"解决，外壳槽组件不再依赖 inject 命中宿主实例。
      external: [],
    },
    cssCodeSplit: false,
    sourcemap: true,
  },
})
