/**
 * plugin-shortcut-manager —— 快捷键帮助面板插件（v2 复刻老版 shortcut-manager）。
 *
 * 老版做了什么：ShortcutManager 集中注册中心 + Ctrl+/ 帮助面板（搜索/分组/图标/描述/系统冲突提醒/
 * 行内重映射/导出导入/恢复默认）。
 *
 * v2 分工（薄适配，不重复造注册中心）：
 * - 注册中心 → 命令注册表的 keys 字段（渲染层 CanvasHost 统一分发；无独立 shortcut 表）。
 * - 帮助列表/冲突/重映射/导入导出 → 本包 v2ShortcutManager 适配器（纯逻辑可单测），
 *   数据源 = command registry，remap 走 CommandRegistry.remapKeys/resetKeys。
 * - 持久化 → shortcutRemapEngine（save type='shortcut' remap 表）。
 * - Ctrl+/ 帮助面板 → 命令 shortcut-manager:help（keys: ['mod+/']）+ overlay 槽 occupant；
 *   浮层 = 复刻老版 ShortcutHelpPanel.vue / RemapPanel.vue / ShortcutKeys.vue。
 *
 * UI 方式：overlay 槽 occupant（宿主已渲染 overlay 槽），面板显隐由同包模块级状态控制
 * （命令切换同一对象）。面板与本插件同包 import，不再占 shortcut-manager / shortcut-remap 服务名。
 */
import type { Context, PluginModule } from '@plume-canvas/canvas-base'
import ShortcutHelpPanel from './ShortcutHelpPanel.vue'
import SettingsShortcutPanel from './SettingsShortcutPanel.vue'
import { onShortcutManager, shortcutHelpState } from './shortcutState'
import { ensureShortcutManager, getShortcutRemapEngine } from './ensureShortcutManager'
import { commandRuntime } from '@plume-canvas/canvas-data'

export const name = 'shortcut-manager'

/** 帮助面板共享状态 + 管理器方法（命令/组件/重映射面板读同一注入对象） */
export type { ShortcutManagerState } from './shortcutState'

export function apply(ctx: Context): void {
  const save = ctx.tryGet('save')
  // 管理器与设置页插件共用同一个单例：谁先起来谁建，后起的直接复用。
  // 命令注册表经运行时句柄取（command 服务名已并入 canvas；本插件不依赖它）。
  // 外壳自带的帮助面板可能在画布之前就打开；管理器晚一点建好也要拿到。
  const off = onShortcutManager((manager) => {
    Object.assign(shortcutHelpState, manager)
  })
  ctx.effect(() => () => off())
  const manager = ensureShortcutManager({ command: commandRuntime(), save })
  if (!manager) return
  // shortcut 域后端被云插件切到云端后，重读一次（否则云端存的重映射键位刷新后进不来）
  const remapEngine = getShortcutRemapEngine()
  if (remapEngine) ctx.effect(() => remapEngine.subscribe())

  // 浮层：overlay 槽 occupant（宿主已渲染该槽）。显隐由 state.visible 控制。
  ctx.slots.register('overlay', {
    id: 'shortcut-manager/help',
    order: 200,
    component: ShortcutHelpPanel,
    meta: { title: '快捷键帮助' },
  })

  // 设置页「快捷键」是配置页：同一个管理器、同一套重映射组件，不再只广播一个动作。
  // 两套设置皮按 id 命中这一页；底部的帮助浮层仍由上面的 overlay 槽保留。
  ctx.slots.register('settings.nav', {
    id: 'nav/personal/shortcuts',
    order: 20,
    component: SettingsShortcutPanel,
    meta: { title: '快捷键', category: '个人' },
  })
  // 主题设置页按名取这一件（不再静态 import 本包），换皮也能一起换。
  ctx.registryOf<unknown>('ui').add('settingsShortcutPanel', SettingsShortcutPanel, { id: 'shortcut-manager' })
  // 管理器也按名提供：主题设置页不再 import 本包，缺它就显示"暂无快捷键"。
  // shortcut-settings 可能先起并已上架同一实例，重复注入会被内核拒绝。
  if (!ctx.tryGet('shortcut-manager')) ctx.inject('shortcut-manager', manager)

  // Ctrl+/（或 Cmd+/）开/关帮助面板
  ctx.commands.register({
    id: 'shortcut-manager:help',
    title: '快捷键帮助',
    keys: ['mod+/'],
    order: 5,
    icon: 'keyboard',
    run: () => {
      shortcutHelpState.visible = !shortcutHelpState.visible
    },
  })

}

/** 插件模块出口 */
export const shortcutManagerPlugin: PluginModule = { name, apply }
