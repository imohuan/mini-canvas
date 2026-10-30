/**
 * imageFit —— "图片尺寸 → 节点卡片尺寸"的适配规则（纯函数，零 DOM / 零 Vue，Node 可单测）。
 *
 * 用户要求（原话）："上传图片或者选择图片之后，图片节点的宽高应该和图片的宽高保持一致"。
 * 完全照抄原图像素并不现实（一张 4000×3000 的图会把画布撑爆），所以用「最短边 / 最长边」：
 * - 最长边不超过 imageCardMaxLongSide；
 * - 最短边不小于 imageCardMinShortSide；
 * - 两者冲突（20:1 细长图）时最短边优先，最长边允许超上限。
 *
 * 算法本身在 `@mini-canvas/canvas-base` 的 mediaFit（视频、拖入、翻转共用同一份），
 * 这里只保留图片自己的配置键与写回补丁。注意内核 settings 是**全局同一张表、先声明者独占**，
 * 所以键名必须带本包前缀（imageCard…），不能取 "minShortSide" 这种通用名。
 *
 * 图像尺寸拿不到（0 / NaN / 负数 / 缺失）时一律返回 null —— 调用方保持原尺寸不动，绝不猜一个数字
 * （猜错比不写更糟：会让卡片莫名其妙变成别的形状）。
 *
 * 为什么要单独一层：这条规则被四处写回（上传 / 裁剪 / 旋转 / 生成出图）与一处兜底监听共用，
 * 抄五遍必然漂移；纯函数形态也让"边界到底怎么算"能在 node 里直接断言，不必起浏览器。
 */

import {
  DEFAULT_IMAGE_CARD_LIMITS,
  IMAGE_CARD_LIMIT_KEYS,
  fitMediaCard,
  readMediaCardLimits,
  resolveMediaCardLimits,
  type MediaCardLimits,
} from '@mini-canvas/canvas-base'

/** 图片尺寸限制（最短边 / 最长边） */
export type ImageFitLimits = MediaCardLimits

/** 卡片宽度的硬下限（只在兜底路径用；正常规则由「最短边最小」决定） */
export const MIN_CARD_WIDTH = 120

/** 读不到配置时的回落值（最短边 120、最长边 420） */
export const DEFAULT_IMAGE_FIT_LIMITS: ImageFitLimits = DEFAULT_IMAGE_CARD_LIMITS

/**
 * 尺寸写回补丁：**只给正式字段 size**（唯一正身）。
 *
 * 以前这里手拼 cardWidth/cardHeight/size 三件套，现在镜像（data.cardWidth/cardHeight）由
 * nodeStore 从 size 自动生成 —— 写尺寸的插件只报 size 一处，漏写镜像的可能从根上消掉。
 */
export interface CardSizePatch {
  size: { w: number; h: number }
}

/** 只认正有限数；其余（undefined / NaN / 0 / 负数 / 字符串）一律视为"拿不到" */
function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/**
 * 从"配置读取器"解析图片尺寸限制（纯函数，Node 可单测）。
 */
export function resolveImageFitLimits(get: (key: string) => unknown): ImageFitLimits {
  return resolveMediaCardLimits(get, IMAGE_CARD_LIMIT_KEYS, DEFAULT_IMAGE_FIT_LIMITS)
}

/**
 * 从宿主服务表读上限（ctx.get('settings')）。
 * 没有 settings 服务（极简宿主 / 单测桩）时整体回落默认，不抛错。
 */
export function readImageFitLimits(ctx: { get<T = unknown>(name: string): T } | undefined): ImageFitLimits {
  return readMediaCardLimits(ctx, IMAGE_CARD_LIMIT_KEYS, DEFAULT_IMAGE_FIT_LIMITS)
}

/**
 * 核心规则：图片尺寸 → 卡片尺寸（最短边不小于下限、最长边不超过上限）。
 * @returns 尺寸；图片尺寸或限制全都不合法时返回 null（调用方保持原尺寸不动）
 */
export function fitCardSize(
  imageWidth: unknown,
  imageHeight: unknown,
  limits?: Partial<ImageFitLimits> | null,
): { width: number; height: number } | null {
  return fitMediaCard(imageWidth, imageHeight, limits)
}

/**
 * 尺寸写回补丁（四处写回共用）：一次带上 cardWidth / cardHeight / size。
 * 尺寸拿不到返回 null —— 调用方原样保留旧尺寸，不猜。
 */
export function cardSizePatch(
  imageWidth: unknown,
  imageHeight: unknown,
  limits?: Partial<ImageFitLimits> | null,
): CardSizePatch | null {
  const fit = fitCardSize(imageWidth, imageHeight, limits)
  if (!fit) return null
  return { size: { w: fit.width, h: fit.height } }
}

/**
 * 兜底补算（一）：**挂载时**用。
 *
 * 只管"卡片尺寸缺失"的节点（旧数据、后台/MCP 建的节点、加素材新建的节点），
 * 尺寸已经在的（含用户手动拖过的）返回 null —— 挂载不该覆盖用户的选择。
 */
export function missingCardSizePatch(
  data: Record<string, unknown> | undefined,
  limits?: Partial<ImageFitLimits> | null,
): CardSizePatch | null {
  if (!data) return null
  if (positive(data.cardWidth) !== null && positive(data.cardHeight) !== null) return null
  return cardSizePatch(data.imageWidth, data.imageHeight, limits)
}

/**
 * 兜底补算（二）：**图片地址变了时**用（图片被别的插件/后台换掉、我们没经手的情况）。
 *
 * 幂等是硬要求：算出来的尺寸与当前一致就返回 null，一次都不写 ——
 * 否则我们自己写回尺寸会再次触发本判断，转成"自己触发自己"的死循环。
 *
 * 用户手动拖过尺寸后再换图：这里会按新图比例算出新尺寸（不为 null）→ 照样跟随新图，
 * 与 v1 行为一致（不做"手动调过就锁定"）。
 */
export function followedCardSizePatch(
  data: Record<string, unknown> | undefined,
  limits?: Partial<ImageFitLimits> | null,
): CardSizePatch | null {
  if (!data) return null
  const patch = cardSizePatch(data.imageWidth, data.imageHeight, limits)
  if (!patch) return null
  if (positive(data.cardWidth) === patch.size.w && positive(data.cardHeight) === patch.size.h) return null
  return patch
}
