/**
 * createMiniCanvasHost —— 可复用画布宿主门面（window.MiniCanvas 的唯一装配点）。
 *
 * 定位：
 * - 一个工厂：建 Context → 装基础插件（canvas-base，它自带 12 件画布基础服务 = 8 个 ctx 服务名
 *   + 4 个仅由 services 直接持有的内部实例）→ 注入渲染层两件
 *   （nodeLayout / viewport）→ 冷启动业务插件 → start。
 * - **不 import 任何具体插件**：冷启动要装哪些由调用方(宿主/demo)经 `coldPlugins` 传入，
 *   顺序即装载顺序。这样本模块可被真宿主复用，不绑 demo、不绑任何 node 插件。
 * - 暴露给 window 的 API 面：installPlugin / uninstallPlugin / reloadPlugin / listPlugins /
 *   getContext / getRegistry / getNodeStore ...
 *   → 源码插件、以后打包好的独立 js 插件，都统一经这套 API 安装；宿主不再手写装配。
 *
 * 依赖方向：宿主(本模块) 只操作 opaque 注册表 + PluginModule，不反向依赖插件实现。
 */
import { type PluginClassLike, type PluginModule, type PluginRuntimeStatus, type SettingSchema, SettingsStore } from '@mini-canvas/kernel'
import type { CommandService } from '@mini-canvas/kernel'
import { Context, createCanvasBasePlugin, GRAPH_EDGES_KEY, GRAPH_KEY } from '@mini-canvas/canvas-data'
import { restoreNodeMediaUrls } from '@mini-canvas/canvas-data'
import type { CapabilityFactory } from '../contracts/capabilities'
import { createStandardCapabilities } from '../contracts/standardCapabilities'
import type {
  CanvasEdge,
  CanvasNode,
  DocService,
  EdgeStoreService,
  GraphDocumentService,
  GraphEnvelope,
  HistoryService,
  NodeFactoryService,
  NodeRegistry,
  NodeStore,
  ResourceService,
  SaveServiceImpl,
  SelectionService,
  SettingsPersistService,
  StorageAdapter,
  ThemeRegistry,
} from '@mini-canvas/canvas-data'
import { createPluginManager, type PluginManager } from './pluginManager'
import { tipService } from '../tip/tipService'
import TipLayer from '../tip/TipLayer.vue'
import { NodeLayoutService } from '../layout/nodeLayout'
import { ViewportService } from '../viewport/viewportService'
import {
  CANVAS_INTERACTION_GROUP,
  CANVAS_INTERACTION_SCHEMA,
} from '../contracts/canvasInteractionSettings'
import { defineThemePaletteSettings, installThemePalette } from './themePaletteSettings'
import { defineThemeModeSetting, installThemeMode } from '../contracts/themeModeSettings'
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
  /**
   * 开发态开关，落到 `ctx.isDev`。以**显式传参为准**：库不悄悄读打包器全局变量，
   * 判据必须从调用方来（便于 Node 单测 / 多宿主复现）；宿主组件 CanvasHost 传 `import.meta.env.DEV`。
   *
   * 谁在用：决策 9 的 needs 缺项裁决 —— dev 当场抛错（响亮）、prod undefined + warn。
   * 缺省 false（= 生产语义）。
   */
  dev?: boolean
}

