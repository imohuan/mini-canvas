import type { PluginManager } from '../plugins/PluginManager'
import type { EventBus } from '../plugins/PluginContext'
import type { NodeRegistry } from '../registry/NodeRegistry'

export class CanvasRuntime {
  readonly pluginManager: PluginManager
  readonly eventBus: EventBus
  readonly nodeRegistry: NodeRegistry
  readonly vueFlowInstance: any

  constructor(
    pluginManager: PluginManager,
    eventBus: EventBus,
    nodeRegistry: NodeRegistry,
    vueFlowInstance: any,
  ) {
    this.pluginManager = pluginManager
    this.eventBus = eventBus
    this.nodeRegistry = nodeRegistry
    this.vueFlowInstance = vueFlowInstance
  }

  getPluginAPI<T = unknown>(name: string): T | null {
    return this.pluginManager.getPluginAPI<T>(name)
  }
}