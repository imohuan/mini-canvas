// plugin-node-text —— text 节点插件包统一出口
/// <reference types="vite/client" />
export { nodeTextPlugin } from './nodeTextPlugin'
export type { TextNodeService } from './nodeTextPlugin'

// —— 开发期热重载（HMR）：本包任一源码(逻辑 .ts 或组件 .vue)一改，vite 触发本 accept →
//    经 window.MiniCanvas.reloadPlugin 先卸旧再装新，让改动在运行中的画布里实时生效。
//    仅 dev（import.meta.hot 存在）生效；打包产物无此代码。
//
// 用"自 accept(不带依赖数组)"而非 accept(['./nodeTextPlugin'])：自 accept 让 index.ts 成为
// 整棵依赖子树的 HMR 边界——任一层文件(TextContent.vue / nodeTextPlugin.ts)变更都会冒泡到
// index 并把整棵 index 图重 import，回调拿到的 mod 是全新图 → 其 nodeTextPlugin 已引用新组件。
if (import.meta.hot) {
  import.meta.hot.accept((mod) => {
    const api = (globalThis as { MiniCanvas?: { reloadPlugin(n: string, mod: unknown): void } }).MiniCanvas
    if (!api) return
    const next = mod as { nodeTextPlugin?: unknown } | undefined
    if (next?.nodeTextPlugin) api.reloadPlugin('text', next.nodeTextPlugin)
  })
}
