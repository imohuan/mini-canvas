import { ref, computed, markRaw, shallowRef, type Component } from 'vue'
import { useStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import type { NodeTypesObject } from '@vue-flow/core'
import { ConnectionMode, SelectionMode } from '@vue-flow/core'
import CustomNode from '../components/CustomNode.vue'
import TempTargetNode from '../components/TempTargetNode.vue'
import CustomEdge from '../components/CustomEdge.vue'
import type { ConnectionState } from '../plugins/types'

/**
 * 连接线类型：
 * - bezier: 贝塞尔曲线
 * - straight: 直线
 * - step: 阶梯线（直角折线）
 */
export type EdgeType = 'bezier' | 'straight' | 'step' | 'smoothstep'

function numberOr(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function sameStringSet(a: Set<string>, b: Set<string>) {
  if (a.size !== b.size) return false
  for (const value of a) {
    if (!b.has(value)) return false
  }
  return true
}

/** useStorage 自定义序列化器：处理 Set ↔ 数组、ConnectionMode ↔ 字符串 */
const serializer = {
  read(raw: string) {
    const data = JSON.parse(raw)
    const core = data.core || data
    if (!core.plugins) data.plugins = data.plugins || {}
    return {
      core: {
        handleDebug: core.handleDebug ?? false,
        handleRadius: numberOr(core.handleRadius, 86),
        handleRestOffset: numberOr(core.handleRestOffset, 36),
        handleCursorGap: numberOr(core.handleCursorGap, 24),
        handleButtonSize: numberOr(core.handleButtonSize, 32),
        handleOverlap: numberOr(core.handleOverlap, 16),
        connectionSnapDebugVisible: core.connectionSnapDebugVisible ?? false,
        connectionSnapOuterRatio: numberOr(core.connectionSnapOuterRatio, 0.75),
        connectionSnapInnerRatio: numberOr(core.connectionSnapInnerRatio, 0.6),
        connectionSnapHeightRatio: numberOr(core.connectionSnapHeightRatio, 1.35),
        selectionFramePaddingX: numberOr(core.selectionFramePaddingX, 16),
        selectionFramePaddingTop: numberOr(core.selectionFramePaddingTop, 34),
        selectionFramePaddingBottom: numberOr(core.selectionFramePaddingBottom, 16),
        performancePanelEnabled: core.performancePanelEnabled ?? false,
        performancePanelShowCharts: core.performancePanelShowCharts ?? true,
        performancePanelShowMemory: core.performancePanelShowMemory ?? true,
        connectionMode:
          core.connectionMode === 'loose' ? ConnectionMode.Loose : ConnectionMode.Strict,
        selectionMode:
          core.selectionMode === 'partial' ? SelectionMode.Partial : SelectionMode.Full,
        edgeLineWidth: core.edgeLineWidth ?? 2,
        edgeColor: core.edgeColor ?? '#3b82f6',
        edgeType: core.edgeType ?? 'bezier',
        edgeDashed: core.edgeDashed ?? false,
        edgeAnimated: core.edgeAnimated ?? true,
        edgeMarkerEnd: core.edgeMarkerEnd ?? false,
        edgeMarkerSize: core.edgeMarkerSize ?? 8,
        edgeVisible: core.edgeVisible ?? true,
        edgeStepOffset: core.edgeStepOffset ?? 20,
        edgeSmoothRadius: core.edgeSmoothRadius ?? 5,
        edgeGlowEnabled: core.edgeGlowEnabled ?? true,
        edgeGlowIntensity: core.edgeGlowIntensity ?? 1,
        edgeGlowColor: core.edgeGlowColor ?? '#ffffff',
        topToolbarOffset: core.topToolbarOffset ?? 12,
        bottomToolbarOffset: core.bottomToolbarOffset ?? 12,
        nodesDraggable: core.nodesDraggable ?? true,
        nodesConnectable: core.nodesConnectable ?? true,
        elementsSelectable: core.elementsSelectable ?? true,
        edgesUpdatable: core.edgesUpdatable ?? true,
        snapToGrid: core.snapToGrid ?? false,
        snapGrid: core.snapGrid ?? [15, 15],
        zoomOnPinch: core.zoomOnPinch ?? true,
        minZoom: core.minZoom ?? 0.1,
        maxZoom: core.maxZoom ?? 4,
        zoomOnScroll: core.zoomOnScroll ?? true,
        panOnScroll: core.panOnScroll ?? false,
        panOnDrag: core.panOnDrag ?? true,
        connectOnClick: core.connectOnClick ?? false,
        zoomOnDoubleClick: core.zoomOnDoubleClick ?? false,
        onlyRenderVisibleElements: core.onlyRenderVisibleElements ?? true,
        selectNodesOnDrag: core.selectNodesOnDrag ?? false,
        preventScrolling: core.preventScrolling ?? true,
        shortcutKeymap: core.shortcutKeymap ?? {},
      },
      plugins: data.plugins ?? {},
    }
  },
  write(value: any) {
    const core = value.core || value
    return JSON.stringify({
      core: {
        ...core,
        connectionMode: core.connectionMode === ConnectionMode.Loose ? 'loose' : 'strict',
        selectionMode: core.selectionMode === SelectionMode.Partial ? 'partial' : 'full',
      },
      plugins: value.plugins ?? {},
    })
  },
}

/**
 * 画布全局可配置状态 — 持久化到 localStorage，键名 canvas-state
 *
 * 选中状态 (selectedNodeIds / selectedEdgeIds / selectionVersion)
 * 已移至独立的 selectionState ref，不参与持久化。
 *
 * nodes/edges 不再由 Pinia 管理，改为 VueFlow 内部唯一管理。
 * 持久化通过 Canvas.vue 中的 toObject()/fromObject() + localStorage 实现。
 *
 * 使用方式：
 *   const canvas = useCanvasStore()
 *   canvas.state.nodesDraggable = false // 自动写入 localStorage
 */
export const useCanvasStore = defineStore('canvasState', () => {
  const state = ref({
    /**
     * 核心画布配置
     *
     * 这里放 canvas core 自己提供的全局设置。
     * 包括：连线样式、工具栏偏移、自定义端口、多选框、性能面板、
     *       连线模式、节点交互、视口交互、快捷键映射等。
     */
    core: {
      // ==================== 连线样式 ====================
      edgeLineWidth: 2,
      edgeColor: '#3b82f6',
      edgeType: 'bezier' as EdgeType,
      edgeDashed: false,
      edgeAnimated: true,
      edgeMarkerEnd: false,
      edgeMarkerSize: 8,
      edgeStepOffset: 20,
      edgeSmoothRadius: 5,
      edgeVisible: true,
      edgeGlowEnabled: true,
      edgeGlowIntensity: 1,
      edgeGlowColor: '#ffffff',

      // ==================== 工具栏偏移 ====================
      topToolbarOffset: 12,
      bottomToolbarOffset: 12,

      // ==================== 自定义端口 ====================
      handleDebug: false,
      handleRadius: 86,
      handleRestOffset: 36,
      handleCursorGap: 24,
      handleButtonSize: 32,
      handleOverlap: 16,
      connectionSnapDebugVisible: false,
      connectionSnapOuterRatio: 0.75,
      connectionSnapInnerRatio: 0.6,
      connectionSnapHeightRatio: 1.35,

      // ==================== 多选框 ====================
      selectionFramePaddingX: 16,
      selectionFramePaddingTop: 34,
      selectionFramePaddingBottom: 16,

      // ==================== 性能侦测面板 ====================
      performancePanelEnabled: false,
      performancePanelShowCharts: true,
      performancePanelShowMemory: true,

      // ==================== 连线模式 ====================
      connectionMode: ConnectionMode.Strict,

      // ==================== 节点交互 ====================
      nodesDraggable: true,
      nodesConnectable: true,
      elementsSelectable: true,
      edgesUpdatable: true,
      snapToGrid: false,
      snapGrid: [15, 15] as [number, number],
      zoomOnPinch: true,
      minZoom: 0.1,
      maxZoom: 4,

      // ==================== 视口交互 ====================
      zoomOnScroll: true,
      panOnScroll: false,
      panOnDrag: true,
      connectOnClick: false,
      zoomOnDoubleClick: false,
      selectionMode: SelectionMode.Full as SelectionMode,
      onlyRenderVisibleElements: true,
      selectNodesOnDrag: false,
      preventScrolling: true,

      // ==================== 快捷键映射 ====================
      shortcutKeymap: {} as Record<string, string>,
    },

    /**
     * 插件配置命名空间
     *
     * 每个插件一个 key，key 名 = 插件 name。
     * 插件通过 PanelRegistry.useValue() 注册的设置项会写入这里。
     */
    plugins: {} as Record<string, Record<string, unknown>>,
  })

  useStorage('canvas-state', state, localStorage, { serializer })

  // ==================== 自定义节点/边类型 ====================
  /** 内置节点/边类型（markRaw 整个对象避免 Pinia reactive 包裹组件） */
  const nodeTypes: NodeTypesObject = shallowRef({
    custom: markRaw(CustomNode) as any,
    tempTarget: markRaw(TempTargetNode) as any
  }) as any

  const edgeTypes = shallowRef({
    custom: markRaw(CustomEdge)
  }) as any

  /** 插件注册的自定义节点类型（shallowRef 避免组件被 deep reactive） */
  const customNodeTypes = shallowRef<Record<string, Component>>({})

  /** 插件注册的自定义边类型 */
  const customEdgeTypes = shallowRef<Record<string, Component>>({})

  function registerCustomNodeType(name: string, component: Component) {
    customNodeTypes.value = { ...customNodeTypes.value, [name]: markRaw(component) as any }
  }

  function registerCustomEdgeType(name: string, component: Component) {
    customEdgeTypes.value = { ...customEdgeTypes.value, [name]: markRaw(component) as any }
  }

  // ==================== 连线拖拽状态（不持久化） ====================
  const connectionState = ref<ConnectionState>({
    activeConnection: null,
    hoverNode: null,
    snapTarget: null,
    mouseFlowPosition: null,
    mouseScreenPosition: null,
    hoverTarget: null,
    tempConnection: null,
    suppressHandles: false,
  })

  // ==================== 选中状态（不持久化） ====================
  const selectionState = ref({
    selectedNodeIds: new Set<string>(),
    selectedEdgeIds: new Set<string>(),
    /** 选中版本号 — 每次选中变化递增，用于强制触发 computed 重算 */
    selectionVersion: 0,
  })

  // ==================== 选中状态操作 ====================

  function setSelectedNodeIds(ids: Iterable<string>) {
    const nextIds = new Set(ids)
    if (sameStringSet(selectionState.value.selectedNodeIds, nextIds)) return false
    selectionState.value.selectedNodeIds = nextIds
    selectionState.value.selectionVersion++
    return true
  }

  function setSelectedEdgeIds(ids: Iterable<string>) {
    const nextIds = new Set(ids)
    if (sameStringSet(selectionState.value.selectedEdgeIds, nextIds)) return false
    selectionState.value.selectedEdgeIds = nextIds
    selectionState.value.selectionVersion++
    return true
  }

  function setSelection(payload: { nodeIds?: Iterable<string>; edgeIds?: Iterable<string> }) {
    const nextNodeIds = payload.nodeIds ? new Set(payload.nodeIds) : selectionState.value.selectedNodeIds
    const nextEdgeIds = payload.edgeIds ? new Set(payload.edgeIds) : selectionState.value.selectedEdgeIds
    const nodeChanged = !sameStringSet(selectionState.value.selectedNodeIds, nextNodeIds)
    const edgeChanged = !sameStringSet(selectionState.value.selectedEdgeIds, nextEdgeIds)
    if (!nodeChanged && !edgeChanged) return false
    if (nodeChanged) selectionState.value.selectedNodeIds = nextNodeIds
    if (edgeChanged) selectionState.value.selectedEdgeIds = nextEdgeIds
    selectionState.value.selectionVersion++
    return true
  }

  function clearSelection() {
    if (selectionState.value.selectedNodeIds.size === 0 && selectionState.value.selectedEdgeIds.size === 0) return false
    selectionState.value.selectedNodeIds = new Set<string>()
    selectionState.value.selectedEdgeIds = new Set<string>()
    selectionState.value.selectionVersion++
    return true
  }

  function applyNodeSelectChanges(changes: Iterable<{ id: string; selected: boolean }>) {
    const selectedIds = new Set(selectionState.value.selectedNodeIds)
    let changed = false
    for (const change of changes) {
      if (change.selected) {
        if (!selectedIds.has(change.id)) changed = true
        selectedIds.add(change.id)
      } else if (selectedIds.delete(change.id)) {
        changed = true
      }
    }
    if (!changed) return false
    selectionState.value.selectedNodeIds = selectedIds
    selectionState.value.selectionVersion++
    return true
  }

  function applyEdgeSelectChanges(changes: Iterable<{ id: string; selected: boolean }>) {
    const selectedIds = new Set(selectionState.value.selectedEdgeIds)
    let changed = false
    for (const change of changes) {
      if (change.selected) {
        if (!selectedIds.has(change.id)) changed = true
        selectedIds.add(change.id)
      } else if (selectedIds.delete(change.id)) {
        changed = true
      }
    }
    if (!changed) return false
    selectionState.value.selectedEdgeIds = selectedIds
    selectionState.value.selectionVersion++
    return true
  }

  /** 是否正在拖线（派生） */
  const isConnecting = computed(() => connectionState.value.activeConnection !== null)

  /** 是否可以弹出"拖到空白"的节点选择菜单（核心判定） */
  const canShowConnectionMenu = computed(() => {
    const s = connectionState.value
    if (!s.activeConnection) return false
    if (s.hoverTarget?.type !== 'pane') return false
    if (s.snapTarget?.isSnapped) return false
    if (s.tempConnection) return false
    return true
  })

  return {
    state,
    nodeTypes,
    edgeTypes,
    customNodeTypes,
    customEdgeTypes,
    registerCustomNodeType,
    registerCustomEdgeType,
    connectionState,
    isConnecting,
    canShowConnectionMenu,
    selectionState,
    setSelectedNodeIds,
    setSelectedEdgeIds,
    setSelection,
    clearSelection,
    applyNodeSelectChanges,
    applyEdgeSelectChanges,
  }
})

/**
 * 获取指定插件的命名空间状态存取器
 *
 * 提供对 `state.plugins[pluginName]` 命名空间的响应式 get/set 操作。
 * 首次访问时自动初始化命名空间为空对象。
 *
 * @param pluginName - 插件唯一名称
 * @returns 包含 get、set 和 namespace computed 的存取器对象
 *
 * @example
 * ```typescript
 * const clipboard = usePluginStore('clipboard')
 * clipboard.set('copiedNodes', [...])
 * const nodes = clipboard.get('copiedNodes')
 * ```
 */
export function usePluginStore(pluginName: string) {
  const store = useCanvasStore()
  const namespace = computed(() => {
    if (!store.state.plugins[pluginName]) {
      store.state.plugins[pluginName] = {}
    }
    return store.state.plugins[pluginName]
  })

  function get<T = unknown>(key: string): T {
    return namespace.value[key] as T
  }
  function set(key: string, value: unknown): void {
    namespace.value[key] = value
  }
  return { get, set, namespace }
}

