/**
 * canvasBasePlugin —— 画布基础装配插件（设计文档 §九 步骤 4「建基础插件，收编 15 行装配」）。
 *
 * 解决什么：createMiniCanvasHost 里原先有 15 行 ctx.inject(...)，把「画布有哪些基础服务」写死在
 * 渲染宿主里 —— 换个宿主就得抄一遍，宿主也成了「什么服务都知道」的大杂烩。本插件把这一坨搬进
 * 自己的 apply(ctx)：谁装它，谁就得到一整套画布基础服务（数据层 + 画布语义层）。宿主于是只剩
 * 「建 ctx → 装基础插件 → 装业务插件 → start」。
 *
 * 为什么声明 core: true（决策 1）：这些服务是画布的命脉 —— 一旦被热卸，所有依赖它们的业务插件
 * 会被连带回退 PENDING，画布直接瘫。core 标识让它拒绝动态卸载（ctx.stop() 不拦：整体生命周期
 * 终结不是动态卸载，页面关闭时它也必须正常回收）。
 *
 * 为什么是「工厂返回 { plugin, services }」而不是一个裸 PluginModule：
 * nodeLayout（渲染层服务）要拿 nodeStore 实例，而 nodeStore 现在由本插件创建；宿主必须在 start()
 * 之前就把 nodeLayout 注入（否则插件在 apply 里 ctx.get(nodeLayout) 会拿到 undefined —— 行为变化）。
 * 所以这些零件在**工厂调用时**就建好（它们都不依赖 ctx），宿主可以先拿到实例、再装插件。
 * 唯一依赖 ctx 的是 settingsPersist（要 ctx.get(settings)），它在 apply 里建，
 * 并挂到 save.settings / 内部运行时上，不再占服务名。
 *
 * 归属：src/canvas（画布语义层）。零件全在 canvas-data 内，本文件只做「建 + 注入」；
 * 它不认识 Vue、不认识渲染层 —— nodeLayout / viewport 由宿主注入（那两个要量 DOM / attach 后端）。
 */
import { CommandRegistry } from '@mini-canvas/kernel'
import type { CommandDef, CommandService, PluginModule, PluginScope, SettingsStore } from '@mini-canvas/kernel'
import { NodeStore } from '../nodeStore'
import type { CanvasNode } from '../nodeStore'
import { EdgeStore } from '../edgeStore'
import type { CanvasEdge } from '../edgeStore'
import { Selection } from '../selection'
import { History } from '../history'
import { GraphDocument } from '../graphDocument'
import type { GraphEnvelope } from '../graphDocument'
import { ResourceStore, sanitizeTransientResourceUrls } from '../resourceService'
import { createIndexedDbResourceAdapter } from '../storage/indexedDbResourceAdapter'
import { isResourceAdapter } from '../storage/types'
import { createSettingsPersist } from '../settingsPersist'
import type { SettingsPersistFacade, SettingsPersistService } from '../settingsPersist'
import { isTransient } from '../transient'
import { SaveServiceImpl } from '../storage/SaveService'
import { GRAPH_EDGES_KEY, GRAPH_KEY } from '../storage/keys'
import type { StorageAdapter } from '../storage/types'
import { createDocService } from '../docService'
import type { DocService } from '../docService'
import { NodeRegistry } from './registry/nodeRegistry'
import { ThemeRegistry } from './registry/themeRegistry'
import { NodeFactory } from './nodeFactory'
import { registerCanvasCommands } from './canvasCommands'
import { clearCommandRuntime, setCommandRuntime, type CommandRuntime } from './commandRuntime'
import { canvasRuntime, setCanvasRuntime, type CanvasRuntime } from './canvasRuntime'
import type { CanvasAppBaseServices } from './canvasAppBasePlugin'

/** 基础插件名（宿主门面据此识别「这是宿主自己的装配，不是业务插件」） */
export const CANVAS_BASE_PLUGIN_NAME = 'canvas-base'

