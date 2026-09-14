// plugin-node-image-compare —— 图片对比节点插件包统一出口
export { nodeImageComparePlugin, IMAGE_COMPARE_NODE_TYPE } from './nodeImageComparePlugin'
export type { ImageCompareNodeService } from './nodeImageComparePlugin'

// —— 开发期热重载（HMR）：本包源码一改，vite 触发本 accept →
//    经 window.MiniCanvas.reloadPlugin 先卸旧再装新，让改动在运行中的画布里实时生效。
//    仅 dev（import.meta.hot 存在）生效；打包产物无此代码。
if (import.meta.hot) {
  import.meta.hot.accept(['./nodeImageComparePlugin'], ([newMod]) => {
    const api = (globalThis as { MiniCanvas?: { reloadPlugin(n: string, mod: unknown): void } }).MiniCanvas
    if (!api) return
    const mod = (newMod as { nodeImageComparePlugin?: unknown } | undefined)?.nodeImageComparePlugin
    if (mod) api.reloadPlugin('image-compare', mod)
  })
}
