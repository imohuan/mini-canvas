/**
 * renderEvents —— 渲染层事件桥契约（canvas-render 提供、插件消费）。
 *
 * 背景：老插件(align-guide/auto-layout/mini-map/clipboard…)靠订阅 VueFlow 画布事件(nodesChange/
 * nodeDrag/nodeDragStop/connect…)驱动交互。v2 里 CanvasHost 把事件消化成落盘/选中/交互状态，
 * 但从不 ctx.emit 广播——插件模块拿不到拖拽过程/视口变化等信号。
 *
 * 本文件定义画布手势/数据事件名 + payload 归一化纯函数。CanvasHost 在 VueFlow 事件回调里
 * emit 这些事件（用 coalesce 节流高频的 drag/move），插件 ctx.on(事件名) 消费。
 */

/** 渲染层广播的画布事件名（供 CanvasHost emit + 插件 on） */
export const RenderEvents = {
  /** 节点拖动开始：{ nodeId, position } */
  NodeDragStart: 'canvas:node:drag-start',
  /** 节点拖动逐帧：{ nodeId, position }（rAF 节流后广播） */
  NodeDrag: 'canvas:node:drag',
  /** 节点拖动结束：{ nodeId, position } */
  NodeDragEnd: 'canvas:node:drag-end',
  /** 画布视图开始移动(pan/缩放)：{ viewport } */
  MoveStart: 'canvas:viewport:move-start',
  /** 画布视图移动结束：{ viewport } */
  MoveEnd: 'canvas:viewport:move-end',
  /** 点选节点：{ nodeId, shiftKey } */
  NodeClick: 'canvas:node:click',
  /** 点选边：{ edgeId, shiftKey } */
  EdgeClick: 'canvas:edge:click',
  /** 点画布空白 */
  PaneClick: 'canvas:pane:click',
  /** 选中变化（节点/边任一桶）：{ nodeIds, edgeIds } */
  SelectionChange: 'canvas:selection:change',
  /**
   * 拖线在**空白处**松手（未命中任何节点/端口）：
   * { clientX, clientY, flowPosition, sourceNodeId, sourceHandle }
   *
   * 与右键事件同源：宿主 mouseup 时已算完吸附/命中，结果只描述事实（"落在空白"），
   * 是否就此弹菜单/放临时节点由消费方（如 plugin-context-menu）自行决定 —— 渲染层不掺业务。
   */
  ConnectionDropBlank: 'canvas:connection:drop-blank',
  /** 右键：画布空白 { clientX, clientY, flowPosition } */
  ContextMenuPane: 'canvas:context-menu:pane',
  /** 右键：节点 { clientX, clientY, flowPosition, nodeId, nodeType? } */
  ContextMenuNode: 'canvas:context-menu:node',
  /** 右键：边 { clientX, clientY, flowPosition, edgeId } */
  ContextMenuEdge: 'canvas:context-menu:edge',
} as const

export interface DragEventPayload {
  nodeId: string
  position: { x: number; y: number }
}

export interface MoveEventPayload {
  viewport: { x: number; y: number; zoom: number }
}

export interface ClickPayload {
  nodeId?: string
  edgeId?: string
  shiftKey?: boolean
}

export interface ContextMenuPanePayload {
  clientX: number
  clientY: number
  flowPosition: { x: number; y: number }
}

/** 拖线在空白处松手的 payload（RenderEvents.ConnectionDropBlank） */
export interface ConnectionDropPayload {
  clientX: number
  clientY: number
  /** 松手点的画布(flow)坐标 —— 消费方据此在松手位置放临时节点 */
  flowPosition: { x: number; y: number }
  /** 拖线源节点 id */
  sourceNodeId: string
  /** 拖线起点端口：'source' = 从输出口拖出；'target' = 从输入口反向拖出（线要从新节点往左画） */
  sourceHandle: 'source' | 'target'
}
export interface ContextMenuNodePayload {
  clientX: number
  clientY: number
  flowPosition: { x: number; y: number }
  nodeId: string
  nodeType?: string
}
export interface ContextMenuEdgePayload {
  clientX: number
  clientY: number
  flowPosition: { x: number; y: number }
  edgeId: string
}

export interface SelectionChangePayload {
  nodeIds: string[]
  edgeIds: string[]
}

/* 把一段任意节点拖拽事件对象归一成 { nodeId, position }（容忍 VueFlow NodeDragEvent / 窄对象） */
export function toDragPayload(e: {
  node?: { id?: string; position?: { x: number; y: number } }
}): DragEventPayload | null {
  if (!e.node?.id) return null
  const p = e.node.position
  return { nodeId: e.node.id, position: p ? { x: p.x, y: p.y } : { x: 0, y: 0 } }
}

