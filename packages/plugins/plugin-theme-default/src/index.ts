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
import type { Context, ConfigSchema, InferConfig } from '@mini-canvas/canvas-base'
import type { PluginModule } from '@mini-canvas/canvas-base'
// 跨包服务类型声明（cordis 声明合并）：本插件 `inject:['text']` 依赖 text 插件，需显式 import type 该包，
// 让 node-text 对 `interface Context { text: TextService }` 的增强在本包编译里可见 → ctx.text 类型安全可用。
// 纯类型副作用，运行时无 import（text 服务仍由内核依赖编排注入）。
import type {} from '@mini-canvas/plugin-node-text'
// 主题变量：包加载即生效（:root 定义 --canvas-node-*），壳/端口/边组件 CSS 消费。
import './styles/node-theme.css'
import BaseNode from './components/node/BaseNode.vue'
import CustomEdge from './components/edge/CustomEdge.vue'
import DefaultBackground from './components/background/DefaultBackground.vue'
import ConnectionLine from './components/edge/ConnectionLine.vue'
import PluginSettingsDialog from './components/settings/PluginSettingsDialog.vue'

export const name = 'theme-default'
export const inject = ["text"] as string[]

// 默认皮对应的连线外观默认值（与 engine DEFAULT_EDGE_VISUAL 对齐；作为本插件 config schema 的默认/单一数据源初始值）。
// 这样 demo/宿主经 ctx.settings 读到的初始外观 = 引擎默认，不改则有稳定基线。
// 默认偏向 v1 Decoration 金标准：细线 / 接近黑的深灰 / 轻微虚线 / 无箭头无辉光（看更克制、像工程图连线）。
export const DEFAULT_THEME_EDGE = {
  edgeType: 'bezier',
  edgeColor: '#1f2937',
  edgeLineWidth: 1.5,
  edgeDashed: true,
  edgeAnimated: false,
  edgeMarkerEnd: false,
  edgeMarkerSize: 8,
  edgeGlowEnabled: false,
  edgeGlowIntensity: 1,
  edgeGlowColor: '#1f2937',
  edgeVisible: true,
} as const

/** 浮动端口(half)外观默认值（对齐 canvasHostCore DEFAULT_HANDLE_VISUAL） */
export const DEFAULT_THEME_HANDLE = {
  handleRadius: 86,
  handleRestOffset: 36,
  handleCursorGap: 24,
  handleButtonSize: 32,
  handleOverlap: 16,
} as const

/** 调试可视化开关默认值（对齐 canvasHostCore DEFAULT_DEBUG_VISUAL；作为本插件 config 的初始值） */
export const DEFAULT_THEME_DEBUG = {
  handleDebug: false,
  connectionSnapDebugVisible: false,
} as const

/** 本插件声明"可配置项 → EDGE_VISUAL 字段"的映射（供宿主/demo 在 UI 改动后按 key 窄更新对应一处，不整图重建） */
export const EDGE_SETTING_KEYS: ReadonlyArray<keyof typeof DEFAULT_THEME_EDGE> = Object.keys(
  DEFAULT_THEME_EDGE,
) as (keyof typeof DEFAULT_THEME_EDGE)[]

/** 本插件声明"可配置项 → 端口参数(CanvasParams)"的映射 */
export const HANDLE_SETTING_KEYS: ReadonlyArray<keyof typeof DEFAULT_THEME_HANDLE> = Object.keys(
  DEFAULT_THEME_HANDLE,
) as (keyof typeof DEFAULT_THEME_HANDLE)[]

/** 本插件声明"可配置项 → 调试可视化开关(CanvasDebug)"的映射 */
export const DEBUG_SETTING_KEYS: ReadonlyArray<keyof typeof DEFAULT_THEME_DEBUG> = Object.keys(
  DEFAULT_THEME_DEBUG,
) as (keyof typeof DEFAULT_THEME_DEBUG)[]

/**
 * 本插件的可配置项 schema（P4：模块级 Config）。
 * 字段类型/默认对齐 DEFAULT_THEME_EDGE；group/label/options 供 UI 面板按组分、长控件、显示中文文案。
 * 内核装配时经它校验 + 补默认，apply(ctx, config) 收到的即完整 config。
 */
