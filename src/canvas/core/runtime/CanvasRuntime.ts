import type { PluginManager } from '../plugins/PluginManager'
import type { EventBus } from '../plugins/PluginContext'
import type { NodeRegistry } from '../registry/NodeRegistry'
import type { MenuRegistry } from '../menu/MenuRegistry'
import { ShortcutManager } from '../plugins/ShortcutManager'

export class CanvasRuntime {
  readonly pluginManager: PluginManager
  readonly eventBus: EventBus
  readonly nodeRegistry: NodeRegistry
  readonly menuRegistry: MenuRegistry
  readonly shortcutManager!: ShortcutManager
  readonly vueFlowInstance: any

  constructor(
    pluginManager: PluginManager,
    eventBus: EventBus,
    nodeRegistry: NodeRegistry,
    menuRegistry: MenuRegistry,
    vueFlowInstance: any,
  ) {
    this.pluginManager = pluginManager
    this.eventBus = eventBus
    this.nodeRegistry = nodeRegistry
    this.menuRegistry = menuRegistry
    this.vueFlowInstance = vueFlowInstance
  }

  getPluginAPI<T = unknown>(name: string): T | null {
    return this.pluginManager.getPluginAPI<T>(name)
  }
}