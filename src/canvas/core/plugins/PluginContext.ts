import type { Component } from 'vue'
import { watch } from 'vue'
import type { Node, Edge } from '@vue-flow/core'
import type {
  PluginContext,
  CanvasStoreAPI,
  CanvasActions,
  CanvasSelectionAPI,
  SelectionOptions,
  ViewportAPI,
  Logger,
  CanvasPlugin,
  Point,
  ViewportState,
} from './types'
import { ShortcutManager } from './ShortcutManager'

// ============================================================================
// Internal type for the VueFlow instance passed from Canvas.vue
// ============================================================================

interface VueFlowInstance {
  addNodes(nodes: Node[]): void
  removeNodes(ids: string[]): void
  addEdges(edges: Edge[]): void
  removeEdges(ids: string[]): void
  updateNode(id: string, data: Partial<Omit<Node, 'id'>>): void
  updateEdge(id: string, data: any): Edge
  addSelectedNodes(nodes: Node[]): void
  removeSelectedNodes(nodes: Node[]): void
  removeSelectedElements(): void
  getNodes: { value: Node[] }
  getEdges: { value: Edge[] }
  zoomIn(options?: { duration?: number }): void
  zoomOut(options?: { duration?: number }): void
  zoomTo(level: number, options?: { duration?: number }): void
  fitView(options?: { padding?: number; duration?: number }): void
  setCenter(x: number, y: number, options?: { zoom?: number; duration?: number }): void
  setViewport(transform: { x: number; y: number; zoom: number }, options?: { duration?: number }): void
  project(position: { x: number; y: number }): { x: number; y: number }
  viewport: { value: { x: number; y: number; zoom: number } }
}

// ============================================================================
// EventBus — simple inter-plugin event bus
// ============================================================================

/**
 * 轻量级事件总线，用于插件间通信。
 *
 * 支持 on/off/emit 三元操作，基于 Map 实现。
 * 单个处理函数的异常会被捕获并记录到 console，不影响其他处理函数。
 */
export class EventBus {
  private handlers = new Map<string, Set<(...args: any[]) => void>>()

  /**
   * 注册事件监听器
   *
   * @param event - 事件名称
   * @param handler - 事件处理函数
   */
  on(event: string, handler: (...args: any[]) => void): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set())
    }
    this.handlers.get(event)!.add(handler)
    return () => this.off(event, handler)
  }

  /**
   * 取消事件监听器
   *
   * @param event - 事件名称
   * @param handler - 要移除的处理函数
   */
  off(event: string, handler: (...args: any[]) => void): void {
    const handlers = this.handlers.get(event)
    if (handlers) {
      handlers.delete(handler)
      if (handlers.size === 0) {
        this.handlers.delete(event)
      }
    }
  }

  /**
   * 触发事件
   *
   * 同步调用所有注册的处理函数。
   * 单个处理函数的异常会被捕获并记录，不影响其他处理函数。
   *
   * @param event - 事件名称
   * @param payload - 事件负载数据
   */
  emit(event: string, payload?: unknown): void {
    const handlers = this.handlers.get(event)
    if (!handlers || handlers.size === 0) return

    for (const handler of handlers) {
      try {
        handler(payload)
      } catch (err) {
        console.error(`[EventBus] Handler error for event "${event}":`, err)
      }
    }
  }

  /**
   * 清除所有事件监听器
   */
  clear(): void {
    this.handlers.clear()
  }
}

// ============================================================================
// createPluginContext factory options
// ============================================================================

interface CreatePluginContextOptions {
  /** 画布实例唯一标识 */
  canvasId: string
  /** VueFlow 组合式 API 返回的实例 */
  vueFlowInstance: VueFlowInstance
  /** Pinia 画布状态 store（selection + plugins 命名空间 + 自定义节点/边注册） */
  canvasStore?: {
    state: Record<string, any>
    selectionState: {
      selectedNodeIds: Set<string>
      selectedEdgeIds: Set<string>
      selectionVersion: number
    }
    setSelectedNodeIds?(ids: Iterable<string>): boolean
    setSelectedEdgeIds?(ids: Iterable<string>): boolean
    setSelection?(payload: { nodeIds?: Iterable<string>; edgeIds?: Iterable<string> }): boolean
    clearSelection?(): boolean
    registerCustomNodeType?(name: string, component: Component): void
    registerCustomEdgeType?(name: string, component: Component): void
  }
  /** 可选：共享事件总线（通常从 PluginManager 传入） */
  eventBus?: EventBus
  /** 可选：PluginManager 引用（用于 getPlugin 查找） */
  pluginManager?: { getPlugin(name: string): unknown }
}

