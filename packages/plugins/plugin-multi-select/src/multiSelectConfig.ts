/**
 * multiSelectConfig —— 多选插件的可配置项（群组框的内外双框几何 + 样式）。
 *
 * 两个框是什么（老版 multi-select 的做法，本插件复刻）：
 * - **内框（小框）**：紧贴选中节点的真实矩形并集 —— 按实测尺寸算，**不含标题**。
 *   位置由这里的三项 padding 决定（左/右、上、下各留多少），默认左右 16、上 36、下 16。
 * - **外框（大框）**：内框再往外扩同样的 padding 得到的框，用来兜住标题条、也当整组拖动的把手。
 *
 * 为什么 padding 只管"内框的位置"，不管"内框的大小"：
 * 内框要的是"正好框住节点"，节点多大它就多大；padding 只是把它从外框往里收多少。
 * 早先的实现把"内框大小"也按 padding 反推，一旦 padding 与真实节点尺寸对不上
 * 就会算出一个比外框还大的内框（视觉上两框交叉）。现在内框尺寸直接从节点矩形拿，
 * 只有位置用 padding —— padding 怎么改，内框都稳稳贴在节点上。
 *
 * 分组 `布局/多选`：它属于"画布上的视觉辅助"，与对齐辅助线/控制栏同属一级「布局」。
 *
 * 纯逻辑文件（零 Vue / 零 DOM）：schema、默认值、读取、CSS 生成都在这里，可直接单测；
 * 组件只负责把这里算好的样式贴到元素上。
 */
import type { ConfigSchema, InferConfig } from '@mini-canvas/canvas-base'

/** 线型：实线 / 虚线 / 点线 */
export type FrameLineStyle = 'solid' | 'dashed' | 'dotted'

/** 一个框的描边样式 */
export interface FrameStrokeStyle {
  /** 线色（hex） */
  color: string
  /** 线型 */
  lineStyle: FrameLineStyle
  /** 线宽（px） */
  lineWidth: number
  /** 圆角（px） */
  radius: number
  /** 填充不透明度 0~1（0 = 只描边不填色） */
  fillOpacity: number
}

/** 群组框的完整外观：内框/外框各自的 padding 与样式 */
export interface MultiSelectFrameConfig {
  /** 左右内缩（px）：内框离外框左右各收多少 */
  paddingX: number
  /** 上内缩（px）：给卡片上方的标题条留出的空间 */
  paddingTop: number
  /** 下内缩（px） */
  paddingBottom: number
  /** 外框（大框）样式：整组拖动的把手 */
  outer: FrameStrokeStyle
  /** 内框（小框）样式：紧贴节点并集 */
  inner: FrameStrokeStyle
}

/**
 * 配置键。
 *
 * settings 的 key 是**全局平面命名**、先声明者独占，撞名会被内核静默跳过（开关形同虚设），
 * 故一律加 `multiSelectFrame` 前缀 —— 不要用裸 `paddingX`/`color` 这类通用词。
 */
export const MULTI_SELECT_FRAME_KEYS = {
  paddingX: 'multiSelectFramePaddingX',
  paddingTop: 'multiSelectFramePaddingTop',
  paddingBottom: 'multiSelectFramePaddingBottom',
  outerColor: 'multiSelectFrameOuterColor',
  outerStyle: 'multiSelectFrameOuterStyle',
  outerWidth: 'multiSelectFrameOuterWidth',
  outerRadius: 'multiSelectFrameOuterRadius',
  outerFill: 'multiSelectFrameOuterFillOpacity',
  innerColor: 'multiSelectFrameInnerColor',
  innerStyle: 'multiSelectFrameInnerStyle',
  innerWidth: 'multiSelectFrameInnerWidth',
  innerRadius: 'multiSelectFrameInnerRadius',
  innerFill: 'multiSelectFrameInnerFillOpacity',
} as const

/** 可选的线型下拉项（schema 与测试共用一处） */
export const FRAME_LINE_STYLE_OPTIONS = [
  { value: 'solid', label: '实线' },
  { value: 'dashed', label: '虚线' },
  { value: 'dotted', label: '点线' },
] as const

