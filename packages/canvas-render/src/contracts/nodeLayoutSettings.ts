/**
 * nodeLayoutSettings —— 节点"外壳几何"类配置的统一读取（控制栏贴边距离等）。
 *
 * 背景：节点插件把顶部操作栏/底部状态栏绝对定位在卡片外侧，这些距离以前是写死的字面量
 * （三处 `calc(100% + 6px)`）。用户要求可在设置里调，于是收进 theme-default 的 Config
 * （分组 `布局/控制栏`），由本模块统一读取。
 *
 * 为什么放在 canvas-render 而不是各节点插件各自读：
 * - 读取逻辑一致（"取当前值 → 订阅变化 → 卸载时退订"），抄三遍必然漂移；
 * - 需要读到"设置面板改完立刻生效"，所以必须订阅 settings.onChange，而不是启动时读一次；
 * - 节点插件本来就都依赖 canvas-render，放这里零额外依赖。
 *
 * 键名与默认值与 theme-default 的 Config 对齐（DEFAULT_THEME_LAYOUT）；
 * 这里不 import theme-default（避免插件包之间互相依赖），只按名字读、按同一默认值回落。
 */
import { onBeforeUnmount, ref, type Ref } from 'vue'

import { useCanvasRender } from './renderContext'

/** 控制栏贴边距离（px）：上控制栏离卡片上边、下控制栏离卡片下边 */
export interface NodeToolbarOffsets {
  /** 顶部操作栏离卡片上边的距离 */
  top: number
  /** 底部控制栏（状态栏/生成面板）离卡片下边的距离 */
  bottom: number
}

/** 与 theme-default `DEFAULT_THEME_LAYOUT` 同值（那边是单一数据源的初始值，这里是读不到时的回落） */
export const DEFAULT_TOOLBAR_OFFSETS: NodeToolbarOffsets = Object.freeze({
  top: 6,
  bottom: 6,
})

/**
 * 生成控制栏的尺寸类配置（px）。以前这些数值写死在两个面板的 CSS 里，
 * 用户要求"布局相关的配置要能在设置页面里调"，故与贴边距离同处一室。
 */
export interface GenPanelMetrics {
  /** 图片节点生成面板宽度 */
  imageWidth: number
  /** 文本节点生成面板宽度 */
  textWidth: number
  /** 文本输入框最小高度（内容少时不至于太扁） */
  editorMinHeight: number
  /** 文本输入框最大高度（内容多时内部滚动，面板不被撑爆） */
  editorMaxHeight: number
}

/** 与 theme-default Config 同值（读不到配置时的回落；也是"视觉默认值"的单一出处） */
export const DEFAULT_GEN_PANEL_METRICS: GenPanelMetrics = Object.freeze({
  imageWidth: 650,
  textWidth: 520,
  editorMinHeight: 64,
  editorMaxHeight: 220,
})

/** settings 服务的最小形状（只需要"读一个键 + 订阅变化"） */
interface SettingsLike {
  get(key: string): unknown
  onChange(cb: (key: string, value: unknown) => void): { dispose(): void }
}

