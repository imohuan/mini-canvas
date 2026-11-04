// plugin-shortcut-manager —— 快捷键帮助面板（Ctrl/Cmd+/ 开合；命令 keys 为唯一数据源）。
export { shortcutManagerPlugin, name, apply } from './shortcutManagerPlugin'
export {
  shortcutSettingsPlugin,
  name as shortcutSettingsName,
} from './shortcutSettingsPlugin'
export {
  ensureShortcutManager,
  getShortcutRemapEngine,
  isShortcutManagerInstalled,
  resetShortcutManager,
} from './ensureShortcutManager'
export type { ShortcutManagerHost } from './ensureShortcutManager'
export { default as SettingsShortcutPanel } from './SettingsShortcutPanel.vue'
export { setShortcutManager as installShortcutManager } from './shortcutState'
export type { ShortcutManagerState } from './shortcutManagerPlugin'
export {
  buildShortcutHelpList,
  toGroupedRows,
  type ShortcutCommand,
  type ShortcutHelpItem,
  type ShortcutRow,
} from './shortcutGroups'
export { createShortcutRemapEngine, SHORTCUT_SAVE_KEY } from './shortcutRemapEngine'
export type { ShortcutRemapMap } from './shortcutRemapEngine'
// 键帽翻译（'mod+shift+z' → ['Ctrl','Shift','Z']）：纯展示工具，任何面板想画键帽都能直接用
export { keyPartsToLabels, keyCapLabel, isMacPlatform, normalizeKeyForPlatform } from './keyLabels'
export {
  buildV2HelpList,
  groupV2HelpList,
  v2GroupOf,
  findV2Conflicts,
  normalizeCombo,
  createV2ShortcutManager,
} from './v2ShortcutManager'
export { buildSettingsShortcutGroups, filterSettingsShortcutGroups, SETTINGS_SHORTCUT_GROUP_LABELS } from './settingsPanelData'
export type { SettingsShortcutGroup } from './settingsPanelData'
export type {
  V2ShortcutHelpItem,
  V2ShortcutConflict,
  V2RemapResult,
  V2KeymapData,
  V2ShortcutManager,
} from './v2ShortcutManager'
