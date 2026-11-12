/**
 * mediaFit —— 图片 / 视频节点的卡片尺寸规则（纯函数，零 DOM / 零 Vue，Node 可单测）。
 *
 * 用户口径（2026-10-30）：把原来的「预览上限宽 / 上限高」换成两个更好理解的限制：
 * - **最短边**不能小于 minShortSide；
 * - **最长边**不能大于 maxLongSide；
 * - 两条冲突时（例如 20:1 的细长图），**最短边优先**，最长边允许超出。
 *
 * 这条规则只服务图片 / 视频（内容尺寸跟随素材）；音频、文本、可视化、3D、图片对比
 * 等固定尺寸或用户自己拖拽的节点不走这里。
 *
 * 为什么放 canvas-base：图片、视频、文件拖入、旋转镜像都要算同一个尺寸。
 * 各抄一份必然会漂移（以前图片 420×300、视频 560×360 就是两份规则）。
 */

/** 一组「最短边 / 最长边」限制（px） */
export interface MediaCardLimits {
  minShortSide: number
  maxLongSide: number
}

/** 图片节点的两个设置键（必须带插件前缀：settings 是全局同一张表、先声明者独占） */
export const IMAGE_CARD_LIMIT_KEYS = Object.freeze({
  minShortSide: 'imageCardMinShortSide',
  maxLongSide: 'imageCardMaxLongSide',
})

/** 视频节点的两个设置键 */
export const VIDEO_CARD_LIMIT_KEYS = Object.freeze({
  minShortSide: 'videoCardMinShortSide',
  maxLongSide: 'videoCardMaxLongSide',
})

/** 读不到配置时的回落值：图片最长边 420（保持原来的视觉大小） */
export const DEFAULT_IMAGE_CARD_LIMITS: MediaCardLimits = Object.freeze({ minShortSide: 120, maxLongSide: 420 })

/** 读不到配置时的回落值：视频最长边 560（保持原来的视觉大小） */
export const DEFAULT_VIDEO_CARD_LIMITS: MediaCardLimits = Object.freeze({ minShortSide: 120, maxLongSide: 560 })

/** 只认正有限数；其余（undefined / NaN / 0 / 负数 / 字符串）一律视为「拿不到」 */
function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/**
 * 从「配置读取器」解析一组限制（纯函数，Node 可单测）。
 * 两项各自独立回落：一项被改坏不影响另一项。
 */
export function resolveMediaCardLimits(
  get: (key: string) => unknown,
  keys: { minShortSide: string; maxLongSide: string },
  defaults: MediaCardLimits,
): MediaCardLimits {
  return {
    minShortSide: positive(get(keys.minShortSide)) ?? defaults.minShortSide,
    maxLongSide: positive(get(keys.maxLongSide)) ?? defaults.maxLongSide,
  }
}

/**
 * 从宿主服务表读限制（ctx.get('settings')）。
 * 没有 settings 服务（极简宿主 / 单测桩）时整体回落默认，不抛错。
 */
export function readMediaCardLimits(
  ctx: { get<T = unknown>(name: string): T } | undefined,
  keys: { minShortSide: string; maxLongSide: string },
  defaults: MediaCardLimits,
): MediaCardLimits {
  const settings = ctx?.get<{ get(key: string): unknown } | undefined>('settings')
  if (!settings || typeof settings.get !== 'function') return { ...defaults }
  return resolveMediaCardLimits((key) => settings.get(key), keys, defaults)
}

/** 这个设置键是不是本组限制里的键（组件订阅设置变化时用，避免被无关配置反复触发） */
export function isMediaCardLimitKey(
  key: string,
  keys: { minShortSide: string; maxLongSide: string },
): boolean {
  return key === keys.minShortSide || key === keys.maxLongSide
}

/**
 * 核心规则：素材像素尺寸 → 卡片尺寸。
 *
 * ① 先按最长边缩放到 maxLongSide；
 * ② 若此时短边小于 minShortSide，就改为按短边放大到 minShortSide；
 * ③ 取整时短边向上取整、长边按比例向下取整，保证两条边界不会被取整破坏。
 *
 * 所以普通素材同时满足两条；极细长素材（20:1）按最短边算，最长边允许超出上限。
 *
 * @returns 尺寸；素材尺寸或限制全都不合法时返回 null（调用方保持原尺寸不动，绝不猜）
 */
export function fitMediaCard(
  mediaWidth: unknown,
  mediaHeight: unknown,
  limits?: Partial<MediaCardLimits> | null,
  defaults?: Partial<MediaCardLimits> | null,
): { width: number; height: number } | null {
  const w = positive(mediaWidth)
  const h = positive(mediaHeight)
  if (w === null || h === null) return null
  // 限制本身被改坏时各自回落默认值，而不是让整条规则失效
  const fallbackMin = positive(defaults?.minShortSide) ?? DEFAULT_IMAGE_CARD_LIMITS.minShortSide
  const fallbackMax = positive(defaults?.maxLongSide) ?? DEFAULT_IMAGE_CARD_LIMITS.maxLongSide
  const minShort = positive(limits?.minShortSide) ?? fallbackMin
  const maxLong = positive(limits?.maxLongSide) ?? fallbackMax
  const short = Math.min(w, h)
  const long = Math.max(w, h)
  // 最长边尽量不超过上限；但短边不足时改成按短边放大 —— 两者冲突时短边优先。
  // 小图也按最短边放大：这是用户要的"最短边不能小于多少"。
  const ratio = Math.max(minShort / short, Math.min(1, maxLong / long))
  let width = Math.max(1, Math.round(w * ratio))
  let height = Math.max(1, Math.round(h * ratio))
  // 取整后别掉到下限以下：短边优先，长边跟着比例补一点
  const roundedShort = Math.min(width, height)
  if (roundedShort < minShort) {
    const fix = minShort / roundedShort
    width = Math.max(1, Math.round(width * fix))
    height = Math.max(1, Math.round(height * fix))
  }
  return { width, height }
}
