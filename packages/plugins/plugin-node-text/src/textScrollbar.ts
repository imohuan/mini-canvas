/**
 * textScrollbar —— 文本节点自绘细滚动条的几何（纯函数，零 Vue / 零 DOM，Node 可单测）。
 *
 * 为什么不用浏览器原生滚动条：原生条一直占着 8–12px，即使内容没超出也在视觉上切掉一条边，
 * 而且无法只在鼠标悬停时出现。用户要的是「默认干净，hover 才出现细条」。
 *
 * 本文件只算两块几何：滑块多高、拖动 1px 该滚多少。渲染与事件在 TextContent.vue。
 */

/** 滑块最小高度（px）：长文时仍要抓得住，不能缩成一条看不清的线 */
export const MIN_THUMB_HEIGHT = 24

/** 滚轮一格走的像素上限：画布缩放到 230% 时，原生 100px 会变成 230px，太快 */
export const WHEEL_STEP_CAP = 40

export interface ScrollbarThumbInput {
  /** 当前滚动位置（px，已夹在 0..maxScrollTop） */
  scrollTop: number
  /** 内容总高（px） */
  scrollHeight: number
  /** 可视区高（px） */
  clientHeight: number
  /** 滚动轨道高（px，通常 = clientHeight） */
  trackHeight: number
}

export interface ScrollbarThumb {
  /** 滑块高度（px） */
  thumbHeight: number
  /** 滑块离轨道顶部多远（px） */
  thumbTop: number
  /** 内容最多能滚多少（px） */
  maxScrollTop: number
}

/**
 * 算出当前滑块。内容没有溢出（或量不到尺寸）时返回 null —— 不画滚动条。
 *
 * 滑块高度 = 轨道 × 可视/内容；但滑块也参与排布，所以位置要按「滑块可走的距离」
 * 而不是轨道全高来换算，否则滚到底时滑块会伸出轨道。
 */
export function resolveScrollbarThumb(input: ScrollbarThumbInput): ScrollbarThumb | null {
  const { scrollHeight, clientHeight, trackHeight } = input
  if (!isPositive(scrollHeight) || !isPositive(clientHeight) || !isPositive(trackHeight)) return null
  if (scrollHeight <= clientHeight + 0.5) return null

  const thumbHeight = Math.min(trackHeight, Math.max(MIN_THUMB_HEIGHT, (trackHeight * clientHeight) / scrollHeight))
  const thumbTravel = Math.max(trackHeight - thumbHeight, 0)
  const maxScrollTop = Math.max(scrollHeight - clientHeight, 0)
  const ratio = maxScrollTop > 0 ? clamp(input.scrollTop, 0, maxScrollTop) / maxScrollTop : 0
  return { thumbHeight, thumbTop: thumbTravel * ratio, maxScrollTop }
}

export interface ThumbDragInput {
  /** 按下滑块那一刻的内容滚动位置 */
  startScrollTop: number
  /** 鼠标在屏幕上移动了多少（px；向下为正） */
  deltaY: number
  /** 滑块在轨道里能走的距离（px） */
  thumbTravel: number
  /** 内容能滚动的总距离（px） */
  maxScrollTop: number
}

/** 拖滑块 1px 对应的内容滚动量 = maxScrollTop / thumbTravel；两端夹住 */
export function scrollTopForThumbDrag(input: ThumbDragInput): number {
  const travel = input.thumbTravel
  if (!isPositive(travel)) return clamp(input.startScrollTop, 0, Math.max(input.maxScrollTop, 0))
  const next = input.startScrollTop + (input.deltaY * input.maxScrollTop) / travel
  return clamp(next, 0, Math.max(input.maxScrollTop, 0))
}

function isPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

/**
 * 把浏览器原生 wheel delta 换成实际滚动量。
 *
 * 原生 `scrollTop += deltaY` 会乘上祖先的 `transform: scale()`；节点在画布上被放大到 230% 时
 * 手指只滚了一格，文字像被甩出去。这里在**节点自身坐标**里固定上限，滚动量和视觉移动一致。
 */
export function scrollStepForWheel(deltaY: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 0
  return Math.sign(deltaY) * Math.min(Math.abs(deltaY), WHEEL_STEP_CAP)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
