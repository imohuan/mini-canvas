/**
 * videoFit —— "视频尺寸 → 节点卡片尺寸"的适配规则（纯函数，零 DOM / 零 Vue，Node 可单测）。
 *
 * 与图片节点同一条规矩（见 plugin-node-image 的 imageFit）：视频节点的宽高应该跟着视频的比例走，
 * 但完全照抄原始像素不现实（4K 视频会把画布撑爆），所以用「最短边 / 最长边」：
 * - 最长边不超过 videoCardMaxLongSide（默认 560）；
 * - 最短边不小于 videoCardMinShortSide（默认 120）；
 * - 两者冲突时最短边优先，最长边允许超上限。
 *
 * 算法本身在 `@mini-canvas/canvas-base` 的 mediaFit（图片、拖入、翻转共用同一份）。
 * 键名必须带本包前缀：内核 settings 是全局同一张表、先声明者独占，
 * 叫 "maxWidth" 这类通用名会和其他插件抢同一个键。
 *
 * 视频尺寸拿不到（元数据还没读出来 / 编解码失败 / 0 / NaN / 负数）时一律返回 null ——
 * 调用方保持原尺寸不动，绝不猜一个数字（猜错比不写更糟：卡片会莫名其妙变形）。
 */

import {
  DEFAULT_VIDEO_CARD_LIMITS,
  VIDEO_CARD_LIMIT_KEYS,
  fitMediaCard,
  readMediaCardLimits,
  resolveMediaCardLimits,
  type MediaCardLimits,
} from '@mini-canvas/canvas-base'

/** 视频尺寸限制（最短边 / 最长边） */
export type VideoFitLimits = MediaCardLimits

/** 读不到配置时的回落值（最短边 120、最长边 560） */
export const DEFAULT_VIDEO_FIT_LIMITS: VideoFitLimits = DEFAULT_VIDEO_CARD_LIMITS

/** 一点元数据都读不到时的兜底卡片尺寸 = v1 的 NODE_SIZES.video */
export const DEFAULT_VIDEO_CARD_SIZE = Object.freeze({ width: 480, height: 320 })

/**
 * 尺寸写回补丁：**只给正式字段 size**（唯一正身）。
 * 卡片镜像 data.cardWidth/cardHeight 由 nodeStore 从 size 自动生成，不再手拼三件套。
 */
export interface CardSizePatch {
  size: { w: number; h: number }
}

/**
 * 卡片该按谁的尺寸算：**裁过就按裁框**（用户看到的就是那一块），没裁按整幅画面。
 * 与 videoOps.displaySizeOf 同一口径；放在这里是为了让"设置一改重算卡片"也守住裁框比例。
 */
function cardSourceSize(data: Record<string, unknown> | undefined): { width: number; height: number } {
  const rect = data?.cropRect as { width?: unknown; height?: unknown } | undefined
  const rw = positive(rect?.width)
  const rh = positive(rect?.height)
  if (rw !== null && rh !== null) return { width: rw, height: rh }
  return { width: Number(data?.videoWidth) || 0, height: Number(data?.videoHeight) || 0 }
}

/** 只认正有限数；其余（undefined / NaN / 0 / 负数 / 字符串）一律视为"拿不到" */
function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/**
 * 从"配置读取器"解析视频尺寸限制（纯函数，Node 可单测）。
 */
export function resolveVideoFitLimits(get: (key: string) => unknown): VideoFitLimits {
  return resolveMediaCardLimits(get, VIDEO_CARD_LIMIT_KEYS, DEFAULT_VIDEO_FIT_LIMITS)
}

/**
 * 从宿主服务表读上限（ctx.get('settings')）。
 * 没有 settings 服务（极简宿主 / 单测桩）时整体回落默认，不抛错。
 */
export function readVideoFitLimits(ctx: { get<T = unknown>(name: string): T } | undefined): VideoFitLimits {
  return readMediaCardLimits(ctx, VIDEO_CARD_LIMIT_KEYS, DEFAULT_VIDEO_FIT_LIMITS)
}

/**
 * 核心规则：视频尺寸 → 卡片尺寸（最短边不小于下限、最长边不超过上限）。
 * @returns 尺寸；视频尺寸或限制全都不合法时返回 null（调用方保持原尺寸不动）
 */
export function fitVideoCardSize(
  videoWidth: unknown,
  videoHeight: unknown,
  limits?: Partial<VideoFitLimits> | null,
): { width: number; height: number } | null {
  return fitMediaCard(videoWidth, videoHeight, limits, DEFAULT_VIDEO_FIT_LIMITS)
}

/**
 * 尺寸写回补丁（各处写回共用）：一次带上 cardWidth / cardHeight / size。
 * 尺寸拿不到返回 null —— 调用方原样保留旧尺寸，不猜。
 */
export function videoCardSizePatch(
  videoWidth: unknown,
  videoHeight: unknown,
  limits?: Partial<VideoFitLimits> | null,
): CardSizePatch | null {
  const fit = fitVideoCardSize(videoWidth, videoHeight, limits)
  if (!fit) return null
  return { size: { w: fit.width, h: fit.height } }
}

/**
 * 兜底补算（一）：**挂载时**用。
 *
 * 只管"卡片尺寸缺失"的节点（旧数据、后台/MCP 建的节点、拖进来的新节点），
 * 尺寸已经在的（含用户手动拖过的）返回 null —— 挂载不该覆盖用户的选择。
 */
export function missingVideoCardSizePatch(
  data: Record<string, unknown> | undefined,
  limits?: Partial<VideoFitLimits> | null,
): CardSizePatch | null {
  if (!data) return null
  if (positive(data.cardWidth) !== null && positive(data.cardHeight) !== null) return null
  const source = cardSourceSize(data)
  return videoCardSizePatch(source.width, source.height, limits)
}

/**
 * 兜底补算（二）：**视频地址变了时**用（视频被别的插件/后台换掉、我们没经手的情况）。
 *
 * 幂等是硬要求：算出来的尺寸与当前一致就返回 null，一次都不写 ——
 * 否则我们自己写回尺寸会再次触发本判断，转成"自己触发自己"的死循环。
 */
export function followedVideoCardSizePatch(
  data: Record<string, unknown> | undefined,
  limits?: Partial<VideoFitLimits> | null,
): CardSizePatch | null {
  if (!data) return null
  const source = cardSourceSize(data)
  const patch = videoCardSizePatch(source.width, source.height, limits)
  if (!patch) return null
  if (positive(data.cardWidth) === patch.size.w && positive(data.cardHeight) === patch.size.h) return null
  return patch
}
