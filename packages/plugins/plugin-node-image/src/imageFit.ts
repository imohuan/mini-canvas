/**
 * imageFit —— "图片尺寸 → 节点卡片尺寸"的适配规则（纯函数，零 DOM / 零 Vue，Node 可单测）。
 *
 * 用户要求（原话）："上传图片或者选择图片之后，图片节点的宽高应该和图片的宽高保持一致"。
 * 完全照抄原图像素并不现实（一张 4000×3000 的图会把画布撑爆），所以按 v1 的老办法：
 * **等比缩放 + 封顶 + 最低尺寸兜底**，只缩小、不放大：
 *
 *   ratio  = min(maxW / 图宽, maxH / 图高, 1)
 *   卡片宽 = max(120, round(图宽 * ratio))
 *   卡片高 = max(80,  round(图高 * ratio))
 *
 * 封顶值可配：本包 Config 声明 imageFitMaxWidth / imageFitMaxHeight（分组「布局/图片节点尺寸」），
 * 读不到就回落 v1 的 420×300。注意内核 settings 是**全局同一张表、先声明者独占**，
 * 所以键名必须带本包前缀（imageFit…），不能取 "maxWidth" 这种通用名。
 *
 * 图像尺寸拿不到（0 / NaN / 负数 / 缺失）时一律返回 null —— 调用方保持原尺寸不动，绝不猜一个数字
 * （猜错比不写更糟：会让卡片莫名其妙变成别的形状）。
 *
 * 为什么要单独一层：这条规则被四处写回（上传 / 裁剪 / 旋转 / 生成出图）与一处兜底监听共用，
 * 抄五遍必然漂移；纯函数形态也让"边界到底怎么算"能在 node 里直接断言，不必起浏览器。
 */

/** 图片预览上限（对应配置 imageFitMaxWidth / imageFitMaxHeight） */
export interface ImageFitLimits {
  maxWidth: number
  maxHeight: number
}

/** 卡片尺寸下限：与 theme-default 的 CARD_MIN_WIDTH/HEIGHT（拖拽下限）同值，卡片不会被算得更小 */
export const MIN_CARD_WIDTH = 120
export const MIN_CARD_HEIGHT = 80

/** 读不到配置时的回落值 = v1 的 MAX_PREVIEW_WIDTH / MAX_PREVIEW_HEIGHT */
export const DEFAULT_IMAGE_FIT_LIMITS: ImageFitLimits = Object.freeze({ maxWidth: 420, maxHeight: 300 })

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
 * 从"配置读取器"解析图片预览上限（纯函数，Node 可单测）。
 * 两项各自独立回落：一项被改坏不影响另一项。
 */
export function resolveImageFitLimits(get: (key: string) => unknown): ImageFitLimits {
  return {
    maxWidth: positive(get('imageFitMaxWidth')) ?? DEFAULT_IMAGE_FIT_LIMITS.maxWidth,
    maxHeight: positive(get('imageFitMaxHeight')) ?? DEFAULT_IMAGE_FIT_LIMITS.maxHeight,
  }
}

/**
 * 从宿主服务表读上限（ctx.get('settings')）。
 * 没有 settings 服务（极简宿主 / 单测桩）时整体回落默认，不抛错。
 */
export function readImageFitLimits(ctx: { get<T = unknown>(name: string): T } | undefined): ImageFitLimits {
  const settings = ctx?.get<{ get(key: string): unknown } | undefined>('settings')
  if (!settings || typeof settings.get !== 'function') return { ...DEFAULT_IMAGE_FIT_LIMITS }
  return resolveImageFitLimits((key) => settings.get(key))
}

/**
 * 核心规则：图片尺寸 → 卡片尺寸（等比 + 封顶 + 下限）。
 * @returns 尺寸；图片尺寸或上限全都不合法时返回 null（调用方保持原尺寸不动）
 */
export function fitCardSize(
  imageWidth: unknown,
  imageHeight: unknown,
  limits?: Partial<ImageFitLimits> | null,
): { width: number; height: number } | null {
  const w = positive(imageWidth)
  const h = positive(imageHeight)
  if (w === null || h === null) return null
  // 上限本身被改坏时各自回落默认值，而不是让整条规则失效
  const maxW = positive(limits?.maxWidth) ?? DEFAULT_IMAGE_FIT_LIMITS.maxWidth
  const maxH = positive(limits?.maxHeight) ?? DEFAULT_IMAGE_FIT_LIMITS.maxHeight
  const ratio = Math.min(maxW / w, maxH / h, 1)
  return {
    width: Math.max(MIN_CARD_WIDTH, Math.round(w * ratio)),
    height: Math.max(MIN_CARD_HEIGHT, Math.round(h * ratio)),
  }
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
  return { cardWidth: fit.width, cardHeight: fit.height, size: { w: fit.width, h: fit.height } }
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
  if (positive(data.cardWidth) === patch.cardWidth && positive(data.cardHeight) === patch.cardHeight) return null
  return patch
}
