import type { Node } from '@vue-flow/core'

/**
 * 布局方向
 */
export type LayoutDirection = 'TB' | 'LR' | 'BT' | 'RL'

/**
 * 间距配置
 */
export interface Spacing {
  x: number
  y: number
}

/**
 * 自动布局配置
 */
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

/**
 * Group 的 bounds（供 recalculateBounds 返回）
 */
export interface GroupBounds {
  x: number
  y: number
  w: number
  h: number
}

/**
 * 布局簇（内部使用）
 */
export interface LayoutCluster {
  id: string
  type: 'group' | 'connected' | 'single' | 'super'
  groupId?: string
  nodes: Node[]
  subClusters: LayoutCluster[] | null
  bounds: GroupBounds | null
}

/**
 * 原始图数据（简化版，供布局引擎使用）
 */
export interface SimpleNode {
  id: string
  label?: string
  x: number
  y: number
  w: number
  h: number
  groupId: string | null
  type: 'group-child' | 'connected' | 'isolated'
}

export interface SimpleEdge {
  id: string
  source: string
  target: string
  type: 'connected' | 'cross'
}

export interface SimpleGroup {
  id: string
  label: string
  nodes: string[]
}

/**
 * AutoLayoutPlugin 对外 API
 */
export interface AutoLayoutAPI {
  /** 执行自动布局 */
  run(config?: AutoLayoutConfigPatch): void
  /** 获取当前配置 */
  getConfig(): AutoLayoutConfig
  /** 更新配置 */
  setConfig(config: AutoLayoutConfigPatch): void
  /** 聚焦选中节点 */
  focusSelected(): void
  /** 聚焦指定节点 */
  focusNode(nodeId: string): void
}

/**
 * GroupPlugin 新增 API
 */
export interface GroupLayoutAPI {
  /** 根据组内子节点重新计算并更新 GroupNode 的 bounds */
  recalculateBounds(groupId: string): GroupBounds | null
}
