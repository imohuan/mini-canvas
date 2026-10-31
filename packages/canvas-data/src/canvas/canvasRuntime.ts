/**
 * canvasRuntime —— 基础插件持有的画布内部运行时。
 *
 * Spec 3.1 只允许 7 个基础服务名：`command` / `nodeFactory` / `nodeRegistry` /
 * `themeRegistry` 退出服务表，但能力糖、画布命令和渲染宿主仍需要同一批实例。
 * 把实例收在这里，插件不按旧名取容器，宿主也不必重复注入。
 *
 * 为什么不用全局单例：两个画布宿主会各有一份运行时。绑定随基础插件 fiber
 * 的 apply/回收成对发生；读取方每次现取，不缓存。
 */
import type { CommandService, SettingsStore } from '@mini-canvas/kernel'
import type { NodeFactory } from './nodeFactory'
import type { NodeRegistry } from './registry/nodeRegistry'
import type { ThemeRegistry } from './registry/themeRegistry'
import type { SettingsPersistService } from '../settingsPersist'

export interface CanvasRuntime {
  command: CommandService
  nodeFactory: NodeFactory
  nodeRegistry: NodeRegistry
  themeRegistry: ThemeRegistry
  settingsPersist?: SettingsPersistService
}

let runtime: CanvasRuntime | undefined

export function setCanvasRuntime(next: CanvasRuntime | undefined): void {
  runtime = next
}

export function canvasRuntime(): CanvasRuntime | undefined {
  return runtime
}

/** 能力层仍需要 SettingsStore；它由能力层自身内置，不占用基础服务名。 */
export type CanvasSettingsStore = SettingsStore
