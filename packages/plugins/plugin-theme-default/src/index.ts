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

export function apply(ctx: Context) {
  ctx.theme.register('nodeShell', BaseNode) // 完整节点壳（收编自 core）
  ctx.theme.register('edge', CustomEdge) // 完整自定义连线（收编自 core）
  ctx.theme.register('background', DefaultBackground) // 画布背景
  ctx.theme.register('edgeDefaultType', 'custom')
}

/** 兼容旧装配的 PluginModule 出口 */
export const themeDefaultPlugin: PluginModule = { name, inject, apply }
