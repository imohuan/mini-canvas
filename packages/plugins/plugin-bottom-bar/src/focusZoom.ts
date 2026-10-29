/**
 * 聚焦取景的缩放算法（与 plugin-auto-layout 的 calculateFocusZoom **同一条公式**）。
 *
 * 为什么复制一份而不是 import 对方：项目规矩是「插件各自独立，不跨包共享，也不动核心层」
 * （用户口径 2026-10-15）。底栏也不能把 auto-layout 变成硬依赖 —— 它没装时底栏仍要能用。
 *
 * 两边共享的是**行为契约**（带数值单测钉住），不是代码：
 *   节点高度占视口高度的 focusHeightRatio（默认 0.5），再夹进 [minZoom, maxZoom]。
 * 任何一边改了公式，对应的单测会先红。
 */

export interface FocusZoomInput {
  /** 目标区域高度（flow 坐标） */
  boundsHeight: number
  /** 画布可视高度（像素） */
  viewportHeight: number
  /** 目标占视口高度的比例（auto-layout 设置里的 focusHeightRatio） */
  heightRatio: number
  minZoom: number
  maxZoom: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** 让目标内容的高度占视图指定比例（节点高 200、视图高 800、占比 0.5 → zoom = 2） */
export function calculateFocusZoom(input: FocusZoomInput): number {
  const safeHeight = Math.max(input.boundsHeight, 1)
  const safeViewport = Math.max(input.viewportHeight, 1)
  const safeRatio = clamp(input.heightRatio, 0.05, 1)
  const raw = (safeViewport * safeRatio) / safeHeight
  return clamp(raw, input.minZoom, input.maxZoom)
}
