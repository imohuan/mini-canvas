// plugin-theme-default —— 画布"默认主题"插件。
//
// 职责：把宿主渲染器收编成主题插件提供的默认皮 ——
//   nodeShell = BaseNode（完整节点壳：端口/标题就地改名/选中环/LOD/浮动端口）
//   edge      = CustomEdge（完整自定义边：流光/箭头/双击剪切）
//   background= DefaultBackground（跟随画布的圆点底）
// core 只留"槽位 + 令牌"契约，不再硬编码默认 .vue 渲染器；装本插件即有默认皮。
//
// 经 apply(ctx) 里的 ctx.theme.register 填进 themeRegistry（多 occupant 开放槽）：
// 默认皮 = order 0 的 occupants；别的主题插件可用更小 order 一键顶替，热卸则回退到本默认皮。
import type { PluginModule, Context } from '@mini-canvas/canvas-base'
import BaseNode from './BaseNode.vue'
import CustomEdge from './CustomEdge.vue'
import DefaultBackground from './DefaultBackground.vue'

export const name = 'theme-default'
export const inject = [] as string[]

// 默认皮对应的连线外观默认值（与 engine DEFAULT_EDGE_VISUAL 对齐；作为本插件"可配置项"的 schema 默认/单一数据源初始值）。
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

export function apply(ctx: Context) {
  // ① 申报本主题的外观配置（目标 B2 分组化配置：schema 驱动 UI；单一数据源，改动经 ctx.settings.onChange 订阅）
  ctx.settings.define({
    group: '连线',
    items: {
      edgeType: { type: 'select', default: DEFAULT_THEME_EDGE.edgeType, label: '线型',
        options: [
          { value: 'bezier', label: '贝塞尔' },
          { value: 'straight', label: '直线' },
          { value: 'step', label: '直角' },
          { value: 'smoothstep', label: '圆角折线' },
        ] },
      edgeColor: { type: 'color', default: DEFAULT_THEME_EDGE.edgeColor, label: '连线颜色' },
      edgeLineWidth: { type: 'number', default: DEFAULT_THEME_EDGE.edgeLineWidth, min: 1, max: 6, label: '线宽' },
    },
  })
  ctx.settings.define({
    group: '连线动效与箭头',
    items: {
      edgeAnimated: { type: 'boolean', default: DEFAULT_THEME_EDGE.edgeAnimated, label: '选中流光' },
      edgeDashed: { type: 'boolean', default: DEFAULT_THEME_EDGE.edgeDashed, label: '虚线' },
      edgeMarkerEnd: { type: 'boolean', default: DEFAULT_THEME_EDGE.edgeMarkerEnd, label: '箭头' },
      edgeGlowEnabled: { type: 'boolean', default: DEFAULT_THEME_EDGE.edgeGlowEnabled, label: '辉光' },
    },
  })

  // ② 渲染皮：nodeShell/edge/background/edgeDefaultType
  ctx.theme.register('nodeShell', BaseNode) // 完整节点壳（收编自 core）
  ctx.theme.register('edge', CustomEdge) // 完整自定义连线（收编自 core）
  ctx.theme.register('background', DefaultBackground) // 画布背景
  ctx.theme.register('edgeDefaultType', 'custom')
}

/** 兼容旧装配的 PluginModule 出口 */
export const themeDefaultPlugin: PluginModule = { name, inject, apply }
