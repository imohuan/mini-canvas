import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

// plugin-node-text —— 独立 dev server（宿主跨端口热拉开发用）。
//
// 与 vite.config.ts（UMD 打包）区分：dev 场景不打包，起一个真正的 dev server，
// 宿主 `import('http://localhost:5311/src/index.ts')` 直接拉源码模块。
//
// vue 单例(核心)：宿主与插件都 resolve vue 到 pnpm 同一真实路径(.pnpm/vue@…)，
// 插件 dev 的 .vue import 'vue' 会和宿主拿同一份 → 浏览器 ES 模块 map 同一 URL → 单 vue。

// 插件入口 index.ts 的绝对路径(handleHotUpdate 用)
const entryAbsPath = fileURLToPath(new URL('./src/index.ts', import.meta.url)).replace(/\\/g, '/')

/** 保证插件整树 HMR 冒泡到 index.ts 的 dev 插件(纯 vite 官方 API)。
 *
 * 热更链路(全用 vite 自带机制，无自建 SSE/轮询)：
 *   宿主 import 插件 dev 入口 index.ts → 该模块带上 5311 的 /@vite/client(token 随模块注入)，
 *   宿主页面自动成为 5311 的 HMR 客户端。插件 src/index.ts 里 import.meta.hot.accept(自) 收
 *   原生 HMR 通知 → 调 window.MiniCanvas.reloadPlugin(重卸旧装新)。
 *
 * 为什么需要本插件：@vitejs/plugin-vue 给每个 .vue 注入了自己的 self-accept，当只改
 *   TextContent.vue 这类深层组件时，vite 会在该 .vue 就地热更、不再向上冒泡到 index.ts
 *   → 插件 reload 不触发。本插件用官方 handleHotUpdate：任一插件 src 文件变更时，把入口
 *   index.ts 模块也塞进本次热更的受影响模块 → index 的 accept(self) 必触发 → reloadPlugin。
 *   这样改 .ts(逻辑) 或 .vue(组件) 都能让插件整树热更。
 */
function forcePluginEntryHotUpdate(): Plugin {
  return {
    name: 'mini-canvas:force-plugin-entry-hot',
    handleHotUpdate(ctx) {
      // ctx.file = 变更文件绝对路径；只关心插件 src 内文件(排除 vite 自身/编辑器临时文件)
      const file = ctx.file.replace(/\\/g, '/')
      if (!file.includes('/plugin-node-text/src/')) return
      if (file.includes('.tmp-')) return
      const modules = [...ctx.modules]
      // 把入口模块塞进受影响集合，强制它本轮也被更新 → 触发其 import.meta.hot.accept(self)。
      const entryByFile = [...(ctx.server.moduleGraph.getModulesByFile(entryAbsPath) ?? [])][0]
      if (entryByFile && !modules.includes(entryByFile)) modules.push(entryByFile)
      return modules
    },
  }
}

// 宿主 import 的是 src/index.ts 及它 import 的 .vue——vite 会自动把它们当模块 serve，无需 html。
export default defineConfig({
  plugins: [vue(), forcePluginEntryHotUpdate()],
  server: {
    port: 5311,
    strictPort: true,
    cors: true,
  },
})
