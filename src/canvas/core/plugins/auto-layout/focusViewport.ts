export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export interface FocusZoomInput {
  boundsHeight: number
  viewportHeight: number
  heightRatio: number
  minZoom: number
  maxZoom: number
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * 让选中内容的高度占视图指定比例。
 * 例：节点高 200，视图高 800，占比 0.5，则 zoom = (800 * 0.5) / 200 = 2。
 */
export function calculateFocusZoom(input: FocusZoomInput): number {
  const safeBoundsHeight = Math.max(input.boundsHeight, 1)
  const safeViewportHeight = Math.max(input.viewportHeight, 1)
  const safeRatio = clamp(input.heightRatio, 0.05, 1)
  const rawZoom = (safeViewportHeight * safeRatio) / safeBoundsHeight
  return clamp(rawZoom, input.minZoom, input.maxZoom)
}

export function centerViewportOnBounds(input: {
  bounds: Bounds
  viewportWidth: number
  viewportHeight: number
  zoom: number
}): { x: number; y: number; zoom: number } {
  const centerX = input.bounds.x + input.bounds.width / 2
  const centerY = input.bounds.y + input.bounds.height / 2

  return {
    x: input.viewportWidth / 2 - centerX * input.zoom,
    y: input.viewportHeight / 2 - centerY * input.zoom,
    zoom: input.zoom,
  }
}
