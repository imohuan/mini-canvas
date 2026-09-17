// plugin-theme-default —— 画布"默认主题"插件。
//
// 职责：把宿主渲染器收编成主题插件提供的默认皮 ——
//   nodeShell = BaseNode（完整节点壳：端口/标题就地改名/选中环/LOD/浮动端口）
//   edge      = CustomEdge（完整自定义边：流光/箭头/双击剪切）
//   background= DefaultBackground（跟随画布的圆点底）
// core 只留"槽位 + 令牌"契约，不再硬编码默认 .vue 渲染器；装本插件即有默认皮。
//
// P4 迁移：声明入口从 apply 里 ctx.settings.define → **模块级导出 `Config` schema**（cordis ch5 形态）。
// 装配处给 config → 内核经 schema 校验+补默认 → `apply(ctx, config)` 收完整 config；
// 同时 schema 字段自动登记进 settings 单一数据源(scope=theme-default)，demo/宿主读它做连线外观的
// "config 变化→就地窄更新、实时生效"（逻辑同旧 ctx.settings.onChange，不整图重建）。
import type {
  Context,
  ConfigSchema,
  InferConfig,
} from "@mini-canvas/canvas-base";
import type { PluginModule } from "@mini-canvas/canvas-base";
// 跨包服务类型声明（cordis 声明合并）：本插件 `inject:['text']` 依赖 text 插件，需显式 import type 该包，
// 让 node-text 对 `interface Context { text: TextService }` 的增强在本包编译里可见 → ctx.text 类型安全可用。
// 纯类型副作用，运行时无 import（text 服务仍由内核依赖编排注入）。
import type {} from "@mini-canvas/plugin-node-text";
// 主题变量：包加载即生效（:root 定义 --canvas-node-*），壳/端口/边组件 CSS 消费。
import "./styles/node-theme.css";
import BaseNode from "./components/node/BaseNode.vue";
import {
  MULTI_RADIO_KEYS,
  MULTI_RADIO_SIZE_MAX,
  MULTI_RADIO_SIZE_MIN,
  DEFAULT_MULTI_RADIO,
} from "./components/node/multiRadio";
import CustomEdge from "./components/edge/CustomEdge.vue";
import DefaultBackground from "./components/background/DefaultBackground.vue";
import ConnectionLine from "./components/edge/ConnectionLine.vue";
import PluginSettingsDialog from "./components/settings/PluginSettingsDialog.vue";

export const name = "theme-default";
export const inject = ["text"] as string[];

// 默认皮对应的连线外观默认值（作为本插件 config schema 的默认/单一数据源初始值）。
// 视觉语言（参考 docs/reference/bezier-glow-flow-line）：导轨细线 + 青色渐变光斑沿连线流动，
// 克制但有科技感。edgeGlowColor 即“光斑色”（默认品牌青 #0891b2），edgeColor 为静态导轨/线色。
export const DEFAULT_THEME_EDGE = {
  edgeType: "bezier",
  edgeColor: "#1f2937",
  edgeLineWidth: 1.5,
  edgeDashed: false,
  edgeMarkerEnd: false,
  edgeMarkerSize: 8,
  edgeGlowEnabled: true,
  edgeGlowIntensity: 1,
  edgeGlowColor: "#0891b2",
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
} as const;

/** 浮动端口(half)外观默认值（对齐 canvasHostCore DEFAULT_HANDLE_VISUAL） */
export const DEFAULT_THEME_HANDLE = {
  handleRestOffset: 36,
  handleCursorGap: 24,
  handleButtonSize: 32,
  portZoneWidth: 10, // 端口吸附交互区/半圆耳朵水平外扩，默认 86（对齐 canvasHostCore；0 会让端口区塌成不可命中）
  portZoneHeightRatio: 0.55,
  portZoneOffset: 0,
  portZoneShape: "arc",
  portZoneArcRatio: 0.8,
} as const;

/** 调试可视化开关默认值（对齐 canvasHostCore DEFAULT_DEBUG_VISUAL；作为本插件 config 的初始值） */
export const DEFAULT_THEME_DEBUG = {
  handleDebug: true,
  connectionSnapDebugVisible: true,
} as const;

/**
 * 节点标题外观默认值（对齐 v1 core 的 nodeTitleOffset / nodeTitleScaleMinZoom，见 useCanvasStore）。
 * nodeShell BaseNode 的浮标题（卡片上缘外、反向缩放）读这两项；位置偏移 = 标题底部到节点顶部的基础
 * 屏幕间距，缩放阈值 = 低于该 zoom 后标题与卡片一起反缩放收缩的下限。作为本插件 config 的初始值。
 */
