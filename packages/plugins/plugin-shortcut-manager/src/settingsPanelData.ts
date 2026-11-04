/**
 * 设置页快捷键面板的纯数据层。
 *
 * 设置页和帮助浮层是两种入口，但列表、冲突、导入导出必须共用同一个
 * V2ShortcutManager（命令注册表的 keys 是唯一数据源）。这里只做展示整形，
 * 不复制重映射引擎，也不新增持久化表。
 */
import type { DecoratedItem } from './shortcut-help-panel/useShortcutHelpPanel'
import { normalizeKeyForPlatform } from './keyLabels'
import type { V2ShortcutManager } from './v2ShortcutManager'

export const SETTINGS_SHORTCUT_GROUP_LABELS: Readonly<Record<string, string>> = {
  system: '系统',
  edit: '编辑',
  canvas: '画布',
  view: '视图',
  plugin: '插件',
}

export interface SettingsShortcutGroup {
  group: string
  items: DecoratedItem[]
}

const DESCRIPTIONS: Readonly<Record<string, string>> = {
  撤销: '回退最近一次操作',
  重做: '恢复被撤销的操作',
  删除选中: '移除当前选中的节点或连线',
  快捷键帮助: '查看与重映射所有快捷键',
}

const SYSTEM_RESERVED = new Set([
  'ctrl+t', 'ctrl+w', 'ctrl+shift+t', 'ctrl+shift+w', 'ctrl+tab', 'ctrl+shift+tab',
  'ctrl+1', 'ctrl+2', 'ctrl+3', 'ctrl+4', 'ctrl+5', 'ctrl+6', 'ctrl+7', 'ctrl+8', 'ctrl+9',
  'ctrl+n', 'ctrl+shift+n', 'ctrl+f', 'ctrl+p', 'ctrl+s', 'ctrl+shift+s',
  'ctrl+l', 'ctrl+r', 'ctrl+shift+r',
])

function isSystemReserved(keys: string): boolean {
  return Boolean(keys) && SYSTEM_RESERVED.has(normalizeKeyForPlatform(keys))
}

/** 帮助列表 + 系统保留键标记，按 v1 的五组语义排序。 */
export function buildSettingsShortcutGroups(manager: V2ShortcutManager | undefined): SettingsShortcutGroup[] {
  if (!manager) return []
  return manager.getHelpList().map((group) => ({
    group: group.group,
    items: group.items.map((item) => ({
      ...item,
      description: DESCRIPTIONS[item.command] ?? '',
      systemReserved: isSystemReserved(item.keys),
    })),
  }))
}

/** 搜索：命令名、键位、命令 id；mod 会按平台归一后再匹配一次。 */
export function filterSettingsShortcutGroups(
  groups: SettingsShortcutGroup[],
  query: string,
): SettingsShortcutGroup[] {
  const q = query.trim().toLowerCase()
  if (!q) return groups
  const normalized = normalizeKeyForPlatform(q)
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        item.command.toLowerCase().includes(q) ||
        item.keys.toLowerCase().includes(q) ||
        item.commandId.toLowerCase().includes(q) ||
        normalizeKeyForPlatform(item.keys).includes(normalized),
      ),
    }))
    .filter((group) => group.items.length > 0)
}
