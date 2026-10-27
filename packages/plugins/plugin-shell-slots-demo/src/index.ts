/**
 * plugin-shell-slots-demo —— 外壳插槽演示插件。
 *
 * 目的：验证 @mini-canvas/ui 新增的外壳插槽真的可用（注册 → 渲染 → 卸载回收），
 * 并演示**四种注册/形态**（含同槽多 occupant 与复用内置 UI）：
 *   插槽：shell.status.end / shell.dock.start / shell.dock.end / shell.drawer.tabs
 *   形态：A 复用内置按钮（图标）/ B 复用内置按钮（带文案）/ C 自绘组件 / D 同槽多条
 *
 * 为什么这样写：
 * - 只 import ctx / canvas-render 的公开面，不 import @mini-canvas/ui（依赖方向红线）；
 * - 抽屉页签按钮与面板的“按钮 + 面板”两件套一起登记（缺 meta.panel 会被宿主忽略）；
 * - 注册进本插件 scope，卸载时全部 occupant 自动回收（由内核保证，无需手写清理）。
 *
 * 装载方式：
 * - UMD：pnpm build → dist/plugin-shell-slots-demo.js 给「插件管理」（script 全局装载）；
 * - ESM：pnpm build:esm → dist/plugin-shell-slots-demo.esm.js 可经 manager.install({ url }) 装。
 */
import { markRaw } from 'vue'
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import StatusBadge from './StatusBadge.vue'
import DockEndButton from './DockEndButton.vue'
import DrawerTabButton from './DrawerTabButton.vue'
import DrawerPanel from './DrawerPanel.vue'
import ThemedButtons from './ThemedButtons.vue'

export const name = 'shell-slots-demo'
export const inject = [] as string[]

export function apply(ctx: Context): void {
  // ① 状态条末尾（同槽两条：C 自绘徽章 + A 内置图标按钮）
  ctx.slots.register('shell.status.end', {
    id: 'shell-slots-demo/status',
    order: 40,
    component: markRaw(StatusBadge),
    meta: { title: '插槽演示·状态徽章' },
  })
  ctx.slots.register('shell.status.end', {
    id: 'shell-slots-demo/status-themed',
    order: 41,
    component: markRaw(ThemedButtons),
    meta: { title: '插槽演示·内置按钮', variant: 'icon' },
  })

  // ② 底栏最前：内置图标按钮（A）
  ctx.slots.register('shell.dock.start', {
    id: 'shell-slots-demo/dock-start-themed',
    order: 10,
    component: markRaw(ThemedButtons),
    meta: { title: '插槽演示·内置按钮', variant: 'icon' },
  })

  // ③ 底栏末尾（同槽两条：B 内置文本按钮 + C 自绘按钮）
  ctx.slots.register('shell.dock.end', {
    id: 'shell-slots-demo/dock',
    order: 40,
    component: markRaw(DockEndButton),
    meta: { title: '插槽演示·底栏按钮' },
  })
  ctx.slots.register('shell.dock.end', {
    id: 'shell-slots-demo/dock-themed',
    order: 41,
    component: markRaw(ThemedButtons),
    meta: { title: '插槽演示·内置按钮', variant: 'text' },
  })

  // ④ 左抽屉完整页签：按钮 + meta.panel（宿主按 active/onSelect/host 渲染）
  ctx.slots.register('shell.drawer.tabs', {
    id: 'shell-slots-demo/tab',
    order: 40,
    component: markRaw(DrawerTabButton),
    meta: { title: '演示', panel: markRaw(DrawerPanel) },
  })
}

export const shellSlotsDemoPlugin: PluginModule = { name, inject, apply }
export default shellSlotsDemoPlugin
