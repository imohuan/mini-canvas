/**
 * imageFitBridge —— 读图片节点尺寸限制（最短边/最长边）的最小桥。
 *
 * 为什么不直接 import plugin-node-image：那是另一个插件包，运行期按服务名取（image 服务
 * 可能未装）；限制本身存在 settings（键 imageCardMinShortSide / imageCardMaxLongSide），
 * 直接读设置即可，不必依赖图片插件在场。默认值与 mediaFit 的 DEFAULT_IMAGE_CARD_LIMITS 一致。
 */
export interface ImageFitLimitsLike {
  minShortSide: number
  maxLongSide: number
}

/**
 * 图片尺寸 → 卡片尺寸（与图片节点同一条规则）：
 * 等比缩放，最长边不超过 maxLongSide、最短边不小于 minShortSide，冲突时短边优先。
 * 转发 canvas-base 的 fitMediaCard，避免跨插件包依赖；默认限制与 mediaFit 相同。
 */
import { fitMediaCard } from '@mini-canvas/canvas-base'

export function fitCardSize(
  imageWidth: unknown,
  imageHeight: unknown,
  limits?: Partial<ImageFitLimitsLike> | null,
): { width: number; height: number } | null {
  return fitMediaCard(imageWidth, imageHeight, limits)
}

/** 默认值（与 canvas-base mediaFit.DEFAULT_IMAGE_CARD_LIMITS 相同，本地常量避免跨包依赖） */
export const DEFAULT_IMAGE_LIMITS: ImageFitLimitsLike = Object.freeze({ minShortSide: 120, maxLongSide: 420 })

/** 从宿主服务表读限制；没有 settings 服务时回落默认 */
export function fitImageLimits(ctx: { tryGet?<T = unknown>(name: string): T } | undefined): ImageFitLimitsLike {
  const settings = typeof ctx?.tryGet === 'function' ? ctx.tryGet<{ get(key: string): unknown } | undefined>('settings') : undefined
  const num = (key: string, fallback: number): number => {
    const v = settings?.get(key)
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback
  }
  return {
    minShortSide: num('imageCardMinShortSide', DEFAULT_IMAGE_LIMITS.minShortSide),
    maxLongSide: num('imageCardMaxLongSide', DEFAULT_IMAGE_LIMITS.maxLongSide),
  }
}
