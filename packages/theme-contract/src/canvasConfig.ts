/**
 * plugin-theme-canvas 的 config schema：节点壳 / 端口 / 标题 / 吸附带 / 连线。
 *
 * 纯数据（零 .vue）：拆包前与 themeComponents 共用一份 themeConfig.ts，
 * 拆分后画布那边的键住在这里，组件那边的键住 appearanceConfig.ts。
 * 字段名、默认值、分组文案原样沿用，设置面板里看到的东西不变。
 */
import type { ConfigSchema } from "@plume-canvas/canvas-base";
import { NODE_LOADING_TIER_PREFIX, nodeLoadingTierFields } from "./nodeLoadingTier";
import {
  MULTI_RADIO_KEYS,
  MULTI_RADIO_SIZE_MAX,
  MULTI_RADIO_SIZE_MIN,
  DEFAULT_MULTI_RADIO,
} from "./multiRadio";
// 默认皮对应的连线外观默认值（作为本插件 config schema 的默认/单一数据源初始值）。
// 视觉语言（参考 docs/reference/bezier-glow-flow-line）：导轨细线 + 青色渐变光斑沿连线流动。
//
// **连线颜色（导轨 / 流光）不在这里**：它们已上移进渲染层主题色板
//（`@plume-canvas/canvas-render` 的 themePalette：`edgeRailColor` / `edgeFlowColor`，
// 各带亮/暗两格）。理由：颜色必须"一套主题一个值"，而本插件的 Config 字段是单值 ——
// 留着它就会永远盖住色板（登记过就有值 → CustomEdge 拿到后不再回落色板），
// 于是用户改了主题色也看不到变化。其它非颜色的边外观（线宽/虚线/光斑参数）仍留在此处。
export const DEFAULT_THEME_EDGE = {
  edgeType: "adaptive",
  edgeLineWidth: 1.5,
  edgeDashed: false,
  edgeMarkerEnd: false,
  edgeMarkerSize: 8,
  edgeGlowEnabled: true,
  edgeGlowIntensity: 1,
  edgeVisible: true,
  edgeVisibleOnSelect: false,
  edgeOnTop: false,
  // —— 连线新视觉（导轨 + 色块流动）——
  edgeFlowEnabled: true,
  edgeFlowCount: 3,
  edgeFlowRatio: 20,
  edgeFlowSpeed: 1,
  edgeFlowFade: 35,
  edgeFlowIntensity: 0.9,
  // 正交避障：节点矩形外扩边距 / 拐角圆角
  edgeAvoidMargin: 18,
  edgeAvoidRadius: 8,
  edgeAvoidClearance: 6,
} as const;

/**
 * 浮动端口(half)外观默认值（**T10 决策：这是全仓唯一权威默认**）。
 *
 * canvas-render 的 DEFAULT_HANDLE_VISUAL 已对齐到这里的 10/0.55/0.8（此前宿主回落是
 * 86/0.8/1，与主题双源漂移 —— 核心节点契约 §9-1）。两边一致后，"装不装主题插件"
 * 不再影响端口几何。本值即成品应用一直以来的实际观感。
 */
export const DEFAULT_THEME_HANDLE = {
  handleRestOffset: 36,
  handleCursorGap: 24,
  handleButtonSize: 32,
  portZoneWidth: 10, // 端口吸附交互区/半圆耳朵水平外扩（T10：权威默认；0 会让端口区塌成不可命中）
  portZoneHeightRatio: 0.55,
  portZoneOffset: 0,
  portZoneShape: "arc",
  portZoneArcRatio: 0.8,
} as const;

/** 调试可视化开关默认值（对齐 canvasHostCore DEFAULT_DEBUG_VISUAL；作为本插件 config 的初始值） */
export const DEFAULT_THEME_DEBUG = {
  handleDebug: false,
  connectionSnapDebugVisible: false,
  slotDebug: false,
  uiKitDebug: false,
} as const;

/**
 * 外观默认值：交接给组件库的形状 / 字体。
 * 全部取「跟随项目原有值」，装上新版本看不出变化，只有用户主动改才生效。
 */
export const DEFAULT_THEME_APPEARANCE = {
  themeRadius: "default",
  themeFont: "inherit",
  themeHeadingFont: "inherit",
  themeSize: "inherit",
} as const;