/** 把任意取值收敛成合法距离（非法/负数 → 回落默认；防止 NaN 让 CSS 整条失效） */
function toOffset(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

/**
 * 从配置读取器解析出当前贴边距离（纯函数，Node 可单测）。
 * 缺项 / 非法值各自独立回落到默认 —— 一项坏了不影响另一项。
 */
export function resolveToolbarOffsets(get: (key: string) => unknown): NodeToolbarOffsets {
  return {
    top: toOffset(get('toolbarTopOffset'), DEFAULT_TOOLBAR_OFFSETS.top),
    bottom: toOffset(get('toolbarBottomOffset'), DEFAULT_TOOLBAR_OFFSETS.bottom),
  }
}

/**
 * 应用"某一项配置被改动"到当前值（纯函数，Node 可单测；也是订阅回调里唯一的那点逻辑）。
 * 只认识的键才动，其余键原样返回同一份值（无关配置改动不该引起重渲染）。
 */
export function applyOffsetChange(
  current: NodeToolbarOffsets,
  key: string,
  value: unknown,
): NodeToolbarOffsets {
  if (key === 'toolbarTopOffset') {
    return { ...current, top: toOffset(value, DEFAULT_TOOLBAR_OFFSETS.top) }
  }
  if (key === 'toolbarBottomOffset') {
    return { ...current, bottom: toOffset(value, DEFAULT_TOOLBAR_OFFSETS.bottom) }
  }
  return current
}

/** 把任意取值收敛成合法像素值（非法/非正 → 回落默认；避免 width: NaNpx 让整条声明失效） */
function toPx(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

/** 从配置读取器解析生成面板尺寸（纯函数，Node 可单测） */
export function resolveGenPanelMetrics(get: (key: string) => unknown): GenPanelMetrics {
  return {
    imageWidth: toPx(get('panelImageWidth'), DEFAULT_GEN_PANEL_METRICS.imageWidth),
    textWidth: toPx(get('panelTextWidth'), DEFAULT_GEN_PANEL_METRICS.textWidth),
    editorMinHeight: toPx(get('panelEditorMinHeight'), DEFAULT_GEN_PANEL_METRICS.editorMinHeight),
    editorMaxHeight: toPx(get('panelEditorMaxHeight'), DEFAULT_GEN_PANEL_METRICS.editorMaxHeight),
  }
}

/** 应用"某一项配置被改动"到当前尺寸值（纯函数；无关键原样返回同一引用） */
export function applyGenPanelMetricChange(
  current: GenPanelMetrics,
  key: string,
  value: unknown,
): GenPanelMetrics {
  switch (key) {
    case 'panelImageWidth':
      return { ...current, imageWidth: toPx(value, DEFAULT_GEN_PANEL_METRICS.imageWidth) }
    case 'panelTextWidth':
      return { ...current, textWidth: toPx(value, DEFAULT_GEN_PANEL_METRICS.textWidth) }
    case 'panelEditorMinHeight':
      return { ...current, editorMinHeight: toPx(value, DEFAULT_GEN_PANEL_METRICS.editorMinHeight) }
    case 'panelEditorMaxHeight':
      return { ...current, editorMaxHeight: toPx(value, DEFAULT_GEN_PANEL_METRICS.editorMaxHeight) }
    default:
      return current
  }
}

/**
 * 取"控制栏贴边距离"的响应式值。必须在 CanvasHost 渲染子树内调用（用的是 useCanvasRender 的 ctx）。
 *
 * 语义：
 * - 初次读取当前配置值；
 * - 设置面板改动后**立刻**反映到界面上（订阅 settings.onChange，无需刷新/重开节点）；
 * - 组件卸载时自动退订；
 * - 读不到 settings（极简宿主/单测桩）时回落默认值，不抛错。
 */
export function useToolbarOffsets(): Ref<NodeToolbarOffsets> {
  const { ctx } = useCanvasRender()
  const settings = ctx.get<SettingsLike | undefined>('settings')
  const offsets = ref<NodeToolbarOffsets>({ ...DEFAULT_TOOLBAR_OFFSETS })

  if (!settings || typeof settings.onChange !== 'function') return offsets

  offsets.value = resolveToolbarOffsets((key) => settings.get(key))

  const off = settings.onChange((key, value) => {
    offsets.value = applyOffsetChange(offsets.value, key, value)
  })
  onBeforeUnmount(() => off.dispose())
  return offsets
}

/**
 * 取生成控制栏的尺寸类配置（宽度 / 输入框高度）。与 useToolbarOffsets 同一套语义：
 * 初次读取 → 订阅设置变化实时生效 → 卸载退订 → 读不到回落默认。
 */
export function useGenPanelMetrics(): Ref<GenPanelMetrics> {
  const { ctx } = useCanvasRender()
  const settings = ctx.get<SettingsLike | undefined>('settings')
  const metrics = ref<GenPanelMetrics>({ ...DEFAULT_GEN_PANEL_METRICS })

  if (!settings || typeof settings.onChange !== 'function') return metrics

  metrics.value = resolveGenPanelMetrics((key) => settings.get(key))
  const off = settings.onChange((key, value) => {
    metrics.value = applyGenPanelMetricChange(metrics.value, key, value)
  })
  onBeforeUnmount(() => off.dispose())
  return metrics
}

/**
 * 把贴边距离拼成 CSS 长度：控制栏贴在卡片外侧时用它。
 * @param side 'top' 表示"浮在卡片上方"（配合 bottom:100%），'bottom' 表示"浮在卡片下方"（配合 top:100%）
 * @param offset 距离（px）
 */
export function toolbarOffsetStyle(side: 'top' | 'bottom', offset: number): Record<string, string> {
  const px = toOffset(offset, 0)
  return side === 'top' ? { bottom: `calc(100% + ${px}px)` } : { top: `calc(100% + ${px}px)` }
}

/** 插槽定位层的输入（壳 BaseNode 消费） */
export interface NodeSlotStyleInput {
  /** 哪个插槽：'top' 浮在卡片上方、'bottom' 浮在卡片下方 */
  side: 'top' | 'bottom'
  /** 离卡片边的距离（px；来自「布局/控制栏」的两个偏移配置） */
  offset: number
  /** 当前画布缩放（用于反缩放，让插槽内容在屏幕上大小恒定） */
  zoom: number
}

/**
 * 算出节点上/下插槽定位层的**整份内联样式**：贴边 + 水平居中 + 反缩放，一次算全。
 *
 * 为什么收在这里（用户要求："定位交给 BaseNode 而不是单独的组件"）：
 * 这段样式此前在三个段组件里各抄一遍（顶部操作条 / 图片生成栏 / 文本生成栏），
 * 其中"居中"与"反缩放"必须合进同一个 transform（分写在样式表与内联里会互相顶掉，
 * 图片面板当初因此错位过）。收成纯函数后，壳贴一份、插件不再碰定位，也不可能再漏掉其中一项。
 *
 * 两个"贴边不跑"的细节：
 * - transformOrigin 朝卡片一侧（上插槽 center bottom、下插槽 center top），
 *   否则反缩放时元素围绕自己中心缩，离卡片的距离会跟着变；
 * - 居中用 translateX(-50%) 而不是固定负 margin —— 插槽内容宽度是插件自由决定的。
 */
export function resolveNodeSlotStyle(input: NodeSlotStyleInput): Record<string, string> {
  const zoom = typeof input.zoom === 'number' && Number.isFinite(input.zoom) && input.zoom > 0 ? input.zoom : 1
  return {
    left: '50%',
    ...toolbarOffsetStyle(input.side, input.offset),
    transform: `translateX(-50%) scale(${1 / zoom})`,
    transformOrigin: input.side === 'top' ? 'center bottom' : 'center top',
  }
}