export const DEFAULT_THEME_TITLE = {
  titleOffset: 12,
  titleScaleMinZoom: 0.5,
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
  panelImageWidth: 650,
  panelTextWidth: 520,
  panelEditorMinHeight: 64,
  panelEditorMaxHeight: 220,
} as const;

/** 吸附带配置默认值（字段名 = canvas-render SnapZoneConfig，直接可作 :snap-zone-visual 注入） */
export const DEFAULT_THEME_SNAP_ZONE = {
  heightRatio: 0.8,
  width: 0, // 0 就是 0（带塌成 0 宽，不做兜底）；想用默认带宽就往这里填具体值
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
 * 视觉配色统一收进一级「常规」下的 `常规/主题配色`（各插件颜色集中一处调）；调试开关在 `常规/调试`。
 * 本插件字段分属：节点(端口/吸附带)、边(连线)、常规(主题配色/调试)。
 */
export const Config: ConfigSchema = {
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
    label: "吸附区宽度",
    group: "节点/端口",
    description: "端口接收区矩形的横向宽度（默认 86）。",
  },
  portZoneHeightRatio: {
    type: "number",
    default: DEFAULT_THEME_HANDLE.portZoneHeightRatio,
    min: 0.2,
    max: 1,
    step: 0.05,
    label: "吸附区高度占比",
    group: "节点/端口",
    description: "端口接收区高度占节点高度的比例（0.8=占 80%）。",
  },
  portZoneOffset: {
    type: "number",
    default: DEFAULT_THEME_HANDLE.portZoneOffset,
    min: -200,
    max: 200,
    step: 1,
    label: "吸附区偏移",
    group: "节点/端口",
    description: "端口接收区整体横向偏移：>0 向节点内、<0 向节点外。",
  },
  portZoneArcRatio: {
    type: "number",
    default: DEFAULT_THEME_HANDLE.portZoneArcRatio,
    min: 0.2,
    max: 1,
    step: 0.05,
    label: "吸附区弧饱满度",
    group: "节点/端口",
    description:
      "半椭圆弧的垂直饱满程度：1=半椭圆(与吸附带一致)，越小弧越扁越接近平顶矩形。",
  },
  portZoneShape: {
    type: "select",
    default: DEFAULT_THEME_HANDLE.portZoneShape,
    label: "吸附区形状",
    group: "节点/端口",
    description: "端口接收区使用矩形或半椭圆。",
    options: [
      { value: "arc", label: "半椭圆" },
      { value: "rect", label: "矩形" },
    ],
  },
  // —— 节点标题：BaseNode 卡片上缘外浮标题条的外观（位置偏移 + 缩放阈值；对齐 v1 core 同名项）——
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
  [MULTI_RADIO_KEYS.color]: {
    type: "color",
    default: DEFAULT_MULTI_RADIO.color,
    label: "多选标记颜色",
    group: "节点/多选标记",
    description: "那个圆圈的圆环与中心点的颜色。默认深灰，与节点选中色一致。",
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
    label: "吸附带高度占比",
    group: "节点/吸附带",
    description: "吸附带高度占节点高度的 0~1 比例（0.8=占 80%）。",
  },
  width: {
    type: "number",
    default: DEFAULT_THEME_SNAP_ZONE.width,
    min: 0,
    max: 400,
    step: 1,
    label: "吸附带宽度(px)",
    group: "节点/吸附带",
    description: "吸附带的像素宽度。0 就是 0（带塌成 0 宽，不做兜底）。",
  },
  offset: {
    type: "number",
    default: DEFAULT_THEME_SNAP_ZONE.offset,
    min: -200,
    max: 200,
    step: 1,
    label: "吸附带偏移(px)",
    group: "节点/吸附带",
    description: "吸附带整体横向偏移：>0 向节点内、<0 向节点外。",
  },
  shape: {
    type: "select",
    default: DEFAULT_THEME_SNAP_ZONE.shape,
    label: "吸附带形状",
    group: "节点/吸附带",
    description: "矩形(rect)/半椭圆弧(arc)。命中统一按矩形，仅影响视觉。",
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
      { value: "bezier", label: "贝塞尔" },
      { value: "straight", label: "直线" },
      { value: "step", label: "直角" },
      { value: "smoothstep", label: "圆角折线" },
    ],
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
  // ===== 一级「常规」：主题配色 / 调试 / 小地图等跨插件的常规设置收归一处 =====
  // —— 主题配色：各种插件的颜色集中统一调（本插件 = 连线色/辉光色）——
  edgeColor: {
    type: "color",
    default: DEFAULT_THEME_EDGE.edgeColor,
    label: "连线颜色",
    group: "常规/主题配色",
    description: "默认连线的颜色，改动后画布上现有连线实时跟随。",
  },
  edgeGlowColor: {
    type: "color",
    default: DEFAULT_THEME_EDGE.edgeGlowColor,
    label: "辉光颜色",
    group: "常规/主题配色",
    description: "辉光/流光高亮使用的颜色（缺省跟随线色）。",
  },
  // —— 调试：开发校准开关 ——
  handleDebug: {
    type: "boolean",
    default: DEFAULT_THEME_DEBUG.handleDebug,
    label: "端口调试",
    group: "常规/调试",
    description:
      "打开后，端口上会画出半圆交互区/圆心/归位点/鼠标点辅助线，便于校准端口几何。",
  },
  connectionSnapDebugVisible: {
    type: "boolean",
    default: DEFAULT_THEME_DEBUG.connectionSnapDebugVisible,
    label: "吸附调试",
    group: "常规/调试",
    description:
      "打开后，拖线悬停到某节点时画出它的端口吸附带与卡片接收区，便于校准吸附判定。",
  },
};

