/**
 * fitTo —— 画布取景的唯一算法（纯函数，零 DOM / 零 Vue）。
 *
 * 九份聚焦实现共享的参数轴在这里收口：是否改缩放、是否只在该节点不可见时动、
 * 可用区域要不要扣掉界面条与四边留白。真正的 DOM 尺寸与视口读写由 ViewService 提供。
 *
 * 两个阶段的区别（这是「聚焦后节点被栏压住」的根因）：
 * - **可用区域**（visible）：整块画布扣掉顶部工具栏 / 底部底栏 / 四边留白，
 *   缩放按它算、内容也居中到它的中心；
 * - **可见判定**（onlyIfOutOfView）用**整块画布**，因为"看得见"的语义是用户真的能看到，
 *   而不是"没被栏压住"。
 */
import type {
  FocusInsets,
  FocusPadding,
  LayoutRect,
  ViewportState,
  FitToOptions,
} from '@mini-canvas/canvas-data'

/**
 * 参数类型只有一处定义（canvas-data 的契约）。
 *
 * 为什么不再在本文件写一份：之前这里有一份副本，加参数时容易只改一边 ——
 * 结果 viewService 传了新参数、类型上却不存在。现在统一从契约 re-export。
 */
export type { FitToOptions }

export interface FitToInput {
  rects: LayoutRect[]
  viewport: { w: number; h: number }
  viewportState?: ViewportState
  currentZoom?: number
  opts?: FitToOptions
  /** includeBars 用的界面条尺寸（屏幕像素）；由调用方量 DOM 后传入 */
  barHeight?: { top: number; bottom: number; left?: number; right?: number }
  /**
   * 节点自带**顶部标题条**的高度（屏幕像素）。
   *
   * 它在屏幕上大小恒定（自身反缩放），不能先换算成画布坐标塞进 rects ——
   * 那样包围盒会依赖"本次要算的缩放"，反复聚焦会一路漂移。
   * 正确用法：作为固定屏幕像素，从可用高度里先扣掉，再按扣完的高度算缩放。
   */
  nodeTopBarHeight?: number
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

/** 非负有限数，否则回落缺省 */
function px(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback
}

/** CSS padding 的 1~4 值展开：上 / 右 / 下 / 左（数量不足时按 CSS 规则补齐） */
function expandPadding(values: readonly number[]): FocusInsets {
  const t = values[0] ?? 0
  const r = values[1] ?? t
  const b = values[2] ?? t
  const l = values[3] ?? r
  return { top: t, right: r, bottom: b, left: l }
}

/**
 * 把 `padding` 解析成四边实际要扣的量（**屏幕像素**）。
 *
 * 单位规则（整组统一，避免同一组里一半比例一半像素）：
 * - 全部 ≤ 1 → 比例：占**整块视口**对应边的百分比（0.1 = 10%）
 * - 有任何一个 > 1 → 全部按屏幕像素（整数 48 就是 48px）
 *
 * 负数与非法值当 0；空数组、`undefined` 也返回 0。
 * 之所以把"≤1 用比例"定在这里：比例本来就是这个数量级，
 * 而像素值都远大于 1，一个参数就能同时表达两种写法。
 */
export function resolvePadding(
  padding: FocusPadding | undefined,
  viewport: { w: number; h: number },
): FocusInsets {
  if (padding === undefined) return { top: 0, right: 0, bottom: 0, left: 0 }
  const raw = (Array.isArray(padding) ? padding : [padding as number])
    .filter((v) => typeof v === 'number' && Number.isFinite(v))
    .map((v) => Math.max(v, 0))
  if (raw.length === 0) return { top: 0, right: 0, bottom: 0, left: 0 }
  const asRatio = raw.every((v) => v <= 1)
  // 比例按**较短边**换算：横竖用同一条基准，四边的视觉留白才均匀
  const base = Math.min(Math.max(viewport.w, 0), Math.max(viewport.h, 0))
  const values = raw.map((v) => (asRatio ? v * base : v))
  return expandPadding(values.length > 4 ? values.slice(0, 4) : values)
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
    // margin 是**屏幕像素**（见 renderServiceContracts）：flow 坐标要除以 zoom。
    // 旧 ensureNodeVisible 是 rect*zoom 后与像素 margin 比较，同一语义。
    const zoom = state.zoom || 1
    const margin = Math.max(opts.margin ?? 0, 0) / zoom
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

  // —— 可用区域：整块画布扣掉界面条（includeBars）与四边留白（padding）——
  // 这一步必须在算缩放之前：缩放要按"真正能看见的那块"算，否则内容算得刚好铺满却被栏压住。
  const bars = opts.includeBars ?? 'none'
  const wantTop = bars === 'top' || bars === 'both'
  const wantBottom = bars === 'bottom' || bars === 'both'
  const barTop = wantTop ? px(input.barHeight?.top) : 0
  const barBottom = wantBottom ? px(input.barHeight?.bottom) : 0
  // 节点自身的**顶部标题条**：屏幕上固定高度，先扣成"内容真正能占的屏幕高"，
  // 再由它除以内容高度得到缩放。这样包围盒（bounds）只与数据有关，不依赖当前缩放。
  // 节点底部控制栏不参与：它高度大且随内容变，算进来会把卡片压得过小。
  const nodeTop = px(input.nodeTopBarHeight)
  const inset = resolvePadding(opts.padding, { w: vw, h: vh })
  // 各边加总后按比例收缩，保证四块都留出位置（视口太小时平均分配，绝不出现负可用区）
  const maxH = Math.max(vh - 1, 0)
  const maxW = Math.max(vw - 1, 0)
  let topCut = barTop + inset.top
  let bottomCut = barBottom + inset.bottom
  // 标题条与 padding 不是同一件事：它夹在"可用区域"里侧，跟着内容一起缩放判定
  const chromeTop = nodeTop
  const chromeBottom = 0
  let leftCut = inset.left
  let rightCut = inset.right
  const vCut = topCut + bottomCut
  const hCut = leftCut + rightCut
  if (vCut > maxH && vCut > 0) {
    const k = maxH / vCut
    topCut *= k
    bottomCut *= k
  }
  if (hCut > maxW && hCut > 0) {
    const k = maxW / hCut
    leftCut *= k
    rightCut *= k
  }
  const availW = Math.max(vw - leftCut - rightCut, 1)
  const availH = Math.max(vh - topCut - bottomCut, 1)
  /** 可用区域中心（屏幕像素）——内容就是往这里对 */
  const centerX = leftCut + availW / 2
  const centerY = topCut + availH / 2

  // 缩放优先级：zoom 显式 > keepZoom > heightRatio > 默认（适配整块可用区域）
  let zoom = currentZoom
  if (typeof opts.zoom === 'number') {
    zoom = clamp(opts.zoom, opts.minZoom ?? DEFAULTS.minZoom, opts.maxZoom ?? DEFAULTS.maxZoom)
  } else if (opts.keepZoom) {
    zoom = currentZoom
  } else if (typeof opts.heightRatio === 'number') {
    const ratio = clamp(opts.heightRatio, 0.05, 1)
    // 先扣掉节点控制栏占的屏幕高度，再按剩余高度的一半反推缩放
    const usableH = Math.max(availH - chromeTop - chromeBottom, 1)
    zoom = clamp(
      (usableH * ratio) / Math.max(bounds.height, 1),
      opts.minZoom ?? DEFAULTS.minZoom,
      opts.maxZoom ?? DEFAULTS.maxZoom,
    )
  } else {
    // 只给了 padding（或什么都没给）：把内容适配进**已扣完留白**的可用区域。
    // 留白不再在这里二次相乘 —— 它已经在上面从视口里扣掉了，重复扣会把内容缩得过小。
    const usableW = Math.max(availW - 0, 1)
    const usableH = Math.max(availH - chromeTop - chromeBottom, 1)
    const fit = Math.min(usableW / Math.max(bounds.width, 1), usableH / Math.max(bounds.height, 1))
    zoom = clamp(fit, opts.minZoom ?? DEFAULTS.minZoom, opts.maxZoom ?? DEFAULTS.maxZoom)
  }

  const cx = bounds.x + bounds.width / 2
  const cy = bounds.y + bounds.height / 2
  // 内容中心 → 可用区域中心（不是整块画布中心）。
  // 卡片上方还要放标题条：把卡片中心整体下移半个标题条高度，
  // 「标题条 + 卡片」这条垂直带就落在可用区正中（也避免卡片底部压到上方留白）。
  const centerYAdj = centerY + chromeTop / 2
  const next = { x: centerX - cx * zoom, y: centerYAdj - cy * zoom, zoom }
  const moved =
    Math.abs(next.x - state.x) > 0.5 ||
    Math.abs(next.y - state.y) > 0.5 ||
    Math.abs(next.zoom - (state.zoom ?? 1)) > 1e-4
  return { moved, viewport: moved ? next : state, zoom }
}
