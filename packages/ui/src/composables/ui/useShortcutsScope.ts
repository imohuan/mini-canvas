import { reactive } from 'vue'
import { buildV2HelpList, groupV2HelpList, keyPartsToLabels } from '@mini-canvas/plugin-shortcut-manager'
import type { FullHost } from './types'
import type { UiState } from './createUiState'

/**
 * 快捷键数据：唯一事实来源 = 命令注册表的 keys 字段。
 *
 * 每次打开面板现读一次；数组原地替换，绑定不换对象。
 * hostEl 用 getter 传入，保持原来的可选链与类型收窄写法。
 */
export function createShortcutsScope(state: UiState, hostElValue: () => unknown) {
  /** 注册表分组 → 面板中文组名 */
  const SHORTCUT_GROUP_LABEL: Record<string, string> = {
    system: '系统', edit: '编辑', canvas: '画布', view: '视图', plugin: '更多',
  }

  /** 从宿主命令注册表现读快捷键，按分组返回（拿不到宿主 → 空数组，面板相应为空） */
  function readShortcuts(): Array<{ group: string; items: Array<[string, string[]]> }> {
    const host = ((hostElValue() as { host?: FullHost } | null)?.host ?? hostElValue()) as (FullHost & { command?: { list(): Array<Record<string, unknown>> } }) | undefined
    const list = host?.command?.list?.()
    if (!list) return []
    const grouped = groupV2HelpList(
      buildV2HelpList(list as Parameters<typeof buildV2HelpList>[0]),
    )
    return grouped.map((g) => ({
      group: SHORTCUT_GROUP_LABEL[g.group] ?? g.group,
      items: g.items.map((it) => [it.command, keyPartsToLabels(it.keys)] as [string, string[]]),
    }))
  }

  /**
   * 面板展示用：只显示**真实注册**的快捷键（手势/鼠标操作不是命令、注册表里没有，不列）。
   * 用 reactive 数组（不是 ref）—— `ui` 是普通对象，模板里读 `ui.shortcuts` 时 ref 不会自动解包，
   * reactive 数组则能直接遍历；刷新时**原地替换内容**，绑定不换对象、不闪。
   */
  const shortcuts = reactive<Array<{ group: string; items: Array<[string, string[]]> }>>([])
  function refreshShortcuts(): void {
    shortcuts.splice(0, shortcuts.length, ...readShortcuts())
  }
  return { shortcuts, refreshShortcuts }
}

export type ShortcutsScope = ReturnType<typeof createShortcutsScope>

