import type { CanvasPlugin, PluginContext, PluginInstallResult, Logger } from './types'
import { PluginLifecycle } from './types'
import type { PluginRegistry } from './PluginRegistry'

export class PluginInstaller {
  private registry: PluginRegistry
  private logger: Logger
  private contextFactory: (pluginName: string) => PluginContext
  private lifecycles = new Map<string, string>()
  private loadOrder: string[] = []

  constructor(
    registry: PluginRegistry,
    logger: Logger,
    contextFactory: (pluginName: string) => PluginContext,
  ) {
    this.registry = registry
    this.logger = logger
    this.contextFactory = contextFactory
  }

  setLifecycle(name: string, lifecycle: string): void {
    this.lifecycles.set(name, lifecycle)
  }

  getLifecycle(name: string): string | null {
    return this.lifecycles.get(name) ?? null
  }

  getLoadOrder(): string[] {
    return [...this.loadOrder]
  }

  async installOne(name: string, plugin: CanvasPlugin): Promise<void> {
    this.setLifecycle(name, PluginLifecycle.INSTALLING)
    const context = this.contextFactory(name)
    try {
      const result = await plugin.install(context, (plugin.options || {}) as Record<string, unknown>)
      if (result && typeof result === 'object') {
        this.registry.setInstallResult(name, result as PluginInstallResult)
      }
      this.registry.setContext(name, context)
      this.registry.registerPlugin(plugin)
      this.setLifecycle(name, PluginLifecycle.INSTALLED)
    } catch (err) {
      this.logger.error(`Plugin "${name}" install threw:`, err)
      this.setLifecycle(name, PluginLifecycle.ERROR)
      throw err
    }
  }

  async activateOne(name: string): Promise<void> {
    const current = this.lifecycles.get(name)
    if (current === PluginLifecycle.ACTIVE) return
    this.setLifecycle(name, PluginLifecycle.ACTIVATING)
    const plugin = this.registry.getPlugin(name)
    if (plugin?.activate) {
      try {
        await plugin.activate()
      } catch (err) {
        this.logger.error(`Plugin "${name}" activate threw:`, err)
        this.setLifecycle(name, PluginLifecycle.ERROR)
        throw err
      }
    }
    this.setLifecycle(name, PluginLifecycle.ACTIVE)
  }

  async uninstallOne(name: string): Promise<void> {
    this.setLifecycle(name, PluginLifecycle.UNINSTALLING)
    const result = this.registry.getPluginAPI(name) as PluginInstallResult | null
    const plugin = this.registry.getPlugin(name)
    if (result?.uninstall) {
      await result.uninstall()
    } else if (plugin?.uninstall) {
      await plugin.uninstall()
    }
    this.registry.remove(name)
    this.lifecycles.delete(name)
    this.loadOrder = this.loadOrder.filter(n => n !== name)
  }

  setLoadOrder(order: string[]): void {
    this.loadOrder = order
  }
}