/**
 * 节点标题外观默认值（对齐 v1 core 的 nodeTitleOffset / nodeTitleScaleMinZoom，见 useCanvasStore）。
 * nodeShell BaseNode 的浮标题（卡片上缘外、反向缩放）读这两项；位置偏移 = 标题底部到节点顶部的基础
 * 屏幕间距，缩放阈值 = 低于该 zoom 后标题与卡片一起反缩放收缩的下限。作为本插件 config 的初始值。
 */
export const DEFAULT_THEME_TITLE = {
  titleOffset: 12,
  titleScaleMinZoom: 0.5,
  /**
   * 是否显示节点标题条（节点上缘外那条浮标题）。
   * 关掉 = 整块标题不画（标题文字、类型图标、标题右侧附加文本一起收起），
   * 画面更干净（图片/视频这类"内容即全部"的节点常用）。
   * 缺省 true：与历史行为逐字一致 —— 没碰过这个开关的用户看不出任何变化。
   */
  titleVisible: true,
} as const;

/**
 * 视口外节点的绘制深度（2026-10-26 节点可见状态，docs/plan/2026-10-26-node-visibility-states.md）。
 * 宿主给每个节点下发 data._cullState（visible / culled / culled-linked / transient），
 * 本项决定壳对 culled / culled-linked 两档怎么画：
 * - skeleton：骨架 —— 标题条 + 端口锚点保留（连线端点锚在真实几何上），内容段/控制栏/多选标记
 *   不挂载，卡片本体隐身占位（性能与连线正确性的平衡点，缺省）。
 * - full：全量绘制（等价于关闭降级，回到 2026-10-15 之前的完整渲染）。
 * - ghost：空心占位框 —— 内容不挂载，卡片画一个可见的细边框（远端连线走向一目了然，调试/大屏用）。
 */
export const DEFAULT_THEME_CULLED = {
  culledNodeRendering: "skeleton",
} as const;

/**
 * 多选标记（节点左上角那个圆圈，多选时出现）的外观默认值。
 *
 * 三项各自独立：大小（屏幕量到的直径 px）/ 颜色 / 低缩放下是否显示。
 * 真值定义在 components/node/multiRadio.ts（读取与样式的单一出处），这里只转出，
 * 不让 schema 的 default 与组件里的回落值各写一遍 —— 两份必然漂移。
 */
export const DEFAULT_THEME_MULTI_RADIO = DEFAULT_MULTI_RADIO;

/**
 * 控制栏（节点顶部/底部浮出的操作栏与状态栏）的贴边距离默认值。
 *
 * 节点插件把"上控制栏 / 下控制栏"绝对定位在卡片外侧（不参与卡片的固定尺寸框），
 * 这两项就是它们离卡片边的基础距离（px）：调大 = 离节点更远，调小 = 更贴近。
 * 之所以收在本插件（而不是各节点各声明一份）：settings 的 key 是全局同一张表、
 * 先声明者独占，且"浮层离卡片多远"本就是节点外壳的几何属性 —— 与 titleOffset 同类。
 * 收在这里，日后新增视频等节点类型无需重新声明即可共享同一套观感。
 */
export const DEFAULT_THEME_LAYOUT = {
  toolbarTopOffset: 6,
  toolbarBottomOffset: 6,
} as const;

/**
 * 生成控制栏（节点底部"输入框 + 下拉 + 发送"那一栏）的尺寸默认值。
 * 与 DEFAULT_THEME_LAYOUT 同属「布局/控制栏」：贴边距离管"离节点多远"，这里管"多大"。
 */
export const DEFAULT_THEME_PANEL = {
  panelImageWidth: 660,
  panelTextWidth: 520,
  panelEditorMinHeight: 64,
  panelEditorMaxHeight: 220,
} as const;

/** 吸附带配置默认值（字段名 = canvas-render SnapZoneConfig，直接可作 :snap-zone-visual 注入） */
export const DEFAULT_THEME_SNAP_ZONE = {
  heightRatio: 0.8,
  // 显式给值（不用 undefined 让它回落 portZoneWidth）：吸附调试带/命中带必须看得见、摸得着。
  // 曾经默认 0（"0=塌成 0 宽，不兜底"的语义），结果吸附调试框宽 0 根本画不出来——被用户当成"调试框不见了"。
  width: 24,
  offset: 0,
  shape: "rect",
} as const;