/** 默认值（对齐老版 multi-select 的视觉：外框灰虚线、内框浅蓝实线） */
export const DEFAULT_MULTI_SELECT_FRAME: MultiSelectFrameConfig = {
  paddingX: 16,
  paddingTop: 34,
  paddingBottom: 16,
  outer: { color: '#94a3b8', lineStyle: 'dashed', lineWidth: 1, radius: 6, fillOpacity: 0 },
  inner: { color: '#60a5fa', lineStyle: 'solid', lineWidth: 1, radius: 12, fillOpacity: 0.05 },
}

/** 插件可配置项 schema（模块级 Config，随插件导出 → 内核校验 + 补默认 + 登记设置页面） */
export const Config: ConfigSchema = {
  [MULTI_SELECT_FRAME_KEYS.paddingX]: {
    type: 'number',
    default: DEFAULT_MULTI_SELECT_FRAME.paddingX,
    min: 0,
    max: 200,
    step: 1,
    label: '群组框左右内缩',
    group: '布局/多选',
    description: '多选时那个"大框"比"小框"左右各宽多少像素。调大＝大框离节点更远。',
  },
  [MULTI_SELECT_FRAME_KEYS.paddingTop]: {
    type: 'number',
    default: DEFAULT_MULTI_SELECT_FRAME.paddingTop,
    min: 0,
    max: 200,
    step: 1,
    label: '群组框上方内缩',
    group: '布局/多选',
    description: '大框比小框往上多留多少像素，专门给节点上方的标题条让位置（默认 34，与老版一致）。',
  },
  [MULTI_SELECT_FRAME_KEYS.paddingBottom]: {
    type: 'number',
    default: DEFAULT_MULTI_SELECT_FRAME.paddingBottom,
    min: 0,
    max: 200,
    step: 1,
    label: '群组框下方内缩',
    group: '布局/多选',
    description: '大框比小框往下多留多少像素。',
  },
  [MULTI_SELECT_FRAME_KEYS.outerColor]: {
    type: 'color',
    default: DEFAULT_MULTI_SELECT_FRAME.outer.color,
    label: '外框颜色',
    group: '布局/多选',
    description: '多选时外面那个大框的颜色。',
  },
  [MULTI_SELECT_FRAME_KEYS.outerStyle]: {
    type: 'select',
    default: DEFAULT_MULTI_SELECT_FRAME.outer.lineStyle,
    label: '外框线型',
    group: '布局/多选',
    description: '外框是实线、虚线还是点线。',
    options: FRAME_LINE_STYLE_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
  },
  [MULTI_SELECT_FRAME_KEYS.outerWidth]: {
    type: 'number',
    default: DEFAULT_MULTI_SELECT_FRAME.outer.lineWidth,
    min: 0,
    max: 8,
    step: 0.5,
    label: '外框线宽',
    group: '布局/多选',
    description: '外框线条粗细（px）。0 = 只留内框。',
  },
  [MULTI_SELECT_FRAME_KEYS.outerRadius]: {
    type: 'number',
    default: DEFAULT_MULTI_SELECT_FRAME.outer.radius,
    min: 0,
    max: 40,
    step: 1,
    label: '外框圆角',
    group: '布局/多选',
    description: '外框四个角的圆角大小（px）。',
  },
  [MULTI_SELECT_FRAME_KEYS.outerFill]: {
    type: 'number',
    default: Math.round(DEFAULT_MULTI_SELECT_FRAME.outer.fillOpacity * 100),
    min: 0,
    max: 40,
    step: 1,
    label: '外框填充%',
    group: '布局/多选',
    description: '外框内部的填色浓度（%，0 = 完全透明）。',
  },
  [MULTI_SELECT_FRAME_KEYS.innerColor]: {
    type: 'color',
    default: DEFAULT_MULTI_SELECT_FRAME.inner.color,
    label: '内框颜色',
    group: '布局/多选',
    description: '多选时里面那个紧贴节点的小框的颜色。',
  },
  [MULTI_SELECT_FRAME_KEYS.innerStyle]: {
    type: 'select',
    default: DEFAULT_MULTI_SELECT_FRAME.inner.lineStyle,
    label: '内框线型',
    group: '布局/多选',
    description: '内框是实线、虚线还是点线。',
    options: FRAME_LINE_STYLE_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
  },
  [MULTI_SELECT_FRAME_KEYS.innerWidth]: {
    type: 'number',
    default: DEFAULT_MULTI_SELECT_FRAME.inner.lineWidth,
    min: 0,
    max: 8,
    step: 0.5,
    label: '内框线宽',
    group: '布局/多选',
    description: '内框线条粗细（px）。',
  },
  [MULTI_SELECT_FRAME_KEYS.innerRadius]: {
    type: 'number',
    default: DEFAULT_MULTI_SELECT_FRAME.inner.radius,
    min: 0,
    max: 40,
    step: 1,
    label: '内框圆角',
    group: '布局/多选',
    description: '内框四个角的圆角大小（px）。',
  },
  [MULTI_SELECT_FRAME_KEYS.innerFill]: {
    type: 'number',
    default: Math.round(DEFAULT_MULTI_SELECT_FRAME.inner.fillOpacity * 100),
    min: 0,
    max: 40,
    step: 1,
    label: '内框填充%',
    group: '布局/多选',
    description: '内框内部的填色浓度（%，0 = 完全透明）。',
  },
}

