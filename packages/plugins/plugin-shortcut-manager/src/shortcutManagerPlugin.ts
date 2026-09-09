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
 * UI 方式：overlay 槽 occupant（宿主已渲染 overlay 槽），面板显隐由本插件注入的响应式服务
 * 状态控制（命令切换同一对象）。面板经 ctx.get('shortcut-manager') 拿「服务状态 + 管理器方法」。
 */
import { reactive } from 'vue'
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import type { CommandService, SaveService } from '@mini-canvas/canvas-core-v2'
import { createShortcutRemapEngine } from './shortcutRemapEngine'
import { createV2ShortcutManager, type V2ShortcutManager } from './v2ShortcutManager'
import ShortcutHelpPanel from './ShortcutHelpPanel.vue'

declare module '@mini-canvas/canvas-core-v2' {
  interface Context {
    command: CommandService
  }
}

export const name = 'shortcut-manager'

/** 帮助面板共享状态 + 管理器方法（命令/组件/重映射面板读同一注入对象） */
export interface ShortcutManagerState extends V2ShortcutManager {
  visible: boolean
}

export function apply(ctx: Context): void {
  const save = ctx.get<SaveService | undefined>('save')
  const command = ctx.get<CommandService>('command')

  // 持久化 remap 引擎：装配时读回上次 remap 表并批量应用
  const remapEngine = createShortcutRemapEngine(command, save)
  void remapEngine.restore()

  // v2 适配器：命令 registry（含 remap）+ 持久化引擎 → 老版面板需要的查询/改键 API
  const manager = createV2ShortcutManager(command, {
    remap: (id, keys) => remapEngine.remap(id, keys),
    reset: (id) => remapEngine.reset(id),
    snapshot: () => remapEngine.snapshot(),
  })

  // 单一注入对象：reactive visible + 管理器方法（组件同时拿显隐与功能）
  const state: ShortcutManagerState = reactive({ visible: false }) as ShortcutManagerState
  Object.assign(state, manager)
  ctx.inject('shortcut-manager', state)

  // 浮层：overlay 槽 occupant（宿主已渲染该槽）。显隐由 state.visible 控制。
  ctx.slots.register('overlay', {
    id: 'shortcut-manager-help',
    order: 200,
    component: ShortcutHelpPanel,
    meta: { title: '快捷键帮助' },
  })

  // Ctrl+/（或 Cmd+/）开/关帮助面板
  ctx.commands.register({
    id: 'shortcut-manager:help',
    title: '快捷键帮助',
    keys: ['mod+/'],
    order: 5,
    icon: 'keyboard',
    run: () => {
      state.visible = !state.visible
    },
  })

  // 兼容旧装配的 shortcut-remap 服务（程序化改键仍可调用）
  ctx.inject('shortcut-remap', remapEngine)
}

/** 兼容旧装配的 PluginModule 出口 */
export const shortcutManagerPlugin: PluginModule = { name, apply }
