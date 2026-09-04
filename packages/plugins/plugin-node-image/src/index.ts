// plugin-node-image —— image 节点插件包统一出口
/// <reference types="vite/client" />
export { nodeImagePlugin } from './nodeImagePlugin'
export type { ImageNodeService } from './nodeImagePlugin'

// —— 开发期热重载（HMR）：本包源码一改，vite 触发本 accept →
//    经 window.MiniCanvas.reloadPlugin 先卸旧再装新，让改动在运行中的画布里实时生效。
//    仅 dev（import.meta.hot 存在）生效；打包产物无此代码。
if (import.meta.hot) {
  import.meta.hot.accept(['./nodeImagePlugin'], ([newMod]) => {
    const api = (globalThis as { MiniCanvas?: { reloadPlugin(n: string, mod: unknown): void } }).MiniCanvas
    if (!api) return
    // vite accept(depsArray, cb)：cb 收一个数组，仅被更新的依赖位非空。
    // 这里只 accept 一个依赖 → [0] 即新模块命名空间。
    const mod = (newMod as { nodeImagePlugin?: unknown } | undefined)?.nodeImagePlugin
    if (mod) api.reloadPlugin('image', mod)
  })
}
