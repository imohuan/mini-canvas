import type { Component } from 'vue'
import { watch } from 'vue'
import type { Node, Edge } from '@vue-flow/core'
import type {
  PluginContext,
  CanvasNodeDefinition,
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
import type { NodeRegistry } from '../registry/NodeRegistry'
import type { MenuRegistry } from '../registry/MenuRegistry'
import type { CommandRegistry } from '../registry/CommandRegistry'
import type { CommandContext } from '../registry/types'
import type { ToolbarRegistry } from '../registry/ToolbarRegistry'
import type { PanelRegistry } from '../registry/PanelRegistry'
import { CanvasDomService } from '../runtime/CanvasDomService'
import type { HandleConfig, MenuItemDefinition } from './types'
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
// EventBus - simple inter-plugin event bus
// ============================================================================

export class EventBus {
  private handlers = new Map<string, Set<(...args: any[]) => void>>()

  on(event: string, handler: (...args: any[]) => void): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set())
    }
    this.handlers.get(event)!.add(handler)
    return () => this.off(event, handler)
  }

  off(event: string, handler: (...args: any[]) => void): void {
    const handlers = this.handlers.get(event)
    if (handlers) {
      handlers.delete(handler)
      if (handlers.size === 0) {
        this.handlers.delete(event)
      }
    }
  }

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

  clear(): void {
    this.handlers.clear()
  }
}

// ============================================================================
// createPluginContext factory options
// ============================================================================

interface CreatePluginContextOptions {
  canvasId: string
  vueFlowInstance: VueFlowInstance
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
  eventBus?: EventBus
  nodeRegistry?: NodeRegistry
  menuRegistry?: MenuRegistry
  commandRegistry?: CommandRegistry
  toolbarRegistry?: ToolbarRegistry
  panelRegistry?: PanelRegistry
  pluginManager?: { getPlugin(name: string): unknown; getPluginAPI(name: string): unknown }
  /** canvas.state 引用，供 useValue 使用 */
  canvasState?: { core: Record<string, unknown>; plugins: Record<string, Record<string, unknown>> }
}

// ============================================================================
// Factory: createPluginContext
// ============================================================================

