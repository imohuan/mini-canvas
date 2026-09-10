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
  GraphDocument,
  GRAPH_KEY,
  GRAPH_EDGES_KEY,
  type EdgeStoreService,
  type SelectionService,
  type HistoryService,
  type CommandService,
  type NodeFactoryService,
  type GraphDocumentService,
  type GraphEnvelope,
  SettingsStore,
  createSettingsPersist,
  type SettingsPersistService,
  ResourceStore,
  type ResourceService,
  createMenuService,
  type MenuService,
} from '@mini-canvas/canvas-core-v2'
import { createPluginManager, type PluginManager } from './pluginManager'
import { NodeLayoutService } from '../layout/nodeLayout'
import { ViewportService } from '../viewport/viewportService'
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
  /**
   * 是否自动接入配置持久化桥（settingsPersist）：把 ctx.settings(插件 Config 分组配置)的变更
   * 持久化到 save(config) 域并在启动时恢复。缺省 true（内置；与画布 graph 同走 adapter）。
   * 多宿主/临时画布不需要配置持久化时可关掉。
   */
  persistSettings?: boolean
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
  /** 菜单聚合服务（从命令表实时组装菜单项） */
  menu: MenuService
  history: HistoryService
  nodeFactory: NodeFactoryService
  /** 图唯一写入口：节点/边变更统一走它（含级联、历史、选中维护、提交落盘） */
  graph: GraphDocumentService
  /** 节点布局只读服务（实测尺寸/绝对坐标；渲染层量测注入，插件读） */
  nodeLayout: NodeLayoutService
  /** 视口服务（CanvasHost 挂载后 attach VueFlow backend；插件读/控制视图） */
  viewport: ViewportService
  /** 配置持久化桥（ctx.settings ↔ save(config)）；persistSettings=false 时 undefined */
  settingsPersist?: SettingsPersistService
  /** 资源生命周期服务（Blob/object URL 登记与回收；file-drop 等写入 object URL 的插件接入） */
  resources: ResourceService
  /** 停止并回收全部插件副作用 */
  stop(): void
}

