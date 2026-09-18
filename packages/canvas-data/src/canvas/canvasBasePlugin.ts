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
 * 唯一依赖 ctx 的是 settingsPersist（要 ctx.get(settings)），它在 apply 里建。
 *
 * 归属：src/canvas（画布语义层）。零件全在 canvas-data 内，本文件只做「建 + 注入」；
 * 它不认识 Vue、不认识渲染层 —— nodeLayout / viewport 由宿主注入（那两个要量 DOM / attach 后端）。
 */
import { CommandRegistry } from '@mini-canvas/kernel'
import type { CommandService, PluginModule, PluginScope, SettingsStore } from '@mini-canvas/kernel'
import { NodeStore } from '../nodeStore'
import type { CanvasNode } from '../nodeStore'
import { EdgeStore } from '../edgeStore'
import type { CanvasEdge } from '../edgeStore'
import { Selection } from '../selection'
import { History } from '../history'
import { GraphDocument } from '../graphDocument'
import type { GraphEnvelope } from '../graphDocument'
import { ResourceStore } from '../resourceService'
import { createSettingsPersist } from '../settingsPersist'
import type { SettingsPersistService } from '../settingsPersist'
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

/** 基础插件名（宿主门面据此识别「这是宿主自己的装配，不是业务插件」） */
export const CANVAS_BASE_PLUGIN_NAME = 'canvas-base'

/** 建基础插件时可选项（都是「宿主才知道」的东西：存储后端、宿主自建的注册表实例） */
export interface CanvasBaseOptions {
  /** 存储后端（本地 / 云端可插拔）。缺省内存 adapter。 */
  adapter?: StorageAdapter
  /** 节点展示注册表实例（宿主若需在 boot 前就 provide 给 Vue，可自建传入）。缺省内部新建。 */
  nodeRegistry?: NodeRegistry
  /** 主题 / 外观注册表实例（宿主提供默认 UI 用）。缺省内部新建。 */
  themeRegistry?: ThemeRegistry
  /**
   * 是否自动接入配置持久化桥（settingsPersist）：把 ctx.settings（插件 Config 分组配置）的变更
   * 持久化到 save(config) 域并在启动时恢复。缺省 true（内置；与画布 graph 同走 adapter）。
   * 多宿主 / 临时画布不需要配置持久化时可关掉。
   */
  persistSettings?: boolean
}

/**
 * 基础插件建出来的 12 件服务（宿主 CanvasHostHandle 的字段来源）。
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

  // —— 存储：每 type 一个激活 adapter（宿主给后端则整包切过去） ——
  const save = new SaveServiceImpl()
  if (opts.adapter) save.useAdapterForAll(opts.adapter)

  const nodeStore = new NodeStore()
  const edgeStore = new EdgeStore()

  // 资源生命周期服务：浏览器环境用真实 URL backend（create/revoke objectURL），
  // 非浏览器（SSR / Node 测试）用 no-op 占位（只登记不回收，显式 url 仍可登记）。
  const resources = new ResourceStore(
    typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
      ? {
          createUrl: (r) => URL.createObjectURL(r as Blob),
          revokeUrl: (u) => URL.revokeObjectURL(u),
        }
      : undefined,
  )

  // 展示注册表：节点段（content/工具栏）与主题槽（边/背景/设置面板）
  const nodeRegistry = opts.nodeRegistry ?? new NodeRegistry()
  const themeRegistry = opts.themeRegistry ?? new ThemeRegistry()

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
    save.set(GRAPH_KEY, envelope.nodes.filter((n) => !isTransient(n)), 'canvas')
    save.set(GRAPH_EDGES_KEY, envelope.edges.filter((e) => !isTransient(e)), 'canvas')
  })

  const command = new CommandRegistry()

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
    name: CANVAS_BASE_PLUGIN_NAME,
    // 决策 1：核心插件 —— 拒绝动态热卸（依赖它的插件才不会被连带回退 PENDING）
    core: true,
    inject: [],
    apply(ctx: PluginScope) {
      // —— 基础服务：装完即全画布可用，随本插件 fiber 回收 ——
      ctx.inject('save', save)
      // 数据那一格只有一个名字：doc（5c 删掉 nodeStore/edgeStore/graph/history 四个老服务名）。
      // 四个实例仍在 base.services 上（宿主/渲染层拿它们订阅、量尺寸），但**不再是按名可取的服务**。
      ctx.inject('doc', doc)
      ctx.inject('resources', resources)
      ctx.inject('nodeRegistry', nodeRegistry)
      ctx.inject('themeRegistry', themeRegistry)
      ctx.inject('selection', selection)
      ctx.inject('command', command)
      ctx.inject('nodeFactory', nodeFactory)

      // 画布通用命令（建节点 / 删选中 / 撤销 / 重做）由数据层自带，基础插件默认注册 ——
      // 不必再装一个插件才有 Delete / Ctrl+Z。ctx.effect 登记：随本插件 fiber 回收（restart 不重复注册）。
      ctx.effect(() => registerCanvasCommands({ command, graph, selection, nodeFactory }))

      // 配置持久化桥：ctx.settings 是分组配置单一数据源；桥把用户改动经 save(config) 持久化，
      // 启动时 restore 注入（**由宿主在插件装载完成后 await restore()**，保证插件 Config 已声明完成）。
      // 注意：settingsPersist 依赖 ctx.settings（能力层内置服务）；纯内核 ctx（不装画布能力层）拿不到，
      // 那种环境下跳过 —— 不静默造假服务。
      if (persistSettings) {
        const store = ctx.get<SettingsStore | undefined>('settings')
        if (store) {
          services.settingsPersist = createSettingsPersist(store, save)
          ctx.inject('settingsPersist', services.settingsPersist)
        }
      }
    },
  }

  return { name: CANVAS_BASE_PLUGIN_NAME, plugin, services }
}
