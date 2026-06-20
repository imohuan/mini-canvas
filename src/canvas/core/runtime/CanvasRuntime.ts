import type { PluginManager } from '../plugins/PluginManager'
import type { EventBus } from '../plugins/PluginContext'
import type { NodeRegistry } from '../registry/NodeRegistry'
import type { MenuRegistry } from '../menu/MenuRegistry'
import type { CommandRegistry } from '../registry/CommandRegistry'
import type { ToolbarRegistry } from '../registry/ToolbarRegistry'
import type { PanelRegistry } from '../registry/PanelRegistry'
import { ShortcutManager } from '../plugins/ShortcutManager'

/**
 * 画布运行时
 *
 * 持有所有注册中心实例，通过 provide/inject 供组件和插件访问。
 * PluginContext 创建时会引用这里的 registry 实例。
 */
export class CanvasRuntime {
  readonly pluginManager: PluginManager
  readonly eventBus: EventBus
  readonly nodeRegistry: NodeRegistry
  readonly menuRegistry: MenuRegistry
  /** 命令注册中心（中枢） */
  readonly commandRegistry: CommandRegistry
  /** Toolbar 按钮注册中心 */
  readonly toolbarRegistry: ToolbarRegistry
  /** Panel 设置项注册中心 */
  readonly panelRegistry: PanelRegistry
  readonly shortcutManager!: ShortcutManager
  readonly vueFlowInstance: any

  constructor(
    pluginManager: PluginManager,
    eventBus: EventBus,
    nodeRegistry: NodeRegistry,
    menuRegistry: MenuRegistry,
    commandRegistry: CommandRegistry,
    toolbarRegistry: ToolbarRegistry,
    panelRegistry: PanelRegistry,
    vueFlowInstance: any,
  ) {
    this.pluginManager = pluginManager
    this.eventBus = eventBus
    this.nodeRegistry = nodeRegistry
    this.menuRegistry = menuRegistry
    this.commandRegistry = commandRegistry
    this.toolbarRegistry = toolbarRegistry
    this.panelRegistry = panelRegistry
    this.vueFlowInstance = vueFlowInstance
  }

  getPluginAPI<T = unknown>(name: string): T | null {
    return this.pluginManager.getPluginAPI<T>(name)
  }
}