/** apply 收到的 config TS 类型（与 schema 对齐） */
export interface ThemeConfig extends InferConfig<typeof Config> {}

export function apply(ctx: Context, config?: ThemeConfig) {
  // P4：config 已经内核经 Config schema 校验 + 补默认；这里无需再手写 settings.define（声明即 Config 导出）。
  // 如需在插件内"就地订阅自己 config 的变化并窄更新"，可 ctx.settings.onChange(name, ...)（demo 侧已演示该链路）。
  void config;

  // 渲染皮：nodeShell/edge/background/edgeDefaultType
  ctx.theme.register("nodeShell", BaseNode); // 完整节点壳（收编自 core）
  ctx.theme.register("edge", CustomEdge); // 完整自定义连线（收编自 core）
  ctx.theme.register("background", DefaultBackground); // 画布背景
  ctx.theme.register("connectionLine", ConnectionLine); // 拖线临时连接线（canvas-render #connection-line 渲染它）
  ctx.theme.register("edgeDefaultType", "custom");
  // 设置面板皮：settingsPanel 槽默认赢家（渲染抽象层 SettingsHost 消费 winner，把 ctx.settings 实时喂给它）；
  // 其它宿主想换皮装个 order 更小的插件 `ctx.theme.register('settingsPanel', 新组件, {order:-1})` 即顶替。
  ctx.theme.register("settingsPanel", PluginSettingsDialog, {
    id: "default",
    order: 0,
  });
}

/** 兼容旧装配的 PluginModule 出口 */
export const themeDefaultPlugin: PluginModule = { name, inject, Config, apply };

/**
 * 通用 UI 组件出口（供其它插件复用，避免各节点面板自绘一套近似的下拉/浮层）。
 *
 * 为什么由本插件提供：Select/Dropdown 是"默认皮"的一部分，视觉与交互都按项目 UI 规范实现，
 * 节点插件（图片/文本的生成控制栏等）直接引用同一份组件，才能与设置界面完全同风格 ——
 * 各自复制一份必然漂移。样式随组件内联，使用方无需额外引 CSS。
 */
export { Dropdown, Select, PrecisionSlider, ToolParamField, NodeToolbarButton } from "./components/ui";
export type { DropdownTrigger, SelectOption } from "./components/ui";

/**
 * 渲染件出口（供其它插件复用同一套外观，避免各自手绘一份必然漂移）。
 *
 * - `MovingHandle`：节点浮动端口。支持 `preview` 模式 —— 只复用外观、不注册 VueFlow 真实连接点，
 *   并 emit `connectStart`，正好给"挂在自己浮层上的临时端口"用（如多选框的批量连线端口）。
 * - `ConnectionLine` / `CustomEdge`：拖线临时线与正式边。`ConnectionLine` 内部把渲染完全委托给
 *   `CustomEdge`，所以拖出来的临时线和落成的正式边**长得一模一样**（含流光/箭头/配置/动画）。
 */
export { default as MovingHandle } from "./components/node/MovingHandle.vue";
export { default as ConnectionLine } from "./components/edge/ConnectionLine.vue";
export { default as CustomEdge } from "./components/edge/CustomEdge.vue";
