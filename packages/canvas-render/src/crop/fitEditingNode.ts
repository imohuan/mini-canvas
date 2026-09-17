/**
 * fitEditingNode —— 进入编辑态时"把节点拉进视野"的接线（**一份实现，两处复用**）。
 *
 * 实测缺陷（用户报的「你的图片扩展也全是 BUG，UI 控制端口移动错误显示」）：
 * 节点停在画布偏下的位置，扩展/裁剪框往四周长大之后卡片底部跑到视口之外
 * （实测卡片底 899px 而视口只有 720px）—— 下侧三个控制点在 elementFromPoint 里返回 null，
 * 根本点不到。用户看到的现象就是"控制点错位/拖不动"。根因不是控制点画错，是被推出屏幕了。
 *
 * 解法与 v1 的 fitView({ nodes:[id], padding, maxZoom }) 同思路：进编辑态先把该节点
 * （连同外扩余量）摆进视野。几何判断在 editingViewport.ts（纯函数、可单测）；
 * 这里只负责"取内核服务 → 把两者换算到同一套 flow 坐标系 → 执行 setCenter"这段接线。
 *
 * 坐标换算只做一次、且写成显式算式（这是最容易错的地方）：
 *   VueFlow 的视口 (tx, ty, zoom) 满足： 屏幕 = flow * zoom + t
 *   ⇒ 可视区在 flow 坐标系里的左上角 = (-tx/zoom, -ty/zoom)，大小 = paneSize/zoom
 *
 * 两条底线：
 * - 装得下且都在视野内时**不碰视口**（用户可能刚调好视角，不该被无缘无故拽走）；
 * - 拿不到任何一项必要信息时**安静跳过**（宁可不拉，也不要瞎跳）。
 */
import { resolveEditingViewport, shouldFitEditingViewport, type EditingViewportInput } from './editingViewport'

/** 只要"按名字取服务"这一件事（内核 Context 与渲染上下文都满足） */
export interface ServiceGetter {
  get<T = unknown>(name: string): T
}

/** 视口服务的必要能力（plugin-node-* 消费的最小面） */
interface ViewportLike {
  getViewport(): { x: number; y: number; zoom: number }
  setCenter(x: number, y: number, zoom?: number): void
  getPaneEl?(): HTMLElement | null
}

/** 节点布局服务的必要能力 */
interface NodeLayoutLike {
  getNodeRect(id: string): { x: number; y: number; w: number; h: number } | null
}

/**
 * 把某节点（含编辑余量）拉进视野。装得下且看得见 / 信息不全时什么都不做。
 * @returns 是否真的调了 setCenter（供测试断言"该动才动"）
 */
export function fitEditingNodeIntoView(ctx: ServiceGetter, nodeId: string): boolean {
  const layout = ctx.get<NodeLayoutLike | undefined>('nodeLayout')
  const viewport = ctx.get<ViewportLike | undefined>('viewport')
  const rect = layout?.getNodeRect(nodeId)
  if (!rect || !viewport) return false

  // 可视区尺寸：优先量真实 pane（最准）；量不到再退回窗口尺寸
  const paneEl = viewport.getPaneEl?.() ?? null
  const paneW = paneEl?.clientWidth ?? (typeof window !== 'undefined' ? window.innerWidth : 0)
  const paneH = paneEl?.clientHeight ?? (typeof window !== 'undefined' ? window.innerHeight : 0)
  if (!(paneW > 0) || !(paneH > 0)) return false

  const vp = viewport.getViewport()
  const zoom = vp.zoom > 0 && Number.isFinite(vp.zoom) ? vp.zoom : 1

  // 屏幕 → flow：可视区左上角 = -t/zoom，大小 = paneSize/zoom
  const input: EditingViewportInput = {
    node: { x: rect.x, y: rect.y, width: rect.w, height: rect.h },
    visible: { x: -vp.x / zoom, y: -vp.y / zoom, width: paneW / zoom, height: paneH / zoom },
    zoom,
  }
  if (!shouldFitEditingViewport(input)) return false
  const plan = resolveEditingViewport(input)
  if (!plan) return false
  viewport.setCenter(plan.centerX, plan.centerY, plan.zoom)
  return true
}

