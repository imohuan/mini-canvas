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

/**
 * 三个框的颜色配置（挂「常规/主题配色」与「常规/暗色主题配色」，与其它主题色同层）。
 *
 * 为什么在这里声明而不是进 canvas-render 的色板：这些颜色**属于多选插件**——插件卸载后
 * 这几格配置也该一起消失（用户实测报过"卸载了多选，颜色还留在主题配色里"）。declareConfig
 * 的清理函数随插件 fiber 回收，正好实现这一点。
 *
 * 颜色语义（用户口径）：**可选**；清空 = 回落主题强调色（--ui-accent）。
 */
export const MULTI_SELECT_COLOR_KEYS = {
  boxLight: 'multiSelectBoxColorLight',
  boxDark: 'multiSelectBoxColorDark',
  outerLight: 'multiSelectFrameOuterColorLight',
  outerDark: 'multiSelectFrameOuterColorDark',
  innerLight: 'multiSelectFrameInnerColorLight',
  innerDark: 'multiSelectFrameInnerColorDark',
} as const

/** 一个框的描边样式 */
export interface FrameStrokeStyle {
  /**
   * 线色（hex）—— **可缺省**。缺省 = 用主题配色里的对应 token（见 themePalette）。
   *
   * 用户口径："颜色支持删除，删除之后默认使用主题颜色；只有当该颜色存在时才用它。"
   * 所以这里不是"必填 + 有默认值"，而是"可为空"：空 → 由 CSS 变量（--ui-guide / --ui-accent…）兜。
   */
  color?: string
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
  /** 是否显示群组框（总开关；关掉 = 多选时不画这两个框） */
  enabled: boolean
  /** 多选时是否隐藏被选中节点的标题条（标题常显会与群组框的"上方间距"互相打架） */
  hideTitles: boolean
  /** 两框间距：外框内缘到内框外缘的左右距离（px） */
  paddingX: number
  /** 两框间距：上方（多留一点给卡片上方的标题条） */
  paddingTop: number
  /** 两框间距：下方 */
  paddingBottom: number
  /** 内框相对「选中节点并集」的外扩量：左右（px）。默认 0 = 紧贴节点 */
  innerPaddingX: number
  /** 内框相对节点并集的外扩量：上（px） */
  innerPaddingTop: number
  /** 内框相对节点并集的外扩量：下（px） */
  innerPaddingBottom: number
  /** 外框（大框）样式：整组拖动的把手 */
  outer: FrameStrokeStyle
  /** 内框（小框）样式：紧贴节点并集 */
  inner: FrameStrokeStyle
  /**
   * **绘制框**（Shift 拖拽时那个随鼠标画出来的框）的样式。
   *
   * 概念区分（用户口径）：拖拽时画出来的叫**绘制框**；选中之后围着节点出现的那两条线叫**多选框**。
   * 颜色不在这里 —— 它跟多选框一样走主题配色（见 themePalette 的三个颜色 token），
   * 于是"删掉自定义色 → 回落主题色"这一套对三个框一致生效。
   */
  boxSelect: BoxSelectStyle
}

/** 绘制框的样式（color 可空 = 回落主题 token --ui-select-box，与内外框同语义） */
export interface BoxSelectStyle {
  /**
   * 线色（hex）—— 可缺省。缺省 = 主题配色里的绘制框色（--ui-select-box → --ui-accent 兜底）。
   * 用户口径："清空 = 跟随主题"，与内框/外框的 color 一致。
   */
  color?: string
  lineStyle: FrameLineStyle
  lineWidth: number
  fillOpacity: number
}

/**
 * 配置键。
 *
 * settings 的 key 是**全局平面命名**、先声明者独占，撞名会被内核静默跳过（开关形同虚设），
 * 故一律加 `multiSelectFrame` 前缀 —— 不要用裸 `paddingX`/`color` 这类通用词。
 */
