/**
 * miniMapEngine —— 小地图纯逻辑（零 Vue / 零 DOM，可单测）。
 *
 * 坐标一律 flow（画布）坐标。从老版 MiniMap.vue 提炼，保持相同语义：
 * - 内容包围盒 = 全部存活节点矩形并集（无节点 → null，退化为视口矩形）。
 * - 地图范围 = 内容包围盒 ∪ 当前可见视口矩形（保证视口框始终落在小地图内）。
 * - mapState = 把地图范围归一化到 (width-pad*2 × height-pad*2) 的 scale + 居中 offset。
 * - 拖拽平移：小地图上屏幕位移 px ÷ scale = flow 位移，再 × zoom 换算成视口应移动量，
 *   新视口 = 起始视口 − 位移（拖地图向右 → 内容向右 → 视口向左，与老版一致）。
 */
import type { ViewportState } from '@mini-canvas/canvas-render'

/** flow 坐标矩形 */
export interface MiniMapRect {
  x: number
  y: number
  w: number
  h: number
}

export type MiniMapViewport = ViewportState

/** 归一化结果：scale + 地图范围原点 + 已加 padding 的绘制偏移 */
export interface MiniMapMapState {
  scale: number
  minX: number
  minY: number
  offsetX: number
  offsetY: number
}

const EPS = 1e-6

/** 规范化：消掉 -0（-0/0 参与数值比较没问题，但 toEqual/快照会把 -0 当不同值） */
function norm(v: number): number {
  return v === 0 ? 0 : v
}

/** 全部矩形并集；空数组 → null */
export function computeContentBounds(rects: MiniMapRect[]): MiniMapRect | null {
  if (rects.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of rects) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.w)
    maxY = Math.max(maxY, r.y + r.h)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/** 两个矩形并集（任一为 null 返回另一个） */
export function unionRect(a: MiniMapRect | null, b: MiniMapRect | null): MiniMapRect | null {
  if (!a) return b ? { ...b } : null
  if (!b) return { ...a }
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const maxX = Math.max(a.x + a.w, b.x + b.w)
  const maxY = Math.max(a.y + a.h, b.y + b.h)
  return { x, y, w: maxX - x, h: maxY - y }
}

/** 当前视口在 flow 坐标的可见矩形（VueFlow 惯例：pane 左上角 flow 坐标 = -viewport.x/zoom, -viewport.y/zoom） */
export function viewportRectInFlow(viewport: MiniMapViewport, paneW: number, paneH: number): MiniMapRect {
  const z = viewport.zoom || 1
  return {
    x: norm(-viewport.x / z),
    y: norm(-viewport.y / z),
    w: paneW / z,
    h: paneH / z,
  }
}

/** 把地图范围归一化到小地图内容区（宽高扣除 padding 后居中），scale 取两轴较小值 */
export function computeMapState(
  bounds: MiniMapRect,
  width: number,
  height: number,
  padding: number,
): MiniMapMapState {
  const availW = Math.max(1, width - padding * 2)
  const availH = Math.max(1, height - padding * 2)
  const bW = Math.max(EPS, bounds.w)
  const bH = Math.max(EPS, bounds.h)
  const scale = Math.min(availW / bW, availH / bH)
  const offsetX = padding + (availW - bW * scale) / 2
  const offsetY = padding + (availH - bH * scale) / 2
  return { scale, minX: bounds.x, minY: bounds.y, offsetX, offsetY }
}

/** flow 矩形 → 小地图内 CSS px 矩形（尺寸至少 1px 保证可见） */
export function rectToMap(rect: MiniMapRect, ms: MiniMapMapState): { left: number; top: number; width: number; height: number } {
  return {
    left: ms.offsetX + (rect.x - ms.minX) * ms.scale,
    top: ms.offsetY + (rect.y - ms.minY) * ms.scale,
    width: Math.max(1, rect.w * ms.scale),
    height: Math.max(1, rect.h * ms.scale),
  }
}

/** 拖拽平移：起始视口 + 小地图内屏幕位移 → 新视口（px 位移 ÷ scale → flow 位移；× zoom → 视口移动量） */
export function panViewport(
  startViewport: MiniMapViewport,
  startClient: { x: number; y: number },
  nowClient: { x: number; y: number },
  mapScale: number,
  sensitivityX = 1,
  sensitivityY = 1,
): { x: number; y: number } {
  const dx = (nowClient.x - startClient.x) * sensitivityX
  const dy = (nowClient.y - startClient.y) * sensitivityY
  const zoom = startViewport.zoom || 1
  const s = mapScale || 1
  return {
    x: startViewport.x - (dx / s) * zoom,
    y: startViewport.y - (dy / s) * zoom,
  }
}

/** 小地图内 CSS px → 对应 flow 坐标（点击空白跳转用） */
export function mapPointToFlow(
  px: number,
  py: number,
  ms: MiniMapMapState,
): { x: number; y: number } {
  const s = ms.scale || 1
  return {
    x: ms.minX + (px - ms.offsetX) / s,
    y: ms.minY + (py - ms.offsetY) / s,
  }
}
