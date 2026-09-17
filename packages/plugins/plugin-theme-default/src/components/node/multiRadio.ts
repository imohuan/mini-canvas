/**
 * multiRadio —— 多选标记（节点左上角那个圆圈）的外观契约：大小 / 颜色 / 低缩放下是否显示。
 *
 * 用户要求（原话）：
 * “这个多选标识变小一些，并且支持改变颜色，在这个插件的 Config 中提供对应配置，同时支持大小 size；
 *  并且支持一个开关 —— 当前在低缩放下不显示，我希望你支持一个开关支持显示”。
 *
 * 三件事都收在这里（纯逻辑，零 Vue / 零 DOM，Node 可直接单测）：
 * 1. 默认值 + 三个配置键（键名带 `nodeMultiRadio` 前缀 —— settings 的 key 是全局平面命名，
 *    先声明者独占，裸 `size`/`color` 会撞别的插件）；
 * 2. 读配置 / 收到单项改动（一项坏了只回落那一项，不影响其它项）；
 * 3. 算成 CSS（大小按屏幕像素写死，配合 BaseNode 那层 1/zoom 反缩放 → 屏幕上大小恒定）。
 *
 * 为什么大小是“屏幕像素”而不是 flow 像素：这个标记的意义是“一眼看出这个节点在不在选中集里”，
 * 缩到 0.2x 时若跟着画布一起缩，它就小成一个点、完全起不到指示作用。所以大小恒指“你在屏幕上
 * 量到的直径”，与标题条 / resize 拖柄同一套语义。
 */

/** 多选标记的默认外观 */
export interface MultiRadioConfig {
  /** 屏幕上的直径（px） */
  size: number
  /** 圆环与中心点的颜色 */
  color: string
  /** 低缩放（低于节点低细节阈值）时是否仍然显示 */
  showInLowDetail: boolean
}

/**
 * 配置键。一律加 `nodeMultiRadio` 前缀：settings 的 key 全局一张表、先声明者独占，
 * 撞名会被内核静默跳过（开关形同虚设）。
 */
export const MULTI_RADIO_KEYS = {
  size: 'nodeMultiRadioSize',
  color: 'nodeMultiRadioColor',
  showInLowDetail: 'nodeMultiRadioShowInLowDetail',
} as const

/** 上面三个键的集合版本：订阅回调里逐个比对字符串是热路径（每次设置变化都会跑），用 Set 查一次 */
export const MULTI_RADIO_KEY_SET: ReadonlySet<string> = new Set(Object.values(MULTI_RADIO_KEYS))

/**
 * 大小边界（px，屏幕量到的直径）。
 * 下限 12 保证还看得清；上限 48 防止误填三位数把节点内容整块盖住。
 */
export const MULTI_RADIO_SIZE_MIN = 12
export const MULTI_RADIO_SIZE_MAX = 48

/**
 * 默认值：大小比原先写死的 26px 小一圈（用户要求“变小一些”）；
 * 颜色取主题里的“节点选中色”（深灰 #111827）—— 圆点是“这个节点在选中集里”的指示，
 * 跟选中环同一色系才不会看成一个不相干的小图标。
 */
export const DEFAULT_MULTI_RADIO: MultiRadioConfig = Object.freeze({
  size: 18,
  color: '#111827',
  showInLowDetail: false,
})

/** 取值器：给一个 key 拿当前值（读不到返回 undefined） */
export type MultiRadioGetter = (key: string) => unknown

/** hex(#rgb / #rrggbb) 校验：不合法就回落，避免把坏值喂给 color() 让整条 CSS 失效 */
function toColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)
    ? value
    : fallback
}

/** 大小取值：非数字 / 负数 / NaN 回落默认，超界收进边界 */
function toSize(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback
  return Math.min(MULTI_RADIO_SIZE_MAX, Math.max(MULTI_RADIO_SIZE_MIN, value))
}

/** 布尔取值：非布尔回落默认（半套脏值不该被当成 true） */
function toBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** 从配置读当前外观（纯函数；一项坏了只回落那一项，不影响其它项） */
export function resolveMultiRadio(get: MultiRadioGetter): MultiRadioConfig {
  const d = DEFAULT_MULTI_RADIO
  return {
    size: toSize(get(MULTI_RADIO_KEYS.size), d.size),
    color: toColor(get(MULTI_RADIO_KEYS.color), d.color),
    showInLowDetail: toBool(get(MULTI_RADIO_KEYS.showInLowDetail), d.showInLowDetail),
  }
}

/**
 * 应用“某一项配置被改动”（订阅回调里唯一那点逻辑，纯函数）。
 * 只认识的键才动；别的键（其它插件的配置）原样返回**同一引用** —— 不触发无谓重渲染。
 */
export function applyMultiRadioChange(
  current: MultiRadioConfig,
  key: string,
  value: unknown,
): MultiRadioConfig {
  switch (key) {
    case MULTI_RADIO_KEYS.size:
      return { ...current, size: toSize(value, DEFAULT_MULTI_RADIO.size) }
    case MULTI_RADIO_KEYS.color:
      return { ...current, color: toColor(value, DEFAULT_MULTI_RADIO.color) }
    case MULTI_RADIO_KEYS.showInLowDetail:
      return { ...current, showInLowDetail: toBool(value, DEFAULT_MULTI_RADIO.showInLowDetail) }
    default:
      return current
  }
}

/** multiRadioStyle 的入参：外观 + 当前缩放 + 反缩放下限 */
export interface MultiRadioStyleInput {
  /** 屏幕上的直径（px） */
  size: number
  /** 圆环/圆点颜色 */
  color: string
  /** 当前画布缩放 */
  zoom: number
  /** 反缩放下限（与标题条共用 titleScaleMinZoom）：低于它之后不再继续放大，避免标记吃掉半个节点 */
  minZoom: number
}

/**
 * 算多选标记的 CSS。
 *
 * 大小写法与标题条一致：元素写**屏幕尺寸**，再乘 `1/max(zoom, minZoom)` 反缩放，
 * 于是屏幕上量到的直径恒等于配置的 size。缩放非法（0 / NaN）时按 minZoom 算，绝不产生 Infinity。
 *
 * 返回 `Record<string, string>`（与 canvas-render 的 resolveNodeSlotStyle 同形）：
 * 直接绑到 `:style`，也不用为了给 Vue 的 StyleValue 认而多写一层类型。
 */
export function multiRadioStyle(input: MultiRadioStyleInput): Record<string, string> {
  const minZoom =
    Number.isFinite(input.minZoom) && input.minZoom > 0 ? input.minZoom : 0.5
  const zoom = Number.isFinite(input.zoom) && input.zoom > 0 ? input.zoom : minZoom
  return {
    width: `${input.size}px`,
    height: `${input.size}px`,
    transform: `scale(${1 / Math.max(zoom, minZoom)})`,
    transformOrigin: 'left top',
    color: input.color,
  }
}
