/**
 * videoThumbTier —— 视频节点的「缩放档位 ⇄ 帧图目标尺寸」规则
 * （纯逻辑：零 Vue / 零 DOM / 零 Node，可单测）。
 *
 * 与图片插件那份是**各自独立的两份实现**（不互相 import、也不共享中间包）——
 * 插件只改自己的包，这是那条原则的必然代价：几个常量与三行判定，抄一份比新立一个共享包省事得多。
 * 两个插件的键名前缀不同（image / video），所以用户在设置面板里能分别配。
 *
 * ## 三档（视频与图片最大的差别）
 * 视频**三档都是帧图**（1 对 3）：因为"不播放时不加载视频"，第 1 档也必须是一张图。
 * - 第 1 档（zoom >= tier2Zoom）：**原生尺寸**的那一帧；
 * - 第 2 档：装进 tier2Width×tier2Height；
 * - 第 3 档：装进 tier3Width×tier3Height。
 */

/** 缩放档位：1 = 原生帧，2 = 中帧，3 = 小帧 */
export type VideoThumbTier = 1 | 2 | 3

/** 一档的完整配置 */
export interface VideoThumbTierConfig {
  tier2Zoom: number
  tier2Width: number
  tier2Height: number
  tier3Zoom: number
  tier3Width: number
  tier3Height: number
  /** 编码质量 0-1（canvas.toBlob 的 quality） */
  quality: number
}

/** 默认值：视频帧通常比图片缩略图大一点才看得清，所以尺寸与图片那套独立 */
export const DEFAULT_VIDEO_THUMB_TIERS: VideoThumbTierConfig = Object.freeze({
  tier2Zoom: 0.45,
  tier2Width: 512,
  tier2Height: 512,
  // 与图片插件同口径：必须明显高于画布默认最小缩放 0.2，否则这一档够不着
  tier3Zoom: 0.3,
  tier3Width: 160,
  tier3Height: 160,
  quality: 0.8,
})

function numOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

const MIN_ZOOM = 0.01
const MAX_TIER_SIDE = 4096

/** 从「按 key 取值」的读取器解析配置（每项各自回落） */
export function resolveVideoThumbTiers(prefix: string, get: (key: string) => unknown): VideoThumbTierConfig {
  const d = DEFAULT_VIDEO_THUMB_TIERS
  const clampSide = (v: unknown, fallback: number): number =>
    Math.min(MAX_TIER_SIDE, Math.max(1, Math.round(numOr(v, fallback))))
  const tier2Zoom = Math.max(MIN_ZOOM, numOr(get(prefix + 'Tier2Zoom'), d.tier2Zoom))
  const tier3Zoom = Math.max(MIN_ZOOM, numOr(get(prefix + 'Tier3Zoom'), d.tier3Zoom))
  return {
    tier2Zoom,
    tier3Zoom: Math.min(tier3Zoom, tier2Zoom),
    tier2Width: clampSide(get(prefix + 'Tier2Width'), d.tier2Width),
    tier2Height: clampSide(get(prefix + 'Tier2Height'), d.tier2Height),
    tier3Width: clampSide(get(prefix + 'Tier3Width'), d.tier3Width),
    tier3Height: clampSide(get(prefix + 'Tier3Height'), d.tier3Height),
    quality: Math.min(1, Math.max(0.1, numOr(get(prefix + 'ThumbQuality'), d.quality * 100) / 100)),
  }
}

/** 从宿主服务表读配置（没有 settings 服务时整体回落默认） */
export function readVideoThumbTiers(
  prefix: string,
  ctx: { get<T = unknown>(name: string): T } | undefined,
): VideoThumbTierConfig {
  const settings = ctx?.get<{ get(key: string): unknown } | undefined>('settings')
  if (!settings || typeof settings.get !== 'function') return { ...DEFAULT_VIDEO_THUMB_TIERS }
  return resolveVideoThumbTiers(prefix, (key) => settings.get(key))
}

/**
 * 当前缩放该用哪一档。
 *
 * zoom 非法按第 1 档（宁可正常显示原生帧）；minZoom 兜底保证"缩到画布最小必定进第 3 档"——
 * 见图片插件同名函数的说明（用户实测踩过"第三档够不着"的坑）。
 */
export function resolveVideoThumbTier(
  zoom: unknown,
  cfg: VideoThumbTierConfig = DEFAULT_VIDEO_THUMB_TIERS,
  minZoom?: unknown,
): VideoThumbTier {
  if (typeof zoom !== 'number' || !Number.isFinite(zoom) || zoom <= 0) return 1
  if (typeof minZoom === 'number' && Number.isFinite(minZoom) && minZoom > 0 && zoom <= minZoom + 1e-6) return 3
  if (zoom < cfg.tier3Zoom) return 3
  if (zoom < cfg.tier2Zoom) return 2
  return 1
}