/** apply 收到的 config TS 类型（与 schema 对齐） */
export type MultiSelectConfig = InferConfig<typeof Config>

// ============================================================================
// 读取（纯函数，Node 可单测）
// ============================================================================

/** 取值器：给一个 key 拿当前值（读不到返回 undefined） */
export type ConfigGetter = (key: string) => unknown

function toNumber(value: unknown, fallback: number, min = 0): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min ? value : fallback
}

function toOpacity(value: unknown, fallback: number): number {
  const pct = toNumber(value, fallback * 100)
  return Math.min(Math.max(pct, 0), 100) / 100
}

function toLineStyle(value: unknown, fallback: FrameLineStyle): FrameLineStyle {
  return value === 'solid' || value === 'dashed' || value === 'dotted' ? value : fallback
}

/** hex 颜色校验（不合法回落默认，避免把 CSS 写坏） */
function toColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)
    ? value
    : fallback
}

/** 从配置读当前群组框外观（一项坏了只回落那一项，不影响其它项） */
export function resolveMultiSelectFrameConfig(get: ConfigGetter): MultiSelectFrameConfig {
  const d = DEFAULT_MULTI_SELECT_FRAME
  return {
    paddingX: toNumber(get(MULTI_SELECT_FRAME_KEYS.paddingX), d.paddingX),
    paddingTop: toNumber(get(MULTI_SELECT_FRAME_KEYS.paddingTop), d.paddingTop),
    paddingBottom: toNumber(get(MULTI_SELECT_FRAME_KEYS.paddingBottom), d.paddingBottom),
    outer: {
      color: toColor(get(MULTI_SELECT_FRAME_KEYS.outerColor), d.outer.color),
      lineStyle: toLineStyle(get(MULTI_SELECT_FRAME_KEYS.outerStyle), d.outer.lineStyle),
      lineWidth: toNumber(get(MULTI_SELECT_FRAME_KEYS.outerWidth), d.outer.lineWidth, 0),
      radius: toNumber(get(MULTI_SELECT_FRAME_KEYS.outerRadius), d.outer.radius),
      fillOpacity: toOpacity(get(MULTI_SELECT_FRAME_KEYS.outerFill), d.outer.fillOpacity),
    },
    inner: {
      color: toColor(get(MULTI_SELECT_FRAME_KEYS.innerColor), d.inner.color),
      lineStyle: toLineStyle(get(MULTI_SELECT_FRAME_KEYS.innerStyle), d.inner.lineStyle),
      lineWidth: toNumber(get(MULTI_SELECT_FRAME_KEYS.innerWidth), d.inner.lineWidth, 0),
      radius: toNumber(get(MULTI_SELECT_FRAME_KEYS.innerRadius), d.inner.radius),
      fillOpacity: toOpacity(get(MULTI_SELECT_FRAME_KEYS.innerFill), d.inner.fillOpacity),
    },
  }
}