/** 画布运行时句柄（宿主/Vue 消费：provide、渲染、读服务） */
export interface CanvasHostHandle {
  ctx: Context
  save: SaveServiceImpl
  /**
   * 文档门面（§4.1）：节点 + 边 + 事务 + 撤销 + 快照 + 订阅合成的一个名字。
   * 5c 起数据那一格只有它可按名取（nodeStore/edgeStore/graph/history 四个服务名已下线）；
   * 下面那四个字段仍是**实例**（渲染层要 subscribe / 量尺寸，插件要窄接口），不是服务名。
   */
  doc: DocService
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
export type { GraphEnvelope } from '@mini-canvas/canvas-data'

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
 *
 * 装配形状（步骤 4「搬窝」后）：**建 ctx → 装基础插件 → 装业务插件 → start**。
 * 原来写在这里的 15 行 `ctx.inject(...)` 已收进 `canvasBasePlugin`（core: true，拒绝热卸）；
 * 宿主这里只剩两处 `ctx.inject`，留给**真属于渲染层、必须由宿主在挂载时注入**的两个：
 * `nodeLayout`（要 ResizeObserver 量 DOM）与 `viewport`（要 attach VueFlow 后端）。
 * 注意时序：这两个在 `ctx.plugin(basePlugin)` **之前**注入 —— 基础插件之后装的业务插件一 start 就能
 * `ctx.get('nodeLayout'/'viewport')` 拿到（否则从「注入即可达」退化成「PENDING」，属行为变化）。
 */
export async function createMiniCanvasHost(opts: MiniCanvasOptions = {}): Promise<{
  host: CanvasHostHandle
  api: MiniCanvasApi
  manager: PluginManager
  exposeToWindow: (key?: string) => void
}> {
  // dev 开关落到 ctx.isDev（决策 9 的 needs 缺项裁决要用；缺省 false = 生产语义）
  const ctx = new Context({ dev: opts.dev ?? false })

  // —— 基础插件：画布基础服务（save/doc/resources/nodeRegistry/themeRegistry/selection/command/
  // nodeFactory 八个服务名；nodeStore/edgeStore/graph/history 四个实例由 base.services 直接持有、
  // 已不再是 ctx 服务名（5c 下线），数据统一经 doc）
  // + 画布通用命令 + 配置持久化桥，全在它的 apply 里自建自注入（§4.1：数据那一格只有 doc）。
  // 工厂在调用时就建好实例（它们都不依赖 ctx），宿主要先拿到 nodeStore 才能建 nodeLayout。 ——
  const base = createCanvasBasePlugin({
    adapter: opts.adapter,
    nodeRegistry: opts.nodeRegistry,
    themeRegistry: opts.themeRegistry,
    persistSettings: opts.persistSettings,
  })
  const { save, doc, nodeStore, edgeStore, resources, nodeRegistry, themeRegistry, selection, history, graph, command, nodeFactory } =
    base.services

  // —— 宿主补渲染层两件（真需要 DOM / 后端 attach，数据层给不了）——
  // 节点布局服务：读 nodeStore + 承载渲染层 ResizeObserver 实测尺寸（内存态，不落盘）
  const nodeLayout = new NodeLayoutService(nodeStore)
  ctx.inject('nodeLayout', nodeLayout)

  // 视口服务：工厂先建空壳，CanvasHost 拿到 VueFlow 实例后 attachBackend
  const viewport = new ViewportService()
  ctx.inject('viewport', viewport)

  // 工具注册表（外部能力调用：文生图/图生图/文生文…）由内核 Context 构造时内置上架为 'tools'，
  // 基础插件不重复注入（同一实例由插件的 ctx.tools 与节点的 ctx.get('tools') 共享）。

  // —— 装基础插件（core: true：拒绝动态热卸，见决策 1）——
  ctx.plugin(base.plugin)

  // —— 标准能力包（§4.5 capability / 决策 9）——
  // 组件在 ctx.nodes.attach 里写 needs:['node','zoom',…]，BaseNode 按名造实例喂给它
  // （useCapabilities() 取用）。注册在这里 = "宿主那一份默认实现"；任何插件都能注册同名能力
  // 覆盖它（order 小者赢），主题插件因此能整套换掉 —— 决策 9 的第①条。
  {
    const capField = ctx.registryOf<CapabilityFactory>('capability')
    for (const [name, factory] of Object.entries(createStandardCapabilities(ctx))) {
      capField.add(name, factory, { id: 'host:standard', order: 100 })
    }
  }

  // —— 统一安装句柄提前建（capture ctx 即可；内部方法需 ctx started，调用时满足） ——
  // hiddenPlugins：canvas-base 是宿主自有装配（不是应用可装卸的业务插件），
  // 从 manager.list()/diagnose() 隐去 —— 画布基础服务对应用层是"环境"，不是"清单项"。
  const manager: PluginManager = createPluginManager(ctx, { hiddenPlugins: [base.name] })
  // 把统一安装句柄也上架成一个服务：插件（如「插件管理」）能在运行期按名取到它，
  // 从而自己装卸别的插件（用户诉求：用一个插件去管理其他插件的装/卸/重装）。
  // 放在冷启动之前注入：插件一 start 就能 ctx.get('pluginManager') 拿到。
  ctx.inject('pluginManager', manager)
  // 通用鼠标跟随提示（基础服务）：任何插件/渲染组件 ctx.get('tip').show('...') 即可显示。
  // 放渲染层而不是主题：拖线非法提示属于渲染反馈，换主题也应可用（用户口径 2026-10-26）。
  ctx.inject('tip', tipService)
  ctx.slots.register('overlay', {
    id: 'canvas-render/tip-layer',
    order: 95,
    component: TipLayer,
    meta: { title: '鼠标提示' },
  })

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

  // —— 画布交互配置（「常规/画布」）：渲染宿主级声明（对齐 v1 的 VueFlow 交互开关）——
  // 在插件装载完成后、持久化桥 restore 之前 define：用户保存过的值（settingsPersist.setSavedSnapshot
  // 注入的快照）能在 define 时命中为初值；scope='canvas-render' 表明这是宿主自己的配置，
  // 与插件生命周期解耦（热卸任何插件都不回收这组声明）。
  const interactionSettings = ctx.get<SettingsStore>('settings')
  if (!interactionSettings.has('nodesDraggable')) {
    interactionSettings.define(
      CANVAS_INTERACTION_GROUP,
      CANVAS_INTERACTION_SCHEMA as unknown as Record<string, SettingSchema>,
      'canvas-render',
    )
  }

  // —— 主题色板（「常规/主题配色」+「常规/暗色主题配色」）：每个可配置颜色**亮/暗各一格** ——
  // 与上面交互配置同一套语义：渲染宿主级声明（scope='canvas-render'），热卸业务插件不回收；
  // 时序也一致：在 settingsPersist.restore 之前 define，用户已保存的配色能在 define 时命中为初值。
  defineThemePaletteSettings(interactionSettings)
  // 主题模式（亮色/暗色）也声明进 settings：与交互配置同一套语义（宿主级、scope='canvas-render'、可持久化）。
  // 时序同样在 settingsPersist.restore 之前 define，用户保存过的模式才能在 define 时命中为初值。
  defineThemeModeSetting(interactionSettings)

  // 画布通用命令（建节点 / 删选中 / 撤销 / 重做）已收进基础插件（canvasBasePlugin.apply 里的
  // ctx.effect → registerCanvasCommands），宿主不再重复注册 —— 再注册会撞命令 id 抛错。

  // 配置持久化桥（P1-5 修复）：由基础插件建好并注入 ctx（见 canvasBasePlugin.apply，缺省开启）。
  // 宿主这里只负责"插件装载完成之后"的那一次 restore：插件 Config 已声明完成，
  // 注入的保存快照能在 define 时命中为初值（若宿主关掉 persistSettings，桥缺席 → 不 restore）。
  const settingsPersist: SettingsPersistService | undefined = base.services.settingsPersist
  if (settingsPersist) await settingsPersist.restore()

  // 色板落值：把"用户改过的那些格"写进 <html> 内联 CSS 变量（没改过的不写，CSS 侧默认值生效）。
  // 这步必须在 restore() 之后 —— 否则用户上次存的配色要等下一次改动才可见。
  const disposeThemePalette = installThemePalette(interactionSettings)
  // 主题模式落值：把持久化的亮/暗写进 <html class="dark">。这步也必须在 restore() 之后 ——
  // 否则用户上次存的模式要等下一次改动才生效（刷新后主题回退的成因）。
  const disposeThemeMode = installThemeMode(interactionSettings)

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
    const nodes = restoreNodes ?? []
    // 资源 URL 只在当前页面有效。先按持久化的 resourceId 重建各媒体字段的可用地址；
    // 找不到资源时删掉失效地址，避免挂载媒体元素后触发控制台 ERR_FILE_NOT_FOUND。
    // 判定收在 canvas-data 的 restoreNodeMediaUrls（视频/图片/全景各写哪个字段有单一来源）。
    await restoreNodeMediaUrls(nodes, async (resourceId, kind) => resources.restore?.(resourceId, kind))
    nodeStore.replaceAll(nodes)
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
    doc,
    nodeStore,
    edgeStore,
    nodeRegistry,
    themeRegistry,
    selection,
    command,
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
      // 色板：解除订阅 + 清掉内联覆盖（否则"幽灵变量"会挡住下一个主题）
      disposeThemePalette()
      disposeThemeMode()
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
      // 核心插件不可热替换（决策 1，与 manager.reload 同一处理）：卸不动就**明确抛错并停下**。
      // 旧写法是"卸（被拦、静默 false）→ 继续装新"，旧插件还在时继续装只会抛一句
      // "[core] Duplicate plugin name" —— 错误信息指向别处，最难查。HMR 走的就是这个入口。
      const verdict = ctx.canUninstall(name)
      if (!verdict.ok && verdict.reason === 'core') {
        throw new Error(
          `[host] core plugin cannot be uninstalled: "${name}" (reloadPlugin)`,
        )
      }
      ctx.uninstallPlugin(name) // 卸旧（回收副作用/注册）
      if (nextMod) ctx.installPlugin(nextMod) // 装新
    },
    // 对外插件清单 = 业务插件。宿主自有装配（canvas-base）是"环境"不是"清单项"，
    // 从门面隐去 —— 与本文件原先的对外契约（默认空清单）逐字一致。
    listPlugins: () => ctx.listPlugins().filter((n) => n !== base.name),
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
