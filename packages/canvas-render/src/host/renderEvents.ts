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
import { registerEventName } from '@mini-canvas/kernel'

/** 渲染层广播的画布事件名（供 CanvasHost emit + 插件 on） */
export const RenderEvents = {
  /** 节点拖动开始：{ nodeId, position }（position = flow 绝对坐标，见 toDragPayload） */
  NodeDragStart: 'canvas:node:drag-start',
  /** 节点拖动逐帧：{ nodeId, position }（position = flow 绝对坐标；rAF 节流后广播） */
  NodeDrag: 'canvas:node:drag',
  /** 节点拖动结束：{ nodeId, position }（position = flow 绝对坐标） */
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

// 设计文档 §7.4：**emit 的事件名必须 registerEventName 登记**，否则 dev 下每次 emit 一条
// "[EventBus:dev] emit 了未声明的事件名" warn（验收要求"warn 仅限既有白名单"）。
// ⚠️ 这条此前一直没做：因为 `ctx.isDev` 在真实宿主里恒为 false（见 CanvasHost 的 props.dev 注释），
// 白名单 warn 从不触发，缺陷被掩盖。2026-09-19 接通 isDev 后当场暴露，此处补齐。
for (const name of Object.values(RenderEvents)) registerEventName(name)

export interface DragEventPayload {
  nodeId: string
  /**
   * 节点的 **flow 绝对坐标**（不是 VueFlow 的父相对坐标）。
   *
   * 分组子节点（有 parentNode）在 VueFlow 里存的 position 是**相对父**的，直接广播出去
   * 会让消费方把两套坐标系混着算（多选包围盒、对齐吸附都踩过）。这里统一归一成绝对坐标，
   * 消费方拿到的永远是"画布上的那个点"。
   */
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
  /**
   * 本次拖线从按下到松手的位移（屏幕 px）。
   * 供消费方区分"真拖线"与"在端口上点了一下"（阈值由消费方按自己的配置判定）。
   * 拿不到按下点时（异常路径）为 0。
   */
  dragDistance: number
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

/**
 * 把一段任意节点拖拽事件对象归一成 { nodeId, position }（容忍 VueFlow NodeDragEvent / 窄对象）。
 *
 * **position 一律是 flow 绝对坐标**：优先取 VueFlow 的 `computedPosition`（= 逐级累加父链的
 * 绝对位置，见 GraphNode 类型注释），拿不到才回落 `position`。
 *
 * 为什么必须这样：VueFlow 给分组子节点的 `position` 是**相对父节点**的（父在 (200,260)、
 * 子在父内 (60,90) 时它报 (60,90)），而事件消费方 —— 多选包围盒用 nodeLayout 的绝对矩形、
 * 对齐吸附也用绝对矩形 —— 全都按绝对坐标理解。混用会让几何当场算错：
 * 实测（选中同一组内两个子节点并拖动）多选框高度从 240 撑到 600、位置跳出屏幕。
 */
export function toDragPayload(e: {
  node?: {
    id?: string
    position?: { x: number; y: number }
    /** VueFlow 的绝对位置（有父节点时 = position + 父链 computedPosition） */
    computedPosition?: { x: number; y: number }
  }
}): DragEventPayload | null {
  if (!e.node?.id) return null
  const p = e.node.computedPosition ?? e.node.position
  return { nodeId: e.node.id, position: p ? { x: p.x, y: p.y } : { x: 0, y: 0 } }
}
