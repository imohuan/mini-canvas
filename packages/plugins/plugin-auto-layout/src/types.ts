/**
 * 自动布局通用类型（v2 复刻：去掉老版 @vue-flow/core 依赖，尺寸用 size{w,h} / 平面矩形）。
 */
/** 布局方向 */
export type LayoutDirection = 'TB' | 'LR' | 'BT' | 'RL'

/** 间距配置 */
export interface Spacing {
  x: number
  y: number
}

/** 自动布局配置 */
export interface AutoLayoutConfig {
  /** 布局方向 */
  direction: LayoutDirection
  /** 簇内部节点间距 */
  intraSpacing: Spacing
  /** 簇之间间距 */
  interSpacing: Spacing
  /** F 聚焦时，选中内容高度占视图高度的比例 */
  focusHeightRatio: number
  /** F 聚焦最小缩放 */
  minZoom: number
  /** F 聚焦最大缩放 */
  maxZoom: number
  /** 自动布局诊断日志 */
  debug: boolean
}

export type AutoLayoutConfigPatch = Partial<Omit<AutoLayoutConfig, 'intraSpacing' | 'interSpacing'>> & {
  intraSpacing?: Partial<Spacing>
  interSpacing?: Partial<Spacing>
}

/** Group 的 bounds（供 recalculateBounds 返回） */
export interface GroupBounds {
  x: number
  y: number
  w: number
  h: number
}

/** 布局引擎吃的节点（v2 CanvasNode 子集：id/type/position/data/size + 可选父链） */
export interface LayoutNode {
  id: string
  type: string
  position: { x: number; y: number }
  data?: Record<string, unknown>
  size?: { w: number; h: number }
  parentId?: string
}

/** 布局引擎吃的边（id/source/target 子集） */
export interface LayoutEdge {
  id: string
  source: string
  target: string
}

/** 布局簇（内部使用） */
export interface LayoutCluster {
  id: string
  type: 'group' | 'connected' | 'single' | 'super'
  groupId?: string
  nodes: LayoutNode[]
  subClusters: LayoutCluster[] | null
  bounds: GroupBounds | null
}
