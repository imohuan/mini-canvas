// 文件：packages/docs/public/examples/slots/plugin-demo-badge/src/index.ts
// 格式：TypeScript 模块（插件入口：导出 name / inject / apply）
// 位置：一个可安装插件包的源码入口

import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import ZoomBadgeOverlay from './ZoomBadgeOverlay.vue'

export const name = 'demo-badge'

/**
 * 不写 inject：本插件只往槽里放组件，不读任何按名取的服务。
 * overlay 槽由渲染宿主渲染（不是服务），所以也不需要依赖声明。
 */
export const inject = [] as string[]

export function apply(ctx: Context): void {
  // ① 挂进 overlay 槽。order 给 10：数值本身不重要，
  //    重要的是"同一槽里谁先谁后"（越小越靠前）。
  ctx.slots.register('overlay', {
    id: 'demo-badge',
    order: 10,
    component: ZoomBadgeOverlay,
    meta: { title: '缩放角标' },
  })
  // ② 不用写清理：register 的撤销随本插件作用域自动回收（卸载即摘）
}

/** 兼容旧装配的 PluginModule 出口 */
export const demoBadgePlugin: PluginModule = { name, inject, apply }

