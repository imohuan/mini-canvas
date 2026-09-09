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
import CustomEdge from "./components/edge/CustomEdge.vue";
import DefaultBackground from "./components/background/DefaultBackground.vue";
import ConnectionLine from "./components/edge/ConnectionLine.vue";
import PluginSettingsDialog from "./components/settings/PluginSettingsDialog.vue";

export const name = "theme-default";
export const inject = ["text"] as string[];

// 默认皮对应的连线外观默认值（作为本插件 config schema 的默认/单一数据源初始值）。
// 视觉语言（参考 canvas-core-v2/demo-html-ui/bezier_glow_flow_line）：导轨细线 + 青色渐变光斑沿连线流动，
// 克制但有科技感。edgeGlowColor 即“光斑色”（默认品牌青 #0891b2），edgeColor 为静态导轨/线色。
export const DEFAULT_THEME_EDGE = {
  edgeType: "bezier",
  edgeColor: "#1f2937",
  edgeLineWidth: 2,
  edgeDashed: false,
  edgeAnimated: true,
  edgeMarkerEnd: false,
  edgeMarkerSize: 8,
  edgeGlowEnabled: true,
  edgeGlowIntensity: 1,
  edgeGlowColor: "#0891b2",
  edgeVisible: true,
  // —— 连线新视觉（导轨 + 色块流动）——
  edgeFlowEnabled: true,
  edgeFlowBlockSize: 90,
  edgeFlowGap: 260,
  edgeFlowSpeed: 2.5,
  edgeFlowFade: 35,
  edgeFlowIntensity: 0.9,
} as const;

