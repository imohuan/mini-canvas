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
    /**
     * 后台任务运行态（单对象，便于整补与比对；由 TaskManager 写回）。
     * 语义：{ status, progress?, message?, taskId?, imageUrl?, error? }
     */
    runState?: Record<string, unknown>
    /** 图片节点展示图（前端 <img> 只认此字段） */
    imageUrl?: string
    /** 参考图/预览节点的原始绝对路径（仅后台去重用，非渲染字段） */
    sourcePath?: string
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
  | { type: 'node:updated'; canvasId: string; nodeId: string; patch: Partial<CanvasNode>; node: CanvasNode }
  | { type: 'edge:added'; canvasId: string; edge: CanvasEdge }
  | { type: 'edge:removed'; canvasId: string; edgeId: string }
  | { type: 'graph:changed'; canvasId: string; graphVersion: number }
  | { type: 'graph:saved'; canvasId: string }
  | { type: 'batch:done'; canvasId: string; resource: string; addedCount: number; deletedCount: number; updatedCount: number }
