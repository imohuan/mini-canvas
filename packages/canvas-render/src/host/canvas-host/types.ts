import type { ViewportState } from '../../viewport/viewportService'
import type { FlowRect } from '../../geometry/visibleArea'

/** CanvasSurface 暴露给 CanvasHost 的实例句柄（拖线/绑定/裁剪读取视口和节点 DOM）。 */
export interface CanvasSurfaceHandle {
  getViewport?: () => ViewportState
  getPaneRect?: () => DOMRect | null
  getVisibleRect?: () => FlowRect | null
  screenToFlow?: (x: number, y: number) => { x: number; y: number }
  queryNodeEl?: (nodeId: string) => HTMLElement | null
  getSelectedNodePositions?: () => Array<{ id: string; x: number; y: number }>
  /** 正在拖动节点的实时位置（拖动中 store 尚未落盘；重灌时用它保留画面位置） */
  getDraggingNodePositions?: () => Map<string, { x: number; y: number }>
  /** 当前渲染节点位置快照（含插件逐帧视觉写、dragging 标志、父节点） */
  getRenderNodePositions?: () => ReadonlyArray<{
    id: string
    position: { x: number; y: number }
    dragging: boolean
    parentId?: string
  }>
  /** 插件视觉位移的节点 id + 变化计数（事件驱动裁剪保护用） */
  getVisualMoveSnapshot?: () => { ids: Set<string>; epoch: number }
  setCenter?: (x: number, y: number, zoom?: number) => void
  animateViewport?: (v: { x: number; y: number; zoom: number }, durationMs?: number) => void
}

/** CanvasSurface 消费的渲染边最小形状。 */
export interface CanvasHostRenderEdge {
  id: string
  type: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}
