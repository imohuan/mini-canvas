/**
 * 主题外观的 config 默认值（纯数据，零 .vue、零 DOM）。
 *
 * 拆包前住在 plugin-theme-canvas 的 themeConfig.ts；拆包后两边都要用同一张表：
 * - plugin-theme-canvas 用 EDGE / HANDLE / TITLE / CULLED / MULTI_RADIO / LAYOUT / PANEL / SNAP_ZONE / DEBUG；
 * - plugin-theme-components 用 APPEARANCE 与 DEBUG。
 * 默认值与导出名一个都没改，避免设置面板的初始值出现两条真相。
 */
import {
  MULTI_RADIO_KEYS,
  MULTI_RADIO_SIZE_MAX,
  MULTI_RADIO_SIZE_MIN,
  DEFAULT_MULTI_RADIO,
} from "./multiRadio";
import {
  THEME_FONT_CHOICES,
  THEME_FONT_LABELS,
  THEME_RADIUS_CHOICES,
  THEME_RADIUS_LABELS,
  THEME_SIZE_CHOICES,
  THEME_SIZE_HINTS,
  THEME_SIZE_LABELS,
} from "./themeBridge";

// 默认皮对应的连线外观默认值（作为本插件 config schema 的默认/单一数据源初始值）。
// 视觉语言（参考 docs/reference/bezier-glow-flow-line）：导轨细线 + 青色渐变光斑沿连线流动。
//
// **连线颜色（导轨 / 流光）不在这里**：它们已上移进渲染层主题色板
//（`@mini-canvas/canvas-render` 的 themePalette：`edgeRailColor` / `edgeFlowColor`，
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