/**
 * 应用"某一项配置被改动"（订阅回调里唯一那点逻辑，纯函数）。
 * 只认识的键才动；别的键（其它插件的配置）原样返回**同一引用** —— 不触发无谓重渲染。
 */
export function applyMultiSelectFrameChange(
  current: MultiSelectFrameConfig,
  key: string,
  value: unknown,
): MultiSelectFrameConfig {
  switch (key) {
    case MULTI_SELECT_FRAME_KEYS.paddingX:
      return { ...current, paddingX: toNumber(value, DEFAULT_MULTI_SELECT_FRAME.paddingX) }
    case MULTI_SELECT_FRAME_KEYS.paddingTop:
      return { ...current, paddingTop: toNumber(value, DEFAULT_MULTI_SELECT_FRAME.paddingTop) }
    case MULTI_SELECT_FRAME_KEYS.paddingBottom:
      return { ...current, paddingBottom: toNumber(value, DEFAULT_MULTI_SELECT_FRAME.paddingBottom) }
    case MULTI_SELECT_FRAME_KEYS.outerColor:
      return { ...current, outer: { ...current.outer, color: toColor(value, current.outer.color) } }
    case MULTI_SELECT_FRAME_KEYS.outerStyle:
      return { ...current, outer: { ...current.outer, lineStyle: toLineStyle(value, current.outer.lineStyle) } }
    case MULTI_SELECT_FRAME_KEYS.outerWidth:
      return { ...current, outer: { ...current.outer, lineWidth: toNumber(value, current.outer.lineWidth, 0) } }
    case MULTI_SELECT_FRAME_KEYS.outerRadius:
      return { ...current, outer: { ...current.outer, radius: toNumber(value, current.outer.radius) } }
    case MULTI_SELECT_FRAME_KEYS.outerFill:
      return { ...current, outer: { ...current.outer, fillOpacity: toOpacity(value, current.outer.fillOpacity) } }
    case MULTI_SELECT_FRAME_KEYS.innerColor:
      return { ...current, inner: { ...current.inner, color: toColor(value, current.inner.color) } }
    case MULTI_SELECT_FRAME_KEYS.innerStyle:
      return { ...current, inner: { ...current.inner, lineStyle: toLineStyle(value, current.inner.lineStyle) } }
    case MULTI_SELECT_FRAME_KEYS.innerWidth:
      return { ...current, inner: { ...current.inner, lineWidth: toNumber(value, current.inner.lineWidth, 0) } }
    case MULTI_SELECT_FRAME_KEYS.innerRadius:
      return { ...current, inner: { ...current.inner, radius: toNumber(value, current.inner.radius) } }
    case MULTI_SELECT_FRAME_KEYS.innerFill:
      return { ...current, inner: { ...current.inner, fillOpacity: toOpacity(value, current.inner.fillOpacity) } }
    default:
      return current
  }
}

// ============================================================================
// CSS 生成（纯函数，Node 可单测）
// ============================================================================

/** hex(#rgb / #rrggbb) → rgba()；解析不出来时回落成"透明"，绝不写出坏值 */
export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex)
  if (!m) return 'transparent'
  let body = m[1]
  if (body.length === 3) body = body[0] + body[0] + body[1] + body[1] + body[2] + body[2]
  const r = parseInt(body.slice(0, 2), 16)
  const g = parseInt(body.slice(2, 4), 16)
  const b = parseInt(body.slice(4, 6), 16)
  const a = Math.min(Math.max(alpha, 0), 1)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

/**
 * 把一个框样式转成 CSS 声明（色彩 / 线型 / 线宽 / 圆角 / 填充）。
 * @param lineScale 线宽缩放：外框要反向缩放（1/zoom）让线看起来始终一样粗，内框传 1。
 */
export function frameStrokeCss(
  stroke: FrameStrokeStyle,
  lineScale = 1,
): Record<string, string> {
  return {
    borderColor: stroke.color,
    borderStyle: stroke.lineStyle,
    borderWidth: `${stroke.lineWidth * lineScale}px`,
    borderRadius: `${stroke.radius * lineScale}px`,
    background: stroke.fillOpacity > 0 ? hexToRgba(stroke.color, stroke.fillOpacity) : 'transparent',
  }
}
