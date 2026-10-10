// 文件：packages/docs/public/examples/canvas-render/settings-slot-host/src/index.ts
// 格式：TypeScript 模块（插件入口：导出 name / inject / apply）
// 位置：一个可安装插件包的源码入口
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import DemoOverlay from './DemoOverlay.vue'
import DemoNavItem from './DemoNavItem.vue'
import DemoSettingsPage from './DemoSettingsPage.vue'

export const name = 'panel-demo'
export const inject = [] as string[]   // ① 本插件只放 UI，不读按名取的服务

export function apply(ctx: Context): void {
  // ② 画布浮层：overlay 槽由 CanvasSurface 渲染（order 决定同槽内先后，越小越靠前）
  ctx.slots.register('overlay', {
    id: 'panel-demo/badge',
    order: 10,
    component: DemoOverlay,
    meta: { title: '缩放角标' },
  })

  // ③ 设置面板左导航：一条导航项（默认设置皮读 settingsNav 槽）
  ctx.slots.register('settingsNav', {
    id: 'panel-demo/nav',
    order: 50,
    component: DemoNavItem,
  })

  // ④ 设置页正文：进键形如 settingsGroup/<一级名>，与③的名称一致
  ctx.slots.register('settingsGroup/我的演示', {
    id: 'panel-demo/page',
    component: DemoSettingsPage,
  })

  // ⑤ 连设置项的声明一起给出（这样面板里就有 demoText 这一项了）
  ctx.settings.define('我的演示', {
    demoText: { type: 'string', default: '你好', label: '演示文本' },
  })
}

/** 兼容旧装配的 PluginModule 出口 */
export const panelDemoPlugin: PluginModule = { name, inject, apply }
