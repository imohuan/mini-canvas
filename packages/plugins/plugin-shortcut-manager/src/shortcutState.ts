/**
 * 快捷键帮助面板的同包共享状态。
 *
 * 为什么不走 ctx 服务：面板与管理器本来就是同一个插件的两部分，
 * 用模块级 reactive 即可共享，不必占 shortcut-manager / shortcut-remap 两个服务名。
 */
import { reactive } from 'vue'
import type { V2ShortcutManager } from './v2ShortcutManager'

export interface ShortcutManagerState extends V2ShortcutManager {
  visible: boolean
}

export const shortcutHelpState = reactive({ visible: false }) as ShortcutManagerState

let managerInstance: V2ShortcutManager | undefined

export function setShortcutManager(manager: V2ShortcutManager): void {
  managerInstance = manager
}

/** 同包组件取管理器（apply 之前为 undefined，面板按可选处理） */
export function getShortcutManager(): V2ShortcutManager | undefined {
  return managerInstance
}
