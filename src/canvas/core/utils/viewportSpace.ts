/**
 * 画布空间 ↔ 屏幕空间 坐标转换工具
 *
 * - 通用坐标转换：canvasToScreen / screenToCanvas
 * - 节点 DOM 空间（节点内部元素）：viewport zoom 已自动生效，只需 zoom 封顶
 */
import type { ViewportTransform } from '@vue-flow/core'

// ============================================================
//  通用坐标转换
// ============================================================

/** 画布坐标 → 屏幕坐标 */
export function canvasToScreen(
  canvasX: number,
  canvasY: number,
  viewport: ViewportTransform,
): [number, number] {
  return [
    canvasX * viewport.zoom + viewport.x,
    canvasY * viewport.zoom + viewport.y,
  ]
}

/** 屏幕坐标 → 画布坐标 */
export function screenToCanvas(
  screenX: number,
  screenY: number,
  viewport: ViewportTransform,
): [number, number] {
  return [
    (screenX - viewport.x) / viewport.zoom,
    (screenY - viewport.y) / viewport.zoom,
  ]
}

// ============================================================
//  节点 DOM 空间 — zoom 封顶
// ============================================================

/**
 * 反向缩放系数：zoom≤1 时不干预（1），zoom>1 时用 1/zoom 抵消放大
 */
export function inverseZoom(zoom: number): number {
  return 1 / Math.max(zoom, 1)
}

export interface CappedStyleOptions {
  /** 基础偏移（px），如在 node 顶部的 -20px */
  topOffset?: number
  /** 基础偏移（px），如在 node 左侧 */
  leftOffset?: number
  /** 是否应用 scale 变换封顶文字/元素大小，默认 true */
  scale?: boolean
}

/**
 * 为节点 DOM 内的元素生成封顶样式：zoom>1 时文本不放大、偏移不增加
 */
export function createCappedStyle(
  zoom: number,
  opts: CappedStyleOptions = {},
): Record<string, string> {
  const inv = inverseZoom(zoom)
  const style: Record<string, string> = {}

  if (opts.topOffset !== undefined) {
    style.top = `${opts.topOffset * inv}px`
  }
  if (opts.leftOffset !== undefined) {
    style.left = `${opts.leftOffset * inv}px`
  }

  if (opts.scale !== false) {
    style.transform = `scale(${inv})`
    style.transformOrigin = 'left top'
  }

  return style
}
