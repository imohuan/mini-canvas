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
import BaseNode from './BaseNode.vue'
import CustomEdge from './CustomEdge.vue'
import DefaultBackground from './DefaultBackground.vue'

export const name = 'theme-default'
export const inject = [] as string[]

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
    options: [
      { value: 'bezier', label: '贝塞尔' },
      { value: 'straight', label: '直线' },
      { value: 'step', label: '直角' },
      { value: 'smoothstep', label: '圆角折线' },
    ],
  },
  edgeColor: { type: 'color', default: DEFAULT_THEME_EDGE.edgeColor, label: '连线颜色', group: '连线' },
  edgeLineWidth: { type: 'number', default: DEFAULT_THEME_EDGE.edgeLineWidth, min: 1, max: 6, label: '线宽', group: '连线' },
  edgeAnimated: { type: 'boolean', default: DEFAULT_THEME_EDGE.edgeAnimated, label: '选中流光', group: '连线动效与箭头' },
  edgeDashed: { type: 'boolean', default: DEFAULT_THEME_EDGE.edgeDashed, label: '虚线', group: '连线动效与箭头' },
  edgeMarkerEnd: { type: 'boolean', default: DEFAULT_THEME_EDGE.edgeMarkerEnd, label: '箭头', group: '连线动效与箭头' },
  edgeGlowEnabled: { type: 'boolean', default: DEFAULT_THEME_EDGE.edgeGlowEnabled, label: '辉光', group: '连线动效与箭头' },
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
}

/** 兼容旧装配的 PluginModule 出口 */
export const themeDefaultPlugin: PluginModule = { name, inject, Config, apply }