export function createPluginContext(
  pluginName: string,
  options: CreatePluginContextOptions,
): PluginContext {
  const {
    canvasId,
    vueFlowInstance,
    canvasStore,
    eventBus = new EventBus(),
    nodeRegistry,
    menuRegistry,
    commandRegistry,
    toolbarRegistry,
    panelRegistry,
    canvasState,
    pluginManager,
  } = options

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

  const logger: Logger = {
    debug: (...args: unknown[]) => console.debug(`[${pluginName}]`, ...args),
    info: (...args: unknown[]) => console.info(`[${pluginName}]`, ...args),
    warn: (...args: unknown[]) => console.warn(`[${pluginName}]`, ...args),
    error: (...args: unknown[]) => console.error(`[${pluginName}]`, ...args),
  }

  const store: CanvasStoreAPI = createPluginStore(pluginName, effectiveStore, logger)
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

  const viewport: ViewportAPI = createViewport(vueFlowInstance, logger)
  const registeredComponents = new Map<string, Component>()

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

    dom: createDomService(),

    menus: {
      register(source: string, item: MenuItemDefinition): void {
        menuRegistry?.register(source, item)
      },
      unregister(id: string): void {
        menuRegistry?.unregister(id)
      },
      unregisterSource(source: string): void {
        menuRegistry?.unregisterSource(source)
      },
    },

    registerHandleConfig(config: Partial<HandleConfig>): void {
      const state = effectiveStore.state as Record<string, unknown>
      if (typeof config.radius === 'number') state.handleRadius = config.radius
      if (typeof config.restOffset === 'number') state.handleRestOffset = config.restOffset
      if (typeof config.cursorGap === 'number') state.handleCursorGap = config.cursorGap
      if (typeof config.buttonSize === 'number') state.handleButtonSize = config.buttonSize
      if (typeof config.overlap === 'number') state.handleOverlap = config.overlap
      if (typeof config.snapOuterRatio === 'number') state.connectionSnapOuterRatio = config.snapOuterRatio
      if (typeof config.snapInnerRatio === 'number') state.connectionSnapInnerRatio = config.snapInnerRatio
      if (typeof config.snapHeightRatio === 'number') state.connectionSnapHeightRatio = config.snapHeightRatio
    },

    canvasNodes: {
      register(definition: CanvasNodeDefinition): void {
        nodeRegistry?.register(definition)
        logger.debug(`Registered canvas node: "${definition.type}"`)
      },
      unregister(type: string): void {
        nodeRegistry?.unregister(type)
        logger.debug(`Unregistered canvas node: "${type}"`)
      },
      get(type: string) {
        return nodeRegistry?.get(type) ?? null
      },
      getMenuItems() {
        return nodeRegistry?.getMenuItems() ?? []
      },
    },

    commands: {
      register(command: any) { commandRegistry?.register(command) },
      unregister(id: string) { commandRegistry?.unregister(id) },
      unregisterSource(source: string) { commandRegistry?.unregisterSource(source) },
      async execute<T = void>(id: string, ctx?: CommandContext, args?: unknown): Promise<T | undefined> {
        return commandRegistry?.execute<T>(id, ctx ?? { runtime: null, actions: null, selection: null, viewport: null, store: null, logger }, args)
      },
      canExecute(id: string) { return commandRegistry?.canExecute(id) ?? false },
      has(id: string) { return commandRegistry?.has(id) ?? false },
      get(id: string) { return commandRegistry?.get(id) ?? null },
      getPublic() { return commandRegistry?.getPublic() ?? [] },
      getAll() { return commandRegistry?.getAll() ?? [] },
    },

    toolbars: {
      register(source: string, button: any) { toolbarRegistry?.register(source, button) },
      unregister(id: string) { toolbarRegistry?.unregister(id) },
      unregisterSource(source: string) { toolbarRegistry?.unregisterSource(source) },
      getByPosition(position: 'top' | 'bottom') { return toolbarRegistry?.getByPosition(position) ?? [] },
      getAll() { return toolbarRegistry?.getAll() ?? [] },
    },

    panels: {
      registerSetting(source: string, setting: any) { panelRegistry?.registerSetting(source, setting) },
      unregisterSetting(id: string) { panelRegistry?.unregisterSetting(id) },
      unregisterSource(source: string) { panelRegistry?.unregisterSource(source) },
      getAll() { return panelRegistry?.getAll() ?? [] },
      getBySource(source: string) { return panelRegistry?.getBySource(source) ?? [] },
      useValue<T>(id: string, store: any, defaultValue: T) { return panelRegistry?.useValue<T>(id, store ?? canvasState as any, defaultValue) ?? (null as any) },
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

    unregisterShortcut(keys: string): void {
      const manager = ShortcutManager.getInstance()
      const id = `${pluginName}:${keys.replace(/\+/g, '-').replace(/\s+/g, '')}`
      manager.unregister(id)
    },

    getPluginAPI<T = unknown>(name: string): T | null {
      try {
        return pluginManager?.getPluginAPI(name) as T ?? null
      } catch (err) {
        logger.error(`Failed to get plugin API "${name}":`, err)
        return null
      }
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

function createPluginStore(
  pluginName: string,
  canvasStore: { state: Record<string, any> },
  logger: Logger,
): CanvasStoreAPI {
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
    getAllNodes(): Node[] {
      try { return (vf as any).nodes?.value ?? vf.getNodes.value } catch (err) { logger.error('actions.getAllNodes failed:', err); return [] }
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

function createViewport(vf: VueFlowInstance, logger: Logger): ViewportAPI {
  return {
    zoomIn(): void {
      try { vf.zoomIn() } catch (err) { logger.error('viewport.zoomIn failed:', err) }
    },
    zoomOut(): void {
      try { vf.zoomOut() } catch (err) { logger.error('viewport.zoomOut failed:', err) }
    },
    zoomTo(level: number): void {
      try { vf.zoomTo(level) } catch (err) { logger.error(`viewport.zoomTo(${level}) failed:`, err) }
    },
    fitView(): void {
      try { vf.fitView() } catch (err) { logger.error('viewport.fitView failed:', err) }
    },
    setCenter(x: number, y: number, zoom?: number): void {
      try { vf.setCenter(x, y, zoom !== undefined ? { zoom } : undefined) } catch (err) { logger.error(`viewport.setCenter(${x}, ${y}, ${zoom}) failed:`, err) }
    },
    setViewport(viewport: ViewportState): void {
      try { vf.setViewport({ x: viewport.x, y: viewport.y, zoom: viewport.zoom }) } catch (err) { logger.error(`viewport.setViewport(${viewport.x}, ${viewport.y}, ${viewport.zoom}) failed:`, err) }
    },
    screenToFlowCoordinate(position: Point): Point {
      try {
        const rendererEl = document.querySelector('.vue-flow__renderer') as HTMLElement | null
        if (rendererEl) {
          const bounds = rendererEl.getBoundingClientRect()
          const rendererRelative = { x: position.x - bounds.left, y: position.y - bounds.top }
          return vf.project(rendererRelative)
        }
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

function createDomService() {
  const service = new CanvasDomService()
  return {
    getPane: () => service.getPane(),
    getViewport: () => service.getViewport(),
    onDocument: (type: any, handler: any, opts?: any) => service.onDocument(type, handler, opts),
    onWindow: (type: any, handler: any, opts?: any) => service.onWindow(type, handler, opts),
  }
}

