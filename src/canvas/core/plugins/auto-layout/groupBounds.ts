import type { GroupBounds } from './types'

const GROUP_PADDING_X = 30
const GROUP_PADDING_Y = 30
const GROUP_PADDING_TOP = 10
const MIN_GROUP_W = 200
const MIN_GROUP_H = 150

export interface AbsoluteChildLike {
  id: string
  position: { x: number; y: number }
  dimensions?: { width?: number; height?: number }
  style?: any
}

export function getNodeSize(node: AbsoluteChildLike): { width: number; height: number } {
  return {
    width: node.dimensions?.width ?? (node.style?.width ? parseFloat(String(node.style.width)) : 200),
    height: node.dimensions?.height ?? (node.style?.height ? parseFloat(String(node.style.height)) : 100),
  }
}

export function calculateGroupFrameFromAbsoluteChildren(children: AbsoluteChildLike[]): GroupBounds | null {
  if (children.length === 0) return null

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const child of children) {
    const size = getNodeSize(child)
    minX = Math.min(minX, child.position.x)
    minY = Math.min(minY, child.position.y)
    maxX = Math.max(maxX, child.position.x + size.width)
    maxY = Math.max(maxY, child.position.y + size.height)
  }

  return {
    x: minX - GROUP_PADDING_X,
    y: minY - GROUP_PADDING_Y - GROUP_PADDING_TOP,
    w: Math.max(maxX - minX + GROUP_PADDING_X * 2, MIN_GROUP_W),
    h: Math.max(maxY - minY + GROUP_PADDING_Y * 2 + GROUP_PADDING_TOP, MIN_GROUP_H),
  }
}
