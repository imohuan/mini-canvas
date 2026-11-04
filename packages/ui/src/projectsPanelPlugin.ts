/**
 * 项目页示例面板插件（ui-shell 自带的最小演示）。
 *
 * 它只做两件事，用来证明「应用级插件能在项目页工作」：
 * - apply 只登记槽位，不依赖 doc / selection，所以项目页就能启动；
 * - 面板里用按钮演示「没有画布时禁用并给出可见提示」。
 *
 * 业务插件照这个模式写：apply 里 ctx.slots.register('app.projects.main', …)，
 * 需要画布能力时用 ctx.tryGet('doc') 现取，不要在 apply 里缓存。
 */
import { markRaw } from 'vue'
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import ProjectsPanelDemo from './components/projects/ProjectsPanelDemo.vue'

export const name = 'ui-projects-panel'
export const inject = [] as string[]

export function apply(ctx: Context): void {
  ctx.slots.register('app.projects.main', {
    id: 'ui-projects-panel/demo',
    order: 10,
    component: markRaw(ProjectsPanelDemo),
    meta: { title: '项目页面板示例' },
  })
}

export const projectsPanelPlugin: PluginModule = { name, inject, apply }
