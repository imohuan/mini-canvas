/**
 * 项目页「组件库」页签（ui-shell 自带）。
 *
 * 直接把 ui-kit-shadcn 的展厅注册到项目页左栏（app.projects.tabs）：
 * 卡片与配置条就是组件库预览页那一份，不另建插件，也不复制组件。
 *
 * 它同时是「项目页插件页签」的最小样板：
 * - apply 只登记槽位，不依赖 doc / selection，所以项目页就能启动；
 * - meta 里给 title / icon，宿主负责画左栏、切整页。
 */
import { markRaw } from 'vue'
import { BlocksIcon } from 'lucide-vue-next'
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import ProjectsShowcaseTab from './components/projects/ProjectsShowcaseTab.vue'

export const name = 'ui-projects-panel'
export const inject = [] as string[]

export function apply(ctx: Context): void {
  ctx.slots.register('app.projects.tabs', {
    id: 'ui-projects-panel/component-kit',
    order: 30,
    component: markRaw(ProjectsShowcaseTab),
    meta: {
      title: '组件库',
      icon: BlocksIcon,
      hint: '按钮、输入框、浮层等通用组件；改尺寸 / 圆角立刻生效',
    },
  })
}

export const projectsPanelPlugin: PluginModule = { name, inject, apply }
