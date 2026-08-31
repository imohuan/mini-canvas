/** 节点类型（语义类型；'custom' 是前端 VueFlow 的统一渲染类型） */
export type CanvasNodeType =
  | 'custom'
  | 'image'
  | 'video'
  | 'audio'
  | 'text'
  | 'panorama'
  | 'image-compare'

/** 节点运行时状态 */
export type CanvasNodeStatus = 'idle' | 'rendering' | 'done' | 'error'

/** 画布节点（与前端 VueFlow 节点数据同构） */
export interface CanvasNode {
  id: string
  type: CanvasNodeType
  position: { x: number; y: number }
  data: {
    label?: string
    /** 语义节点类型（前端插件注册的类型，如 image/text/video） */
    nodeType?: string
    status?: CanvasNodeStatus
    progress?: number
    src?: string
    url?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

/** 画布连线 */
export interface CanvasEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  data?: Record<string, unknown>
  [key: string]: unknown
}

/** 画布视口 */
export interface CanvasViewport {
  x: number
  y: number
  zoom: number
}

/** 图事件类型 */
export type GraphEvent =
  | { type: 'node:added'; canvasId: string; node: CanvasNode }
  | { type: 'node:removed'; canvasId: string; nodeId: string }
  | { type: 'node:updated'; canvasId: string; nodeId: string; patch: Partial<CanvasNode> }
  | { type: 'edge:added'; canvasId: string; edge: CanvasEdge }
  | { type: 'edge:removed'; canvasId: string; edgeId: string }
  | { type: 'graph:changed'; canvasId: string; graphVersion: number }
  | { type: 'graph:saved'; canvasId: string }
