// plugin-node-3d-preview —— 3D 全景预览节点插件包统一出口
export { node3dPreviewPlugin, PANORAMA_NODE_TYPE } from './node3dPreviewPlugin'
export type { Panorama3DNodeService } from './node3dPreviewPlugin'

// —— 开发期热重载（HMR）：本包源码一改，vite 触发本 accept →
//    经 window.MiniCanvas.reloadPlugin 先卸旧再装新，让改动在运行中的画布里实时生效。
//    仅 dev（import.meta.hot 存在）生效；打包产物无此代码。
if (import.meta.hot) {
  import.meta.hot.accept(['./node3dPreviewPlugin'], ([newMod]) => {
    const api = (globalThis as { MiniCanvas?: { reloadPlugin(n: string, mod: unknown): void } }).MiniCanvas
    if (!api) return
    const mod = (newMod as { node3dPreviewPlugin?: unknown } | undefined)?.node3dPreviewPlugin
    if (mod) api.reloadPlugin('3d-preview', mod)
  })
}
