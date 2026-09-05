// plugin-theme-default —— 画布"默认主题"插件。
//
// 职责：把宿主渲染器收编成主题插件提供的默认皮 ——
//   nodeShell = BaseNode（完整节点壳：端口/标题就地改名/选中环/LOD/浮动端口）
//   edge      = CustomEdge（完整自定义边：流光/箭头/双击剪切）
//   background= DefaultBackground（跟随画布的圆点底）
// core 只留"槽位 + 令牌"契约，不再硬编码默认 .vue 渲染器；装本插件即有默认皮。
//
// 经 registerThemeSlot 填进 themeRegistry，宿主(demo/预览)装配时消费；热卸则回退(无皮)。
import { registerThemeSlot } from '@mini-canvas/canvas-core-v2'
import type { PluginModule } from '@mini-canvas/canvas-core-v2'
import BaseNode from './BaseNode.vue'
import CustomEdge from './CustomEdge.vue'
import DefaultBackground from './DefaultBackground.vue'

export const themeDefaultPlugin: PluginModule = {
  name: 'theme-default',
  setup(ctx) {
    registerThemeSlot(ctx, 'nodeShell', BaseNode) // 完整节点壳（收编自 core）
    registerThemeSlot(ctx, 'edge', CustomEdge) // 完整自定义连线（收编自 core）
    registerThemeSlot(ctx, 'background', DefaultBackground) // 画布背景
    registerThemeSlot(ctx, 'edgeDefaultType', 'custom')
  },
}