export const MULTI_SELECT_FRAME_KEYS = {
  enabled: 'multiSelectFrameEnabled',
  hideTitles: 'multiSelectHideTitles',
  paddingX: 'multiSelectFramePaddingX',
  paddingTop: 'multiSelectFramePaddingTop',
  paddingBottom: 'multiSelectFramePaddingBottom',
  innerPaddingX: 'multiSelectFrameInnerPaddingX',
  innerPaddingTop: 'multiSelectFrameInnerPaddingTop',
  innerPaddingBottom: 'multiSelectFrameInnerPaddingBottom',
  outerStyle: 'multiSelectFrameOuterStyle',
  outerWidth: 'multiSelectFrameOuterWidth',
  outerRadius: 'multiSelectFrameOuterRadius',
  outerFill: 'multiSelectFrameOuterFillOpacity',
  innerStyle: 'multiSelectFrameInnerStyle',
  innerWidth: 'multiSelectFrameInnerWidth',
  innerRadius: 'multiSelectFrameInnerRadius',
  innerFill: 'multiSelectFrameInnerFillOpacity',
  // —— 绘制框（Shift 拖拽时画的那个框）——
  boxStyle: 'multiSelectBoxStyle',
  boxWidth: 'multiSelectBoxWidth',
  boxFill: 'multiSelectBoxFillOpacity',
  // 颜色键（optional：可清除，清空 = 走主题强调色）。**声明在 Config 的主题配色组里**（见下方 schema），
  // 由本插件申报、随插件卸载一起消失；读取仍用这些 key。
  outerColor: 'multiSelectFrameOuterColor',
  innerColor: 'multiSelectFrameInnerColor',
} as const

/** 可选的线型下拉项（schema 与测试共用一处） */
export const FRAME_LINE_STYLE_OPTIONS = [
  { value: 'solid', label: '实线' },
  { value: 'dashed', label: '虚线' },
  { value: 'dotted', label: '点线' },
] as const

/** 默认值（对齐老版 multi-select 的视觉：外框灰虚线、内框浅蓝实线） */
export const DEFAULT_MULTI_SELECT_FRAME: MultiSelectFrameConfig = {
  enabled: true,
  hideTitles: false,
  paddingX: 16,
  paddingTop: 34,
  paddingBottom: 16,
  // 内框默认紧贴节点并集（全 0）：与老版、与本插件早先版本一致，改成别的值即"内框向外扩"
  innerPaddingX: 0,
  innerPaddingTop: 0,
  innerPaddingBottom: 0,
  // 颜色默认**留空** = 走主题配色（用户在「常规/主题配色」里改；这是用户要求的"删掉自定义色就用主题色"）。
  // 想要固定色就自己在设置里选一个。
  outer: { lineStyle: 'dashed', lineWidth: 1, radius: 6, fillOpacity: 0 },
  // 内框默认 0 = 直角：它要"紧贴选中节点的并集"，而节点并集是个正矩形，
  // 给它加圆角只会让四条边在角上提前弯掉、看起来没贴住（用户明确要求去掉这个圆角）。
  inner: { lineStyle: 'solid', lineWidth: 1, radius: 0, fillOpacity: 0.05 },
  // 绘制框：颜色走主题，样式默认实线 + 一点点底
  boxSelect: { color: undefined, lineStyle: 'solid', lineWidth: 1.5, fillOpacity: 0.16 },
}

