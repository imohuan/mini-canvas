import { ref, computed, markRaw, shallowRef, type Component } from 'vue'
import { useStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import type { NodeTypesObject } from '@vue-flow/core'
import { ConnectionMode, SelectionMode } from '@vue-flow/core'
import CustomNode from '../components/CustomNode.vue'
import TempTargetNode from '../components/TempTargetNode.vue'
import CustomEdge from '../components/CustomEdge.vue'

/**
 * 连接线类型：
 * - bezier: 贝塞尔曲线
 * - straight: 直线
 * - step: 阶梯线（直角折线）
 */
export type EdgeType = 'bezier' | 'straight' | 'step'

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
    if (!data.plugins) data.plugins = {}
    if (!data.shortcutKeymap) data.shortcutKeymap = {}
    return {
      ...data,
      handleDebug: data.handleDebug ?? false,
      handleRadius: numberOr(data.handleRadius, 86),
      handleRestOffset: numberOr(data.handleRestOffset, 36),
      handleCursorGap: numberOr(data.handleCursorGap, 24),
      handleButtonSize: numberOr(data.handleButtonSize, 32),
      handleOverlap: numberOr(data.handleOverlap, 16),
      connectionSnapDebugVisible: data.connectionSnapDebugVisible ?? false,
      connectionSnapOuterRatio: numberOr(data.connectionSnapOuterRatio, 0.75),
      connectionSnapInnerRatio: numberOr(data.connectionSnapInnerRatio, 0.6),
      connectionSnapHeightRatio: numberOr(data.connectionSnapHeightRatio, 1.35),
      selectionFramePaddingX: numberOr(data.selectionFramePaddingX, 16),
      selectionFramePaddingTop: numberOr(data.selectionFramePaddingTop, 34),
      selectionFramePaddingBottom: numberOr(data.selectionFramePaddingBottom, 16),
      connectionMode:
        data.connectionMode === 'loose' ? ConnectionMode.Loose : ConnectionMode.Strict,
      selectionMode:
        data.selectionMode === 'partial' ? SelectionMode.Partial : SelectionMode.Full,
    }
  },
  write(value: any) {
    return JSON.stringify({
      ...value,
      connectionMode: value.connectionMode === ConnectionMode.Loose ? 'loose' : 'strict',
      selectionMode: value.selectionMode === SelectionMode.Partial ? 'partial' : 'full',
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
    // ==================== 连接线样式 ====================
    edgeLineWidth: 2,
    edgeColor: '#3b82f6',
    edgeType: 'bezier' as EdgeType,
    edgeDashed: false,
    edgeAnimated: false,

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

    // ==================== 插件命名空间状态 ====================
    plugins: {} as Record<string, Record<string, unknown>>,

    // ==================== 快捷键映射 ====================
    shortcutKeymap: {} as Record<string, string>,
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
  const connectionState = ref({
    isConnecting: false,
    sourceNodeId: null as string | null,
    sourceHandle: null as string | null,
    suppressHandles: false,
    /** 拖线时，鼠标正落在哪个节点的"反馈区"（节点主体 + 端口半圆） */
    hoverFeedbackNodeId: null as string | null,
    /** 拖线时鼠标在画布坐标里的位置，用来让目标节点做 3D 跟随 */
    hoverFeedbackPoint: null as { x: number; y: number } | null,
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

  return {
    state,
    nodeTypes,
    edgeTypes,
    customNodeTypes,
    customEdgeTypes,
    registerCustomNodeType,
    registerCustomEdgeType,
    connectionState,
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
