/**
 * 外壳插槽演示（demo-kit 的一间展台）。
 *
 * 目的：验证 @plume-canvas/ui 新增的外壳插槽真的可用（注册 → 渲染 → 卸载回收），
 * 并演示**四种注册/形态**（含同槽多 occupant 与复用主题 UI）：
 *   插槽：shell.status.end / shell.dock.start / shell.dock.end / shell.drawer.tabs
 *   形态：A 复用主题按钮（图标）/ B 复用主题按钮（带文案）/ C 自绘组件 / D 同槽多条
 *
 * 上下文边界（2026-10-28 用户口径）：
 * - apply(ctx) 只负责注册：往 slots 里放组件，不预先读 ui/doc/command；
 * - 组件各自 useCanvasContext() 拿 ctx，再取 ui/doc/command；
 * - 不 import 主题包 / @plume-canvas/ui；不读 window.PlumeUI。
 *
 * 注册进本插件 scope，卸载时 occupant 自动回收（由内核保证）。
 *
 * 装载方式：随 demo-kit 的 UMD 产物一起装（pnpm build → dist/plugin-demo-kit.js）。
 */
import { markRaw } from 'vue'
import type { Context } from '@plume-canvas/canvas-base'
import StatusBadge from './StatusBadge.vue'
import DockEndButton from './DockEndButton.vue'
import DrawerTabButton from './DrawerTabButton.vue'
import DrawerPanel from './DrawerPanel.vue'
import ThemedButtons from './ThemedButtons.vue'

export function apply(ctx: Context): void {
  // ① 状态条：自绘徽章排在缩放前面（before 指向同槽条目 id，不是槽名）
  ctx.slots.register('shell.status', {
    id: 'demo-kit/shell-status',
    order: 40,
    after: 'host/zoom',
    component: markRaw(StatusBadge),
    meta: { title: '插槽演示·状态徽章' },
  })
  
  // 同槽第二条：主题按钮排在缩放后面（after 目标存在 → 相对位置优先于 order）
  ctx.slots.register('shell.status', {
    id: 'demo-kit/shell-status-themed',
    order: 41,
    after: 'host/zoom',
    component: markRaw(ThemedButtons),
    meta: { title: '插槽演示·主题按钮', variant: 'icon' },
  })

  // ② 底栏：主题图标按钮插到“角色造型室”前面（before 指向内置锚点 host/roles）
  ctx.slots.register('shell.dock', {
    id: 'demo-kit/shell-dock-start',
    order: 10,
    before: 'host/roles',
    component: markRaw(ThemedButtons),
    meta: { title: '插槽演示·主题按钮', variant: 'icon' },
  })

  // ③ 底栏两条：自绘按钮放在快捷键前，主题文本按钮放在分隔线后
  //    （Agent 圆球是独立按钮、不在排序容器里，不能作为 before/after 目标）
  ctx.slots.register('shell.dock', {
    id: 'demo-kit/shell-dock',
    order: 40,
    before: 'host/shortcuts',
    component: markRaw(DockEndButton),
    meta: { title: '插槽演示·底栏按钮' },
  })
  ctx.slots.register('shell.dock', {
    id: 'demo-kit/shell-dock-themed',
    order: 41,
    after: 'host/separator',
    component: markRaw(ThemedButtons),
    meta: { title: '插槽演示·主题按钮', variant: 'text' },
  })

  // ④ 左抽屉完整页签：按钮 + meta.panel（宿主按 active/onSelect/host 渲染）
  ctx.slots.register('shell.drawer.tabs', {
    id: 'demo-kit/shell-drawer-tab',
    order: 40,
    // 演示"before 目标不存在时的兜底"：这里刻意写一个不存在的 id，
    // 排序会忽略它并按 order 落到两个内置页签之后。
    before: 'host/not-installed-tab',
    component: markRaw(DrawerTabButton),
    meta: { title: '演示', panel: markRaw(DrawerPanel) },
  })
}