/** 图数据存储信封：节点 + 边（持久化与 history 快照共用）。类型由 core-v2 graphDocument 提供。 */
export type { GraphEnvelope } from '@mini-canvas/canvas-core-v2'

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
  getGraph(): GraphDocumentService
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

  // 节点布局服务：读 nodeStore + 承载渲染层 ResizeObserver 实测尺寸（内存态，不落盘）
  const nodeLayout = new NodeLayoutService(nodeStore)
  ctx.inject('nodeLayout', nodeLayout)

  // 视口服务：工厂先建空壳，CanvasHost 拿到 VueFlow 实例后 attachBackend
  const viewport = new ViewportService()
  ctx.inject('viewport', viewport)

  const edgeStore = new EdgeStore()
  ctx.inject('edgeStore', edgeStore)

  // 资源生命周期服务：浏览器环境用真实 URL backend（create/revoke objectURL），
  // 非浏览器（SSR/Node 测试）用 no-op 占位（只登记不回收，显式 url 仍可登记）。
  const resources = new ResourceStore(
    typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
      ? {
          createUrl: (r) => URL.createObjectURL(r as Blob),
          revokeUrl: (u) => URL.revokeObjectURL(u),
        }
      : undefined,
  )
  ctx.inject('resources', resources)

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
      // 临时脚手架（data.isTemp：拖线落空白的菜单节点 + 占位连线）**不进历史**：
      // 它是交互中间态，不该出现在撤销栈里，也不该被 undo 恢复出来。
      nodes: JSON.parse(JSON.stringify(nodeStore.getNodes().filter((n) => !n.data?.isTemp))) as CanvasNode[],
      edges: JSON.parse(JSON.stringify(edgeStore.getEdges().filter((e) => !e.data?.isTemp))) as CanvasEdge[],
    }),
    restore: (g) => {
      const env = (g as GraphEnvelope) ?? { nodes: [], edges: [] }
      nodeStore.replaceAll(env.nodes ?? [])
      edgeStore.replaceAll(env.edges ?? [])
    },
  })
  ctx.inject('history', history)

  // 图唯一写入口：统一"节点/边变更 + 历史 + 选中维护 + 提交后落盘"。
  // commit 回调接收整图信封：宿主把当前节点+边持久化（与 CanvasHost/commands 的 graph/graph-edges 分存一致）。
  const graph = new GraphDocument(nodeStore, edgeStore, selection, history, (envelope) => {
    // 落盘同样滤掉临时脚手架：临时菜单节点/占位连线是交互中间态，刷新后不该复活。
    save.set('graph', envelope.nodes.filter((n) => !n.data?.isTemp), 'canvas')
    save.set(GRAPH_EDGES_KEY, envelope.edges.filter((e) => !e.data?.isTemp), 'canvas')
  })
  ctx.inject('graph', graph)

  const command = new CommandRegistry()
  ctx.inject('command', command)

  // 菜单聚合服务（G 项）：从 command 表实时组装 pane/node/edge/toolbar 菜单项，供右键/工具栏 UI 消费
  const menu = createMenuService(() => command.list())
  ctx.inject('menu', menu)

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

  // 配置持久化桥（P1-5 修复）：默认开启。ctx.settings 是内置分组配置单一数据源；
  // 桥把用户改动经 save(config) 持久化，启动时 restore 注入（插件 Config 已声明完成）。
  let settingsPersist: SettingsPersistService | undefined
  if (opts.persistSettings !== false) {
    const settingsStore = ctx.get<SettingsStore>('settings')
    settingsPersist = createSettingsPersist(settingsStore, save)
    ctx.inject('settingsPersist', settingsPersist)
    await settingsPersist.restore()
  }

  // 恢复上次画布；从未保存过才跑 seedDefault（若有）。已保存的空图([])也必须原样恢复，
  // 否则用户删光节点后刷新会重新长出默认 seed。
  // 节点存 GRAPH_KEY(历史遗留为 CanvasNode[]，边下沉后可能为 {nodes,edges})；边独立存 GRAPH_EDGES_KEY(CanvasEdge[])。
  const saved = await save.get<CanvasNode[] | GraphEnvelope>(GRAPH_KEY, 'canvas')
  const savedEdges = await save.get<CanvasEdge[]>(GRAPH_EDGES_KEY, 'canvas')
  // 兼容三种形态：旧数组(仅节点) / 新信封(含 edges) / 空；边独立存的 graph-edges 一律并入恢复。
  // 关键判定：saved === undefined 才是"从未保存"，不应与"保存了空数组"混为一谈。
  const hasStoredGraph = saved !== undefined
  let restoreNodes: CanvasNode[] | null = null
  let restoreEdges: CanvasEdge[] | null = savedEdges ?? []
  if (Array.isArray(saved)) {
    restoreNodes = saved
  } else if (hasStoredGraph && Array.isArray(saved.nodes)) {
    restoreNodes = saved.nodes
    // 信封内若自带 edges(未来单 key)且未单独存，则以信封内为准
    restoreEdges = (saved.edges ?? []) as CanvasEdge[]
  }
  if (hasStoredGraph) {
    nodeStore.replaceAll(restoreNodes ?? [])
    edgeStore.replaceAll(restoreEdges ?? [])
  } else if (opts.seedDefault) {
    const seeded = opts.seedDefault()
    nodeStore.replaceAll(seeded)
    edgeStore.replaceAll(restoreEdges ?? [])
  }

  /** exposeToWindow 挂载的 window key（host.stop 时自动清理，防旧 API 残留） */
  let exposedWindowKey: string | null = null

  const host: CanvasHostHandle = {
    ctx,
    save,
    nodeStore,
    edgeStore,
    nodeRegistry,
    themeRegistry,
    selection,
    command,
    menu,
    history,
    nodeFactory,
    graph,
    nodeLayout,
    viewport,
    settingsPersist,
    resources,
    stop: () => {
      // 停用前先把脏队列捕获进 flush 的批量快照（同步完成），再停内核，避免最后未落盘的写入丢失。
      // flush 会同步把 dirty 快照进本地 batch，故即使调用方不 await，数据也已进入落盘流程。
      void save.flush()
      settingsPersist?.dispose()
      resources.dispose()
      // P1-16：停用即清理 window 暴露的 API 句柄（防旧画布残留可被误调）
      if (exposedWindowKey) {
        const w = globalThis as Record<string, unknown>
        if (w[exposedWindowKey] === api) delete w[exposedWindowKey]
        exposedWindowKey = null
      }
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
    getGraph: () => graph,
    getHost: () => host,
  }

  const exposeToWindow = (key = 'MiniCanvas') => {
    const w = globalThis as Record<string, unknown>
    w[key] = api
    exposedWindowKey = key // 记录供 stop 清理
  }

  return { host, api, manager, exposeToWindow }
}