/** 本插件声明"可配置项 → EDGE_VISUAL 字段"的映射（供宿主/demo 在 UI 改动后按 key 窄更新对应一处，不整图重建） */
export const EDGE_SETTING_KEYS: ReadonlyArray<keyof typeof DEFAULT_THEME_EDGE> =
  Object.keys(DEFAULT_THEME_EDGE) as (keyof typeof DEFAULT_THEME_EDGE)[];

/** 本插件声明"可配置项 → 端口参数(CanvasParams)"的映射 */
export const HANDLE_SETTING_KEYS: ReadonlyArray<
  keyof typeof DEFAULT_THEME_HANDLE
> = Object.keys(DEFAULT_THEME_HANDLE) as (keyof typeof DEFAULT_THEME_HANDLE)[];

/** 本插件声明"可配置项 → 调试可视化开关(CanvasDebug)"的映射 */
export const DEBUG_SETTING_KEYS: ReadonlyArray<
  keyof typeof DEFAULT_THEME_DEBUG
> = Object.keys(DEFAULT_THEME_DEBUG) as (keyof typeof DEFAULT_THEME_DEBUG)[];

/** 本插件声明"可配置项 → 节点标题外观"的映射（BaseNode 浮标题读；对齐 v1 nodeTitleOffset/nodeTitleScaleMinZoom） */
export const TITLE_SETTING_KEYS: ReadonlyArray<
  keyof typeof DEFAULT_THEME_TITLE
> = Object.keys(DEFAULT_THEME_TITLE) as (keyof typeof DEFAULT_THEME_TITLE)[];

/** 本插件声明"可配置项 → 控制栏贴边距离"的映射（节点顶部/底部控制栏读） */
export const LAYOUT_SETTING_KEYS: ReadonlyArray<
  keyof typeof DEFAULT_THEME_LAYOUT
> = Object.keys(DEFAULT_THEME_LAYOUT) as (keyof typeof DEFAULT_THEME_LAYOUT)[];

/** 本插件声明"可配置项 → 生成控制栏尺寸"的映射（图片/文本生成面板读） */
export const PANEL_SETTING_KEYS: ReadonlyArray<
  keyof typeof DEFAULT_THEME_PANEL
> = Object.keys(DEFAULT_THEME_PANEL) as (keyof typeof DEFAULT_THEME_PANEL)[];

/** 本插件声明"可配置项 → 吸附带配置(SnapZoneConfig)"的映射 */
export const SNAP_ZONE_SETTING_KEYS: ReadonlyArray<
  keyof typeof DEFAULT_THEME_SNAP_ZONE
> = Object.keys(
  DEFAULT_THEME_SNAP_ZONE,
) as (keyof typeof DEFAULT_THEME_SNAP_ZONE)[];

/**
 * 本插件的可配置项 schema（P4：模块级 Config）。
 * 字段类型/默认对齐 DEFAULT_THEME_EDGE；group/label/options 供 UI 面板按组分、长控件、显示中文文案。
 * 内核装配时经它校验 + 补默认，apply(ctx, config) 收到的即完整 config。
 *
 * 分组命名约定：`一级/二级`（左侧一级导航、右侧二级页签条），一级按"画布对象/功能"归类、跨插件聚合；
 * 视觉配色统一收进一级「外观」下的 `外观/主题配色`（各插件颜色集中一处调）；调试开关在 `常规/调试`。
 * 本插件字段分属：节点(端口/吸附带)、边(连线)、常规(主题配色/调试)。
 */
