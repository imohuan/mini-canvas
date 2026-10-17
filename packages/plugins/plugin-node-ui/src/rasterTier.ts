/**
 * rasterTier —— 「画布缩放档位 ⇄ 渲染清晰度倍数」的规则（纯逻辑：零 Vue / 零 DOM，可单测）。
 *
 * 照着图片插件 thumbTier.ts 的思路做：档位是**渲染期选择**，跟当前缩放走，
 * 写进节点会让每次缩放都改画布数据、还占撤销栈 —— 所以不写节点，只在这里算。
 *
 * ## 三档（与图片插件同一套语义）
 * - 第 1 档（zoom >= tier2Zoom）：倍率 `tier1Scale`（默认 1，即不动）
 * - 第 2 档（tier3Zoom <= zoom < tier2Zoom）：倍率 `tier2Scale`（默认 2）
 * - 第 3 档（zoom < tier3Zoom）：倍率 `tier3Scale`（默认 4）
 *
 * ## 三条刻意的取舍（照抄图片插件的踩坑经验）
 * 1. 阈值只判一次、不做滞回：档位是纯函数、无状态；缩放抖动最多多切一次，
 *    而切换只是改一个 CSS，不产生真实成本。
 * 2. 阈值往下夹：第三档阈值若配得比第二档还大，收敛成 tier3 <= tier2，
 *    让配置写错时行为仍然确定。
 * 3. ★ 第三档必须**够得着**：判定与画布实际能缩到的最小值一起看 ——
 *    「缩到最小」理应进入第三档。用户把阈值配得比 minZoom 还小时，minZoom 兜底
 *    仍然保证缩到最小能进第三档（否则表现为"只有两档"，界面上看不出原因）。
 */

/** 缩放档位：1 = 正常、2 = 清晰、3 = 最清晰 */
export type RasterTier = 1 | 2 | 3

/** 本插件在 settings 里的键名前缀（键名带前缀：settings 全局同一张表、先声明者独占） */
export const RASTER_TIER_PREFIX = 'uiNodeRaster'

/** 一档的完整配置（阈值 + 该档的渲染倍数） */
export interface RasterTierConfig {
  tier2Zoom: number
  tier2Scale: number
  tier3Zoom: number
  tier3Scale: number
  /** 第 1 档（放大到第二档阈值以上）用的倍数 */
  tier1Scale: number
}

/**
 * 默认值。
 *
 * 为什么第 1 档是 1：小倍率下 iframe 本来就看得清，多画一倍只是白烧内存；
 * 真正需要精度的是放大之后（用户 2026-10-17 报的问题就是放大后糊）。
 */
export const DEFAULT_RASTER_TIERS: RasterTierConfig = Object.freeze({
  tier1Scale: 1,
  tier2Zoom: 0.45,
  tier2Scale: 2,
  tier3Zoom: 0.3,
  tier3Scale: 4,
})

/** 允许的倍数：1/8、1/4、1/2、1、2、4、8（与配置下拉一致，支持缩小档省性能） */
export const RASTER_SCALES: readonly number[] = [0.125, 0.25, 0.5, 1, 2, 4, 8]

/** 把一个任意值收敛到允许的倍数；认不出来就给 fallback（默认 1 = 不动） */
export function normalizeRasterScale(raw: unknown, fallback = 1): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  return RASTER_SCALES.includes(n) ? n : fallback
}

/** 只认有限正数；否则回落 fallback */
function numOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

const MIN_ZOOM = 0.01

/** 从「按 key 取值」的读取器解析配置（每一项各自独立回落，一项坏掉不连累其它项） */
export function resolveRasterTiers(prefix: string, get: (key: string) => unknown): RasterTierConfig {
  const d = DEFAULT_RASTER_TIERS
  const tier2Zoom = Math.max(MIN_ZOOM, numOr(get(prefix + 'Tier2Zoom'), d.tier2Zoom))
  const tier3Zoom = Math.max(MIN_ZOOM, numOr(get(prefix + 'Tier3Zoom'), d.tier3Zoom))
  return {
    tier1Scale: normalizeRasterScale(get(prefix + 'Tier1Scale'), d.tier1Scale),
    tier2Scale: normalizeRasterScale(get(prefix + 'Tier2Scale'), d.tier2Scale),
    tier3Scale: normalizeRasterScale(get(prefix + 'Tier3Scale'), d.tier3Scale),
    tier2Zoom,
    // 阈值往下夹，配置写错时仍然确定
    tier3Zoom: Math.min(tier3Zoom, tier2Zoom),
  }
}