// ============================================================================
// Factory: createPluginContext
// ============================================================================

/**
 * 创建 PluginContext 实例
 *
 * PluginContext 是插件与画布系统之间的核心适配器，
 * 包装了 VueFlow API、Pinia store 和事件总线等底层能力。
 * 插件通过 PluginContext 进行所有画布操作，不直接调用 useVueFlow()。
 *
 * @param pluginName - 插件唯一名称
 * @param options - 上下文配置项
 * @returns 完整的 PluginContext 实例
 *
 * @example
 * ```typescript
 * const ctx = createPluginContext('myPlugin', {
 *   canvasId: 'canvas-1',
 *   vueFlowInstance: useVueFlow(),
 *   canvasStore: useCanvasStore(),
 *   eventBus: sharedBus,
 * })
 * ```
 */
export function createPluginContext(
  pluginName: string,
  options: CreatePluginContextOptions,
): PluginContext {
  const {
    canvasId,
    vueFlowInstance,
    canvasStore,
    eventBus = new EventBus(),
    pluginManager,
  } = options

  // 安全回退：当 canvasStore 未提供时（如 PluginManager stub），使用空 Set
  const effectiveStore = canvasStore ?? {
    state: {
      plugins: {} as Record<string, Record<string, unknown>>,
    },
    selectionState: {
      selectedNodeIds: new Set<string>(),
      selectedEdgeIds: new Set<string>(),
      selectionVersion: 0,
    },
  }

  // ================================================================
  // Logger — prefix-scoped console wrapper
  // ================================================================

  const logger: Logger = {
    debug: (...args: unknown[]) => console.debug(`[${pluginName}]`, ...args),
    info: (...args: unknown[]) => console.info(`[${pluginName}]`, ...args),
    warn: (...args: unknown[]) => console.warn(`[${pluginName}]`, ...args),
    error: (...args: unknown[]) => console.error(`[${pluginName}]`, ...args),
  }

  // ================================================================
  // Store — namespace-isolated state read/write on Pinia store
  // ================================================================

  const store: CanvasStoreAPI = createPluginStore(pluginName, effectiveStore, logger)

  // ================================================================
  // Actions — node/edge CRUD wrapping VueFlow composable
  // ================================================================

  const actions: CanvasActions = createActions(vueFlowInstance, logger)

  function syncSelectionToVueFlow(nodeIds: Iterable<string>, edgeIds: Iterable<string>): void {
    const selectedNodeIds = new Set(nodeIds)
    const selectedEdgeIds = new Set(edgeIds)

    for (const node of vueFlowInstance.getNodes.value) {
      const selected = selectedNodeIds.has(node.id)
      const runtimeNode = node as Node & { selected?: boolean }
      if (runtimeNode.selected !== selected) {
        vueFlowInstance.updateNode(node.id, { selected } as Partial<Omit<Node, 'id'>>)
      }
    }

    for (const edge of vueFlowInstance.getEdges.value) {
      const selected = selectedEdgeIds.has(edge.id)
      const runtimeEdge = edge as Edge & { selected?: boolean }
      if (runtimeEdge.selected !== selected) {
        vueFlowInstance.updateEdge(edge.id, { selected })
      }
    }
  }

  const selection: CanvasSelectionAPI = {
    getSelectedNodeIds: () => new Set(effectiveStore.selectionState.selectedNodeIds),
    getSelectedEdgeIds: () => new Set(effectiveStore.selectionState.selectedEdgeIds),
    setSelectedNodeIds: (ids: Iterable<string>, opts?: SelectionOptions) => {
      const nextNodeIds = new Set(ids)
      if (effectiveStore.setSelectedNodeIds) {
        effectiveStore.setSelectedNodeIds(nextNodeIds)
      } else {
        effectiveStore.selectionState.selectedNodeIds = nextNodeIds
        effectiveStore.selectionState.selectionVersion++
      }
      if (!opts?.skipSync) {
        syncSelectionToVueFlow(nextNodeIds, effectiveStore.selectionState.selectedEdgeIds)
      }
    },
    setSelectedEdgeIds: (ids: Iterable<string>, opts?: SelectionOptions) => {
      const nextEdgeIds = new Set(ids)
      if (effectiveStore.setSelectedEdgeIds) {
        effectiveStore.setSelectedEdgeIds(nextEdgeIds)
      } else {
        effectiveStore.selectionState.selectedEdgeIds = nextEdgeIds
        effectiveStore.selectionState.selectionVersion++
      }
      if (!opts?.skipSync) {
        syncSelectionToVueFlow(effectiveStore.selectionState.selectedNodeIds, nextEdgeIds)
      }
    },
    setSelection: (payload: { nodeIds?: Iterable<string>; edgeIds?: Iterable<string> }, opts?: SelectionOptions) => {
      const nextNodeIds = payload.nodeIds ? new Set(payload.nodeIds) : effectiveStore.selectionState.selectedNodeIds
      const nextEdgeIds = payload.edgeIds ? new Set(payload.edgeIds) : effectiveStore.selectionState.selectedEdgeIds
      if (effectiveStore.setSelection) {
        effectiveStore.setSelection({ nodeIds: nextNodeIds, edgeIds: nextEdgeIds })
      } else {
        effectiveStore.selectionState.selectedNodeIds = nextNodeIds
        effectiveStore.selectionState.selectedEdgeIds = nextEdgeIds
        effectiveStore.selectionState.selectionVersion++
      }
      if (!opts?.skipSync) {
        syncSelectionToVueFlow(nextNodeIds, nextEdgeIds)
      }
    },
    clearSelection: (opts?: SelectionOptions) => {
      const hadSelection = effectiveStore.selectionState.selectedNodeIds.size > 0 || effectiveStore.selectionState.selectedEdgeIds.size > 0
      if (effectiveStore.clearSelection) {
        effectiveStore.clearSelection()
      } else if (hadSelection) {
        effectiveStore.selectionState.selectedNodeIds = new Set<string>()
        effectiveStore.selectionState.selectedEdgeIds = new Set<string>()
        effectiveStore.selectionState.selectionVersion++
      }
      if (!opts?.skipSync && hadSelection) {
        syncSelectionToVueFlow([], [])
      }
      return hadSelection
    },
  }

  // ================================================================

  const viewport: ViewportAPI = createViewport(vueFlowInstance, logger)

  // ================================================================
  // Component registry — stores registered node/edge types
  // ================================================================

  const registeredComponents = new Map<string, Component>()

  // ================================================================
  // Event delegation — pre-define functions to bypass any object literal issues
  // ================================================================

  function contextOn(event: string, handler: (...args: any[]) => void): () => void {
    eventBus.on(event, handler)
    return () => eventBus.off(event, handler)
  }

  function contextOff(event: string, handler: (...args: any[]) => void): void {
    eventBus.off(event, handler)
  }

  function contextEmit(event: string, payload: unknown): void {
    eventBus.emit(event, payload)
  }

  // ================================================================
  // Build and return the PluginContext
  // ================================================================

  const context: PluginContext = {
    canvasId,
    store,
    actions,
    selection,
    viewport,
    logger,

    registerNodeType(name: string, component: Component): void {
      try {
        effectiveStore.registerCustomNodeType?.(name, component)
        logger.debug(`Registered node type: "${name}"`)
      } catch (err) {
        logger.error(`Failed to register node type "${name}":`, err)
      }
    },

    registerEdgeType(name: string, component: Component): void {
      try {
        effectiveStore.registerCustomEdgeType?.(name, component)
        logger.debug(`Registered edge type: "${name}"`)
      } catch (err) {
        logger.error(`Failed to register edge type "${name}":`, err)
      }
    },

    registerComponent(name: string, component: Component): void {
      try {
        registeredComponents.set(name, component)
        logger.debug(`Registered component: "${name}"`)
      } catch (err) {
        logger.error(`Failed to register component "${name}":`, err)
      }
    },

    on: contextOn,
    off: contextOff,
    emit: contextEmit,

    mountOverlay(el: HTMLElement | Component, target: 'viewport' | 'canvas' | 'root'): void {
      try {
        const containers: Record<typeof target, string> = {
          viewport: '.vue-flow__viewport',
          canvas: '.vue-flow__renderer',
          root: '#app',
        }
        const selector = containers[target]
        const container = document.querySelector(selector)
        if (container && el instanceof HTMLElement) {
          container.appendChild(el)
          logger.debug(`Mounted overlay to "${target}"`)
        } else if (container && !(el instanceof HTMLElement)) {
          logger.warn(`Component overlay mounting not yet implemented for "${target}"`)
        } else if (!container) {
          logger.warn(`Overlay target container "${selector}" not found`)
        }
      } catch (err) {
        logger.error(`Failed to mount overlay to "${target}":`, err)
      }
    },

    unmountOverlay(el: HTMLElement | Component): void {
      try {
        if (el instanceof HTMLElement && el.parentNode) {
          el.parentNode.removeChild(el)
          logger.debug('Unmounted overlay')
        }
      } catch (err) {
        logger.error('Failed to unmount overlay:', err)
      }
    },

    /**
     * 注册快捷键（委托给 ShortcutManager 统一管理）
     *
     * 签名与旧版完全兼容。内部生成稳定 ID（格式：pluginName:keys）
     * 并转发给 ShortcutManager 完成注册、冲突检测和键盘监听。
     *
     * @param keys - 快捷键字符串，如 'ctrl+z'
     * @param handler - 快捷键触发时的回调函数
     * @param description - 人类可读的功能描述
     */
    registerShortcut(keys: string, handler: () => void, description?: string): void {
      const manager = ShortcutManager.getInstance()
      const id = `${pluginName}:${keys.replace(/\+/g, '-').replace(/\s+/g, '')}`
      const result = manager.register({
        id,
        command: description || `快捷键: ${keys}`,
        keys,
        handler,
        priority: 30,
        pluginId: pluginName,
        group: 'plugin',
      })
      if (!result.ok) {
        logger.warn(`Shortcut conflict: "${keys}" is already registered by another plugin`)
      }
    },

    /**
     * 注销快捷键（委托给 ShortcutManager 统一管理）
     *
     * 使用与 registerShortcut 相同的 ID 生成规则，从 ShortcutManager 中注销。
     *
     * @param keys - 快捷键字符串，如 'ctrl+z'
     */
    unregisterShortcut(keys: string): void {
      const manager = ShortcutManager.getInstance()
      const id = `${pluginName}:${keys.replace(/\+/g, '-').replace(/\s+/g, '')}`
      manager.unregister(id)
    },

    getPlugin<T = CanvasPlugin>(name: string): T | null {
      try {
        if (pluginManager) {
          return pluginManager.getPlugin(name) as T | null
        }
        return null
      } catch (err) {
        logger.error(`Failed to get plugin "${name}":`, err)
        return null
      }
    },
  }

  return context
}

