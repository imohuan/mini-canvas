import type { CanvasPlugin, PluginContext, PluginInstallResult } from './types'

export class PluginRegistry {
  private plugins = new Map<string, CanvasPlugin>()
  private contexts = new Map<string, PluginContext>()
  private installResults = new Map<string, PluginInstallResult>()

  registerPlugin(plugin: CanvasPlugin): void {
    this.plugins.set(plugin.name, plugin)
  }

  setContext(name: string, context: PluginContext): void {
    this.contexts.set(name, context)
  }

  setInstallResult(name: string, result: PluginInstallResult): void {
    this.installResults.set(name, result)
  }

  getPlugin<T = CanvasPlugin>(name: string): T | null {
    return (this.plugins.get(name) as T) ?? null
  }

  getPluginAPI<T = unknown>(name: string): T | null {
    const result = this.installResults.get(name)
    return (result?.api as T) ?? null
  }

  getContext(name: string): PluginContext | null {
    return this.contexts.get(name) ?? null
  }

  remove(name: string): void {
    this.plugins.delete(name)
    this.contexts.delete(name)
    this.installResults.delete(name)
  }

  get installedNames(): string[] {
    return [...this.plugins.keys()]
  }
}