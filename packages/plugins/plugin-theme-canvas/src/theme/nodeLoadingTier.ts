/**
 * nodeLoadingTier —— 「画布缩放档位 ⇄ 节点加载态版式」的规则（纯逻辑：零 Vue / 零 DOM，可单测）。
 *
 * 为什么要有全局档位：加载态是**所有节点类型共用的一只件**（图片 / 视频 / 可视化 / 文本都挂它）。
 * 一屏几十个节点、缩到 25% 时，每张卡仍画 56px 的大百分比 + 耗时胶囊 + 两行文案，
 * 屏幕上就是一整片糊字，还白画几十份流光。所以按缩放分三档，越缩小给得越少。
 *
 * ## 三档（与图片 / 视频缩略图的分档同一套语义，但**只此一份**）
 * - 第 1 档（zoom >= tier2Zoom）：完整 —— 状态词 + 耗时 + 大百分比 + 阶段文案 + 取消按钮；
 * - 第 2 档（tier3Zoom <= zoom < tier2Zoom）：精简 —— 去掉耗时，数字小一号，保留状态词与文案；
 * - 第 3 档（zoom < tier3Zoom）：极简 —— 只留中心数字（或不确定态光圈），不写状态词与文案。
 *
 * 与缩略图分档的两个差别：
 * 1. 缩略图是**每个插件各自一份配置**（图片 / 视频 / 可视化各配各的），这里刻意做成
 *    **全局一份**：加载态本来就长在所有节点上，再让三处各配一套阈值只会互相打架；
 * 2. 加载态不生成任何资源，切档只是换 DOM 与字号 —— 所以阈值不做滞回，抖动没有成本。
 *
 * ★ 第三档必须够得着：与画布最小缩放（minZoom）一起判定，缩到画布最小必定进第三档，
 *   否则用户会看到「只有两档」而不知道原因（图片分档踩过这个坑）。
 */

/** 本组配置键的前缀（settings 是全局同一张表，键名必须带前缀防撞） */
export const NODE_LOADING_TIER_PREFIX = 'nodeLoading'

/** 加载态档位：1 = 完整，2 = 精简，3 = 极简 */
export type NodeLoadingTier = 1 | 2 | 3

/** 一档的完整配置（只有阈值；版式本身写死在组件里，不开放到设置面板） */
export interface NodeLoadingTierConfig {
  /** 低于该缩放进入第二档 */
  tier2Zoom: number
  /** 低于该缩放进入第三档（会被夹到不超过第二档） */
  tier3Zoom: number
}

/**
 * 默认值：0.6 / 0.35。
 *
 * 依据是屏幕上的可读性，不是像素大小：12px 正文在 0.6 倍下只剩 7px，已经读不清；
 * 到 0.35 倍时数字都糊成一团，继续画文案只是噪音。
 */
export const DEFAULT_NODE_LOADING_TIERS: NodeLoadingTierConfig = Object.freeze({
  tier2Zoom: 0.6,
  tier3Zoom: 0.35,
})

/** 只认有限正数；否则回落 fallback */
function numOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

const MIN_ZOOM = 0.01

/** 从「按 key 取值」的读取器解析配置（每一项各自独立回落，一项坏掉不连累另一项） */
export function resolveNodeLoadingTiers(
  prefix: string,
  get: (key: string) => unknown,
): NodeLoadingTierConfig {
  const d = DEFAULT_NODE_LOADING_TIERS
  const tier2Zoom = Math.max(MIN_ZOOM, numOr(get(prefix + 'Tier2Zoom'), d.tier2Zoom))
  const tier3Zoom = Math.max(MIN_ZOOM, numOr(get(prefix + 'Tier3Zoom'), d.tier3Zoom))
  return {
    tier2Zoom,
    // 阈值往下夹：第三档配得比第二档还大时，收敛成 tier3 <= tier2，行为仍然确定
    tier3Zoom: Math.min(tier3Zoom, tier2Zoom),
  }
}

/** 从宿主服务表读配置（没有 settings 服务时整体回落默认，不抛错） */
export function readNodeLoadingTiers(
  prefix: string,
  ctx:
    | {
        get?<T = unknown>(name: string): T
        tryGet?<T = unknown>(name: string): T | undefined
      }
    | undefined,
): NodeLoadingTierConfig {
  const settings =
    ctx?.tryGet?.<{ get(key: string): unknown } | undefined>('settings') ??
    ctx?.get?.<{ get(key: string): unknown } | undefined>('settings')
  if (!settings || typeof settings.get !== 'function') return { ...DEFAULT_NODE_LOADING_TIERS }
  return resolveNodeLoadingTiers(prefix, (key) => settings.get(key))
}

/**
 * 当前缩放该用哪一档。
 *
 * zoom 非法（NaN / Infinity / 缺失）时按第 1 档：宁可把完整版式画出来，
 * 也不要因为一个坏数值把加载态变成什么都不显示。
 */
export function resolveNodeLoadingTier(
  zoom: unknown,
  cfg: NodeLoadingTierConfig = DEFAULT_NODE_LOADING_TIERS,
  minZoom?: unknown,
): NodeLoadingTier {
  if (typeof zoom !== 'number' || !Number.isFinite(zoom) || zoom <= 0) return 1
  // 缩到画布最小 → 必定是最小那一档（与配置无关的兜底）
  if (
    typeof minZoom === 'number' &&
    Number.isFinite(minZoom) &&
    minZoom > 0 &&
    zoom <= minZoom + 1e-6
  ) {
    return 3
  }
  if (zoom < cfg.tier3Zoom) return 3
  if (zoom < cfg.tier2Zoom) return 2
  return 1
}

/** 一条设置字段（内核 SettingSchema 用到的那几项） */
export interface NodeLoadingTierFieldDef {
  type: 'number'
  default: number
  min: number
  max: number
  step: number
  label: string
  group: string
  description: string
}

/** 生成全局档位设置字段（2 项），键名前缀由调用方给 */
export function nodeLoadingTierFields(
  prefix: string,
  group: string,
): Record<string, NodeLoadingTierFieldDef> {
  return {
    [prefix + 'Tier2Zoom']: {
      type: 'number',
      default: DEFAULT_NODE_LOADING_TIERS.tier2Zoom,
      min: 0.05,
      max: 2,
      step: 0.05,
      label: '第二档缩放阈值',
      group,
      description:
        '画布缩到该值以下时，节点加载态切换成精简版：去掉耗时胶囊、进度数字小一号。不小于该值时显示完整版式。',
    },
    [prefix + 'Tier3Zoom']: {
      type: 'number',
      default: DEFAULT_NODE_LOADING_TIERS.tier3Zoom,
      min: 0.05,
      max: 2,
      step: 0.05,
      label: '第三档缩放阈值',
      group,
      description:
        '画布缩到该值以下时切换成极简版：只留中心的进度数字（或旋转光圈），不再显示状态词与阶段文案。' +
        '不超过第二档阈值。★ 建议高于「常规/画布」里的最小缩放，否则这一档平时够不着（缩到画布最小时仍会进入第三档，这是兜底）。',
    },
  }
}

/** 本组的全部设置键（订阅 settings 变更时按它过滤） */
export function nodeLoadingTierKeys(prefix: string): string[] {
  return [prefix + 'Tier2Zoom', prefix + 'Tier3Zoom']
}
