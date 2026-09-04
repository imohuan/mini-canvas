// plugin-theme-default —— 画布"默认主题"插件（示例：插件里用 vue 组件替换连线/背景 UI）。
//
// 职责演示：主题插件经 registerThemeSlot 把自写 vue 组件填进画布槽位，宿主(demo)装配时消费。
// 本包只演示"替换 UI"，不碰节点内容(那是 node 插件的事)。要换皮就换/加主题插件。
//
// 纯逻辑 + vue 组件句柄都经 opaque 传递；依赖 @mini-canvas/canvas-core-v2 的 registerThemeSlot。
import { registerThemeSlot } from '@mini-canvas/canvas-core-v2'
import type { PluginModule } from '@mini-canvas/canvas-core-v2'
import DefaultEdge from './DefaultEdge.vue'
import DefaultBackground from './DefaultBackground.vue'

export const themeDefaultPlugin: PluginModule = {
  name: 'theme-default',
  setup(ctx) {
    registerThemeSlot(ctx, 'edge', DefaultEdge) // 用插件自己的连线组件替换宿主默认
    registerThemeSlot(ctx, 'background', DefaultBackground) // 插件自己的画布背景
    registerThemeSlot(ctx, 'edgeDefaultType', 'custom')
  },
}
