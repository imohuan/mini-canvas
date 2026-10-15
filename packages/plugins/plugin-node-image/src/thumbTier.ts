/**
 * thumbTier —— 「缩放档位 ⇄ 目标尺寸」的规则（纯逻辑：零 Vue / 零 DOM / 零 Node，可单测）。
 *
 * ## 为什么在插件里（而不是放基础包）
 * 这是**本插件自己的**渲染策略：分辨率掉到多少就换小图，是图片节点的显示选择，
 * 别的包不需要知道。按项目原则「插件只改自己包内的东西」——要做到这一点，
 * 它就不能住在 canvas-data / canvas-render 里（那等于要求基础包为某个插件的能力开后门）。
 * 视频插件有一份同样的实现：两个插件互相独立，不互相 import，也不共享中间包。
 *
 * ## 三档
 * - 第 1 档（zoom >= tier2Zoom）：原图（**不生成任何东西**）；
 * - 第 2 档（tier3Zoom <= zoom < tier2Zoom）：装进 tier2Width×tier2Height 的框；
 * - 第 3 档（zoom < tier3Zoom）：装进 tier3Width×tier3Height 的框。
 *
 * ## 三条刻意的取舍
 * 1. 阈值只判一次、不做滞回：档位是纯函数、无状态；抖动最多多生成一次，
 *    而生成结果在缓存里（命中即取），不产生真实成本。
 * 2. 阈值往下夹：第三档阈值若配得比第二档还大，判定会永远进不了第二档 ——
 *    收敛成 tier3 <= tier2，让配置写错时行为仍然确定。
 * 3. ★ 第三档必须**够得着**：判定与画布实际能缩到的最小值（minZoom）一起看 ——
 *    "缩到最小"理应进入第三档。默认阈值 0.3 明显高于画布默认 minZoom 0.2；
 *    万一用户把阈值配得比最小缩放还小，minZoom 兜底仍然保证缩到最小能进第三档
 *    （否则表现为"只有两档"，且界面上看不出原因 —— 用户实测踩过这个坑）。
 */

/** 缩放档位：1 = 原图，2 = 中图，3 = 小图 */
export type ThumbTier = 1 | 2 | 3

/** 一档的完整配置（阈值 + 目标框 + 压缩质量） */
export interface ThumbTierConfig {
  tier2Zoom: number
  tier2Width: number
  tier2Height: number
  tier3Zoom: number
  tier3Width: number
  tier3Height: number
  /** 编码质量 0-1（canvas.toBlob 的 quality） */
  quality: number
}

/**
 * 默认值。尺寸取自实测常识：一屏几十个节点的画布里，卡片实际像素宽度多在 200-400 之间，
 * 第 2 档给 512 的框（缩小一档仍看得清）、第 3 档给 160 的框（只认个大概，解码量最小）。
 */
export const DEFAULT_THUMB_TIERS: ThumbTierConfig = Object.freeze({
  tier2Zoom: 0.45,
  tier2Width: 512,
  tier2Height: 512,
  tier3Zoom: 0.3,
  tier3Width: 160,
  tier3Height: 160,
  quality: 0.8,
})

/** 只认有限正数；否则回落 fallback */
function numOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

const MIN_ZOOM = 0.01
const MAX_TIER_SIDE = 4096