// ============================================================================
// Module factories
// ============================================================================

/**
 * 创建命名空间隔离的插件状态存储
 *
 * 读写操作限定在 `canvasStore.state.plugins[pluginName]` 命名空间内。
 *
 * @param pluginName - 插件名称
 * @param canvasStore - Pinia 画布状态 store
 * @param logger - 日志记录器
 * @returns CanvasStoreAPI 实例
 */
function createPluginStore(
  pluginName: string,
  canvasStore: { state: Record<string, any> },
  logger: Logger,
): CanvasStoreAPI {
  /** 确保插件命名空间已初始化 */
  function ensureNamespace(): void {
    if (!canvasStore.state.plugins) {
      canvasStore.state.plugins = {}
    }
    if (!canvasStore.state.plugins[pluginName]) {
      canvasStore.state.plugins[pluginName] = {}
    }
  }

  return {
    get<T = unknown>(key: string): T {
      try {
        ensureNamespace()
        return canvasStore.state.plugins[pluginName][key] as T
      } catch (err) {
        logger.error(`store.get("${key}") failed:`, err)
        return undefined as unknown as T
      }
    },

    set(key: string, value: unknown): void {
      try {
        ensureNamespace()
        canvasStore.state.plugins[pluginName][key] = value
      } catch (err) {
        logger.error(`store.set("${key}") failed:`, err)
      }
    },

    watch(storeKey: string, callback: (val: unknown) => void): () => void {
      try {
        ensureNamespace()
        const stop = watch(
          () => canvasStore.state.plugins?.[pluginName]?.[storeKey],
          (newVal) => {
            if (newVal !== undefined) {
              callback(newVal)
            }
          },
        )
        return stop
      } catch (err) {
        logger.error(`store.watch("${storeKey}") failed:`, err)
        return () => {}
      }
    },

    getState(): Record<string, unknown> {
      try {
        ensureNamespace()
        return { ...canvasStore.state.plugins[pluginName] } as Record<string, unknown>
      } catch (err) {
        logger.error('store.getState() failed:', err)
        return {}
      }
    },
  }
}

