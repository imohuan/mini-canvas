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

/** 反向缩放系数：zoom≤1 时不干预（1），zoom>1 时用 1/zoom 抵消放大 */
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
  /**
   * 基础宽度（px，节点 DOM 空间）。
   * 启用 scale 时按 1/inv 放大布局宽度，抵消 scale 从左上角收缩，
   * 使缩放后视觉宽度保持不变（"宽度反缩放"）。
   */
  width?: number
}

/** 为节点 DOM 内的元素生成封顶样式：zoom>1 时文本不放大、偏移不增加、宽度反缩放 */
export function createCappedStyle(
  zoom: number,
  opts: CappedStyleOptions = {},
): Record<string, string> {
  const inv = inverseZoom(zoom)
  const style: Record<string, string> = {}
  const applyScale = opts.scale !== false

  if (opts.topOffset !== undefined) {
    style.top = `${opts.topOffset * inv}px`
  }
  if (opts.leftOffset !== undefined) {
    style.left = `${opts.leftOffset * inv}px`
  }
  if (opts.width !== undefined) {
    // 启用 scale 时用 1/inv 放大布局宽度，scale 后视觉宽度回到 opts.width
    style.width = applyScale ? `${opts.width / inv}px` : `${opts.width}px`
  }

  if (applyScale) {
    style.transform = `scale(${inv})`
    style.transformOrigin = 'left top'
  }

  return style
}
