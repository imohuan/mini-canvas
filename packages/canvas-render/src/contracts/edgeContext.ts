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
  // ===== 连线新视觉（参考 canvas-core-v2/demo-html-ui/bezier_glow_flow_line：导轨 + 光斑流动）=====
  /** 常驻“导轨 + 光斑流动”视觉总开关（默认 true；false = 回退素淡线/虚线） */
  edgeFlowEnabled?: boolean
  /** 光斑块长度（路径归一 1000 刻度，默认 90 ≈ 9% 路径长） */
  edgeFlowBlockSize?: number
  /** 光斑块之间的间隔（路径归一 1000 刻度，默认 260 ≈ 26% 路径长） */
  edgeFlowGap?: number
  /** 流动速度（px/帧 @60fps，与参考 demo 的 speed 同量纲；默认 2.5） */
  edgeFlowSpeed?: number
  /** 光斑两端柔光延伸量（占块长 %，模拟头尾渐隐；默认 35） */
  edgeFlowFade?: number
  /** 光斑峰值不透明度（默认 0.9） */
  edgeFlowIntensity?: number
}

export const EDGE_VISUAL_KEY: InjectionKey<Partial<EdgeVisual>> = Symbol('canvas-edge-visual')

export interface EdgeSelection {
  selectedNodeIds: Ref<ReadonlySet<string>>
  selectedEdgeIds: Ref<ReadonlySet<string>>
}

export const EDGE_SELECTION_KEY: InjectionKey<Partial<EdgeSelection>> = Symbol('canvas-edge-selection')
