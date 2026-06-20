export type PerformanceLevel = 'smooth' | 'unstable' | 'slow' | 'jank'

export interface PerformanceThresholds {
  smoothFps: number
  unstableFps: number
  slowFps: number
  jankFrameMs: number
}

export interface PerformanceSample {
  timestamp: number
  fps: number
  frameMs: number
}

export interface PerformanceStatus {
  level: PerformanceLevel
  label: string
  tone: 'green' | 'yellow' | 'orange' | 'red'
  message: string
}

export interface ViewportState {
  x: number
  y: number
  zoom: number
}

export interface Size {
  width: number
  height: number
}

export interface NodeLike {
  id: string
  position?: { x: number; y: number }
  computedPosition?: { x: number; y: number }
  dimensions?: { width?: number; height?: number }
  width?: unknown
  height?: unknown
}

export interface Bounds {
  left: number
  top: number
  right: number
  bottom: number
}

export interface VisibleNodeStats {
  totalNodes: number
  visibleNodes: number
}

export interface PerformanceSummary {
  averageFps: number
  lowestFps: number
  maxFrameMs: number
  jankCount: number
}

export const DEFAULT_PERFORMANCE_THRESHOLDS: PerformanceThresholds = {
  smoothFps: 55,
  unstableFps: 45,
  slowFps: 30,
  jankFrameMs: 100,
}

const DEFAULT_NODE_WIDTH = 180
const DEFAULT_NODE_HEIGHT = 120

export function getPerformanceStatus(input: {
  fps: number
  frameMs: number
  thresholds?: PerformanceThresholds
}): PerformanceStatus {
  const thresholds = input.thresholds ?? DEFAULT_PERFORMANCE_THRESHOLDS

  if (input.frameMs >= thresholds.jankFrameMs || input.fps < thresholds.slowFps) {
    return { level: 'jank', label: '明显卡顿', tone: 'red', message: `卡顿 ${Math.round(input.frameMs)}ms` }
  }

  if (input.fps < thresholds.unstableFps) {
    return { level: 'slow', label: '偏卡', tone: 'orange', message: `${Math.round(input.fps)} FPS · 偏卡` }
  }

  if (input.fps < thresholds.smoothFps) {
    return { level: 'unstable', label: '波动', tone: 'yellow', message: `${Math.round(input.fps)} FPS · 波动` }
  }

  return { level: 'smooth', label: '流畅', tone: 'green', message: `${Math.round(input.fps)} FPS · 流畅` }
}

export function limitSamples(samples: PerformanceSample[], limit: number): PerformanceSample[] {
  if (limit <= 0) return []
  if (samples.length <= limit) return samples
  return samples.slice(samples.length - limit)
}

export function summarizeSamples(
  samples: PerformanceSample[],
  thresholds: PerformanceThresholds = DEFAULT_PERFORMANCE_THRESHOLDS,
): PerformanceSummary {
  if (samples.length === 0) {
    return { averageFps: 0, lowestFps: 0, maxFrameMs: 0, jankCount: 0 }
  }

  let fpsTotal = 0
  let lowestFps = Number.POSITIVE_INFINITY
  let maxFrameMs = 0
  let jankCount = 0

  for (const sample of samples) {
    fpsTotal += sample.fps
    lowestFps = Math.min(lowestFps, sample.fps)
    maxFrameMs = Math.max(maxFrameMs, sample.frameMs)
    if (sample.frameMs >= thresholds.jankFrameMs || sample.fps < thresholds.slowFps) {
      jankCount++
    }
  }

  return {
    averageFps: Math.round(fpsTotal / samples.length),
    lowestFps: Math.round(lowestFps),
    maxFrameMs: Math.round(maxFrameMs),
    jankCount,
  }
}

export function getViewportBounds(input: {
  viewport: ViewportState
  containerSize: Size
  margin?: number
}): Bounds {
  const zoom = input.viewport.zoom || 1
  const margin = input.margin ?? 0
  const left = (-input.viewport.x / zoom) - margin
  const top = (-input.viewport.y / zoom) - margin
  const right = ((input.containerSize.width - input.viewport.x) / zoom) + margin
  const bottom = ((input.containerSize.height - input.viewport.y) / zoom) + margin
  return { left, top, right, bottom }
}

export function getVisibleNodeStats(input: {
  nodes: NodeLike[]
  viewport: ViewportState
  containerSize: Size
  margin?: number
}): VisibleNodeStats {
  const bounds = getViewportBounds(input)
  let visibleNodes = 0

  for (const node of input.nodes) {
    const position = node.computedPosition ?? node.position ?? { x: 0, y: 0 }
    const rawWidth = node.dimensions?.width ?? node.width
    const rawHeight = node.dimensions?.height ?? node.height
    const width = typeof rawWidth === 'number' && Number.isFinite(rawWidth) ? rawWidth : DEFAULT_NODE_WIDTH
    const height = typeof rawHeight === 'number' && Number.isFinite(rawHeight) ? rawHeight : DEFAULT_NODE_HEIGHT
    const nodeBounds = {
      left: position.x,
      top: position.y,
      right: position.x + width,
      bottom: position.y + height,
    }

    const intersects = nodeBounds.right >= bounds.left
      && nodeBounds.left <= bounds.right
      && nodeBounds.bottom >= bounds.top
      && nodeBounds.top <= bounds.bottom

    if (intersects) visibleNodes++
  }

  return { totalNodes: input.nodes.length, visibleNodes }
}

export function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '不支持'
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${Math.round(bytes / 1024 / 1024)} MB`
}