/** 从「按 key 取值」的读取器解析配置（每一项各自独立回落，一项坏掉不连累其它项） */
export function resolveThumbTiers(prefix: string, get: (key: string) => unknown): ThumbTierConfig {
  const d = DEFAULT_THUMB_TIERS
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

/** 从宿主服务表读配置（没有 settings 服务时整体回落默认，不抛错） */
export function readThumbTiers(
  prefix: string,
  ctx: { get<T = unknown>(name: string): T } | undefined,
): ThumbTierConfig {
  const settings = ctx?.get<{ get(key: string): unknown } | undefined>('settings')
  if (!settings || typeof settings.get !== 'function') return { ...DEFAULT_THUMB_TIERS }
  return resolveThumbTiers(prefix, (key) => settings.get(key))
}

/**
 * 当前缩放该用哪一档。
 *
 * zoom 非法（NaN / Infinity / 缺失）时按第 1 档处理：宁可正常显示原图，
 * 也不要因为一个坏数值把画面变成糊图。
 */
export function resolveThumbTier(
  zoom: unknown,
  cfg: ThumbTierConfig = DEFAULT_THUMB_TIERS,
  minZoom?: unknown,
): ThumbTier {
  if (typeof zoom !== 'number' || !Number.isFinite(zoom) || zoom <= 0) return 1
  // 画布缩到最小 → 必定是最小那一档（"够得着"的保证，与配置无关）
  if (typeof minZoom === 'number' && Number.isFinite(minZoom) && minZoom > 0 && zoom <= minZoom + 1e-6) return 3
  if (zoom < cfg.tier3Zoom) return 3
  if (zoom < cfg.tier2Zoom) return 2
  return 1
}

/**
 * 该档的目标框；第 1 档返回 null（= 原图，不该生成任何东西）。
 *
 * 返回 null 而不是"原尺寸的框"是刻意的：调用方据此**跳过生成**——
 * 给原图生成一张同为原生尺寸的小图纯属浪费（还要多占一份内存）。
 */
export function thumbTargetFor(tier: ThumbTier, cfg: ThumbTierConfig = DEFAULT_THUMB_TIERS): { width: number; height: number } | null {
  if (tier === 3) return { width: cfg.tier3Width, height: cfg.tier3Height }
  if (tier === 2) return { width: cfg.tier2Width, height: cfg.tier2Height }
  return null
}

/** 一条设置字段（内核 SettingSchema 用到的那几项） */
export interface ThumbTierFieldDef {
  type: 'number'
  default: number
  min: number
  max: number
  step: number
  label: string
  group: string
  description: string
}

/**
 * 生成本插件的一组设置字段（7 项），键名前缀由调用方给。
 *
 * 键名必须带前缀：settings 是**全局同一张表、先声明者独占**，
 * 叫 `tier2Zoom` 这种通用名会跟别的插件抢同一个键（撞名会被静默跳过）。
 */
export function thumbTierFields(prefix: string, group: string, labelPrefix = ''): Record<string, ThumbTierFieldDef> {
  const l = labelPrefix
  return {
    [prefix + 'Tier2Zoom']: {
      type: 'number',
      default: DEFAULT_THUMB_TIERS.tier2Zoom,
      min: 0.05,
      max: 2,
      step: 0.05,
      label: l + '第二档缩放阈值',
      group,
      description: '画布缩到该值以下时改用第二档缩略图（更省解码）。不小于该值时用' + (l || '原图') + '。',
    },
    [prefix + 'Tier2Width']: {
      type: 'number',
      default: DEFAULT_THUMB_TIERS.tier2Width,
      min: 32,
      max: 4096,
      step: 16,
      label: l + '第二档宽度',
      group,
      description: '第二档缩略图的最大宽度（px；等比缩放，不拉伸、不裁切）。',
    },
    [prefix + 'Tier2Height']: {
      type: 'number',
      default: DEFAULT_THUMB_TIERS.tier2Height,
      min: 32,
      max: 4096,
      step: 16,
      label: l + '第二档高度',
      group,
      description: '第二档缩略图的最大高度（px）。',
    },
    [prefix + 'Tier3Zoom']: {
      type: 'number',
      default: DEFAULT_THUMB_TIERS.tier3Zoom,
      min: 0.05,
      max: 2,
      step: 0.05,
      label: l + '第三档缩放阈值',
      group,
      description:
        '画布缩到该值以下时改用第三档缩略图（最小、最省）。不超过第二档阈值。' +
        '★ 建议**高于**画布的最小缩放（「常规/画布」里的「最小缩放」），否则这一档平时够不着' +
        '（缩到画布最小时仍会进入第三档，这是兜底）。',
    },
    [prefix + 'Tier3Width']: {
      type: 'number',
      default: DEFAULT_THUMB_TIERS.tier3Width,
      min: 16,
      max: 4096,
      step: 16,
      label: l + '第三档宽度',
      group,
      description: '第三档缩略图的最大宽度（px）。',
    },
    [prefix + 'Tier3Height']: {
      type: 'number',
      default: DEFAULT_THUMB_TIERS.tier3Height,
      min: 16,
      max: 4096,
      step: 16,
      label: l + '第三档高度',
      group,
      description: '第三档缩略图的最大高度（px）。',
    },
    [prefix + 'ThumbQuality']: {
      type: 'number',
      default: Math.round(DEFAULT_THUMB_TIERS.quality * 100),
      min: 1,
      max: 100,
      step: 1,
      label: l + '缩略图清晰度',
      group,
      description:
        '缩略图 / 帧图的编码质量（1-100）。数字大更清楚、内存占用更大。' +
        '清晰度与尺寸是两件事：尺寸决定解码多少像素（影响卡不卡），清晰度决定同等像素下压得多细。',
    },
  }
}

/** 本插件的全部档位设置键（订阅 settings 变更时按它过滤） */
export function thumbTierKeys(prefix: string): string[] {
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

