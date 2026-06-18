import type { Component } from 'vue'
import type { Node, Edge } from '@vue-flow/core'

/**
 * 二维坐标点
 */
export interface Point {
  x: number
  y: number
}

/**
 * 视口状态（位置 + 缩放）
 */
export interface ViewportState extends Point {
  zoom: number
}

/**
 * 插件生命周期状态枚举
 *
 * 描述插件从安装到卸载的完整生命周期状态流转：
 * INSTALLING → INSTALLED → ACTIVATING → ACTIVE
 * ACTIVE → DEACTIVATING → INACTIVE → ACTIVATING（可重新激活）
 * ACTIVE → UNINSTALLING → UNINSTALLED
 * 任意状态 → ERROR（发生错误时）
 * ERROR → UNINSTALLING（卸载出错的插件）
 */
export const PluginLifecycle = {
  /** 正在安装中 */
  INSTALLING: 'installing',
  /** 已安装，尚未激活 */
  INSTALLED: 'installed',
  /** 正在激活中 */
  ACTIVATING: 'activating',
  /** 已激活，正常运行 */
  ACTIVE: 'active',
  /** 正在停用中 */
  DEACTIVATING: 'deactivating',
  /** 已停用（暂停运行） */
  INACTIVE: 'inactive',
  /** 正在卸载中 */
  UNINSTALLING: 'uninstalling',
  /** 已卸载 */
  UNINSTALLED: 'uninstalled',
  /** 发生错误 */
  ERROR: 'error',
} as const

export type PluginLifecycle = (typeof PluginLifecycle)[keyof typeof PluginLifecycle]

/**
 * 日志接口
 *
 * 提供分级日志输出能力，插件通过 PluginContext.logger 获取实例。
 */
export interface Logger {
  /** 调试级别日志 */
  debug(...args: unknown[]): void
  /** 信息级别日志 */
  info(...args: unknown[]): void
  /** 警告级别日志 */
  warn(...args: unknown[]): void
  /** 错误级别日志 */
  error(...args: unknown[]): void
}

/**
 * Canvas 状态存储 API
 *
 * 提供命名空间隔离的状态读写能力。
 * 插件通过 PluginContext.store 访问，读写操作限定在插件命名空间内。
 */
export interface CanvasStoreAPI {
  /** 读取指定 key 的状态值 */
  get<T = unknown>(key: string): T
  /** 设置指定 key 的状态值 */
  set(key: string, value: unknown): void
  /** 监听指定 key 的变化，返回取消监听的函数 */
  watch(key: string, callback: (val: unknown) => void): () => void
  /** 获取当前命名空间下的全部状态快照 */
  getState(): Record<string, unknown>
}

export interface SelectionOptions {
  /** 跳过同步到 VueFlow（当选中变化来自 VueFlow 自身时设为 true） */
  skipSync?: boolean
}

export interface CanvasSelectionAPI {
  getSelectedNodeIds(): Set<string>
  getSelectedEdgeIds(): Set<string>
  setSelectedNodeIds(ids: Iterable<string>, opts?: SelectionOptions): void
  setSelectedEdgeIds(ids: Iterable<string>, opts?: SelectionOptions): void
  setSelection(payload: { nodeIds?: Iterable<string>; edgeIds?: Iterable<string> }, opts?: SelectionOptions): void
  clearSelection(opts?: SelectionOptions): boolean
}

/**
 * 画布操作 API（节点与边）
 *
 * 提供对画布节点和边的基础 CRUD 操作。
 * 插件通过 PluginContext.actions 访问。
 */
export interface CanvasActions {
  /** 批量添加节点 */
  addNodes(nodes: Node[]): void
  /** 批量删除节点 */
  removeNodes(ids: string[]): void
  /** 批量添加边 */
  addEdges(edges: Edge[]): void
  /** 批量删除边 */
  removeEdges(ids: string[]): void
  /** 更新指定节点的部分属性（不含 id） */
  updateNode(id: string, data: Partial<Omit<Node, 'id'>>): void
  /** 更新指定边的部分属性（不含 id） */
  updateEdge(id: string, data: Partial<Omit<Edge, 'id'>>): void
  /** 获取画布中所有节点 */
  getNodes(): Node[]
  /** 获取画布中所有边 */
  getEdges(): Edge[]
  /** 使用 VueFlow 自己的选中逻辑选中节点（会触发 nodes-change） */
  addSelectedNodes(nodes: Node[]): void
  /** 使用 VueFlow 自己的选中逻辑取消选中节点（会触发 nodes-change） */
  removeSelectedNodes(nodes: Node[]): void
  /** 清空 VueFlow 选中状态（会触发 nodes-change / edges-change） */
  removeSelectedElements(): void
}

/**
 * 视口控制 API
 *
 * 提供对画布视口的缩放、平移等控制能力。
 * 插件通过 PluginContext.viewport 访问。
 */
export interface ViewportAPI {
  /** 放大 */
  zoomIn(): void
  /** 缩小 */
  zoomOut(): void
  /** 缩放至指定级别 */
  zoomTo(level: number): void
  /** 自适应视口，使所有节点可见 */
  fitView(): void
  /** 设置视口中心点，可同时指定缩放级别 */
  setCenter(x: number, y: number, zoom?: number): void
  /** 将屏幕坐标转换为画布坐标 */
  screenToFlowCoordinate(position: Point): Point
  /** 获取当前视口状态 */
  getViewport(): ViewportState
}

