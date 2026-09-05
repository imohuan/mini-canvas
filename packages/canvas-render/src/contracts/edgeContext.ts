/**
 * edgeContext —— 自定义边( CustomEdge )的外观类型与默认值（消费方经 useCanvasRender().edgeVisual 取，
 * 不再经 edge 自建注入令牌）。
 *
 * CustomEdge 外观取自渲染宿主上下文（CanvasSurface 提供，见 renderContext.ts）。本文件只定义
 * 外观形状/默认值契约（对齐 contract §0），供宿主构造 edgeVisual 与 CustomEdge 读取。
 */
import type { InjectionKey, Ref } from 'vue'

/** CustomEdge 外观/行为配置（默认值对齐 core-node-contract §0 的 canvas.state.core.* 表） */
export interface EdgeVisual {
  /** 边路径类型，默认 bezier */
  edgeType?: 'bezier' | 'straight' | 'step' | 'smoothstep'
  /** 线宽 px，v1 edgeLineWidth=2 */
  edgeLineWidth?: number
  /** 线色，v1 edgeColor='#3b82f6' */
  edgeColor?: string
  /** 虚线，v1 edgeDashed=false */
  edgeDashed?: boolean
  /** 流光动画开关，v1 edgeAnimated=true */
  edgeAnimated?: boolean
  /** 箭头开关，v1 edgeMarkerEnd=false */
  edgeMarkerEnd?: boolean
  /** 箭头尺寸，v1 edgeMarkerSize=8 */
  edgeMarkerSize?: number
  /** 整体可见，v1 edgeVisible=true */
  edgeVisible?: boolean
  /** 辉光开关，v1 edgeGlowEnabled=true */
  edgeGlowEnabled?: boolean
  /** 辉光强度，v1 edgeGlowIntensity=1 */
  edgeGlowIntensity?: number
  /** 辉光色，v1 edgeGlowColor 缺省=线色 */
  edgeGlowColor?: string
}

export const EDGE_VISUAL_KEY: InjectionKey<Partial<EdgeVisual>> = Symbol('canvas-edge-visual')

export interface EdgeSelection {
  selectedNodeIds: Ref<ReadonlySet<string>>
  selectedEdgeIds: Ref<ReadonlySet<string>>
}

export const EDGE_SELECTION_KEY: InjectionKey<Partial<EdgeSelection>> = Symbol('canvas-edge-selection')
