/**
 * nodeVisualSync —— 拖拽中把「节点视觉尺寸」同步进 VueFlow 内部（纯逻辑，可单测）。
 *
 * ## 解决的线上问题（用户反馈）
 * resize 拖拽期间，卡片的内联 width/height 变了，但 **VueFlow 内部记的节点尺寸没变**，于是：
 *   - 端口（Handle）位置仍按旧尺寸算 → 拖大后端口不跟着往下移；
 *   - 节点外层 .vue-flow__node 的尺寸不变 → 端口锚点、盒子高度都停在旧值；
 *   - 相连的边端点不重算 → 线还连在旧位置。
 * 实测（同一节点拖拽中）：VueFlow dimensions 恒为 593×563，而卡片已到 641；
 * 调一次 updateNode(style) + updateNodeInternals([id]) 后，dimensions/端口/边路径立刻跟上。
 *
 * ## 为什么两步都要
 * - `updateNode(id, { style })`：把新尺寸写进 VueFlow 的节点记录（外层盒子的尺寸来源）；
 * - `updateNodeInternals([id])`：让 VueFlow **重算**该节点的 handle 位置与相连边（VueFlow 官方接口）。
 *   只做前者，内部 handleBounds/边仍不会刷新；只做后者，尺寸来源还是旧的。
 *
 * 注：松手提交（走 nodeStore → 重渲染）后 VueFlow 自己的 ResizeObserver 会收敛，故本同步只在
 * **拖拽实时**这条绕过 store 的路径上需要。
 */

/** VueFlow 侧用到的两个能力（最小形状，便于无 Vue 单测与替换） */
export interface NodeVisualSyncApi {
  updateNode(id: string, patch: { style: { width: string; height: string } }): void
  updateNodeInternals(nodeIds: string[]): void
}

/**
 * 把节点的新视觉尺寸同步给 VueFlow 并强制重算内部（端口位置 / 相连边端点）。
 * 非正尺寸直接忽略（拖拽中的中间态可能算出 0，不必打扰 VueFlow）。
 */
export function applyNodeVisualSize(
  api: NodeVisualSyncApi,
  id: string,
  w: number,
  h: number,
): void {
  if (!(w > 0) || !(h > 0)) return
  api.updateNode(id, { style: { width: `${w}px`, height: `${h}px` } })
  api.updateNodeInternals([id])
}