/**
 * 插件安装结果
 *
 * install() 像 hooks 一样返回清理函数和公共 API，
 * 替代旧式 `(Plugin as any)._cleanup` 和 `(Plugin as any).api` 模式。
 *
 * @typeParam API - 插件暴露的公共 API 类型
 */
export interface PluginInstallResult<API = unknown> {
  /** 插件暴露的公共 API（类型安全，无需 as any） */
  api?: API
  /** 卸载时调用的清理函数（自动清理事件监听、DOM、定时器等） */
  uninstall?: () => void | Promise<void>
}

/**
 * Canvas 插件接口
 *
 * 所有插件必须实现此接口。插件通过 install 方法接入插件系统，
 * 获取 PluginContext 后进行功能注册和初始化。
 *
 * install() 返回 PluginInstallResult<API>，其中包含公共 API 和清理函数。
 * PluginManager 在卸载时自动调用返回的 uninstall 函数。
 *
 * @typeParam T - 插件配置选项类型
 * @typeParam API - 插件暴露的公共 API 类型（默认 unknown）
 */
export interface CanvasPlugin<
  T extends Record<string, unknown> = {},
  API = unknown,
> {
  /** 插件唯一标识名称 */
  name: string
  /** 插件版本号（遵循 semver 规范） */
  version?: string
  /** 依赖的其他插件名称列表 */
  dependencies?: string[]
  /** 插件配置选项 */
  options?: T
  /**
   * 安装插件，获取 PluginContext 并完成初始化。
   *
   * 推荐返回 PluginInstallResult<API>（`{ api, uninstall }`），
   * 使公共 API 和清理逻辑类型安全、可推导。
   * 也可以返回 void（兼容旧式插件）。
   */
  install(context: PluginContext, options: T): void | Promise<void> | PluginInstallResult<API> | Promise<PluginInstallResult<API>>
  /** @deprecated 使用 install() 返回的 uninstall 替代 */
  uninstall?(): void | Promise<void>
  /** 激活插件（从暂停状态恢复） */
  activate?(): void | Promise<void>
  /** 停用插件（暂停运行但不卸载） */
  deactivate?(): void | Promise<void>
}

/**
 * 插件上下文
 *
 * 插件与画布系统之间的核心桥梁。
 * 插件通过 PluginContext 获取画布能力、注册组件类型、监听事件等。
 * 所有与 VueFlow 的交互均通过此上下文间接完成，插件不直接调用 useVueFlow()。
 */
export interface PluginContext {
  /** 画布实例唯一标识 */
  readonly canvasId: string
  /** 状态存储 API（命名空间隔离） */
  readonly store: CanvasStoreAPI
  /** 节点与边的操作 API */
  readonly actions: CanvasActions
  /** 当前选中态 API（运行时状态，不持久化） */
  readonly selection: CanvasSelectionAPI
  /** 视口控制 API */
  readonly viewport: ViewportAPI
  /** 日志记录器 */
  readonly logger: Logger
  /** 注册自定义节点类型 */
  registerNodeType: (name: string, component: Component) => void
  /** 注册自定义边类型 */
  registerEdgeType: (name: string, component: Component) => void
  /** 注册自定义组件 */
  registerComponent: (name: string, component: Component) => void
  /**
   * 监听事件，返回取消监听的函数。
   *
   * 用法类似 Vue watch / React useEffect 清理：
   * ```ts
   * const off = context.on('nodeDrag', handler)
   * // 取消监听：
   * off()
   * ```
   */
  on: (event: string, handler: (...args: any[]) => void) => () => void
  /** 取消事件监听 */
  off: (event: string, handler: (...args: any[]) => void) => void
  /** 触发事件 */
  emit: (event: string, payload: unknown) => void
  /** 挂载覆盖层元素到指定目标区域 */
  mountOverlay: (el: HTMLElement | Component, target: 'viewport' | 'canvas' | 'root') => void
  /** 卸载覆盖层元素 */
  unmountOverlay: (el: HTMLElement | Component) => void
  /** 注册快捷键 */
  registerShortcut: (keys: string, handler: () => void, description?: string) => void
  /** 取消快捷键注册 */
  unregisterShortcut: (keys: string) => void
  /** 按名称获取其他已安装的插件实例 */
  getPlugin: <T = CanvasPlugin>(name: string) => T | null
}

/**
 * Canvas 配置
 *
 * 初始化 Canvas 应用时的配置项。
 */
export interface CanvasConfig {
  /** 要加载的插件列表 */
  plugins: CanvasPlugin[]
  /** 画布容器元素或选择器 */
  container?: string | HTMLElement
  /** 初始节点列表 */
  initialNodes?: Node[]
  /** 初始边列表 */
  initialEdges?: Edge[]
  /** 默认视口位置与缩放 */
  defaultViewport?: ViewportState
  /** 是否开启调试模式 */
  debug?: boolean
  /** 可选：自定义上下文工厂函数，用于为每个插件创建 PluginContext */
  createContext?: (pluginName: string) => PluginContext
}

/**
 * 插件清单
 *
 * 描述插件的基本元信息，用于插件注册和依赖解析。
 */
export interface PluginManifest {
  /** 插件名称 */
  name: string
  /** 插件版本 */
  version: string
  /** 依赖列表 */
  dependencies: string[]
  /** 作者 */
  author?: string
  /** 描述 */
  description?: string
}
