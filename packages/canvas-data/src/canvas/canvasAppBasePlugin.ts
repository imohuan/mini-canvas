/**
 * canvasAppBasePlugin —— 应用级画布底座（根级 Provider 常驻的那一份）。
 *
 * 和 canvas-base 的分工：
 * - 本插件只管**与当前画布无关**的东西：存储通道（save）、资源生命周期（resources）、
 *   主题/节点注册表的容器，以及配置持久化桥。
 * - canvas-base / canvas-session 关心的是「这张画布」：doc / selection / view / 命令 / 节点数据。
 *
 * 为什么需要拆开：项目页也要能取设置、装插件、使用通用组件，但不该为此启动一张画布。
 * 根级 Provider 常驻的只有这一层；进入画布时再装会话插件，把 doc/selection 等服务补上。
 *
 * 生命周期：根级常驻，不随路由卸载。因此**不声明 core**（core 只影响热卸拦截，
 * 这里由宿主自己持有实例，不需要靠内核的卸载守卫）。
 */
import { CommandRegistry, type PluginModule, type PluginScope, type SettingsStore } from '@mini-canvas/kernel'
import { SaveServiceImpl } from '../storage/SaveService'
import { createIndexedDbResourceAdapter } from '../storage/indexedDbResourceAdapter'
import { isResourceAdapter, type StorageAdapter } from '../storage/types'
import { ResourceStore } from '../resourceService'
import { createSettingsPersist, type SettingsPersistFacade, type SettingsPersistService } from '../settingsPersist'
import { NodeRegistry } from './registry/nodeRegistry'
import { ThemeRegistry } from './registry/themeRegistry'
import { setCanvasRuntime, type CanvasRuntime } from './canvasRuntime'
import { clearCommandRuntime, setCommandRuntime, type CommandRuntime } from './commandRuntime'

/** 应用级底座插件名 */
export const CANVAS_APP_BASE_PLUGIN_NAME = 'canvas-app-base'

export interface CanvasAppBaseOptions {
  /** 存储后端（本地 / 云端可插拔）；缺省内存 adapter。 */
  adapter?: StorageAdapter
  /** 宿主自建的注册表容器（根级 Provider 需要在启动前就拿到同一份实例）。 */
  nodeRegistry?: NodeRegistry
  themeRegistry?: ThemeRegistry
  /** 是否接配置持久化桥；缺省 true。 */
  persistSettings?: boolean
}

/** 应用级底座建出来的零件（画布会话会复用同一批实例）。 */
export interface CanvasAppBaseServices {
  save: SaveServiceImpl
  resources: ResourceStore
  nodeRegistry: NodeRegistry
  themeRegistry: ThemeRegistry
  /** 命令表：命令是应用级能力（如 Agent 的开关命令），项目页也要能注册 */
  command: CommandRegistry
  /** 配置持久化桥；persistSettings: false（或 ctx 没有 settings 段）时缺席 */
  settingsPersist?: SettingsPersistService
}

export interface CanvasAppBaseAssembly {
  name: string
  plugin: PluginModule
  services: CanvasAppBaseServices
}

/**
 * 建应用级底座。实例在调用时就建好，宿主可以先拿到它们再 start。
 */
export function createCanvasAppBasePlugin(opts: CanvasAppBaseOptions = {}): CanvasAppBaseAssembly {
  const persistSettings = opts.persistSettings !== false

  const save = new SaveServiceImpl()
  if (opts.adapter) save.useAdapterForAll(opts.adapter)

  // 资源后端：现取 save 的 resource 格；宿主只换了文本后端时仍补本地 IndexedDB。
  const localResourceAdapter = createIndexedDbResourceAdapter()
  if (localResourceAdapter && !isResourceAdapter(save.adapterOf('resource'))) {
    save.useAdapter('resource', localResourceAdapter)
  }
  const resources = new ResourceStore(
    () => {
      const a = save.adapterOf('resource')
      return isResourceAdapter(a) ? a : undefined
    },
    typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
      ? { revokeUrl: (u) => URL.revokeObjectURL(u) }
      : undefined,
  )

  const nodeRegistry = opts.nodeRegistry ?? new NodeRegistry()
  const themeRegistry = opts.themeRegistry ?? new ThemeRegistry()
  const command = new CommandRegistry()

  const services: CanvasAppBaseServices = { save, resources, nodeRegistry, themeRegistry, command }

  const plugin: PluginModule = {
    name: CANVAS_APP_BASE_PLUGIN_NAME,
    inject: [],
    apply(ctx: PluginScope) {
      ctx.inject('save', save)
      ctx.inject('resources', resources)

      // 主题/节点注册表不上架服务名，但仍需要一个「应用级」的内部运行时：
      // 项目页的通用组件取件、画布会话装配都会读它。
      const runtime: CanvasRuntime = {
        command,
        // nodeFactory 属于画布会话；这里先留空，会话插件装上后补齐。
        nodeFactory: undefined as unknown as CanvasRuntime['nodeFactory'],
        nodeRegistry,
        themeRegistry,
      }
      setCanvasRuntime(runtime)
      ctx.effect(() => () => setCanvasRuntime(undefined))

      // 命令运行时：应用级常驻。画布通用命令由会话插件在进入画布时追加注册。
      const commandRuntime: CommandRuntime = {
        execute: (id, ...payload) => command.execute(id, ...payload),
        list: () => command.list(),
        has: (id) => command.has(id),
        register: (def) => command.register(def),
        remapKeys: (id, keys) => command.remapKeys(id, keys),
        resetKeys: (id) => command.resetKeys(id),
        originalKeys: (id) => command.originalKeys(id),
        isRemapped: (id) => command.isRemapped(id),
      }
      setCommandRuntime(commandRuntime, command)
      ctx.effect(() => () => clearCommandRuntime())

      if (persistSettings) {
        const store = ctx.get<SettingsStore | undefined>('settings')
        if (store) {
          const bridge = createSettingsPersist(store, save)
          services.settingsPersist = bridge
          runtime.settingsPersist = bridge
          ;(save as SaveServiceImpl & { settings?: SettingsPersistFacade }).settings = {
            restore: () => bridge.restore(),
            persistNow: () => bridge.persistNow(),
            resetKey: (k) => bridge.resetKey(k),
          }
        }
      }
    },
  }

  return { name: CANVAS_APP_BASE_PLUGIN_NAME, plugin, services }
}
