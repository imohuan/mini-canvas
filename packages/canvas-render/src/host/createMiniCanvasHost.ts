/**
 * createMiniCanvasHost —— 可复用画布宿主门面（window.MiniCanvas 的唯一装配点）。
 *
 * 定位：
 * - 一个工厂：建 Context + 注入全部内核服务 + 建展示注册表 + 冷启动插件。
 * - **不 import 任何具体插件**：冷启动要装哪些由调用方(宿主/demo)经 `coldPlugins` 传入，
 *   顺序即装载顺序。这样本模块可被真宿主复用，不绑 demo、不绑任何 node 插件。
 * - 暴露给 window 的 API 面：installPlugin / uninstallPlugin / reloadPlugin / listPlugins /
 *   getContext / getRegistry / getNodeStore ...
 *   → 源码插件、以后打包好的独立 js 插件，都统一经这套 API 安装；宿主不再手写装配。
 *
 * 依赖方向：宿主(本模块) 只操作 opaque 注册表 + PluginModule，不反向依赖插件实现。
 */
import {
  Context,
  type PluginModule,
  NodeRegistry,
  ThemeRegistry,
  SaveServiceImpl,
  NodeStore,
  type CanvasNode,
  type StorageAdapter,
  Selection,
  History,
  CommandRegistry,
  NodeFactory,
  type SelectionService,
  type HistoryService,
  type CommandService,
  type NodeFactoryService,
} from '@mini-canvas/canvas-core-v2'
import { createPluginManager, type PluginManager } from './pluginManager'

/** 门面可选项 */
export interface MiniCanvasOptions {
  /** 存储后端（本地/云端可插拔）。默认内存 adapter。 */
  adapter?: StorageAdapter
  /** 冷启动要装载的插件（顺序即装载顺序）。宿主负责给全(含内置+业务)。 */
  coldPlugins?: PluginModule[]
  /** 节点展示注册表实例。宿主若需在 boot 前就 provide 给 Vue，可自建传入。 */
  nodeRegistry?: NodeRegistry
  /** 主题/外观注册表实例（宿主提供默认 UI 用）。缺省内部新建。 */
  themeRegistry?: ThemeRegistry
  /** 首次启动(存储为空)时生成默认画布；返回的节点会被 replaceAll。 */
  seedDefault?: () => CanvasNode[]
}

/** 画布运行时句柄（宿主/Vue 消费：provide、渲染、读服务） */
export interface CanvasHostHandle {
  ctx: Context
  save: SaveServiceImpl
  nodeStore: NodeStore
  /** 展示注册表：type→content/toolbar 段组件（供 Vue 层 provide/渲染） */
  nodeRegistry: NodeRegistry
  /** 主题/外观注册表：slot→渲染器组件（edge/background/nodeShell 等），供 Vue 层装配 */
  themeRegistry: ThemeRegistry
  selection: SelectionService
  command: CommandService
  history: HistoryService
  nodeFactory: NodeFactoryService
  /** 停止并回收全部插件副作用 */
  stop(): void
}

/** 暴露给 window.MiniCanvas 的插件/运行时 API 面 */
export interface MiniCanvasApi {
  /** 热装一个插件（dsh 式 { name, setup(ctx) }） */
  installPlugin(mod: PluginModule): string
  /** 热卸一个插件（副作用/注册/UI 自动回收）；返回是否真卸到 */
  uninstallPlugin(name: string): boolean
  /** 热重载一个插件：先卸旧再装新（开发期改插件代码后调用，让改动实时生效） */
  reloadPlugin(name: string, nextMod?: PluginModule): void
  /** 已装载插件名列表 */
  listPlugins(): string[]
  getContext(): Context
  getRegistry(): NodeRegistry
  getNodeStore(): NodeStore
  getHost(): CanvasHostHandle
}

/**
 * 建一个可复用画布宿主 + 插件门面。
 * 返回 { host, api, manager, exposeToWindow }：宿主(Vue)拿 host 渲染；api/manager 是插件安装入口
 * (manager 是目标 D 的统一安装句柄, 带外部来源 + manifest)；exposeToWindow(windowKey) 把 api 挂到 window 上。
 */
export async function createMiniCanvasHost(opts: MiniCanvasOptions = {}): Promise<{
  host: CanvasHostHandle
  api: MiniCanvasApi
  manager: PluginManager
  exposeToWindow: (key?: string) => void
}> {
  const ctx = new Context()

  // —— 注入内核服务（宿主负责，插件只 ctx.get） ——
  const save = new SaveServiceImpl()
  if (opts.adapter) save.useAdapterForAll(opts.adapter)
  ctx.inject('save', save)

  const nodeStore = new NodeStore()
  ctx.inject('nodeStore', nodeStore)

  const nodeRegistry = opts.nodeRegistry ?? new NodeRegistry()
  ctx.inject('nodeRegistry', nodeRegistry)

  const themeRegistry = opts.themeRegistry ?? new ThemeRegistry()
  ctx.inject('themeRegistry', themeRegistry)

  const selection = new Selection()
  ctx.inject('selection', selection)

  const history = new History({
    snapshot: () => JSON.parse(JSON.stringify(nodeStore.getNodes())),
    restore: (nodes) => nodeStore.replaceAll(nodes as CanvasNode[]),
  })
  ctx.inject('history', history)

  const command = new CommandRegistry()
  ctx.inject('command', command)

  const nodeFactory = new NodeFactory()
  ctx.inject('nodeFactory', nodeFactory)

  // —— 冷启动插件（宿主给定，顺序即装载顺序） ——
  for (const p of opts.coldPlugins ?? []) ctx.plugin(p)
  await ctx.start()
  // 给命令注入执行上下文（命令内部如需 ctx.get 用服务）
  command.setContext(ctx)

  // 恢复上次画布；首次(空)则跑 seedDefault（若有）
  const saved = await save.get<CanvasNode[]>('graph', 'canvas')
  if (saved && saved.length > 0) {
    nodeStore.replaceAll(saved)
  } else if (opts.seedDefault) {
    nodeStore.replaceAll(opts.seedDefault())
  }

  const host: CanvasHostHandle = {
    ctx,
    save,
    nodeStore,
    nodeRegistry,
    themeRegistry,
    selection,
    command,
    history,
    nodeFactory,
    stop: () => ctx.stop(),
  }

  const api: MiniCanvasApi = {
    installPlugin: (mod) => ctx.installPlugin(mod),
    uninstallPlugin: (name) => ctx.uninstallPlugin(name),
    reloadPlugin(name, nextMod) {
      ctx.uninstallPlugin(name) // 卸旧（回收副作用/注册）
      if (nextMod) ctx.installPlugin(nextMod) // 装新
    },
    listPlugins: () => ctx.listPlugins(),
    getContext: () => ctx,
    getRegistry: () => nodeRegistry,
    getNodeStore: () => nodeStore,
    getHost: () => host,
  }

  const exposeToWindow = (key = 'MiniCanvas') => {
    const w = globalThis as Record<string, unknown>
    w[key] = api
  }

  const manager: PluginManager = createPluginManager(ctx)

  return { host, api, manager, exposeToWindow }
}
