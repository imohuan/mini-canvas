/**
 * visibleArea —— 可视区域纯几何（零 Vue / 零 DOM，Node 可单测）。
 *
 * 把"视口变换 + pane 像素尺寸"换算成 **flow（画布）坐标下的可视矩形**，并提供
 * 矩形相交判定 —— 供 align-guide(参考线候选剪枝) / mini-map / 其它渲染插件按可视区
 * 裁剪节点，避免大画布(数千节点)逐帧对全量节点做 O(n)~O(n²) 比对。
 *
 * 坐标约定与 VueFlow 一致：pane 左上角在 flow 坐标下 = (-viewport.x/zoom, -viewport.y/zoom)，
 * 可视尺寸 = pane 像素宽高 ÷ zoom（viewport.x/y 是 VueFlow 的 translate，单位随 zoom 缩放）。
 * 参考 plugin-mini-map/miniMapEngine.viewportRectInFlow 的同款换算（此处上移为 core 公共能力，
 * 避免插件间互相依赖）。
 */
import type { ViewportState } from '../viewport/viewportService'

/** flow 坐标矩形（x/y 左上角，w/h 尺寸） */
export interface FlowRect {
  x: number
  y: number
  w: number
  h: number
}

/** 规范化：消掉 -0（-0 参与比较没问题，但 toEqual/快照会把 -0 当不同值） */
function norm(v: number): number {
  return v === 0 ? 0 : v
}

/** 视口变换 + pane 像素尺寸 → 可视区在 flow 坐标下的矩形 */
export function viewportRectInFlow(viewport: ViewportState, paneW: number, paneH: number): FlowRect {
  const z = viewport.zoom || 1
  return {
    x: norm(-viewport.x / z),
    y: norm(-viewport.y / z),
    w: paneW / z,
    h: paneH / z,
  }
}

/** 两矩形是否相交（任一零尺寸/退化矩形恒不相交；含恰好压边算相交，用严格小于判断） */
export function rectsOverlap(a: FlowRect, b: FlowRect): boolean {
  if (a.w <= 0 || a.h <= 0 || b.w <= 0 || b.h <= 0) return false
  const aR = a.x + a.w
  const aB = a.y + a.h
  const bR = b.x + b.w
  const bB = b.y + b.h
  return a.x < bR && aR > b.x && a.y < bB && aB > b.y
}

/** 矩形向外扩 margin(flow 单位)；返回新矩形，原矩形不改 */
export function expandRect(r: FlowRect, margin: number): FlowRect {
  return { x: r.x - margin, y: r.y - margin, w: r.w + margin * 2, h: r.h + margin * 2 }
}