/** 插件可配置项 schema（模块级 Config，随插件导出 → 内核校验 + 补默认 + 登记设置页面） */
export const Config: ConfigSchema = {
  [MULTI_SELECT_FRAME_KEYS.enabled]: {
    type: 'boolean',
    default: DEFAULT_MULTI_SELECT_FRAME.enabled,
    label: '显示群组框',
    group: '布局/多选',
    description: '多选时是否画出那两个框（大框 + 小框）。关掉只是不画框，多选本身照常可用。',
  },
  [MULTI_SELECT_FRAME_KEYS.hideTitles]: {
    type: 'boolean',
    default: DEFAULT_MULTI_SELECT_FRAME.hideTitles,
    label: '多选时隐藏节点标题',
    group: '布局/多选',
    description:
      '多选时把被选中节点的标题条藏起来（列表更干净；关掉则标题常显）。关掉后若想让大框仍兜住标题，把「两框间距（上）」适当调大。',
  },
  [MULTI_SELECT_FRAME_KEYS.paddingX]: {
    type: 'number',
    default: DEFAULT_MULTI_SELECT_FRAME.paddingX,
    min: 0,
    max: 200,
    step: 1,
    label: '两框间距（左右）',
    group: '布局/多选',
    description: '大框（外）与小框（内）之间左右各留多少像素。调大＝两框离得更开。',
  },
  [MULTI_SELECT_FRAME_KEYS.paddingTop]: {
    type: 'number',
    default: DEFAULT_MULTI_SELECT_FRAME.paddingTop,
    min: 0,
    max: 200,
    step: 1,
    label: '两框间距（上）',
    group: '布局/多选',
    description: '大框比小框往上多留多少像素。默认 34（与老版一致），正好把卡片上方的标题条兜进大框。',
  },
  [MULTI_SELECT_FRAME_KEYS.paddingBottom]: {
    type: 'number',
    default: DEFAULT_MULTI_SELECT_FRAME.paddingBottom,
    min: 0,
    max: 200,
    step: 1,
    label: '两框间距（下）',
    group: '布局/多选',
    description: '大框比小框往下多留多少像素。',
  },
  // —— 小框（内框）相对「选中节点并集」的外扩量：默认 0 = 紧贴节点 ——
  [MULTI_SELECT_FRAME_KEYS.innerPaddingX]: {
    type: 'number',
    default: DEFAULT_MULTI_SELECT_FRAME.innerPaddingX,
    min: 0,
    max: 200,
    step: 1,
    label: '小框左右外扩',
    group: '布局/多选',
    description:
      '小框比"选中节点的最外沿"左右各向外扩多少像素。默认 0 = 严丝合缝贴住节点。',
  },
  [MULTI_SELECT_FRAME_KEYS.innerPaddingTop]: {
    type: 'number',
    default: DEFAULT_MULTI_SELECT_FRAME.innerPaddingTop,
    min: 0,
    max: 200,
    step: 1,
    label: '小框上方外扩',
    group: '布局/多选',
    description: '小框比节点上沿再往上扩多少像素。默认 0（不含标题）。',
  },
  [MULTI_SELECT_FRAME_KEYS.innerPaddingBottom]: {
    type: 'number',
    default: DEFAULT_MULTI_SELECT_FRAME.innerPaddingBottom,
    min: 0,
    max: 200,
    step: 1,
    label: '小框下方外扩',
    group: '布局/多选',
    description: '小框比节点下沿再往下扩多少像素。默认 0。',
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
    description: '内框四个角的圆角大小（px）。默认 0 = 直角，让框严丝合缝贴住节点并集。',
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
  // —— 绘制框（Shift 拖拽时随鼠标画出来的那个框）——
  [MULTI_SELECT_FRAME_KEYS.boxStyle]: {
    type: 'select',
    default: DEFAULT_MULTI_SELECT_FRAME.boxSelect.lineStyle,
    label: '绘制框线型',
    group: '布局/多选',
    description: 'Shift 拖拽时画出来的那个框，是实线、虚线还是点线。',
    options: FRAME_LINE_STYLE_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
  },
  [MULTI_SELECT_FRAME_KEYS.boxWidth]: {
    type: 'number',
    default: DEFAULT_MULTI_SELECT_FRAME.boxSelect.lineWidth,
    min: 1,
    max: 8,
    step: 0.5,
    label: '绘制框线宽',
    group: '布局/多选',
    description: '绘制框线条粗细（px）。',
  },
  [MULTI_SELECT_FRAME_KEYS.boxFill]: {
    type: 'number',
    default: Math.round(DEFAULT_MULTI_SELECT_FRAME.boxSelect.fillOpacity * 100),
    min: 0,
    max: 40,
    step: 1,
    label: '绘制框填充%',
    group: '布局/多选',
    description: '绘制框内部的填色浓度（%，0 = 完全透明）。想让框选时的背景完全透明就调到 0。',
  },
  // ====== 三个框的颜色：optional（可清空 = 跟随主题强调色），挂主题配色两格制 ======
  // 由本插件申报 → 插件卸载时这几格跟着消失（用户要求：卸载多选后主题配色里不再留它们）。
  [MULTI_SELECT_COLOR_KEYS.boxLight]: {
    type: 'color',
    default: '',
    label: '绘制框颜色',
    group: '常规/主题配色',
    optional: true,
    description: 'Shift 拖拽框选时随鼠标画出来的框（绘制框）的描边颜色。清空 = 跟随主题强调色。',
  },
  [MULTI_SELECT_COLOR_KEYS.boxDark]: {
    type: 'color',
    default: '',
    label: '绘制框颜色',
    group: '常规/暗色主题配色',
    optional: true,
    description: '暗色主题下的绘制框描边颜色。清空 = 跟随主题强调色。',
  },
  [MULTI_SELECT_COLOR_KEYS.outerLight]: {
    type: 'color',
    default: '',
    label: '多选框-外框颜色',
    group: '常规/主题配色',
    optional: true,
    description: '选中多个节点后，外面那圈较大的框（多选框-外框）的颜色。清空 = 跟随主题强调色。',
  },
  [MULTI_SELECT_COLOR_KEYS.outerDark]: {
    type: 'color',
    default: '',
    label: '多选框-外框颜色',
    group: '常规/暗色主题配色',
    optional: true,
    description: '暗色主题下的多选框-外框颜色。清空 = 跟随主题强调色。',
  },
  [MULTI_SELECT_COLOR_KEYS.innerLight]: {
    type: 'color',
    default: '',
    label: '多选框-内框颜色',
    group: '常规/主题配色',
    optional: true,
    description: '选中多个节点后，紧贴节点那圈较小的框（多选框-内框）的颜色。清空 = 跟随主题强调色。',
  },
  [MULTI_SELECT_COLOR_KEYS.innerDark]: {
    type: 'color',
    default: '',
    label: '多选框-内框颜色',
    group: '常规/暗色主题配色',
    optional: true,
    description: '暗色主题下的多选框-内框颜色。清空 = 跟随主题强调色。',
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

/** 布尔取值（非布尔回落默认，避免半套脏值把开关误判成 false） */
function toBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * hex 颜色取值：**空值一律返回 undefined**（= 用主题色），非法值也回落 undefined。
 *
 * 用户口径："颜色支持删除，删除之后默认使用主题颜色；只有该颜色存在时才用它。"
 * 所以这里不再有"缺省 hex 兜底"，而是"没有 → undefined → 消费方走 CSS 变量"。
 */
function toOptionalColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const v = value.trim()
  if (!v) return undefined
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v) ? v : undefined
}

/**
 * 从配置读当前群组框外观（一项坏了只回落那一项，不影响其它项）。
 *
 * @param get 配置取值器
 * @param mode 当前主题模式（亮/暗）：三个框的**颜色**是两格制的（亮色格 / 暗色格各一个 key），
 *   按当前主题挑那一格；线型/线宽等几何项不分主题。
 */
export function resolveMultiSelectFrameConfig(
  get: ConfigGetter,
  mode: 'light' | 'dark' = 'light',
): MultiSelectFrameConfig {
  const d = DEFAULT_MULTI_SELECT_FRAME
  return {
    enabled: toBool(get(MULTI_SELECT_FRAME_KEYS.enabled), d.enabled),
    hideTitles: toBool(get(MULTI_SELECT_FRAME_KEYS.hideTitles), d.hideTitles),
    paddingX: toNumber(get(MULTI_SELECT_FRAME_KEYS.paddingX), d.paddingX),
    paddingTop: toNumber(get(MULTI_SELECT_FRAME_KEYS.paddingTop), d.paddingTop),
    paddingBottom: toNumber(get(MULTI_SELECT_FRAME_KEYS.paddingBottom), d.paddingBottom),
    innerPaddingX: toNumber(get(MULTI_SELECT_FRAME_KEYS.innerPaddingX), d.innerPaddingX),
    innerPaddingTop: toNumber(get(MULTI_SELECT_FRAME_KEYS.innerPaddingTop), d.innerPaddingTop),
    innerPaddingBottom: toNumber(get(MULTI_SELECT_FRAME_KEYS.innerPaddingBottom), d.innerPaddingBottom),
    outer: {
      color: toOptionalColor(get(mode === 'dark' ? MULTI_SELECT_COLOR_KEYS.outerDark : MULTI_SELECT_COLOR_KEYS.outerLight)),
      lineStyle: toLineStyle(get(MULTI_SELECT_FRAME_KEYS.outerStyle), d.outer.lineStyle),
      lineWidth: toNumber(get(MULTI_SELECT_FRAME_KEYS.outerWidth), d.outer.lineWidth, 0),
      radius: toNumber(get(MULTI_SELECT_FRAME_KEYS.outerRadius), d.outer.radius),
      fillOpacity: toOpacity(get(MULTI_SELECT_FRAME_KEYS.outerFill), d.outer.fillOpacity),
    },
    inner: {
      color: toOptionalColor(get(mode === 'dark' ? MULTI_SELECT_COLOR_KEYS.innerDark : MULTI_SELECT_COLOR_KEYS.innerLight)),
      lineStyle: toLineStyle(get(MULTI_SELECT_FRAME_KEYS.innerStyle), d.inner.lineStyle),
      lineWidth: toNumber(get(MULTI_SELECT_FRAME_KEYS.innerWidth), d.inner.lineWidth, 0),
      radius: toNumber(get(MULTI_SELECT_FRAME_KEYS.innerRadius), d.inner.radius),
      fillOpacity: toOpacity(get(MULTI_SELECT_FRAME_KEYS.innerFill), d.inner.fillOpacity),
    },
    boxSelect: {
      color: toOptionalColor(get(mode === 'dark' ? MULTI_SELECT_COLOR_KEYS.boxDark : MULTI_SELECT_COLOR_KEYS.boxLight)),
      lineStyle: toLineStyle(get(MULTI_SELECT_FRAME_KEYS.boxStyle), d.boxSelect.lineStyle),
      lineWidth: toNumber(get(MULTI_SELECT_FRAME_KEYS.boxWidth), d.boxSelect.lineWidth, 0),
      fillOpacity: toOpacity(get(MULTI_SELECT_FRAME_KEYS.boxFill), d.boxSelect.fillOpacity),
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
    case MULTI_SELECT_FRAME_KEYS.enabled:
      return { ...current, enabled: toBool(value, DEFAULT_MULTI_SELECT_FRAME.enabled) }
    case MULTI_SELECT_FRAME_KEYS.hideTitles:
      return { ...current, hideTitles: toBool(value, DEFAULT_MULTI_SELECT_FRAME.hideTitles) }
    case MULTI_SELECT_FRAME_KEYS.paddingX:
      return { ...current, paddingX: toNumber(value, DEFAULT_MULTI_SELECT_FRAME.paddingX) }
    case MULTI_SELECT_FRAME_KEYS.paddingTop:
      return { ...current, paddingTop: toNumber(value, DEFAULT_MULTI_SELECT_FRAME.paddingTop) }
    case MULTI_SELECT_FRAME_KEYS.paddingBottom:
      return { ...current, paddingBottom: toNumber(value, DEFAULT_MULTI_SELECT_FRAME.paddingBottom) }
    case MULTI_SELECT_FRAME_KEYS.innerPaddingX:
      return { ...current, innerPaddingX: toNumber(value, DEFAULT_MULTI_SELECT_FRAME.innerPaddingX) }
    case MULTI_SELECT_FRAME_KEYS.innerPaddingTop:
      return { ...current, innerPaddingTop: toNumber(value, DEFAULT_MULTI_SELECT_FRAME.innerPaddingTop) }
    case MULTI_SELECT_FRAME_KEYS.innerPaddingBottom:
      return { ...current, innerPaddingBottom: toNumber(value, DEFAULT_MULTI_SELECT_FRAME.innerPaddingBottom) }
    case MULTI_SELECT_FRAME_KEYS.outerStyle:
      return { ...current, outer: { ...current.outer, lineStyle: toLineStyle(value, current.outer.lineStyle) } }
    case MULTI_SELECT_FRAME_KEYS.outerWidth:
      return { ...current, outer: { ...current.outer, lineWidth: toNumber(value, current.outer.lineWidth, 0) } }
    case MULTI_SELECT_FRAME_KEYS.outerRadius:
      return { ...current, outer: { ...current.outer, radius: toNumber(value, current.outer.radius) } }
    case MULTI_SELECT_FRAME_KEYS.outerFill:
      return { ...current, outer: { ...current.outer, fillOpacity: toOpacity(value, current.outer.fillOpacity) } }
    case MULTI_SELECT_FRAME_KEYS.innerStyle:
      return { ...current, inner: { ...current.inner, lineStyle: toLineStyle(value, current.inner.lineStyle) } }
    case MULTI_SELECT_FRAME_KEYS.innerWidth:
      return { ...current, inner: { ...current.inner, lineWidth: toNumber(value, current.inner.lineWidth, 0) } }
    case MULTI_SELECT_FRAME_KEYS.innerRadius:
      return { ...current, inner: { ...current.inner, radius: toNumber(value, current.inner.radius) } }
    case MULTI_SELECT_FRAME_KEYS.innerFill:
      return { ...current, inner: { ...current.inner, fillOpacity: toOpacity(value, current.inner.fillOpacity) } }
    case MULTI_SELECT_FRAME_KEYS.boxStyle:
      return { ...current, boxSelect: { ...current.boxSelect, lineStyle: toLineStyle(value, current.boxSelect.lineStyle) } }
    case MULTI_SELECT_FRAME_KEYS.boxWidth:
      return { ...current, boxSelect: { ...current.boxSelect, lineWidth: toNumber(value, current.boxSelect.lineWidth, 0) } }
    case MULTI_SELECT_FRAME_KEYS.boxFill:
      return { ...current, boxSelect: { ...current.boxSelect, fillOpacity: toOpacity(value, current.boxSelect.fillOpacity) } }
    case MULTI_SELECT_COLOR_KEYS.boxLight:
    case MULTI_SELECT_COLOR_KEYS.boxDark:
      // 颜色是 optional：空串合法（= 跟随主题），非空须为合法 hex
      return { ...current, boxSelect: { ...current.boxSelect } }
    case MULTI_SELECT_COLOR_KEYS.outerLight:
    case MULTI_SELECT_COLOR_KEYS.outerDark:
      return { ...current, outer: { ...current.outer } }
    case MULTI_SELECT_COLOR_KEYS.innerLight:
    case MULTI_SELECT_COLOR_KEYS.innerDark:
      return { ...current, inner: { ...current.inner } }
    default:
      return current
  }
}

// ============================================================================
// CSS 生成（纯函数，Node 可单测）
// ============================================================================

/** 两框各自的 padding 取值（交给 engine 的几何函数用） */
export interface FramePaddings {
  /** 内框相对节点并集的外扩量 */
  inner: { paddingX: number; paddingTop: number; paddingBottom: number }
  /** 外框相对内框的间距 */
  gap: { paddingX: number; paddingTop: number; paddingBottom: number }
}

/**
 * 把一份外观配置拆成几何用的两组 padding。
 * 组件只调这一个函数，免得在模板/计算里手抄六个字段（抄错一个就静默错位）。
 */
export function framePaddingsOf(cfg: MultiSelectFrameConfig): FramePaddings {
  return {
    inner: {
      paddingX: cfg.innerPaddingX,
      paddingTop: cfg.innerPaddingTop,
      paddingBottom: cfg.innerPaddingBottom,
    },
    gap: {
      paddingX: cfg.paddingX,
      paddingTop: cfg.paddingTop,
      paddingBottom: cfg.paddingBottom,
    },
  }
}

/**
 * 选框间距的取值：**跟随画布一起缩放**（用户明确要求）。
 *
 * 语义：配置里的 padding 是**画布(flow)单位**，与节点尺寸同域 —— 缩画布时选框连同它的
 * 内边距一起变大变小，和节点卡片本身完全一致。
 *
 * 历史（别再改回去）：早先这里按 1/zoom 把它换算成"屏幕上恒定"（反缩放），因为那时**线宽**
 * 是反缩放的、间距不反缩放会让线在缩小时糊在一起。现在线宽也改回跟随画布（见 frameStrokeCss），
 * 两者同域，1/zoom 反而会让间距与线宽**反过来**对不上（缩小时间距变大、线变细），所以必须去掉。
 *
 * 保留这个函数（而不是删掉、把调用点直接换成恒等）：它是"间距怎么随缩放变"的唯一接缝，
 * 以后要再引入别的策略只改这一处；也便于单测直接锁住"跟随画布"这条语义。
 *
 * @param zoom 当前缩放（本函数不再据此换算；保留形参是为了调用点与语义接缝保持稳定）
 */
export function scaleFramePaddings(pads: FramePaddings, zoom: number): FramePaddings {
  void zoom // 跟随画布 = 不做任何换算；形参留着是接缝约定（见上方说明）
  return pads
}

/** hex(#rgb / #rgba / #rrggbb / #rrggbbaa) → rgba()；解析不出来时回落成"透明"，绝不写出坏值 */
export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(hex)
  if (!m) return 'transparent'
  let body = m[1]
  if (body.length === 3 || body.length === 4) {
    body = body.split('').map((c) => c + c).join('')
  }
  const r = parseInt(body.slice(0, 2), 16)
  const g = parseInt(body.slice(2, 4), 16)
  const b = parseInt(body.slice(4, 6), 16)
  const embeddedAlpha = body.length === 8 ? parseInt(body.slice(6, 8), 16) / 255 : 1
  const requestedAlpha = Number.isFinite(alpha) ? Math.min(Math.max(alpha, 0), 1) : 0
  const a = embeddedAlpha * requestedAlpha
  return `rgba(${r}, ${g}, ${b}, ${a})` // 主题色白名单: 从配置色运行时生成的 rgba 字符串（非写死外观；色值来自上方 hex 参数）
}

/**
 * 把一个框样式转成 CSS 声明（色彩 / 线型 / 线宽 / 圆角 / 填充）。
 *
 * 线宽 / 圆角**跟随画布一起缩放**（用户明确要求）：配置值是画布(flow)单位，与节点卡片边框
 * 同一套约定（卡片边框也是 flow 单位、随画布缩放；见 theme-default 的 cardFrame）。
 * 所以这里**不再**乘 1/zoom —— 缩小时选框的线会跟着变细，而非屏幕上恒粗。
 *
 * @param lineScale 线宽/圆角倍数（保留形参：调用方若确需另做反缩放可显式传入；默认 1 = 跟随画布）
 */
export function frameStrokeCss(
  stroke: FrameStrokeStyle,
  lineScale = 1,
  /** 颜色缺省时用哪个 CSS 变量（默认 --ui-guide；外框传 --ui-select-outer、内框传 --ui-select-inner） */
  fallbackVar = 'var(--ui-guide, #3b82f6)',
): Record<string, string> {
  // 颜色缺省（用户删掉了自定义色）→ 交给传入的 CSS 变量（--ui-guide），设置面板里删掉即回主题色。
  // fillOpacity > 0 时用 color-mix 从同一个色现算底色 —— 两种来源（自定义 hex / 主题变量）都适用，
  // 不必再手写 rgba（hexToRgba 只认 hex，喂 CSS 变量会写坏值）。
  const color = stroke.color ?? fallbackVar
  return {
    borderColor: color,
    borderStyle: stroke.lineStyle,
    borderWidth: `${stroke.lineWidth * lineScale}px`,
    borderRadius: `${stroke.radius * lineScale}px`,
    background: stroke.fillOpacity > 0 ? `color-mix(in srgb, ${color} ${stroke.fillOpacity * 100}%, transparent)` : 'transparent',
  }
}
