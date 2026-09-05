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
  type PluginClassLike,
  type PluginModule,
  type PluginRuntimeStatus,
  NodeRegistry,
  ThemeRegistry,
  SaveServiceImpl,
  NodeStore,
  type CanvasNode,
  type CanvasEdge,
  type StorageAdapter,
  Selection,
  History,
  CommandRegistry,
  NodeFactory,
  EdgeStore,
  type EdgeStoreService,
  type SelectionService,
  type HistoryService,
  type CommandService,
  type NodeFactoryService,
} from '@mini-canvas/canvas-core-v2'
import { createPluginManager, type PluginManager } from './pluginManager'
import type { PluginManifest } from './pluginManager'

/** 宿主/装配处可装载的插件形态（对象 PluginModule 或 Service 类，cordis 类形态） */
export type HostPlugin = PluginModule | PluginClassLike

/** 门面可选项 */
export interface MiniCanvasOptions {
  /** 存储后端（本地/云端可插拔）。默认内存 adapter。 */
  adapter?: StorageAdapter
  /** 冷启动要装载的插件（顺序即装载顺序）。宿主负责给全(含内置+业务)。支持 PluginModule 对象与 Service 类。 */
  coldPlugins?: HostPlugin[]
  /**
   * 装配清单冷启动（目标 D / B5）：给则启动走 `manager.applyManifest(manifest)`（热装语义），
   * 支持 disabled 项(登记但关闭不装)、per-plugin config 覆盖、同 id 换版本；与 coldPlugins 二选一(manifest 优先)。
   */
  manifest?: PluginManifest
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
  /** 边数据服务(边下沉内核后)：建边/删边/删节点清边都写它；渲染层读它画边 */
  edgeStore: EdgeStoreService
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

/** 图数据存储信封：节点 + 边（持久化与 history 快照共用）。兼容旧"仅节点数组"存储 */
export interface GraphEnvelope {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

/** 暴露给 window.MiniCanvas 的插件/运行时 API 面 */
export interface MiniCanvasApi {
  /** 热装一个插件（对象 { name, apply } 或 Service 类） */
  installPlugin(mod: HostPlugin): string
  /** 热卸一个插件（副作用/注册/UI 自动回收）；返回是否真卸到 */
  uninstallPlugin(name: string): boolean
  /** 热重载一个插件：先卸旧再装新（开发期改插件代码后调用，让改动实时生效） */
  reloadPlugin(name: string, nextMod?: HostPlugin): void
  /** 已装载插件名列表 */
  listPlugins(): string[]
  /** P5 只读诊断：每个已装(含 FAILED 保留)插件的 fiber 运行时态 + PENDING 缺依赖(missingDeps/error) */
  inspectPlugins(): PluginRuntimeStatus[]
  getContext(): Context
  getRegistry(): NodeRegistry
  getNodeStore(): NodeStore
  getEdgeStore(): EdgeStoreService
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

  const edgeStore = new EdgeStore()
  ctx.inject('edgeStore', edgeStore)

  const nodeRegistry = opts.nodeRegistry ?? new NodeRegistry()
  ctx.inject('nodeRegistry', nodeRegistry)

  const themeRegistry = opts.themeRegistry ?? new ThemeRegistry()
  ctx.inject('themeRegistry', themeRegistry)

  const selection = new Selection()
  ctx.inject('selection', selection)

  // 全图快照(节点+边)：undo/redo 回退整个图，边随节点一起记录(边下沉后删除/撤销对边生效)。
  // 注入的 snapshot/restore 只负责"读/写两份 store"，深度拷贝交给调用处；restore 同时回填 nodeStore+edgeStore。
  const history = new History({
    snapshot: (): GraphEnvelope => ({
      nodes: JSON.parse(JSON.stringify(nodeStore.getNodes())) as CanvasNode[],
      edges: JSON.parse(JSON.stringify(edgeStore.getEdges())) as CanvasEdge[],
    }),
    restore: (g) => {
      const env = (g as GraphEnvelope) ?? { nodes: [], edges: [] }
      nodeStore.replaceAll(env.nodes ?? [])
      edgeStore.replaceAll(env.edges ?? [])
    },
  })
  ctx.inject('history', history)

