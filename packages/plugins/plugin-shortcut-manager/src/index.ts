// plugin-shortcut-manager —— 快捷键帮助面板（Ctrl/Cmd+/ 开合；命令 keys 为唯一数据源）。
export { shortcutManagerPlugin, name, apply } from './shortcutManagerPlugin'
export type { ShortcutManagerState } from './shortcutManagerPlugin'
export {
  buildShortcutHelpList,
  toGroupedRows,
  type ShortcutCommand,
  type ShortcutHelpItem,
  type ShortcutRow,
} from './shortcutGroups'