/**
 * 创建节点与边的 CRUD 操作代理
 *
 * 直接透传给 VueFlow 实例的对应方法。
 * nodes/edges 由 VueFlow 内部唯一管理，不再双写到 Pinia。
 *
 * @param vf - VueFlow 实例
 * @param logger - 日志记录器
 * @returns CanvasActions 实例
 */
function createActions(vf: VueFlowInstance, logger: Logger) {
  return {
    addNodes(nodes: Node[]): void {
      try { vf.addNodes(nodes) } catch (err) { logger.error('actions.addNodes failed:', err) }
    },

    removeNodes(ids: string[]): void {
      try { vf.removeNodes(ids) } catch (err) { logger.error('actions.removeNodes failed:', err) }
    },

    addEdges(edges: Edge[]): void {
      try { vf.addEdges(edges) } catch (err) { logger.error('actions.addEdges failed:', err) }
    },

    removeEdges(ids: string[]): void {
      try { vf.removeEdges(ids) } catch (err) { logger.error('actions.removeEdges failed:', err) }
    },

    updateNode(id: string, data: Partial<Omit<Node, 'id'>>): void {
      try { vf.updateNode(id, data) } catch (err) { logger.error(`actions.updateNode("${id}") failed:`, err) }
    },

    updateEdge(id: string, data: Partial<Omit<Edge, 'id'>>): void {
      try { vf.updateEdge(id, data) } catch (err) { logger.error(`actions.updateEdge("${id}") failed:`, err) }
    },

    getNodes(): Node[] {
      try { return vf.getNodes.value } catch (err) { logger.error('actions.getNodes failed:', err); return [] }
    },

    getEdges(): Edge[] {
      try { return vf.getEdges.value } catch (err) { logger.error('actions.getEdges failed:', err); return [] }
    },

    addSelectedNodes(nodes: Node[]): void {
      try { vf.addSelectedNodes(nodes) } catch (err) { logger.error('actions.addSelectedNodes failed:', err) }
    },

    removeSelectedNodes(nodes: Node[]): void {
      try { vf.removeSelectedNodes(nodes) } catch (err) { logger.error('actions.removeSelectedNodes failed:', err) }
    },

    removeSelectedElements(): void {
      try { vf.removeSelectedElements() } catch (err) { logger.error('actions.removeSelectedElements failed:', err) }
    },
  }
}