  const command = new CommandRegistry()
  ctx.inject('command', command)

  const nodeFactory = new NodeFactory()
  ctx.inject('nodeFactory', nodeFactory)

  // —— 统一安装句柄提前建（capture ctx 即可；内部方法需 ctx started，调用时满足） ——
  const manager: PluginManager = createPluginManager(ctx)

  // —— 冷启动插件：manifest 模式走 applyManifest(disabled/config覆盖/同id换版本)；缺省 coldPlugins(顺序装载) ——
  if (opts.manifest) {
    // applyManifest 走 ctx.installPlugin(需 started)：先空 start，再逐项热装
    await ctx.start()
    await manager.applyManifest(opts.manifest)
  } else {
    for (const p of opts.coldPlugins ?? []) ctx.plugin(p)
    await ctx.start()
  }
  // 给命令注入执行上下文（命令内部如需 ctx.get 用服务）
  command.setContext(ctx)

  // 恢复上次画布；首次(空)则跑 seedDefault（若有）。
  // 节点存 'graph'(历史遗留为 CanvasNode[]，边下沉后可能为 {nodes,edges})；边独立存 'graph-edges'(CanvasEdge[])。
  const saved = await save.get<CanvasNode[] | GraphEnvelope>('graph', 'canvas')
  const savedEdges = await save.get<CanvasEdge[]>('graph-edges', 'canvas')
  // 兼容三种形态：旧数组(仅节点) / 新信封(含 edges) / 空；边独立存的 graph-edges 一律并入恢复
  let restoreNodes: CanvasNode[] | null = null
  let restoreEdges: CanvasEdge[] | null = savedEdges ?? []
  if (Array.isArray(saved)) {
    restoreNodes = saved
  } else if (saved && Array.isArray(saved.nodes)) {
    restoreNodes = saved.nodes
    // 信封内若自带 edges(未来单 key)且未单独存，则以信封内为准
    restoreEdges = (saved.edges ?? []) as CanvasEdge[]
  }
  if (restoreNodes && restoreNodes.length > 0) {
    nodeStore.replaceAll(restoreNodes)
    edgeStore.replaceAll(restoreEdges ?? [])
  } else if (opts.seedDefault) {
    const seeded = opts.seedDefault()
    nodeStore.replaceAll(seeded)
    edgeStore.replaceAll(restoreEdges ?? [])
  }

  const host: CanvasHostHandle = {
    ctx,
    save,
    nodeStore,
    edgeStore,
    nodeRegistry,
    themeRegistry,
    selection,
    command,
    history,
    nodeFactory,
    stop: () => {
      // 停用前先把脏队列捕获进 flush 的批量快照（同步完成），再停内核，避免最后未落盘的写入丢失。
      // flush 会同步把 dirty 快照进本地 batch，故即使调用方不 await，数据也已进入落盘流程。
      void save.flush()
      ctx.stop()
    },
  }

  const api: MiniCanvasApi = {
    installPlugin: (mod) => ctx.installPlugin(mod),
    uninstallPlugin: (name) => ctx.uninstallPlugin(name),
    reloadPlugin(name, nextMod) {
      ctx.uninstallPlugin(name) // 卸旧（回收副作用/注册）
      if (nextMod) ctx.installPlugin(nextMod) // 装新
    },
    listPlugins: () => ctx.listPlugins(),
    inspectPlugins: () => ctx.inspectPlugins(),
    getContext: () => ctx,
    getRegistry: () => nodeRegistry,
    getNodeStore: () => nodeStore,
    getEdgeStore: () => edgeStore,
    getHost: () => host,
  }

  const exposeToWindow = (key = 'MiniCanvas') => {
    const w = globalThis as Record<string, unknown>
    w[key] = api
  }

  return { host, api, manager, exposeToWindow }
}