export const CanvasConfig: ConfigSchema = {
  // —— 节点/节点加载态：图片 / 视频 / 可视化 / 文本节点**共用**的一只加载件的分档阈值 ——
  // 加载态长在所有节点上，所以阈值刻意做成全局一份（三处各配一套只会互相打架）。
  ...nodeLoadingTierFields(NODE_LOADING_TIER_PREFIX, "常规/节点加载态"),

  // ===== 一级「节点」：节点自身的手柄端口 / 吸附带 / 节点内容外观（来自多个插件，二级 = 各插件块）=====
  // —— 端口（浮动球 + 吸附区）：theme-default 的节点手柄 ——
  handleRestOffset: {
    type: "number",
    default: DEFAULT_THEME_HANDLE.handleRestOffset,
    min: 0,
    max: 100,
    step: 1,
    label: "端口偏移",
    group: "节点/端口",
    description: "鼠标离开后圆球回到节点外侧的默认距离。",
  },
  handleCursorGap: {
    type: "number",
    default: DEFAULT_THEME_HANDLE.handleCursorGap,
    min: 0,
    max: 80,
    step: 1,
    label: "光标间隙",
    group: "节点/端口",
    description: "圆球跟随鼠标时与光标的错开距离。",
  },
  handleButtonSize: {
    type: "number",
    default: DEFAULT_THEME_HANDLE.handleButtonSize,
    min: 16,
    max: 64,
    step: 1,
    label: "端口球大小",
    group: "节点/端口",
    description: "浮动端口圆球按钮的直径。",
  },
  portZoneWidth: {
    type: "number",
    default: DEFAULT_THEME_HANDLE.portZoneWidth,
    min: 0,
    max: 400,
    step: 1,
    label: "活动区域宽度",
    group: "节点/端口活动区",
    description: "端口自己的命中区域宽度，只决定鼠标离端口多近能抓住它；拖线吸附另见「吸附区域」。",
  },
  portZoneHeightRatio: {
    type: "number",
    default: DEFAULT_THEME_HANDLE.portZoneHeightRatio,
    min: 0.2,
    max: 1,
    step: 0.05,
    label: "活动区域高度占比",
    group: "节点/端口活动区",
    description: "端口活动区域的高度占节点高度的比例（0.8=占 80%），不是拖线吸附带。",
  },
  portZoneOffset: {
    type: "number",
    default: DEFAULT_THEME_HANDLE.portZoneOffset,
    min: -200,
    max: 200,
    step: 1,
    label: "活动区域偏移",
    group: "节点/端口活动区",
    description: "端口活动区域整体横向偏移：>0 向节点内、<0 向节点外；只影响端口命中，不影响拖线吸附。",
  },
  portZoneArcRatio: {
    type: "number",
    default: DEFAULT_THEME_HANDLE.portZoneArcRatio,
    min: 0.2,
    max: 1,
    step: 0.05,
    label: "活动区域弧饱满度",
    group: "节点/端口活动区",
    description:
      "端口活动区域半椭圆弧的垂直饱满程度：1=半椭圆，越小弧越扁越接近平顶矩形。",
  },
  portZoneShape: {
    type: "select",
    default: DEFAULT_THEME_HANDLE.portZoneShape,
    label: "活动区域形状",
    group: "节点/端口活动区",
    description: "端口自己的活动区域使用矩形或半椭圆，和拖线吸附区域是两件事。",
    options: [
      { value: "arc", label: "半椭圆" },
      { value: "rect", label: "矩形" },
    ],
  },
  // —— 节点标题：BaseNode 卡片上缘外浮标题条的外观（位置偏移 + 缩放阈值；对齐 v1 core 同名项）——
  titleVisible: {
    type: "boolean",
    default: DEFAULT_THEME_TITLE.titleVisible,
    label: "显示节点标题",
    group: "节点/标题",
    description:
      "关闭后所有节点都不画标题（标题文字、类型图标、标题右侧的尺寸等附加文本一起收起）。图片/视频这类\"内容即全部\"的节点常用。",
  },
  titleOffset: {
    type: "number",
    default: DEFAULT_THEME_TITLE.titleOffset,
    min: 0,
    max: 40,
    step: 1,
    label: "标题位置偏移",
    group: "节点/标题",
    description: "标题底部到节点顶部的基础屏幕间距；低于缩放阈值后随标题一起缩小。",
  },
  titleScaleMinZoom: {
    type: "number",
    default: DEFAULT_THEME_TITLE.titleScaleMinZoom,
    min: 0.1,
    max: 1,
    step: 0.05,
    label: "标题缩放阈值",
    group: "节点/标题",
    description: "低于该缩放值后标题跟随画布一起反向缩放（防标题无限放大的下限）。",
  },
  // —— 节点 LOD：低细节阈值（缩放低于此值时节点进入低细节：隐标题条/隐端口/去阴影）——
  nodeLodLowDetailZoom: {
    type: "number",
    default: 0.4,
    min: 0.1,
    max: 1,
    step: 0.05,
    label: "节点低细节阈值",
    group: "节点/低细节",
    description: "低于该缩放值后所有节点进入低细节模式（隐藏端口/标题条、去掉阴影）。",
  },
  // —— 视口外节点绘制深度：壳按宿主下发的 _cullState 自选画法（2026-10-26）——
  culledNodeRendering: {
    type: "select",
    default: DEFAULT_THEME_CULLED.culledNodeRendering,
    label: "视口外节点绘制",
    group: "节点/低细节",
    description:
      "视口外（含缓冲带）节点画到什么程度：骨架=隐身占位（标题/端口保留，连线端点不变，缺省）；全量=等同关闭降级；占位框=画可见空心框（远端连线走向可见）。",
    options: [
      { value: "skeleton", label: "骨架（隐身占位）" },
      { value: "full", label: "全量绘制" },
      { value: "ghost", label: "占位框" },
    ],
  },
  // —— 多选标记：多选时节点内容区左上角那个圆圈（大小 / 颜色 / 低缩放是否显示）——
  [MULTI_RADIO_KEYS.size]: {
    type: "number",
    default: DEFAULT_MULTI_RADIO.size,
    min: MULTI_RADIO_SIZE_MIN,
    max: MULTI_RADIO_SIZE_MAX,
    step: 1,
    label: "多选标记大小",
    group: "节点/多选标记",
    description:
      "多选时节点左上角那个圆圈的直径（px，屏幕上量到的大小）。缩放不低于「标题缩放阈值」时屏幕大小不变，再小则随画布一起缩小。",
  },
  [MULTI_RADIO_KEYS.showInLowDetail]: {
    type: "boolean",
    default: DEFAULT_MULTI_RADIO.showInLowDetail,
    label: "多选标记低缩放显示",
    group: "节点/多选标记",
    description:
      "画布缩得很小时（低于「节点低细节阈值」）节点会简化渲染，那个圆圈默认跟着不显示；打开这个开关就让它一直在。",
  },
  // —— 布局：控制栏贴边距离（节点顶部/底部浮出的操作栏与状态栏离卡片边多远）——
  toolbarTopOffset: {
    type: "number",
    default: DEFAULT_THEME_LAYOUT.toolbarTopOffset,
    min: 0,
    max: 40,
    step: 1,
    label: "上控制栏偏移",
    group: "布局/控制栏",
    description:
      "节点顶部操作栏离卡片上边的距离（px）。调大=往外挪得更远，调小=更贴近节点。",
  },
  toolbarBottomOffset: {
    type: "number",
    default: DEFAULT_THEME_LAYOUT.toolbarBottomOffset,
    min: 0,
    max: 40,
    step: 1,
    label: "下控制栏偏移",
    group: "布局/控制栏",
    description:
      "节点底部控制栏离卡片下边的距离（px）。调大=往外挪得更远，调小=更贴近节点。",
  },
  // —— 布局：生成控制栏的尺寸（宽度 / 输入框高度）——
  panelImageWidth: {
    type: "number",
    default: DEFAULT_THEME_PANEL.panelImageWidth,
    min: 320,
    max: 1200,
    step: 10,
    label: "图片生成栏宽度",
    group: "布局/控制栏",
    description:
      "图片节点底部生成控制栏的宽度（px）。里面是输入框 + 模型/参数/模板下拉 + 发送按钮。",
  },
  panelTextWidth: {
    type: "number",
    default: DEFAULT_THEME_PANEL.panelTextWidth,
    min: 280,
    max: 1200,
    step: 10,
    label: "文本生成栏宽度",
    group: "布局/控制栏",
    description: "文本节点底部生成控制栏的宽度（px）。版式与图片同款，只是默认窄一些。",
  },
  panelEditorMinHeight: {
    type: "number",
    default: DEFAULT_THEME_PANEL.panelEditorMinHeight,
    min: 32,
    max: 400,
    step: 2,
    label: "生成栏输入框最小高",
    group: "布局/控制栏",
    description:
      "生成控制栏里那个大输入框的最小高度（px）。内容少时也不至于扁成一条线。",
  },
  panelEditorMaxHeight: {
    type: "number",
    default: DEFAULT_THEME_PANEL.panelEditorMaxHeight,
    min: 64,
    max: 800,
    step: 4,
    label: "生成栏输入框最大高",
    group: "布局/控制栏",
    description:
      "生成控制栏输入框的最大高度（px）。写长了在框内滚动，不会把面板撑得很大。",
  },
  // —— 文本 LOD：文本节点内容的三级缩略（full 全文 → condensed 首行 → icon 缩略占位）——
  textLodIconZoom: {
    type: "number",
    default: 0.18,
    min: 0.05,
    max: 1,
    step: 0.05,
    label: "文本缩略阈值",
    group: "节点/文本LOD",
    description:
      "低于该缩放值，文本节点内容只显示灰色缩略占位（介于本文本LOD阈值与标题缩放阈值之间则只显示首行截断）。",
  },
  // —— 吸附带：theme-default 的节点吸附带 ——
  heightRatio: {
    type: "number",
    default: DEFAULT_THEME_SNAP_ZONE.heightRatio,
    min: 0.2,
    max: 1,
    step: 0.05,
    label: "吸附高度占比",
    group: "节点/吸附带",
    description: "拖线时吸附区域的高度占节点高度的 0~1 比例（0.8=占 80%）。",
  },
  width: {
    type: "number",
    default: DEFAULT_THEME_SNAP_ZONE.width,
    min: 0,
    max: 400,
    step: 1,
    label: "吸附宽度(px)",
    group: "节点/吸附带",
    description: "拖线吸附区域的像素宽度。0 就是 0（带塌成 0 宽，不做兜底）。",
  },
  offset: {
    type: "number",
    default: DEFAULT_THEME_SNAP_ZONE.offset,
    min: -200,
    max: 200,
    step: 1,
    label: "吸附偏移(px)",
    group: "节点/吸附带",
    description: "拖线吸附区域整体横向偏移：>0 向节点内、<0 向节点外。",
  },
  shape: {
    type: "select",
    default: DEFAULT_THEME_SNAP_ZONE.shape,
    label: "吸附形状",
    group: "节点/吸附带",
    description: "拖线吸附区域的形状：矩形(rect)/半椭圆弧(arc)。命中统一按矩形，仅影响视觉。",
    options: [
      { value: "rect", label: "矩形" },
      { value: "arc", label: "半椭圆弧" },
    ],
  },
  // ===== 一级「边」：连线外观与连线工具（theme-default 连线样式 + 其它插件连线工具）=====
  edgeType: {
    type: "select",
    default: DEFAULT_THEME_EDGE.edgeType,
    label: "线型",
    group: "边/连线",
    description:
      "连线在两节点之间的走线形态，贝塞尔最平滑，直角/折线更贴近工程图。",
    options: [
      { value: "adaptive", label: "自适应贝塞尔" },
      { value: "avoid", label: "正交避障" },
      { value: "bezier", label: "贝塞尔" },
      { value: "straight", label: "直线" },
      { value: "step", label: "直角" },
      { value: "smoothstep", label: "圆角折线" },
    ],
  },
  edgeAvoidMargin: {
    type: "number",
    default: DEFAULT_THEME_EDGE.edgeAvoidMargin,
    min: 4,
    max: 48,
    step: 1,
    label: "避障边距",
    group: "边/连线",
    description:
      "正交避障时连线离节点矩形边缘的距离（像素），也就是黄色安全区的大小。调大后连线会离卡片更远。",
  },
  edgeAvoidRadius: {
    type: "number",
    default: DEFAULT_THEME_EDGE.edgeAvoidRadius,
    min: 0,
    max: 16,
    step: 1,
    label: "避障圆角",
    group: "边/连线",
    description: "正交避障路径拐角的圆角半径（像素）。",
  },
  edgeAvoidClearance: {
    type: "number",
    default: DEFAULT_THEME_EDGE.edgeAvoidClearance,
    min: 0,
    max: 24,
    step: 1,
    label: "连线留白",
    group: "边/连线",
    description: "在避障边距之外再多留的间距（像素）。想更宽松就调大它。",
  },
  edgeLineWidth: {
    type: "number",
    default: DEFAULT_THEME_EDGE.edgeLineWidth,
    min: 1,
    max: 6,
    step: 0.5,
    label: "线宽",
    group: "边/连线",
    description: "连线的粗细（像素）。值越大线条越明显。",
  },
  edgeDashed: {
    type: "boolean",
    default: DEFAULT_THEME_EDGE.edgeDashed,
    label: "虚线",
    group: "边/连线",
    description: '以虚线绘制连线，常用于"可选/临时"关系的表达。',
  },
  edgeVisible: {
    type: "boolean",
    default: DEFAULT_THEME_EDGE.edgeVisible,
    label: "显示连线",
    group: "边/连线",
    description: "关闭后连线整体隐藏（只留交互热区）；临时拖拽线不受影响仍会显示。",
  },
  edgeVisibleOnSelect: {
    type: "boolean",
    default: DEFAULT_THEME_EDGE.edgeVisibleOnSelect,
    label: "选中节点时显示相连连线",
    group: "边/连线",
    description: "配合“隐藏连线”使用：平时连线隐藏，选中任一相关节点时该连线重新显示。",
  },
  edgeOnTop: {
    type: "boolean",
    default: DEFAULT_THEME_EDGE.edgeOnTop,
    label: "连线显示在最上层",
    group: "边/连线",
    description: "连线绘制在节点之上（z 置顶），不被节点卡片遮挡。",
  },
  edgeMarkerEnd: {
    type: "boolean",
    default: DEFAULT_THEME_EDGE.edgeMarkerEnd,
    label: "箭头",
    group: "边/连线",
    description: "在连线目标端显示箭头，标明方向。",
  },
  edgeMarkerSize: {
    type: "number",
    default: DEFAULT_THEME_EDGE.edgeMarkerSize,
    min: 4,
    max: 24,
    label: "箭头大小",
    group: "边/连线",
    description: "目标端箭头的大小（开启箭头后生效）。",
  },
  edgeGlowEnabled: {
    type: "boolean",
    default: DEFAULT_THEME_EDGE.edgeGlowEnabled,
    label: "辉光",
    group: "边/连线",
    description: "连线外圈的柔光效果，增强视觉层次。",
  },
  edgeGlowIntensity: {
    type: "number",
    default: DEFAULT_THEME_EDGE.edgeGlowIntensity,
    min: 0,
    max: 3,
    step: 0.1,
    label: "辉光强度",
    group: "边/连线",
    description: "选中/相连连线的外圈辉光强度。",
  },
  edgeFlowEnabled: {
    type: "boolean",
    default: DEFAULT_THEME_EDGE.edgeFlowEnabled,
    label: "色块流动",
    group: "边/连线",
    description:
      "连线动效总开关：选中节点或连线时，导轨 + 渐变光斑沿连线流动；关闭后回退素淡静态线（静止、无光斑）。",
  },
  edgeFlowCount: {
    type: "number",
    default: DEFAULT_THEME_EDGE.edgeFlowCount,
    min: 1,
    max: 8,
    step: 1,
    label: "色块数量",
    group: "边/连线",
    description:
      "一条连线固定显示几个发光色块（1~8）。整条线均分成这么多份、每份放一个，线短线长都不变。",
  },
  edgeFlowRatio: {
    type: "number",
    default: DEFAULT_THEME_EDGE.edgeFlowRatio,
    min: 5,
    max: 100,
    step: 1,
    label: "色块占比(%)",
    group: "边/连线",
    description:
      "色块占“自己那一份”长度的百分比：连线先按数量均分，再按这个比例决定色块多大（100% = 色块与那一份等长）。",
  },
  edgeFlowSpeed: {
    type: "number",
    default: DEFAULT_THEME_EDGE.edgeFlowSpeed,
    min: 0.1,
    max: 5,
    step: 0.1,
    label: "色块流速(倍)",
    group: "边/连线",
    description:
      "倍数：1 倍 = 2 秒走完整条连线（长短线都是 2 秒，同时出发同时到达）。数值越大越快。",
  },
  edgeFlowFade: {
    type: "number",
    default: DEFAULT_THEME_EDGE.edgeFlowFade,
    min: 5,
    max: 50,
    step: 1,
    label: "色块渐隐占比",
    group: "边/连线",
    description:
      "每个色块头尾两端柔和渐隐的长度占该色块长度的百分比（越大越柔；参考 demo 35）。",
  },
  edgeFlowIntensity: {
    type: "number",
    default: DEFAULT_THEME_EDGE.edgeFlowIntensity,
    min: 0.1,
    max: 1,
    step: 0.05,
    label: "色块强度",
    group: "边/连线",
    description: "发光色块峰值不透明度（越大越亮越实）。",
  },
};