/**
 * 该档的目标框。
 *
 * 与图片插件的关键差别：**第 1 档也给一个框**（原生尺寸 = 源宽高，fitIntoBox 不会放大），
 * 因为视频的第 1 档也要真的生成一张帧图（不播放时页面里没有 video 元素）。
 */
export function videoThumbTargetFor(
  tier: VideoThumbTier,
  cfg: VideoThumbTierConfig = DEFAULT_VIDEO_THUMB_TIERS,
  sourceSize: { width: number; height: number } = { width: 0, height: 0 },
): { width: number; height: number } {
  if (tier === 3) return { width: cfg.tier3Width, height: cfg.tier3Height }
  if (tier === 2) return { width: cfg.tier2Width, height: cfg.tier2Height }
  return { width: sourceSize.width, height: sourceSize.height }
}

/** 设定字段（与图片插件同款，前缀与分组不同） */
export interface VideoThumbTierFieldDef {
  type: 'number'
  default: number
  min: number
  max: number
  step: number
  label: string
  group: string
  description: string
}

export function videoThumbTierFields(
  prefix: string,
  group: string,
  labelPrefix = '',
): Record<string, VideoThumbTierFieldDef> {
  const l = labelPrefix
  return {
    [prefix + 'Tier2Zoom']: {
      type: 'number',
      default: DEFAULT_VIDEO_THUMB_TIERS.tier2Zoom,
      min: 0.05,
      max: 2,
      step: 0.05,
      label: l + '第二档缩放阈值',
      group,
      description: '画布缩到该值以下时改用第二档帧图（更省解码）。不小于该值时用' + (l || '原生帧') + '。',
    },
    [prefix + 'Tier2Width']: {
      type: 'number',
      default: DEFAULT_VIDEO_THUMB_TIERS.tier2Width,
      min: 32,
      max: 4096,
      step: 16,
      label: l + '第二档宽度',
      group,
      description: '第二档帧图的最大宽度（px；等比缩放，不拉伸、不裁切）。',
    },
    [prefix + 'Tier2Height']: {
      type: 'number',
      default: DEFAULT_VIDEO_THUMB_TIERS.tier2Height,
      min: 32,
      max: 4096,
      step: 16,
      label: l + '第二档高度',
      group,
      description: '第二档帧图的最大高度（px）。',
    },
    [prefix + 'Tier3Zoom']: {
      type: 'number',
      default: DEFAULT_VIDEO_THUMB_TIERS.tier3Zoom,
      min: 0.05,
      max: 2,
      step: 0.05,
      label: l + '第三档缩放阈值',
      group,
      description:
        '画布缩到该值以下时改用第三档帧图（最小、最省）。不超过第二档阈值。' +
        '★ 建议**高于**画布的最小缩放（「常规/画布」里的「最小缩放」），否则这一档平时够不着' +
        '（缩到画布最小时仍会进入第三档，这是兜底）。',
    },
    [prefix + 'Tier3Width']: {
      type: 'number',
      default: DEFAULT_VIDEO_THUMB_TIERS.tier3Width,
      min: 16,
      max: 4096,
      step: 16,
      label: l + '第三档宽度',
      group,
      description: '第三档帧图的最大宽度（px）。',
    },
    [prefix + 'Tier3Height']: {
      type: 'number',
      default: DEFAULT_VIDEO_THUMB_TIERS.tier3Height,
      min: 16,
      max: 4096,
      step: 16,
      label: l + '第三档高度',
      group,
      description: '第三档帧图的最大高度（px）。',
    },
    [prefix + 'ThumbQuality']: {
      type: 'number',
      default: Math.round(DEFAULT_VIDEO_THUMB_TIERS.quality * 100),
      min: 1,
      max: 100,
      step: 1,
      label: l + '帧图清晰度',
      group,
      description: '预览帧图的编码质量（1-100）。数字大更清楚、内存占用更大。与尺寸是两件事。',
    },
  }
}

/** 本插件的全部档位设置键 */
export function videoThumbTierKeys(prefix: string): string[] {
  return [
    prefix + 'Tier2Zoom',
    prefix + 'Tier2Width',
    prefix + 'Tier2Height',
    prefix + 'Tier3Zoom',
    prefix + 'Tier3Width',
    prefix + 'Tier3Height',
    prefix + 'ThumbQuality',
  ]
}

