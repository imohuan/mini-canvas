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
/** 管理器第一次建好时通知订阅方（云后端切换后需要重读键位）。 */
const listeners = new Set<(manager: V2ShortcutManager) => void>()

export function setShortcutManager(manager: V2ShortcutManager | undefined): void {
  managerInstance = manager
  if (!manager) return
  for (const listener of listeners) {
    try {
      listener(manager)
    } catch {
      /* 单个订阅者异常不阻断其它订阅 */
    }
  }
}

/** 订阅管理器就绪；已经就绪时立刻回调。返回取消订阅。 */
export function onShortcutManager(listener: (manager: V2ShortcutManager) => void): () => void {
  if (managerInstance) {
    listener(managerInstance)
    return () => {}
  }
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 同包组件取管理器（apply 之前为 undefined，面板按可选处理） */
export function getShortcutManager(): V2ShortcutManager | undefined {
  return managerInstance
}