export const Config: ConfigSchema = {
  edgeType: {
    type: 'select',
    default: DEFAULT_THEME_EDGE.edgeType,
    label: '线型',
    group: '连线',
    description: '连线在两节点之间的走线形态，贝塞尔最平滑，直角/折线更贴近工程图。',
    options: [
      { value: 'bezier', label: '贝塞尔' },
      { value: 'straight', label: '直线' },
      { value: 'step', label: '直角' },
      { value: 'smoothstep', label: '圆角折线' },
    ],
  },
  edgeColor: {
    type: 'color',
    default: DEFAULT_THEME_EDGE.edgeColor,
    label: '连线颜色',
    group: '连线',
    description: '默认连线的颜色，改动后画布上现有连线实时跟随。',
  },
  edgeLineWidth: {
    type: 'number',
    default: DEFAULT_THEME_EDGE.edgeLineWidth,
    min: 1,
    max: 6,
    label: '线宽',
    group: '连线',
    description: '连线的粗细（像素）。值越大线条越明显。',
  },
  edgeVisible: {
    type: 'boolean',
    default: DEFAULT_THEME_EDGE.edgeVisible,
    label: '显示连线',
    group: '连线',
    description: '关闭后连线整体隐藏（只留交互热区）。',
  },
  edgeMarkerSize: {
    type: 'number',
    default: DEFAULT_THEME_EDGE.edgeMarkerSize,
    min: 4,
    max: 24,
    label: '箭头大小',
    group: '连线',
    description: '目标端箭头的大小（开启箭头后生效）。',
  },
  edgeGlowIntensity: {
    type: 'number',
    default: DEFAULT_THEME_EDGE.edgeGlowIntensity,
    min: 0.1,
    max: 3,
    label: '辉光强度',
    group: '连线',
    description: '选中/相连连线的外圈辉光强度。',
  },
  edgeGlowColor: {
    type: 'color',
    default: DEFAULT_THEME_EDGE.edgeGlowColor,
    label: '辉光颜色',
    group: '连线',
    description: '辉光/流光高亮使用的颜色（缺省跟随线色）。',
  },
  edgeAnimated: {
    type: 'boolean',
    default: DEFAULT_THEME_EDGE.edgeAnimated,
    label: '选中流光',
    group: '连线动效与箭头',
    description: '选中连线时沿路径流动的高亮光效。',
  },
  edgeDashed: {
    type: 'boolean',
    default: DEFAULT_THEME_EDGE.edgeDashed,
    label: '虚线',
    group: '连线动效与箭头',
    description: '以虚线绘制连线，常用于"可选/临时"关系的表达。',
  },
  edgeMarkerEnd: {
    type: 'boolean',
    default: DEFAULT_THEME_EDGE.edgeMarkerEnd,
    label: '箭头',
    group: '连线动效与箭头',
    description: '在连线目标端显示箭头，标明方向。',
  },
  edgeGlowEnabled: {
    type: 'boolean',
    default: DEFAULT_THEME_EDGE.edgeGlowEnabled,
    label: '辉光',
    group: '连线动效与箭头',
    description: '连线外圈的柔光效果，增强视觉层次。',
  },
  handleRadius: {
    type: 'number',
    default: DEFAULT_THEME_HANDLE.handleRadius,
    min: 30,
    max: 200,
    label: '端口吸附半径',
    group: '端口',
    description: '端口半圆形交互区/吸附范围的大小。',
  },
  handleRestOffset: {
    type: 'number',
    default: DEFAULT_THEME_HANDLE.handleRestOffset,
    min: 0,
    max: 100,
    label: '端口偏移',
    group: '端口',
    description: '鼠标离开后圆球回到节点外侧的默认距离。',
  },
  handleCursorGap: {
    type: 'number',
    default: DEFAULT_THEME_HANDLE.handleCursorGap,
    min: 0,
    max: 80,
    label: '光标间隙',
    group: '端口',
    description: '圆球跟随鼠标时与光标的错开距离。',
  },
  handleButtonSize: {
    type: 'number',
    default: DEFAULT_THEME_HANDLE.handleButtonSize,
    min: 16,
    max: 64,
    label: '按钮大小',
    group: '端口',
    description: '浮动端口圆球按钮的直径。',
  },
  handleOverlap: {
    type: 'number',
    default: DEFAULT_THEME_HANDLE.handleOverlap,
    min: 0,
    max: 50,
    label: '覆盖距离',
    group: '端口',
    description: '半圆交互区向节点内侧覆盖后被裁掉的宽度。',
  },
  handleDebug: {
    type: 'boolean',
    default: DEFAULT_THEME_DEBUG.handleDebug,
    label: '端口调试',
    group: '调试',
    description: '打开后，端口上会画出半圆交互区/圆心/归位点/鼠标点辅助线，便于校准端口几何。',
  },
  connectionSnapDebugVisible: {
    type: 'boolean',
    default: DEFAULT_THEME_DEBUG.connectionSnapDebugVisible,
    label: '吸附调试',
    group: '调试',
    description: '打开后，拖线悬停到某节点时画出它的端口吸附带与卡片接收区，便于校准吸附判定。',
  },
}

/** apply 收到的 config TS 类型（与 schema 对齐） */
export interface ThemeConfig extends InferConfig<typeof Config> {}

export function apply(ctx: Context, config?: ThemeConfig) {
  // P4：config 已经内核经 Config schema 校验 + 补默认；这里无需再手写 settings.define（声明即 Config 导出）。
  // 如需在插件内"就地订阅自己 config 的变化并窄更新"，可 ctx.settings.onChange(name, ...)（demo 侧已演示该链路）。
  void config

  // 渲染皮：nodeShell/edge/background/edgeDefaultType
  ctx.theme.register('nodeShell', BaseNode) // 完整节点壳（收编自 core）
  ctx.theme.register('edge', CustomEdge) // 完整自定义连线（收编自 core）
  ctx.theme.register('background', DefaultBackground) // 画布背景
  ctx.theme.register('connectionLine', ConnectionLine) // 拖线临时连接线（canvas-render #connection-line 渲染它）
  ctx.theme.register('edgeDefaultType', 'custom')
  // 设置面板皮：settingsPanel 槽默认赢家（渲染抽象层 SettingsHost 消费 winner，把 ctx.settings 实时喂给它）；
  // 其它宿主想换皮装个 order 更小的插件 `ctx.theme.register('settingsPanel', 新组件, {order:-1})` 即顶替。
  ctx.theme.register('settingsPanel', PluginSettingsDialog, { id: 'default', order: 0 })
}

/** 兼容旧装配的 PluginModule 出口 */
export const themeDefaultPlugin: PluginModule = { name, inject, Config, apply }
