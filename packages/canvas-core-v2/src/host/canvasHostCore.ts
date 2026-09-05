/**
 * canvasHostCore —— 渲染宿主组件(CanvasHost.vue)的纯逻辑部分，可脱离 DOM / Vue 单测。
 *
 * 职责：把 CanvasDemo.vue 里"store→flow 映射、主题装配、默认外观参数"这几段无副作用逻辑收拢在此，
 * CanvasHost.vue 只做接线(建 host/provide/订阅/事件)。这样核心映射逻辑有单测保护，宿主组件保持薄。
 *
 * 边界：不 import @vue-flow/core，不 import Vue 运行时；类型用最小结构接口避免拉运行时。
 */

import type { NodeStoreService, CanvasNode } from '../services/nodeStore'
import type { ThemeRegistry } from '../core/registry/themeRegistry'

// ============================================================================
// store → VueFlow 渲染态
// ============================================================================

/** VueFlow 消费的节点最小形状（宿主由此驱动渲染；与 nodeStore 节点同构 + 浅拷贝 data） */
export interface FlowNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
}

/** 把内核 nodeStore 当前节点灌成 VueFlow 节点数组（data 浅拷贝，避免共享引用被 Vue 改写污染内核） */
export function nodesFromStore(store: NodeStoreService): FlowNode[] {
  return store.getNodes().map((n: CanvasNode) => ({
    id: n.id,
    type: n.type,
    position: { x: n.position.x, y: n.position.y },
    data: { ...(n.data as Record<string, unknown>) },
  }))
}

/** 现有边保留(宿主内维护)；当节点被删时清掉悬挂边 */
export function pruneDanglingEdges<T extends { source: string; target: string }>(
  edges: T[],
  aliveNodeIds: Set<string>,
): T[] {
  return edges.filter((e) => aliveNodeIds.has(e.source) && aliveNodeIds.has(e.target))
}

// ============================================================================
// themeRegistry 装配
// ============================================================================

/** 主题装配结果：宿主拿去填 VueFlow 的 node-types/edge-types + 背景 + 建边默认 type */
export interface ThemeAssembly {
  /** 节点壳组件（nodeShell 槽位；缺省 undefined = 无壳/裸内容） */
  nodeShell: unknown
  /** 边渲染组件（edge 槽位，放 edgeTypes.custom） */
  edge: unknown
  /** 画布背景组件（background 槽位；缺省 undefined） */
  background: unknown
  /** 所有边默认 type 键（edgeDefaultType 槽位；缺省 'custom'） */
  edgeDefaultType: string
  /** 展示注册表里已注册的业务 type 列表（用于铺 nodeTypes 键） */
  nodeTypes: string[]
}

/**
 * 从 themeRegistry 读整幅画布渲染所需的外观装配。
 * 节点 type 键来自 nodeStore 已注册类型(经 store 传入)而非 themeRegistry（节点是业务侧注册的）。
 */
export function assembleTheme(
  theme: ThemeRegistry | undefined,
  storeTypes: Iterable<string>,
): ThemeAssembly {
  const shell = theme?.get('nodeShell')
  const edge = theme?.get('edge')
  const background = theme?.get('background')
  const edgeDefaultType =
    (theme?.get('edgeDefaultType') as string | undefined) ?? 'custom'
  return {
    nodeShell: shell,
    edge,
    background,
    edgeDefaultType,
    nodeTypes: [...storeTypes],
  }
}

// ============================================================================
// 默认外观参数（host 未显式传参时的回落；对齐 core-node-contract §0）
// ============================================================================

/** 自定义边外观默认值（对齐 CanvasDemo cfg.edge / CustomEdge 回落） */
export interface EdgeVisualDefaults {
  edgeType?: 'bezier' | 'straight' | 'step' | 'smoothstep'
  edgeLineWidth?: number
  edgeColor?: string
  edgeDashed?: boolean
  edgeAnimated?: boolean
  edgeMarkerEnd?: boolean
  edgeGlowEnabled?: boolean
  edgeGlowIntensity?: number
}

export const DEFAULT_EDGE_VISUAL: EdgeVisualDefaults = {
  edgeType: 'bezier',
  edgeLineWidth: 2,
  edgeColor: '#3b82f6',
  edgeDashed: false,
  edgeAnimated: true,
  edgeMarkerEnd: false,
  edgeGlowEnabled: true,
  edgeGlowIntensity: 1,
}

/** 浮动端口外观默认值（对齐 BaseNode DEFAULT_HANDLE / contract §0） */
export interface HandleVisualDefaults {
  handleRadius: number
  handleRestOffset: number
  handleCursorGap: number
  handleButtonSize: number
  handleOverlap: number
}

export const DEFAULT_HANDLE_VISUAL: HandleVisualDefaults = {
  handleRadius: 86,
  handleRestOffset: 36,
  handleCursorGap: 24,
  handleButtonSize: 32,
  handleOverlap: 16,
}

/** 给一条源→目标连接生成稳定边 id */
export function edgeId(source: string, target: string): string {
  return `e-${source}-${target}`
}