/**
 * 创建视口控制代理
 *
 * 包装 VueFlow 的缩放、平移和坐标转换方法。
 *
 * @param vf - VueFlow 实例
 * @param logger - 日志记录器
 * @returns ViewportAPI 实例
 */
function createViewport(vf: VueFlowInstance, logger: Logger): ViewportAPI {
  return {
    zoomIn(): void {
      try {
        vf.zoomIn()
      } catch (err) {
        logger.error('viewport.zoomIn failed:', err)
      }
    },

    zoomOut(): void {
      try {
        vf.zoomOut()
      } catch (err) {
        logger.error('viewport.zoomOut failed:', err)
      }
    },

    zoomTo(level: number): void {
      try {
        vf.zoomTo(level)
      } catch (err) {
        logger.error(`viewport.zoomTo(${level}) failed:`, err)
      }
    },

    fitView(): void {
      try {
        vf.fitView()
      } catch (err) {
        logger.error('viewport.fitView failed:', err)
      }
    },

    setCenter(x: number, y: number, zoom?: number): void {
      try {
        vf.setCenter(x, y, zoom !== undefined ? { zoom } : undefined)
      } catch (err) {
        logger.error(`viewport.setCenter(${x}, ${y}, ${zoom}) failed:`, err)
      }
    },

    setViewport(viewport: ViewportState): void {
      try {
        vf.setViewport({ x: viewport.x, y: viewport.y, zoom: viewport.zoom })
      } catch (err) {
        logger.error(`viewport.setViewport(${viewport.x}, ${viewport.y}, ${viewport.zoom}) failed:`, err)
      }
    },

    screenToFlowCoordinate(position: Point): Point {
      try {
        // vf.project() 期望 renderer-relative 坐标（clientX - rendererBounds.left）
        // 但调用者传入的可能是屏幕坐标，需要先转换
        const rendererEl = document.querySelector('.vue-flow__renderer') as HTMLElement | null
        if (rendererEl) {
          const bounds = rendererEl.getBoundingClientRect()
          const rendererRelative = {
            x: position.x - bounds.left,
            y: position.y - bounds.top,
          }
          return vf.project(rendererRelative)
        }
        // fallback: 直接用 project（假设已经是 renderer-relative）
        return vf.project(position)
      } catch (err) {
        logger.error('viewport.screenToFlowCoordinate failed:', err)
        return position
      }
    },

    getViewport(): ViewportState {
      try {
        const vp = vf.viewport.value
        return { x: vp.x, y: vp.y, zoom: vp.zoom }
      } catch (err) {
        logger.error('viewport.getViewport failed:', err)
        return { x: 0, y: 0, zoom: 1 }
      }
    },
  }
}
