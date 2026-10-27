/**
 * plugin-shell-slots-demo —— 外壳插槽演示插件。
 *
 * 目的：验证 @mini-canvas/ui 新增的三类外壳插槽真的可用（注册 → 渲染 → 卸载回收）：
 *   1. shell.status.end     —— 左下状态条末尾（徽章）
 *   2. shell.dock.end       —— 底部工具栏末尾（按钮，经 shell:open-drawer 命令开抽屉）
 *   3. shell.drawer.tabs    —— 左侧抽屉页签行（按钮 + meta.panel 正文）
 *
 * 为什么这样写：
 * - 只 import ctx / canvas-render 的公开面，不 import @mini-canvas/ui（依赖方向红线）；
 * - 抽屉页签按钮与面板的“按钮 + 面板”两件套一起登记（缺 meta.panel 会被宿主忽略）；
 * - 注册进本插件 scope，卸载时三条 occupant 自动回收（由内核保证，无需手写清理）。
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

export const name = 'shell-slots-demo'
export const inject = [] as string[]

export function apply(ctx: Context): void {
  // ① 状态条末尾：一个小徽章
  ctx.slots.register('shell.status.end', {
    id: 'shell-slots-demo/status',
    order: 40,
    component: markRaw(StatusBadge),
    meta: { title: '插槽演示·状态徽章' },
  })

  // ② 底栏末尾：一个按钮（点击经命令打开抽屉）
  ctx.slots.register('shell.dock.end', {
    id: 'shell-slots-demo/dock',
    order: 40,
    component: markRaw(DockEndButton),
    meta: { title: '插槽演示·底栏按钮' },
  })

  // ③ 左抽屉完整页签：按钮 + meta.panel（宿主按 active/onSelect/host 渲染）
  ctx.slots.register('shell.drawer.tabs', {
    id: 'shell-slots-demo/tab',
    order: 40,
    component: markRaw(DrawerTabButton),
    meta: { title: '演示', panel: markRaw(DrawerPanel) },
  })
}

export const shellSlotsDemoPlugin: PluginModule = { name, inject, apply }
export default shellSlotsDemoPlugin
