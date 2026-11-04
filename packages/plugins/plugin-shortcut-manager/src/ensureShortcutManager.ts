/**
 * 快捷键管理器的**唯一**创建入口。
 *
 * 为什么需要它：设置页的配置面板和外壳的快捷键帮助都读同包模块级管理器，
 * 谁先打开谁创建。以前外壳自己复制了一份创建逻辑，设置页插件再建一份就成两套；
 * 现在两边都调这里，拿到的永远是同一个实例。
 */
import { createShortcutRemapEngine } from './shortcutRemapEngine'
import { createV2ShortcutManager, type V2ShortcutManager } from './v2ShortcutManager'
import { getShortcutManager, setShortcutManager } from './shortcutState'

/** 建管理器只需要两样：命令表 + 存档（缺存档时重映射不落盘，其余照常）。 */
export interface ShortcutManagerHost {
  command?: Parameters<typeof createV2ShortcutManager>[0]
  save?: Parameters<typeof createShortcutRemapEngine>[1]
}

let engine: ReturnType<typeof createShortcutRemapEngine> | undefined

/** 已建过就复用；没有命令表返回 undefined（设置页显示空态，外壳帮助面板为空）。 */
export function ensureShortcutManager(host: ShortcutManagerHost | undefined): V2ShortcutManager | undefined {
  const existing = getShortcutManager()
  if (existing) return existing
  const command = host?.command
  if (!command || typeof command.has !== 'function') return undefined

  const remapEngine = createShortcutRemapEngine(command, host?.save)
  void remapEngine.restore()
  engine = remapEngine
  const manager = createV2ShortcutManager(command, {
    remap: (id, keys) => remapEngine.remap(id, keys),
    reset: (id) => remapEngine.reset(id),
    snapshot: () => remapEngine.snapshot(),
  })
  setShortcutManager(manager)
  return manager
}

/** 本包是否已经建过管理器（测试用）。 */
export function isShortcutManagerInstalled(): boolean {
  return Boolean(getShortcutManager())
}

/** 持久化引擎：完整插件用它订阅「shortcut 后端被切到云端」后重读键位。 */
export function getShortcutRemapEngine(): ReturnType<typeof createShortcutRemapEngine> | undefined {
  return engine
}

/** 测试重置模块级单例。 */
export function resetShortcutManager(): void {
  setShortcutManager(undefined)
  engine = undefined
}
