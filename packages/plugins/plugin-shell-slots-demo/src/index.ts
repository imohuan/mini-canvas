/**
 * plugin-shell-slots-demo —— 外壳插槽演示插件。
 *
 * 目的：验证 @mini-canvas/ui 新增的外壳插槽真的可用（注册 → 渲染 → 卸载回收），
 * 并演示**四种注册/形态**（含同槽多 occupant 与复用主题 UI）：
 *   插槽：shell.status.end / shell.dock.start / shell.dock.end / shell.drawer.tabs
 *   形态：A 复用主题按钮（图标）/ B 复用主题按钮（带文案）/ C 自绘组件 / D 同槽多条
 *
 * 上下文边界（2026-10-28 用户口径）：
 * - **只认 apply(ctx)**：ui 目录、doc、command 全从 ctx 取；不 import 主题包 / 渲染包；
 * - .vue 组件只收 props：不调用 useUiComponent / useCanvasContext，也不读 window 全局；
 * - 取件统一在 bindings.ts（纯数据 + 订阅），组件树之外也能单测。
 *
 * 注册进本插件 scope，卸载时 occupant 与订阅一起回收（由内核保证）。
 *
 * 装载方式：
 * - UMD：pnpm build → dist/plugin-shell-slots-demo.umd.js 给「插件管理」（script 全局装载）；
 * - ESM：pnpm build:esm → dist/plugin-shell-slots-demo.esm.js 可经 manager.install({ url }) 装。
 */
import { defineComponent, h, markRaw } from 'vue'
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import { createBindings, type CommandField, type DocField, type UiField } from './bindings'
import StatusBadge from './StatusBadge.vue'
import DockEndButton from './DockEndButton.vue'
import DrawerTabButton from './DrawerTabButton.vue'
import DrawerPanel from './DrawerPanel.vue'
import ThemedButtons from './ThemedButtons.vue'

export const name = 'shell-slots-demo'
export const inject = [] as string[]

export function apply(ctx: Context): void {
  // —— 上下文取件：只在这里读，组件只收 props ——
  const ui = ctx.registryOf<unknown>('ui') as unknown as UiField
  const bindings = createBindings({
    ui,
    doc: ctx.tryGet<DocField>('doc'),
    command: ctx.tryGet<CommandField>('command'),
  })
  ctx.effect(() => () => bindings.dispose())

  /** 主题按钮：订阅后的 Ref，换主题时包装组件重渲染 */
  const themedButton = (): unknown => bindings.button.value
  const nodeCount = (): number => bindings.nodeCount.value
  const openDrawer = (): void => bindings.openDrawer()

  // ① 状态条末尾（同槽两条：C 自绘徽章 + A 主题图标按钮）
  ctx.slots.register('shell.status.end', {
    id: 'shell-slots-demo/status',
    order: 40,
    component: markRaw(
      defineComponent({
        name: 'ShellSlotsDemoStatusSlot',
        setup() {
          return () => h(StatusBadge, { count: nodeCount() })
        },
      }),
    ),
    meta: { title: '插槽演示·状态徽章' },
  })
  ctx.slots.register('shell.status.end', {
    id: 'shell-slots-demo/status-themed',
    order: 41,
    component: markRaw(
      defineComponent({
        name: 'ShellSlotsDemoStatusThemed',
        setup() {
          return () => h(ThemedButtons, { button: themedButton(), variant: 'icon' })
        },
      }),
    ),
    meta: { title: '插槽演示·主题按钮', variant: 'icon' },
  })

  // ② 底栏最前：主题图标按钮（A）
  ctx.slots.register('shell.dock.start', {
    id: 'shell-slots-demo/dock-start-themed',
    order: 10,
    component: markRaw(
      defineComponent({
        name: 'ShellSlotsDemoDockStart',
        setup() {
          return () => h(ThemedButtons, { button: themedButton(), variant: 'icon' })
        },
      }),
    ),
    meta: { title: '插槽演示·主题按钮', variant: 'icon' },
  })

  // ③ 底栏末尾（同槽两条：B 主题文本按钮 + C 自绘按钮）
  ctx.slots.register('shell.dock.end', {
    id: 'shell-slots-demo/dock',
    order: 40,
    component: markRaw(
      defineComponent({
        name: 'ShellSlotsDemoDockEnd',
        setup() {
          return () => h(DockEndButton, { onOpen: openDrawer })
        },
      }),
    ),
    meta: { title: '插槽演示·底栏按钮' },
  })
  ctx.slots.register('shell.dock.end', {
    id: 'shell-slots-demo/dock-themed',
    order: 41,
    component: markRaw(
      defineComponent({
        name: 'ShellSlotsDemoDockEndThemed',
        setup() {
          return () => h(ThemedButtons, { button: themedButton(), variant: 'text' })
        },
      }),
    ),
    meta: { title: '插槽演示·主题按钮', variant: 'text' },
  })

  // ④ 左抽屉完整页签：按钮 + meta.panel（宿主按 active/onSelect/host 渲染）
  ctx.slots.register('shell.drawer.tabs', {
    id: 'shell-slots-demo/tab',
    order: 40,
    component: markRaw(
      defineComponent({
        name: 'ShellSlotsDemoDrawerTab',
        props: {
          active: { type: Boolean, default: false },
          onSelect: { type: Function, default: () => {} },
          host: { type: Object, required: true },
        },
        setup(props) {
          return () =>
            h(DrawerTabButton, {
              active: props.active,
              onSelect: props.onSelect,
              host: props.host,
            })
        },
      }),
    ),
    meta: {
      title: '演示',
      panel: markRaw(
        defineComponent({
          name: 'ShellSlotsDemoDrawerPanel',
          props: { host: { type: Object, required: true } },
          setup(props) {
            return () => h(DrawerPanel, { host: props.host, nodeCount: nodeCount(), button: themedButton() })
          },
        }),
      ),
    },
  })
}

export const shellSlotsDemoPlugin: PluginModule = { name, inject, apply }
export default shellSlotsDemoPlugin
