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
import BaseNode from './components/node/BaseNode.vue'
import CustomEdge from './components/edge/CustomEdge.vue'
import DefaultBackground from './components/background/DefaultBackground.vue'
import PluginSettingsDialog from './components/settings/PluginSettingsDialog.vue'

export const name = 'theme-default'
export const inject = ["text"] as string[]

// 默认皮对应的连线外观默认值（与 engine DEFAULT_EDGE_VISUAL 对齐；作为本插件 config schema 的默认/单一数据源初始值）。
// 这样 demo/宿主经 ctx.settings 读到的初始外观 = 引擎默认，不改则有稳定基线。
export const DEFAULT_THEME_EDGE = {
  edgeType: 'bezier',
  edgeColor: '#3b82f6',
  edgeLineWidth: 2,
  edgeDashed: false,
  edgeAnimated: true,
  edgeMarkerEnd: false,
  edgeGlowEnabled: true,
} as const

/** 本插件声明"可配置项 → EDGE_VISUAL 字段"的映射（供宿主/demo 在 UI 改动后按 key 窄更新对应一处，不整图重建） */
export const EDGE_SETTING_KEYS: ReadonlyArray<keyof typeof DEFAULT_THEME_EDGE> = Object.keys(
  DEFAULT_THEME_EDGE,
) as (keyof typeof DEFAULT_THEME_EDGE)[]

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
  ctx.theme.register('edgeDefaultType', 'custom')
  // 设置面板皮：settingsPanel 槽默认赢家（渲染抽象层 SettingsHost 消费 winner，把 ctx.settings 实时喂给它）；
  // 其它宿主想换皮装个 order 更小的插件 `ctx.theme.register('settingsPanel', 新组件, {order:-1})` 即顶替。
  ctx.theme.register('settingsPanel', PluginSettingsDialog, { id: 'default', order: 0 })
}

/** 兼容旧装配的 PluginModule 出口 */
export const themeDefaultPlugin: PluginModule = { name, inject, Config, apply }