/** 浮动端口(half)外观默认值（对齐 canvasHostCore DEFAULT_HANDLE_VISUAL） */
export const DEFAULT_THEME_HANDLE = {
  handleRestOffset: 36,
  handleCursorGap: 24,
  handleButtonSize: 32,
  portZoneWidth: 86, // 端口吸附交互区/半圆耳朵水平外扩，默认 86（对齐 canvasHostCore；0 会让端口区塌成不可命中）
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

/** 吸附带配置默认值（字段名 = canvas-render SnapZoneConfig，直接可作 :snap-zone-visual 注入） */
export const DEFAULT_THEME_SNAP_ZONE = {
  heightRatio: 0.8,
  width: 0, // 0 = 用吸附带默认带宽兜底（canvasHost 侧回落 86）
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
 */
export const Config: ConfigSchema = {
  edgeType: {
    type: "select",
    default: DEFAULT_THEME_EDGE.edgeType,
    label: "线型",
    group: "连线",
    description:
      "连线在两节点之间的走线形态，贝塞尔最平滑，直角/折线更贴近工程图。",
    options: [
      { value: "bezier", label: "贝塞尔" },
      { value: "straight", label: "直线" },
      { value: "step", label: "直角" },
      { value: "smoothstep", label: "圆角折线" },
    ],
  },
  edgeColor: {
    type: "color",
    default: DEFAULT_THEME_EDGE.edgeColor,
    label: "连线颜色",
    group: "连线",
    description: "默认连线的颜色，改动后画布上现有连线实时跟随。",
  },
  edgeLineWidth: {
    type: "number",
    default: DEFAULT_THEME_EDGE.edgeLineWidth,
    min: 1,
    max: 6,
    step: 0.5,
    label: "线宽",
    group: "连线",
    description: "连线的粗细（像素）。值越大线条越明显。",
  },
  edgeVisible: {
    type: "boolean",
    default: DEFAULT_THEME_EDGE.edgeVisible,
    label: "显示连线",
    group: "连线",
    description: "关闭后连线整体隐藏（只留交互热区）。",
  },
  edgeMarkerSize: {
    type: "number",
    default: DEFAULT_THEME_EDGE.edgeMarkerSize,
    min: 4,
    max: 24,
    label: "箭头大小",
    group: "连线",
    description: "目标端箭头的大小（开启箭头后生效）。",
  },
  edgeGlowIntensity: {
    type: "number",
    default: DEFAULT_THEME_EDGE.edgeGlowIntensity,
    min: 0.1,
    max: 3,
    step: 0.1,
    label: "辉光强度",
    group: "连线",
    description: "选中/相连连线的外圈辉光强度。",
  },
  edgeGlowColor: {
    type: "color",
    default: DEFAULT_THEME_EDGE.edgeGlowColor,
    label: "辉光颜色",
    group: "连线",
    description: "辉光/流光高亮使用的颜色（缺省跟随线色）。",
  },
  edgeAnimated: {
    type: "boolean",
    default: DEFAULT_THEME_EDGE.edgeAnimated,
    label: "流动动画",
    group: "连线动效与箭头",
    description: "允许光斑沿连线流动的动画总开关；关闭后连线静止（素淡线/虚线）。",
  },
  edgeDashed: {
    type: "boolean",
    default: DEFAULT_THEME_EDGE.edgeDashed,
    label: "虚线",
    group: "连线动效与箭头",
    description: '以虚线绘制连线，常用于"可选/临时"关系的表达。',
  },
  edgeMarkerEnd: {
    type: "boolean",
    default: DEFAULT_THEME_EDGE.edgeMarkerEnd,
    label: "箭头",
    group: "连线动效与箭头",
    description: "在连线目标端显示箭头，标明方向。",
  },
  edgeGlowEnabled: {
    type: "boolean",
    default: DEFAULT_THEME_EDGE.edgeGlowEnabled,
    label: "辉光",
    group: "连线动效与箭头",
    description: "连线外圈的柔光效果，增强视觉层次。",
  },
  edgeFlowEnabled: {
    type: "boolean",
    default: DEFAULT_THEME_EDGE.edgeFlowEnabled,
    label: "色块流动",
    group: "连线动效与箭头",
    description:
      "导轨 + 渐变光斑沿连线流动（参考 demo 视觉）。关闭后回退素淡静态线。",
  },
  edgeFlowBlockSize: {
    type: "number",
    default: DEFAULT_THEME_EDGE.edgeFlowBlockSize,
    min: 30,
    max: 400,
    step: 5,
    label: "色块长度",
    group: "连线动效与箭头",
    description:
      "单个发光色块沿路径的长度（路径长度归一 1000 刻度，默认 90 ≈ 9%）。",
  },
  edgeFlowGap: {
    type: "number",
    default: DEFAULT_THEME_EDGE.edgeFlowGap,
    min: 50,
    max: 800,
    step: 10,
    label: "色块间隔",
    group: "连线动效与箭头",
    description:
      "相邻发光色块之间的间距（归一 1000 刻度，默认 260 ≈ 26%）。",
  },
  edgeFlowSpeed: {
    type: "number",
    default: DEFAULT_THEME_EDGE.edgeFlowSpeed,
    min: 0.2,
    max: 10,
    step: 0.1,
    label: "色块流速",
    group: "连线动效与箭头",
    description: "光斑沿连线的流动速度（px/帧 @60fps，参考 demo 同量纲）。",
  },
  edgeFlowFade: {
    type: "number",
    default: DEFAULT_THEME_EDGE.edgeFlowFade,
    min: 5,
    max: 50,
    step: 1,
    label: "色块渐变占比",
    group: "连线动效与箭头",
    description:
      "每个光斑头尾柔和渐隐的过渡长度占比（%，越大越柔和；参考 demo 35）。",
  },
  edgeFlowIntensity: {
    type: "number",
    default: DEFAULT_THEME_EDGE.edgeFlowIntensity,
    min: 0.1,
    max: 1,
    step: 0.05,
    label: "色块强度",
    group: "连线动效与箭头",
    description: "发光色块峰值不透明度（越大越亮越实）。",
  },
  handleRestOffset: {
    type: "number",
    default: DEFAULT_THEME_HANDLE.handleRestOffset,
    min: 0,
    max: 100,
    step: 1,
    label: "端口偏移",
    group: "端口",
    description: "鼠标离开后圆球回到节点外侧的默认距离。",
  },
  handleCursorGap: {
    type: "number",
    default: DEFAULT_THEME_HANDLE.handleCursorGap,
    min: 0,
    max: 80,
    step: 1,
    label: "光标间隙",
    group: "端口",
    description: "圆球跟随鼠标时与光标的错开距离。",
  },
  handleButtonSize: {
    type: "number",
    default: DEFAULT_THEME_HANDLE.handleButtonSize,
    min: 16,
    max: 64,
    step: 1,
    label: "按钮大小",
    group: "端口",
    description: "浮动端口圆球按钮的直径。",
  },
  portZoneWidth: {
    type: "number",
    default: DEFAULT_THEME_HANDLE.portZoneWidth,
    min: 0,
    max: 400,
    step: 1,
    label: "端口区域宽度",
    group: "端口",
    description: "端口接收区矩形的横向宽度（默认 86）。",
  },
  portZoneArcRatio: {
    type: "number",
    default: DEFAULT_THEME_HANDLE.portZoneArcRatio,
    min: 0.2,
    max: 1,
    step: 0.05,
    label: "端口弧饱满度",
    group: "端口",
    description:
      "半椭圆弧的垂直饱满程度：1=半椭圆(与吸附带一致)，越小弧越扁越接近平顶矩形。",
  },
  portZoneHeightRatio: {
    type: "number",
    default: DEFAULT_THEME_HANDLE.portZoneHeightRatio,
    min: 0.2,
    max: 1,
    step: 0.05,
    label: "端口区域高度占比",
    group: "端口",
    description: "端口接收区高度占节点高度的比例（0.8=占 80%）。",
  },
  portZoneOffset: {
    type: "number",
    default: DEFAULT_THEME_HANDLE.portZoneOffset,
    min: -200,
    max: 200,
    step: 1,
    label: "端口区域偏移",
    group: "端口",
    description: "端口接收区整体横向偏移：>0 向节点内、<0 向节点外。",
  },
  portZoneShape: {
    type: "select",
    default: DEFAULT_THEME_HANDLE.portZoneShape,
    label: "端口区域形状",
    group: "端口",
    description: "端口接收区使用矩形或半椭圆。",
    options: [
      { value: "arc", label: "半椭圆" },
      { value: "rect", label: "矩形" },
    ],
  },
  heightRatio: {
    type: "number",
    default: DEFAULT_THEME_SNAP_ZONE.heightRatio,
    min: 0.2,
    max: 1,
    step: 0.05,
    label: "吸附带高度占比",
    group: "吸附带",
    description: "吸附带高度占节点高度的 0~1 比例（0.8=占 80%）。",
  },
  width: {
    type: "number",
    default: DEFAULT_THEME_SNAP_ZONE.width,
    min: 0,
    max: 400,
    step: 1,
    label: "吸附带宽度(px)",
    group: "吸附带",
    description: "吸附带的像素宽度。0 = 用默认带宽兜底(86)。",
  },
  offset: {
    type: "number",
    default: DEFAULT_THEME_SNAP_ZONE.offset,
    min: -200,
    max: 200,
    step: 1,
    label: "吸附带偏移(px)",
    group: "吸附带",
    description: "吸附带整体横向偏移：>0 向节点内、<0 向节点外。",
  },
  shape: {
    type: "select",
    default: DEFAULT_THEME_SNAP_ZONE.shape,
    label: "吸附带形状",
    group: "吸附带",
    description: "矩形(rect)/半椭圆弧(arc)。命中统一按矩形，仅影响视觉。",
    options: [
      { value: "rect", label: "矩形" },
      { value: "arc", label: "半椭圆弧" },
    ],
  },
  handleDebug: {
    type: "boolean",
    default: DEFAULT_THEME_DEBUG.handleDebug,
    label: "端口调试",
    group: "调试",
    description:
      "打开后，端口上会画出半圆交互区/圆心/归位点/鼠标点辅助线，便于校准端口几何。",
  },
  connectionSnapDebugVisible: {
    type: "boolean",
    default: DEFAULT_THEME_DEBUG.connectionSnapDebugVisible,
    label: "吸附调试",
    group: "调试",
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