/** 从宿主服务表读配置（没有 settings 服务时整体回落默认，不抛错） */
export function readRasterTiers(
  prefix: string,
  ctx: { get?<T = unknown>(name: string): T; tryGet?<T = unknown>(name: string): T | undefined } | undefined,
): RasterTierConfig {
  // 宿主上下文是 ctx.get(name)；测试夹具可能只有 tryGet，也可能两个都没有 → 一律回落默认
  const settings =
    (ctx?.get?.<{ get(key: string): unknown } | undefined>('settings') ??
      ctx?.tryGet?.<{ get(key: string): unknown } | undefined>('settings'))
  if (!settings || typeof settings.get !== 'function') return { ...DEFAULT_RASTER_TIERS }
  return resolveRasterTiers(prefix, (key) => settings.get(key))
}

/**
 * 当前缩放该用哪一档。
 *
 * zoom 非法（NaN / Infinity / 缺失）时按第 1 档处理：宁可正常显示，
 * 也不要因为一个坏数值把画面变成糊图。
 */
export function resolveRasterTier(
  zoom: unknown,
  cfg: RasterTierConfig = DEFAULT_RASTER_TIERS,
  minZoom?: unknown,
): RasterTier {
  if (typeof zoom !== 'number' || !Number.isFinite(zoom) || zoom <= 0) return 1
  // 画布缩到最小 → 必定是最清晰那一档（"够得着"的保证，与配置无关）
  if (typeof minZoom === 'number' && Number.isFinite(minZoom) && minZoom > 0 && zoom <= minZoom + 1e-6) return 3
  if (zoom < cfg.tier3Zoom) return 3
  if (zoom < cfg.tier2Zoom) return 2
  return 1
}

/** 该档要用的渲染倍数 */
export function rasterScaleFor(tier: RasterTier, cfg: RasterTierConfig = DEFAULT_RASTER_TIERS): number {
  if (tier === 3) return cfg.tier3Scale
  if (tier === 2) return cfg.tier2Scale
  return cfg.tier1Scale
}

/** 一条设置字段（内核 ConfigSchema 用到的那几项） */
export interface RasterTierFieldDef {
  type: 'number' | 'select'
  default: number | string
  label: string
  group: string
  description: string
  min?: number
  max?: number
  step?: number
  options?: Array<{ value: string; label?: string }>
}

/** 倍数的下拉候选（大于 1 更清晰、小于 1 更省性能） */
const SCALE_OPTIONS = RASTER_SCALES.map((n) => ({
  value: String(n),
  label:
    n >= 1 ? n + ' 倍' : '1/' + Math.round(1 / n) + ' 倍（省性能）',
}))

/** 生成本插件的一组档位设置字段（5 项），键名前缀由调用方给 */
export function rasterTierFields(prefix: string, group: string): Record<string, RasterTierFieldDef> {
  return {
    [prefix + 'Tier1Scale']: {
      type: 'select',
      default: String(DEFAULT_RASTER_TIERS.tier1Scale),
      options: SCALE_OPTIONS,
      label: '一档（正常）倍数',
      group,
      description: '画布缩放不低于第二档阈值时用的渲染倍数。1 倍 = 完全不动，和普通节点一样。',
    },
    [prefix + 'Tier2Zoom']: {
      type: 'number',
      default: DEFAULT_RASTER_TIERS.tier2Zoom,
      min: 0.05,
      max: 2,
      step: 0.05,
      label: '第二档缩放阈值',
      group,
      description: '画布缩到该值以下时换用第二档倍数。不小于该值时用一档。',
    },
    [prefix + 'Tier2Scale']: {
      type: 'select',
      default: String(DEFAULT_RASTER_TIERS.tier2Scale),
      options: SCALE_OPTIONS,
      label: '二档倍数',
      group,
      description: '第二档的渲染倍数。通常比一档大，缩小画布时文字不至于糊成一团。',
    },
    [prefix + 'Tier3Zoom']: {
      type: 'number',
      default: DEFAULT_RASTER_TIERS.tier3Zoom,
      min: 0.05,
      max: 2,
      step: 0.05,
      label: '第三档缩放阈值',
      group,
      description:
        '画布缩到该值以下时换用第三档倍数。不超过第二档阈值。' +
        '★ 建议高于画布的最小缩放（「常规/画布」里的「最小缩放」），否则这一档平时够不着' +
        '（缩到画布最小时仍会进入第三档，这是兜底）。',
    },
    [prefix + 'Tier3Scale']: {
      type: 'select',
      default: String(DEFAULT_RASTER_TIERS.tier3Scale),
      options: SCALE_OPTIONS,
      label: '三档倍数',
      group,
      description: '第三档的渲染倍数（画布缩到最小时用）。想省性能可以设成 1/2 或 1/4。',
    },
  }
}

/** 本插件的全部档位设置键（订阅 settings 变更时按它过滤） */
export function rasterTierKeys(prefix: string): string[] {
  return [
    prefix + 'Tier1Scale',
    prefix + 'Tier2Zoom',
    prefix + 'Tier2Scale',
    prefix + 'Tier3Zoom',
    prefix + 'Tier3Scale',
  ]
}