/** 建基础插件时可选项（都是「宿主才知道」的东西：存储后端、宿主自建的注册表实例） */
export interface CanvasBaseOptions {
  /** 插件名；缺省 'canvas-base'。画布会话用 canvasDataPlugin（'canvas-data'）另起一个可卸单元。 */
  pluginName?: string
  /** 是否声明 core（拒绝动态热卸）；缺省 true。画布会话必须为 false。 */
  core?: boolean
  /** 存储后端（本地 / 云端可插拔）。缺省内存 adapter。 */
  adapter?: StorageAdapter
  /** 节点展示注册表实例（宿主若需在 boot 前就 provide 给 Vue，可自建传入）。缺省内部新建。 */
  nodeRegistry?: NodeRegistry
  /** 主题 / 外观注册表实例（宿主提供默认 UI 用）。缺省内部新建。 */
  themeRegistry?: ThemeRegistry
  /**
   * 复用一个已建好的「应用级底座」实例（根级 Provider 的 save/resources/注册表/命令表）。
   *
   * 传了它就不再新建这几件，直接复用同一份实例 —— 于是应用级与画布级看到的是同一个
   * save / resources / 主题注册表，不会出现两份。缺省（不传）保持原有行为：
   * 本插件自建整套服务（独立宿主 / 测试仍可用）。
   */
  appBase?: CanvasAppBaseServices
  /**
   * 是否自动接入配置持久化桥（settingsPersist）：把 ctx.settings（插件 Config 分组配置）的变更
   * 持久化到 save(config) 域并在启动时恢复。缺省 true（内置；与画布 graph 同走 adapter）。
   * 多宿主 / 临时画布不需要配置持久化时可关掉。
   */
  persistSettings?: boolean
}

/**
 * 基础插件建出来的零件（宿主 CanvasHostHandle 的字段来源）共 12 件：
 * - 进 ctx 服务表的基础件：save / doc / resources / selection；
 * - command / nodeFactory / nodeRegistry / themeRegistry 收进内部运行时，
 *   不再作为独立服务名（Spec 3.1）；
 * - 仅由 services 直接持有、**不再是服务名**的 4 件（5c 下线）：nodeStore / edgeStore /
 *   graph / history（数据统一经 doc 取用）；
 * - 另有 settingsPersist 条件存在（persistSettings 为真且 ctx 有 settings 时），
 *   经 save.settings 与内部运行时提供。
 *
 * 类型给的是具体类（不是接口）—— 宿主需要类上的额外方法（如 SaveServiceImpl.flush、ResourceStore.dispose）。
 */
export interface CanvasBaseServices {
  save: SaveServiceImpl
  /** 文档门面（§4.1）：nodeStore/edgeStore/graph/history 合并后的正式名字（5c 起四个老名下线） */
  doc: DocService
  nodeStore: NodeStore
  edgeStore: EdgeStore
  resources: ResourceStore
  nodeRegistry: NodeRegistry
  themeRegistry: ThemeRegistry
  selection: Selection
  history: History
  graph: GraphDocument
  command: CommandService
  nodeFactory: NodeFactory
  /** 配置持久化桥；persistSettings: false（或 ctx 无 settings 段）时缺席 */
  settingsPersist?: SettingsPersistService
  /** 会话级服务撤销句柄（共享根 Context 时，离开画布要主动摘掉，不能等整棵 Context 停） */
  revokeDoc?: () => void
  revokeSelection?: () => void
}


/** 工厂返回：可装载的插件模块 + 已建好的服务实例（宿主在 start 前就要用） */
export interface CanvasBaseAssembly {
  /** 插件名（= CANVAS_BASE_PLUGIN_NAME） */
  name: string
  /** 交给 ctx.plugin(...) 的插件模块（core: true，拒绝动态热卸） */
  plugin: PluginModule
  /** 已建好的服务实例（随 apply 注入内核；settingsPersist 在 apply 时才建） */
  services: CanvasBaseServices
}

/**
 * 建一个画布基础插件（含它要注入的基础服务实例）。
 *
 * 用法（宿主）：
 *   const base = createCanvasBasePlugin({ adapter, nodeRegistry })
 *   const nodeLayout = new NodeLayoutService(base.services.nodeStore) // start 前就能建
 *   ctx.plugin(base.plugin)
 *   ctx.inject(nodeLayout) // 宿主补渲染层那几个（要量 DOM / attach 后端）
 */
