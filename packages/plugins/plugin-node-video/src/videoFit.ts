/**
 * videoFit —— "视频尺寸 → 节点卡片尺寸"的适配规则（纯函数，零 DOM / 零 Vue，Node 可单测）。
 *
 * 与图片节点同一条规矩（见 plugin-node-image 的 imageFit）：视频节点的宽高应该跟着视频的比例走，
 * 但完全照抄原始像素不现实（4K 视频会把画布撑爆），所以照 v1 的 fitVideoCardSize：
 * **等比缩放 + 封顶 + 最低尺寸兜底**，只缩小、不放大：
 *
 *   ratio  = min(maxW / 视频宽, maxH / 视频高, 1)
 *   卡片宽 = max(120, round(视频宽 * ratio))
 *   卡片高 = max(80,  round(视频高 * ratio))
 *
 * 与 v1 的差别只有封顶值：v1 把上限写死在 560×360，这里可配
 * （本包 Config 声明 videoFitMaxWidth / videoFitMaxHeight，分组「布局/视频节点尺寸」）。
 * 键名必须带本包前缀：内核 settings 是全局同一张表、先声明者独占，
 * 叫 "maxWidth" 这类通用名会和其他插件抢同一个键。
 *
 * 视频尺寸拿不到（元数据还没读出来 / 编解码失败 / 0 / NaN / 负数）时一律返回 null ——
 * 调用方保持原尺寸不动，绝不猜一个数字（猜错比不写更糟：卡片会莫名其妙变形）。
 */

/** 视频预览上限（对应配置 videoFitMaxWidth / videoFitMaxHeight） */
export interface VideoFitLimits {
  maxWidth: number
  maxHeight: number
}

/** 卡片尺寸下限：与 theme-default 的拖拽下限同值，卡片不会被算得更小 */
export const MIN_CARD_WIDTH = 120
export const MIN_CARD_HEIGHT = 80

/** 读不到配置时的回落值 = v1 fitVideoCardSize 的默认封顶（560×360） */
export const DEFAULT_VIDEO_FIT_LIMITS: VideoFitLimits = Object.freeze({ maxWidth: 560, maxHeight: 360 })

/** 一点元数据都读不到时的兜底卡片尺寸 = v1 的 NODE_SIZES.video */
export const DEFAULT_VIDEO_CARD_SIZE = Object.freeze({ width: 480, height: 320 })

/** 尺寸写回补丁：cardWidth/cardHeight 给卡片渲染读，size 是内核正式尺寸字段（写 node.size） */
export interface CardSizePatch {
  cardWidth: number
  cardHeight: number
  size: { w: number; h: number }
}

/** 只认正有限数；其余（undefined / NaN / 0 / 负数 / 字符串）一律视为"拿不到" */
function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/**
 * 从"配置读取器"解析视频预览上限（纯函数，Node 可单测）。
 * 两项各自独立回落：一项被改坏不影响另一项。
 */
export function resolveVideoFitLimits(get: (key: string) => unknown): VideoFitLimits {
  return {
    maxWidth: positive(get('videoFitMaxWidth')) ?? DEFAULT_VIDEO_FIT_LIMITS.maxWidth,
    maxHeight: positive(get('videoFitMaxHeight')) ?? DEFAULT_VIDEO_FIT_LIMITS.maxHeight,
  }
}

/**
 * 从宿主服务表读上限（ctx.get('settings')）。
 * 没有 settings 服务（极简宿主 / 单测桩）时整体回落默认，不抛错。
 */
export function readVideoFitLimits(ctx: { get<T = unknown>(name: string): T } | undefined): VideoFitLimits {
  const settings = ctx?.get<{ get(key: string): unknown } | undefined>('settings')
  if (!settings || typeof settings.get !== 'function') return { ...DEFAULT_VIDEO_FIT_LIMITS }
  return resolveVideoFitLimits((key) => settings.get(key))
}

/**
 * 核心规则：视频尺寸 → 卡片尺寸（等比 + 封顶 + 下限）。
 * @returns 尺寸；视频尺寸或上限全都不合法时返回 null（调用方保持原尺寸不动）
 */
export function fitVideoCardSize(
  videoWidth: unknown,
  videoHeight: unknown,
  limits?: Partial<VideoFitLimits> | null,
): { width: number; height: number } | null {
  const w = positive(videoWidth)
  const h = positive(videoHeight)
  if (w === null || h === null) return null
  // 上限本身被改坏时各自回落默认值，而不是让整条规则失效
  const maxW = positive(limits?.maxWidth) ?? DEFAULT_VIDEO_FIT_LIMITS.maxWidth
  const maxH = positive(limits?.maxHeight) ?? DEFAULT_VIDEO_FIT_LIMITS.maxHeight
  const ratio = Math.min(maxW / w, maxH / h, 1)
  return {
    width: Math.max(MIN_CARD_WIDTH, Math.round(w * ratio)),
    height: Math.max(MIN_CARD_HEIGHT, Math.round(h * ratio)),
  }
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
  return { cardWidth: fit.width, cardHeight: fit.height, size: { w: fit.width, h: fit.height } }
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
  return videoCardSizePatch(data.videoWidth, data.videoHeight, limits)
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
  const patch = videoCardSizePatch(data.videoWidth, data.videoHeight, limits)
  if (!patch) return null
  if (positive(data.cardWidth) === patch.cardWidth && positive(data.cardHeight) === patch.cardHeight) return null
  return patch
}
