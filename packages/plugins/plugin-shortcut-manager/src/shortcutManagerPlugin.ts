/**
 * plugin-shortcut-manager —— 快捷键帮助面板插件（v2 独立包，复刻老版 shortcut-manager 的 Ctrl+/ 帮助）。
 *
 * 老版做了什么：ShortcutManager 单例注册中心 + 重映射/冲突检测 UI + Ctrl+/ 打开帮助面板 + 导出/导入键位。
 *
 * v2 分工（薄适配包，不重复造、零耦合）：
 * - 注册中心 → 命令注册表的 keys 字段（渲染层 CanvasHost 统一分发；无独立 shortcut 表）。
 * - 冲突检测 → 本包纯逻辑 buildShortcutHelpList 里暴露重复 combo 检测（见 shortcutGroups）。
 * - Ctrl+/ 帮助面板 → 命令 shortcut-manager:help（keys: ['mod+/']），浮层经 overlay 槽挂载。
 * - 键位重映射/持久化 → v2 命令 keys 是静态声明，运行期重映射需内核支持（缺口，见文件尾注释）。
 *
 * UI 方式：overlay 槽 occupant（宿主已渲染 overlay 槽），面板显隐由本插件注入的响应式服务状态
 * 控制（命令切换同对象）。面板读 ctx.get('command').list() 实时枚举带 keys 的命令。
 */
import { reactive } from 'vue'
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import type { CommandService } from '@mini-canvas/canvas-core-v2'
import ShortcutHelpPanel from './ShortcutHelpPanel.vue'

declare module '@mini-canvas/canvas-core-v2' {
  interface Context {
    command: CommandService
  }
}

export const name = 'shortcut-manager'

/** 帮助面板共享状态（命令与组件读写同一响应式对象） */
export interface ShortcutManagerState {
  visible: boolean
}

export function apply(ctx: Context): void {
  const state: ShortcutManagerState = reactive({ visible: false })
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
    areas: ['pane'],
    order: 5,
    icon: 'keyboard',
    run: () => {
      state.visible = !state.visible
    },
  })

  // 缺口注释：v1 的键位重映射/持久化（把某命令改绑到别的键、localStorage 记忆）依赖运行期改
  // CommandDef.keys。内核 CommandRegistry 是静态声明、无运行期改 keys API —— 若日后需要，
  // 应补内核命令服务的 remap 能力（持久化走 save.set('shortcut' type)），而非本包绕过。
}

/** 兼容旧装配的 PluginModule 出口 */
export const shortcutManagerPlugin: PluginModule = { name, apply }
