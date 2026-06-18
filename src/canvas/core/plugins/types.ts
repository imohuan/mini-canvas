import type { Component } from 'vue'
import type { Node, Edge } from '@vue-flow/core'
import type { CanvasNodeDefinition, CanvasNodeMenuItem } from '../registry/NodeRegistry'
import type { MenuItemDefinition } from '../menu/MenuRegistry'
export type { MenuItemDefinition }
export type { CanvasNodeDefinition, CanvasNodeMenuItem }

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
 */
export const PluginLifecycle = {
  INSTALLING: 'installing',
  INSTALLED: 'installed',
  ACTIVATING: 'activating',
  ACTIVE: 'active',
  DEACTIVATING: 'deactivating',
  INACTIVE: 'inactive',
  UNINSTALLING: 'uninstalling',
  UNINSTALLED: 'uninstalled',
  ERROR: 'error',
} as const

export type PluginLifecycle = (typeof PluginLifecycle)[keyof typeof PluginLifecycle]

export interface Logger {
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

export interface CanvasStoreAPI {
  get<T = unknown>(key: string): T
  set(key: string, value: unknown): void
  watch(key: string, callback: (val: unknown) => void): () => void
  getState(): Record<string, unknown>
}

export interface SelectionOptions {
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

export interface CanvasActions {
  addNodes(nodes: Node[]): void
  removeNodes(ids: string[]): void
  addEdges(edges: Edge[]): void
  removeEdges(ids: string[]): void
  updateNode(id: string, data: Partial<Omit<Node, 'id'>>): void
  updateEdge(id: string, data: Partial<Omit<Edge, 'id'>>): void
  getNodes(): Node[]
  getEdges(): Edge[]
  addSelectedNodes(nodes: Node[]): void
  removeSelectedNodes(nodes: Node[]): void
  removeSelectedElements(): void
}

export interface HandleConfig {
  radius: number
  restOffset: number
  cursorGap: number
  buttonSize: number
  overlap: number
  snapOuterRatio: number
  snapInnerRatio: number
  snapHeightRatio: number
}

export interface MenuRegistryAPI {
  register(items: MenuItemDefinition[]): void
  unregister(ids: string[]): void
  unregisterAll(): void
}

export interface CanvasNodeRegistryAPI {
  register(definition: CanvasNodeDefinition): void
  unregister(type: string): void
  get(type: string): CanvasNodeDefinition | null
  getMenuItems(): CanvasNodeMenuItem[]
}

export interface ViewportAPI {
  zoomIn(): void
  zoomOut(): void
  zoomTo(level: number): void
  fitView(): void
  setCenter(x: number, y: number, zoom?: number): void
  setViewport(viewport: ViewportState): void
  screenToFlowCoordinate(position: Point): Point
  getViewport(): ViewportState
}

export interface PluginInstallResult<API = unknown> {
  api?: API
  uninstall?: () => void | Promise<void>
}

export interface CanvasPlugin<
  T extends Record<string, unknown> = {},
  API = unknown,
> {
  name: string
  version?: string
  dependencies?: string[]
  options?: T
  install(context: PluginContext, options: T): void | Promise<void> | PluginInstallResult<API> | Promise<PluginInstallResult<API>>
  uninstall?(): void | Promise<void>
  activate?(): void | Promise<void>
  deactivate?(): void | Promise<void>
}

export interface PluginContext {
  readonly canvasId: string
  readonly store: CanvasStoreAPI
  readonly actions: CanvasActions
  readonly selection: CanvasSelectionAPI
  readonly viewport: ViewportAPI
  readonly logger: Logger
  registerNodeType: (name: string, component: Component) => void
  registerEdgeType: (name: string, component: Component) => void
  registerComponent: (name: string, component: Component) => void
  readonly canvasNodes: CanvasNodeRegistryAPI
  readonly menus: MenuRegistryAPI
  registerHandleConfig: (config: Partial<HandleConfig>) => void
  on: (event: string, handler: (...args: any[]) => void) => () => void
  off: (event: string, handler: (...args: any[]) => void) => void
  emit: (event: string, payload: unknown) => void
  mountOverlay: (el: HTMLElement | Component, target: 'viewport' | 'canvas' | 'root') => void
  unmountOverlay: (el: HTMLElement | Component) => void
  registerShortcut: (keys: string, handler: () => void, description?: string) => void
  unregisterShortcut: (keys: string) => void
  /** 按名称获取其他插件的公共 API（类型安全） */
  getPluginAPI: <T = unknown>(name: string) => T | null
  /** @deprecated 只返回插件定义对象。插件间调用 API 请用 getPluginAPI()。 */
  getPlugin: <T = CanvasPlugin>(name: string) => T | null
}

export interface CanvasConfig {
  plugins: CanvasPlugin[]
  container?: string | HTMLElement
  initialNodes?: Node[]
  initialEdges?: Edge[]
  defaultViewport?: ViewportState
  debug?: boolean
  createContext?: (pluginName: string) => PluginContext
}

export interface PluginManifest {
  name: string
  version: string
  dependencies: string[]
  author?: string
  description?: string
}