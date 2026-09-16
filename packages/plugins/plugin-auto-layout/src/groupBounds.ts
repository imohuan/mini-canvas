import type { GroupBounds } from './types'

const MIN_GROUP_W = 200
const MIN_GROUP_H = 150

/**
 * 分组四周留白（px）。与 plugin-group 的设置 key / 默认值保持一致
 * （各自本地实现，避免插件间运行时依赖；两边的 key 必须同步改）。
 */
export interface GroupPadding {
  left: number
  right: number
  top: number
  bottom: number
}

/** plugin-group Config 声明的分组留白设置 key（设置面板单一数据源） */
export const GROUP_PADDING_KEYS = {
  left: 'groupPaddingLeft',
  right: 'groupPaddingRight',
  top: 'groupPaddingTop',
  bottom: 'groupPaddingBottom',
} as const

/** 默认留白：四周 30，顶部额外 10 给标题条 → 40（与 plugin-group 默认一致） */
export const DEFAULT_GROUP_PADDING: GroupPadding = { left: 30, right: 30, top: 40, bottom: 30 }

/** 从 settings 读当前分组留白（逐项校验：非有限非负数回落默认；key 与 plugin-group 同步） */
export function resolveGroupPadding(get: (key: string) => unknown): GroupPadding {
  const pick = (key: string, fallback: number): number => {
    const v = get(key)
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback
  }
  return {
    left: pick(GROUP_PADDING_KEYS.left, DEFAULT_GROUP_PADDING.left),
    right: pick(GROUP_PADDING_KEYS.right, DEFAULT_GROUP_PADDING.right),
    top: pick(GROUP_PADDING_KEYS.top, DEFAULT_GROUP_PADDING.top),
    bottom: pick(GROUP_PADDING_KEYS.bottom, DEFAULT_GROUP_PADDING.bottom),
  }
}

export interface AbsoluteChildLike {
  id: string
  position: { x: number; y: number }
  size?: { w: number; h: number }
}

export function getNodeSize(node: AbsoluteChildLike): { width: number; height: number } {
  return {
    width: node.size?.w ?? 200,
    height: node.size?.h ?? 100,
  }
}

/** 布局后收拢组框：几何语义与 plugin-group 的 computeGroupBounds 一致（本地实现，避免插件间依赖） */
export function calculateGroupFrameFromAbsoluteChildren(
  children: AbsoluteChildLike[],
  padding?: Partial<GroupPadding>,
): GroupBounds | null {
  if (children.length === 0) return null

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const child of children) {
    const size = getNodeSize(child)
    minX = Math.min(minX, child.position.x)
    minY = Math.min(minY, child.position.y)
    maxX = Math.max(maxX, child.position.x + size.width)
    maxY = Math.max(maxY, child.position.y + size.height)
  }

  // 逐边解析：缺省/非法（负数/NaN/Infinity/非数值）回落该边默认（与 plugin-group 同语义）
  const pick = (edge: number | undefined, fallback: number): number =>
    typeof edge === 'number' && Number.isFinite(edge) && edge >= 0 ? edge : fallback
  const pad = {
    left: pick(padding?.left, DEFAULT_GROUP_PADDING.left),
    right: pick(padding?.right, DEFAULT_GROUP_PADDING.right),
    top: pick(padding?.top, DEFAULT_GROUP_PADDING.top),
    bottom: pick(padding?.bottom, DEFAULT_GROUP_PADDING.bottom),
  }

  return {
    x: minX - pad.left,
    y: minY - pad.top,
    w: Math.max(maxX - minX + pad.left + pad.right, MIN_GROUP_W),
    h: Math.max(maxY - minY + pad.top + pad.bottom, MIN_GROUP_H),
  }
}
