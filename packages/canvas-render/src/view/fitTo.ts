/**
 * fitTo —— 画布取景的唯一算法（纯函数，零 DOM / 零 Vue）。
 *
 * 九份聚焦实现共享的参数轴在这里收口：是否改缩放、是否只在该节点不可见时动、
 * 是否把底栏高度算进可用高度。真正的 DOM 尺寸与视口读写由 ViewService 提供。
 */
import type { LayoutRect, ViewportState } from '@mini-canvas/canvas-data'

export interface FitToOptions {
  /** 留白比例（0..0.49，与 VueFlow fitView 同义）；不写 heightRatio 时用它适配整块内容 */
  padding?: number
  /** 目标内容高度占视口高度的比例（auto-layout / 底栏用 0.5）；写了它就不看 padding */
  heightRatio?: number
  /** 缩放上限/下限，缺省 0.1 / 4 */
  minZoom?: number
  maxZoom?: number
  /** true = 保持当前 zoom，只平移 */
  keepZoom?: boolean
  /** 指定固定 zoom（会先按 minZoom/maxZoom 夹取） */
  zoom?: number
  /** 是否顺手选中目标（只由 canvas.focus 消费；fitTo 自己不改选中） */
  select?: boolean
  /** 只在该内容不可见时移动 */
  onlyIfOutOfView?: boolean
  /** 不可见判定的额外边距（屏幕像素） */
  margin?: number
  /** 把上/下状态栏高度算进包围盒：'none' | 'bottom' | 'both'；缺省 'none' */
  includeBars?: 'none' | 'bottom' | 'both'
  /** 是否播放过渡；缺省 true */
  animate?: boolean
  /** 动画时长；缺省 320 */
  durationMs?: number
}

export interface FitToInput {
  rects: LayoutRect[]
  viewport: { w: number; h: number }
  viewportState?: ViewportState
  currentZoom?: number
  opts?: FitToOptions
  /** includeBars 用的额外高度（屏幕像素）；由调用方量 DOM 后传入 */
  barHeight?: { top: number; bottom: number }
}

export interface FitToResult {
  moved: boolean
  viewport: ViewportState
  zoom: number
}

const DEFAULTS = { minZoom: 0.1, maxZoom: 4, durationMs: 320 }

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}

export function computeFitTo(input: FitToInput): FitToResult {
  const opts = input.opts ?? {}
  const state = input.viewportState ?? { x: 0, y: 0, zoom: input.currentZoom ?? 1 }
  const currentZoom = input.currentZoom ?? state.zoom ?? 1
  const vw = Math.max(input.viewport.w, 1)
  const vh = Math.max(input.viewport.h, 1)
  if (input.rects.length === 0) {
    return { moved: false, viewport: state, zoom: currentZoom }
  }

  const minX = Math.min(...input.rects.map((r) => r.x))
  const minY = Math.min(...input.rects.map((r) => r.y))
  const maxX = Math.max(...input.rects.map((r) => r.x + r.w))
  const maxY = Math.max(...input.rects.map((r) => r.y + r.h))
  const bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY }

  // 已完整可见 → 不动（ensureVisible / BaseNode 语义）
  if (opts.onlyIfOutOfView) {
    const margin = Math.max(opts.margin ?? 0, 0)
    const zoom = state.zoom || 1
    const left = -state.x / zoom
    const top = -state.y / zoom
    const right = left + vw / zoom
    const bottom = top + vh / zoom
    const visible =
      bounds.x >= left + margin &&
      bounds.y >= top + margin &&
      bounds.x + bounds.width <= right - margin &&
      bounds.y + bounds.height <= bottom - margin
    if (visible) return { moved: false, viewport: state, zoom: currentZoom }
  }

  // 缩放优先级：zoom 显式 > keepZoom > heightRatio > padding 比例适配
  let zoom = currentZoom
  if (typeof opts.zoom === 'number') {
    zoom = clamp(opts.zoom, opts.minZoom ?? DEFAULTS.minZoom, opts.maxZoom ?? DEFAULTS.maxZoom)
  } else if (opts.keepZoom) {
    zoom = currentZoom
  } else if (typeof opts.heightRatio === 'number') {
    const ratio = clamp(opts.heightRatio, 0.05, 1)
    const barH =
      opts.includeBars === 'both'
        ? (input.barHeight?.top ?? 0) + (input.barHeight?.bottom ?? 0)
        : opts.includeBars === 'bottom'
          ? (input.barHeight?.bottom ?? 0)
          : 0
    const usableH = Math.max(vh - barH, 1)
    zoom = clamp(
      (usableH * ratio) / Math.max(bounds.height, 1),
      opts.minZoom ?? DEFAULTS.minZoom,
      opts.maxZoom ?? DEFAULTS.maxZoom,
    )
  } else {
    // padding 与 VueFlow 同义：0..1 的比例留白（0.1 = 每边 10%）
    const pad = clamp(opts.padding ?? 0.1, 0, 0.49)
    const availW = Math.max(vw * (1 - pad * 2), 1)
    const availH = Math.max(vh * (1 - pad * 2), 1)
    const fit = Math.min(availW / Math.max(bounds.width, 1), availH / Math.max(bounds.height, 1))
    zoom = clamp(fit, opts.minZoom ?? DEFAULTS.minZoom, opts.maxZoom ?? DEFAULTS.maxZoom)
  }

  const cx = bounds.x + bounds.width / 2
  const cy = bounds.y + bounds.height / 2
  const next = { x: vw / 2 - cx * zoom, y: vh / 2 - cy * zoom, zoom }
  const moved =
    Math.abs(next.x - state.x) > 0.5 ||
    Math.abs(next.y - state.y) > 0.5 ||
    Math.abs(next.zoom - (state.zoom ?? 1)) > 1e-4
  return { moved, viewport: moved ? next : state, zoom }
}