export function createCanvasBasePlugin(opts: CanvasBaseOptions = {}): CanvasBaseAssembly {
  const persistSettings = opts.persistSettings !== false
  const app = opts.appBase
  const pluginName = opts.pluginName ?? CANVAS_BASE_PLUGIN_NAME
  const isCore = opts.core !== false

  // —— 存储：每 type 一个激活 adapter（宿主给后端则整包切过去） ——
  const save = app?.save ?? new SaveServiceImpl()
  if (!app && opts.adapter) save.useAdapterForAll(opts.adapter)

  const nodeStore = new NodeStore()
  const edgeStore = new EdgeStore()

  // 资源服务：后端**现取**（向 save 要 resource 那一格的激活 adapter）。
  // 本地默认装 IndexedDB；云插件 `save.useAdapter('resource', 云端适配器)` 一换就整体切走 ——
  // 于是"文本存哪"与"资源存哪"是同一个开关（用户最初的设计：一个 adapter 管两种形式）。
  // 兜底：宿主显式给了 adapter 时，若它不是资源后端，仍装上本地 IndexedDB 资源后端，
  // 免得"换了文本 adapter"顺带把资源存储弄没了。
  let resources = app?.resources
  if (!resources) {
    const localResourceAdapter = createIndexedDbResourceAdapter()
    if (localResourceAdapter && !isResourceAdapter(save.adapterOf('resource'))) {
      save.useAdapter('resource', localResourceAdapter)
    }
    resources = new ResourceStore(
      () => {
        const a = save.adapterOf('resource')
        return isResourceAdapter(a) ? a : undefined
      },
      typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
        ? {
            revokeUrl: (u) => URL.revokeObjectURL(u),
          }
        : undefined,
    )
  }

  // 展示注册表：节点段（content/工具栏）与主题槽（边/背景/设置面板）
  const nodeRegistry = opts.nodeRegistry ?? app?.nodeRegistry ?? new NodeRegistry()
  const themeRegistry = opts.themeRegistry ?? app?.themeRegistry ?? new ThemeRegistry()

  const selection = new Selection()

  // 全图快照(节点+边)：undo/redo 回退整个图，边随节点一起记录(边下沉后删除/撤销对边生效)。
  // 注入的 snapshot/restore 只负责「读/写两份 store」，深度拷贝交给调用处；restore 同时回填 nodeStore+edgeStore。
  const history = new History({
    snapshot: (): GraphEnvelope => ({
      // 中间态元素（如拖线落空白的菜单节点 + 占位连线）**不进历史**：
      // 它是交互中间态，不该出现在撤销栈里，也不该被 undo 恢复出来。
      // 判定读内核通用契约（isTransient），不认识具体插件。
      nodes: JSON.parse(JSON.stringify(nodeStore.getNodes().filter((n) => !isTransient(n)))) as CanvasNode[],
      edges: JSON.parse(JSON.stringify(edgeStore.getEdges().filter((e) => !isTransient(e)))) as CanvasEdge[],
    }),
    restore: (g) => {
      const env = (g as GraphEnvelope) ?? { nodes: [], edges: [] }
      nodeStore.replaceAll(env.nodes ?? [])
      edgeStore.replaceAll(env.edges ?? [])
    },
  })

  // 图唯一写入口：统一「节点/边变更 + 历史 + 选中维护 + 提交后落盘」。
  // commit 回调接收整图信封：宿主把当前节点+边持久化（与 CanvasHost/commands 的 graph/graph-edges 分存一致）。
  const graph = new GraphDocument(nodeStore, edgeStore, selection, history, (envelope) => {
    // 落盘同样滤掉中间态：交互中间态刷新后不该复活。
    save.set(GRAPH_KEY, sanitizeTransientResourceUrls(envelope.nodes.filter((n) => !isTransient(n))), 'canvas')
    save.set(GRAPH_EDGES_KEY, envelope.edges.filter((e) => !isTransient(e)), 'canvas')
  })

  const command = app?.command ?? new CommandRegistry()

  const nodeFactory = new NodeFactory()

  // 文档门面（§4.1）：把上面四个实例**直接交给它**（不再按名解析 —— 5c 已删四个老服务名）。
  // 门面是纯转发视图、零状态：底层实例随本插件 fiber 回收，门面随之作废。
  const doc = createDocService({ nodeStore, edgeStore, graph, history })

  // 工具注册表（外部能力调用：文生图/图生图/文生文…）由内核 Context 构造时内置上架为 tools，
  // 基础插件不重复注入（同一实例由插件的 ctx.tools 与节点的 ctx.get(tools) 共享）。

  const services: CanvasBaseServices = {
    save,
    doc,
    nodeStore,
    edgeStore,
    resources,
    nodeRegistry,
    themeRegistry,
    selection,
    history,
    graph,
    command,
    nodeFactory,
  }

  const plugin: PluginModule = {
    name: pluginName,
    // 决策 1：核心插件 —— 拒绝动态热卸（依赖它的插件才不会被连带回退 PENDING）
    core: isCore,
    inject: [],
    apply(ctx: PluginScope) {
      // —— 基础服务：装完即全画布可用，随本插件 fiber 回收 ——
      // 根级应用底座已经提供过 save/resources 时不再重复注入（内核会拒绝重复服务名）。
      if (!app) ctx.inject('save', save)
      // 数据那一格只有一个名字：doc（5c 删掉 nodeStore/edgeStore/graph/history 四个老服务名）。
      // 四个实例仍在 base.services 上（宿主/渲染层拿它们订阅、量尺寸），但**不再是按名可取的服务**。
      services.revokeDoc = ctx.inject('doc', doc)
      if (!app) ctx.inject('resources', resources)
      services.revokeSelection = ctx.inject('selection', selection)
      // 容器与工厂不再上架服务名：能力糖 / 画布命令 / 宿主经内部运行时读同一批实例。
      // 应用底座已经建好容器（项目页的 UI 目录 / 设置面板要用）时，复用它的注册表，
      // 只把本会话的 command / nodeFactory 补进去；卸载时不能把根级容器一起清掉。
      const inherited = app ? canvasRuntime() : undefined
      const sessionRuntime: CanvasRuntime = {
        command,
        nodeFactory,
        nodeRegistry: inherited?.nodeRegistry ?? nodeRegistry,
        themeRegistry: inherited?.themeRegistry ?? themeRegistry,
        ...(inherited?.settingsPersist ? { settingsPersist: inherited.settingsPersist } : {}),
      }
      setCanvasRuntime(sessionRuntime)
      ctx.effect(() => () => {
        // 只在顶层容器仍是本会话这份时清空；根级应用底座的生命周期比会话长。
        if (canvasRuntime() === sessionRuntime) setCanvasRuntime(inherited)
      })
      // 命令运行时：`command` 服务名迁移期保留；新入口是 ctx.commands 糖与 canvas.runCommand。
      const runtime: CommandRuntime = {
        execute: (id, ...payload) => command.execute(id, ...payload),
        list: () => command.list(),
        has: (id) => command.has(id),
        register: (def) => command.register(def),
        remapKeys: (id, keys) => command.remapKeys(id, keys),
        resetKeys: (id) => command.resetKeys(id),
        originalKeys: (id) => command.originalKeys(id),
        isRemapped: (id) => command.isRemapped(id),
      }
      setCommandRuntime(runtime, command)
      ctx.effect(() => () => clearCommandRuntime())

      // 画布通用命令（建节点 / 删选中 / 撤销 / 重做）由数据层自带，基础插件默认注册 ——
      // 不必再装一个插件才有 Delete / Ctrl+Z。ctx.effect 登记：随本插件 fiber 回收（restart 不重复注册）。
      // 应用底座已注册同一批命令时不重复：同一个 id 再注册会抛错。
      const alreadyHasCommands = command.has('command:create-node')
      if (!alreadyHasCommands) {
        ctx.effect(() =>
          registerCanvasCommands({
            command,
            graph,
            selection,
            nodeFactory,
            // 命令场是插件侧的自省入口；运行表仍是 command，场里只放同一份定义。
            field: ctx.registryOf<{ def: CommandDef }>('command'),
          }),
        )
      }

      // 配置持久化桥：ctx.settings 是分组配置单一数据源；桥把用户改动经 save(config) 持久化，
      // 启动时 restore 注入（**由宿主在插件装载完成后 await restore()**，保证插件 Config 已声明完成）。
      // 注意：settingsPersist 依赖 ctx.settings（能力层内置服务）；纯内核 ctx（不装画布能力层）拿不到，
      // 那种环境下跳过 —— 不静默造假服务。
      if (persistSettings && !app?.settingsPersist) {
        const store = ctx.get<SettingsStore | undefined>('settings')
        if (store) {
          services.settingsPersist = createSettingsPersist(store, save)
          // 配置持久化并入 save 子对象：插件只认 save.settings；不再占服务名。
          ;(save as SaveServiceImpl & { settings?: SettingsPersistFacade }).settings = {
            restore: () => services.settingsPersist!.restore(),
            persistNow: () => services.settingsPersist!.persistNow(),
            resetKey: (k) => services.settingsPersist!.resetKey(k),
          }
          sessionRuntime.settingsPersist = services.settingsPersist
        }
      } else if (app?.settingsPersist) {
        // 应用级底座已经建过同一个桥：画布会话复用它，避免两份订阅同时写 config。
        services.settingsPersist = app.settingsPersist
        sessionRuntime.settingsPersist = app.settingsPersist
      }
    },
  }

  return { name: pluginName, plugin, services }
}
