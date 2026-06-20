<script setup lang="ts">
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import { ref, onMounted, onUnmounted, computed, reactive, nextTick, watch, shallowRef, markRaw, provide } from 'vue'
import {
  VueFlow, useVueFlow,
  Position,
} from '@vue-flow/core'
import type { Node, Edge, Connection, EdgeChange, NodeMouseEvent, EdgeMouseEvent, OnConnectStartParams } from '@vue-flow/core'
import type { ConnectionLineProps } from '@vue-flow/core'
import DynamicSettingsPanel from './components/Panel/DynamicSettingsPanel.vue'
import CanvasPerformancePanel from './components/Performance/CanvasPerformancePanel.vue'
import SelectionFrame from './plugins/multi-select/SelectionFrame.vue'
import CustomEdge from './components/CustomEdge.vue'
import CanvasMenu from './components/Menu/CanvasMenu.vue'
import type { CanvasMenuItem, CanvasMenuState, CanvasMenuMode } from './registry/types'
import { useCanvasStore } from './composables/useCanvasStore'
import { useCanvasPerformance } from './composables/useCanvasPerformance'
import type { CanvasPlugin } from './plugins/types.ts'
import { PluginManager } from './plugins/PluginManager.ts'
import { createPluginContext } from './plugins/PluginContext.ts'
import { ShortcutManager } from './plugins/ShortcutManager'
import { useCanvasBootstrap } from './composables/useCanvasBootstrap'
import { CanvasRuntime, CanvasRuntimeProvider } from './runtime'
import { NodeRegistry } from './registry/NodeRegistry'
import { CommandRegistry } from './registry/CommandRegistry'
import { ToolbarRegistry } from './registry/ToolbarRegistry'
import { PanelRegistry } from './registry/PanelRegistry'
import { MenuRegistry, resolveMenuItems, type MenuContext } from './registry/MenuRegistry'

// ========================
// 插件系统 Props
// ========================
const props = defineProps<{
  /** 要加载的插件列表 */
  plugins?: CanvasPlugin[]
  /** 插件配置映射（name → options），支持响应式 */
  pluginConfigs?: Record<string, Record<string, unknown>>
}>()

// --- Pinia 画布状态 ---
const canvas = useCanvasStore()

// ========================
// 设置面板 slot props（暴露给外部自定义面板）
// ========================
import type { PanelSettingDefinition } from './registry/types'
const allSettings = computed<PanelSettingDefinition[]>(() => panelRegistry.getAll())

const groupedSettings = computed(() => {
  const groups = new Map<string, PanelSettingDefinition[]>()
  for (const s of allSettings.value) {
    const g = s.group || 'default'
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(s)
  }
  return [...groups.entries()].map(([name, items]) => ({ name, items }))
})

/** 获取设置项的响应式值（可直接 v-model） */
function getSettingValue(id: string) {
  const setting = panelRegistry.getAll().find(s => s.id === id)
  return panelRegistry.useValue(id, canvas.state as any, setting?.defaultValue)
}


// 创建连接线 data
function makeEdgeData() {
  const s = canvas.state.core
  return {
    edgeType: s.edgeType,
    edgeLineWidth: s.edgeLineWidth,
    edgeColor: s.edgeColor,
    edgeDashed: s.edgeDashed,
  }
}

// 显式 ID，确保 useVueFlow() 和 <VueFlow> 共享同一个实例
const CANVAS_ID = 'main-canvas'
/** VueFlow 实例，提供节点/边操作和视口控制 */
const vueFlowInstance = useVueFlow(CANVAS_ID)
const { getNodes, getEdges } = vueFlowInstance
/** 画布容器 DOM 引用 */
const canvasContainerRef = ref<HTMLElement | null>(null)
/** 画布容器当前宽高 */
const canvasContainerSize = ref({ width: 0, height: 0 })
let canvasResizeObserver: ResizeObserver | null = null

const performanceEnabled = computed(() => canvas.state.core.performancePanelEnabled)
/** 性能监控器，追踪 FPS、帧时间、内存使用 */
const performanceMonitor = useCanvasPerformance({ enabled: performanceEnabled })

/** 更新画布容器的宽高尺寸，响应窗口大小变化 */
function updateCanvasContainerSize() {
  const rect = canvasContainerRef.value?.getBoundingClientRect()
  canvasContainerSize.value = {
    width: rect?.width ?? window.innerWidth,
    height: rect?.height ?? window.innerHeight,
  }
}


/** 节点 ID 索引（O(1) 查找，消除 findNearestValidTarget/Source 中的 O(n) find） */
const nodesById = shallowRef(new Map<string, Node>())
watch(
  () => getNodes.value,
  (nodes) => {
    const map = new Map<string, Node>()
    for (const n of nodes as Node[]) map.set(n.id, n)
    nodesById.value = map
  },
  { immediate: true, deep: false },
)

/** 合并硬编码类型 + 插件注册的自定义类型
 *  使用 watchEffect 从 Pinia store 读取，逐项 markRaw 避免组件被响应式化 */
const mergedNodeTypes = shallowRef<Record<string, any>>({})
const mergedEdgeTypes = shallowRef<Record<string, any>>({})

watch(() => [canvas.nodeTypes, canvas.customNodeTypes, canvas.edgeTypes, canvas.customEdgeTypes], () => {
  const nt: Record<string, any> = {}
  const et: Record<string, any> = {}

  for (const key of Object.keys(canvas.nodeTypes as Record<string, any>)) nt[key] = markRaw((canvas.nodeTypes as any)[key])
  for (const key of Object.keys(canvas.customNodeTypes as Record<string, any>)) nt[key] = markRaw((canvas.customNodeTypes as any)[key])
  for (const key of Object.keys(canvas.edgeTypes as Record<string, any>)) et[key] = markRaw((canvas.edgeTypes as any)[key])
  for (const key of Object.keys(canvas.customEdgeTypes as Record<string, any>)) et[key] = markRaw((canvas.customEdgeTypes as any)[key])

  mergedNodeTypes.value = nt
  mergedEdgeTypes.value = et
}, { immediate: true, deep: false })

/** 最后一次原生 connect 事件的时间戳，用于防止 connectEnd 重复处理 */
let lastNativeConnectAt = 0

/** 批量连线状态：类型、节点列表、临时元素 ID */
const batchConnectState = ref<{
  type: 'source' | 'target'
  nodeIds: string[]
  tempNodeId: string
  tempEdgeIds: string[]
} | null>(null)

// NODE_MENU_ITEMS removed - use nodeRegistry.getMenuItems() instead

const menuState = reactive<CanvasMenuState>({
  visible: false,
  title: '',
  mode: 'pane',
  position: { x: 0, y: 0 },
  items: [],
})


/** 右键菜单上下文（当前节点/边/连线信息） */
const menuContext = ref<MenuContext>({})

// --- 选中同步：事件驱动，直接写入 Pinia store ---

function onNodesChange(changes: any[]) {
  const removeChanges = changes.filter((c: any) => c.type === 'remove')
  if (removeChanges.length > 0) {
    const removeIds = new Set(removeChanges.map((c: any) => c.id))

    // 清理选中态中已删除的节点
    for (const id of removeIds) {
      canvas.selectionState.selectedNodeIds.delete(id)
    }
    canvas.selectionState.selectionVersion++
    console.log('[Canvas] onNodesChange 删除同步:', { count: removeIds.size, ids: [...removeIds] })
    return
  }

  const selectChanges = changes.filter((c: any) => c.type === 'select')
  if (selectChanges.length > 0) {
    // 不读 getNodes.value 里的 selected。
    // VueFlow 触发 nodes-change 时，内部节点 selected 有时还没完全同步；
    // 直接按 changes 增删，Shift 加选/减选最稳。
    canvas.applyNodeSelectChanges(selectChanges)
    console.log('[Canvas] onNodesChange 选中变化:', { count: canvas.selectionState.selectedNodeIds.size, ids: [...canvas.selectionState.selectedNodeIds], total: getNodes.value.length })
  }
}

/** 画布空白处点击：清除所有选中 */
function onPaneClick() {
  if (canvas.selectionState.selectedNodeIds.size === 0 && canvas.selectionState.selectedEdgeIds.size === 0) return
  if (canvas.clearSelection()) {
    manager.eventBus.emit('selection:clear')
  }
}

/** VueFlow 边变化事件：同步删除/选中状态到 Pinia store */
function onEdgesChange(changes: EdgeChange[]) {
  const removeChanges = changes.filter((c): c is Extract<EdgeChange, { type: 'remove' }> => c.type === 'remove')
  if (removeChanges.length > 0) {
    const removeIds = new Set(removeChanges.map(c => c.id))

    for (const id of removeIds) {
      canvas.selectionState.selectedEdgeIds.delete(id)
    }
    canvas.selectionState.selectionVersion++
    console.log('[Canvas] onEdgesChange 删除同步:', { count: removeIds.size, ids: [...removeIds] })
  }

  const selectChanges = changes.filter((c): c is Extract<EdgeChange, { type: 'select' }> => c.type === 'select')
  if (selectChanges.length > 0) {
    canvas.applyEdgeSelectChanges(selectChanges)
    console.log('[Canvas] onEdgesChange 选中变化:', { count: canvas.selectionState.selectedEdgeIds.size, ids: [...canvas.selectionState.selectedEdgeIds], total: getEdges.value.length })
  }
}

/** 根据 ID 查找可连线的节点 */
function getConnectableNode(id: string | null | undefined) {
  if (!id) return undefined
  return (getNodes.value as Node[]).find(node => node.id === id)
}

/** 标准化连接对象：补全默认的 sourceHandle/targetHandle */
function normalizeConnection(connection: Connection): Connection {
  return {
    ...connection,
    sourceHandle: connection.sourceHandle || 'source',
    targetHandle: connection.targetHandle || 'target',
  }
}

function toCanonicalConnection(connection: Connection): Connection | null {
  const normalized = normalizeConnection(connection)
  if (normalized.sourceHandle === 'source' && normalized.targetHandle === 'target') {
    return normalized
  }
  if (normalized.sourceHandle === 'target' && normalized.targetHandle === 'source') {
    return {
      ...normalized,
      source: normalized.target,
      target: normalized.source,
      sourceHandle: 'source',
      targetHandle: 'target',
    }
  }
  return null
}

function getCanonicalEdgeEndpoints(edge: Edge) {
  const sourceHandle = edge.sourceHandle ?? 'source'
  const targetHandle = edge.targetHandle ?? 'target'

  if (sourceHandle === 'source' && targetHandle === 'target') {
    return { source: edge.source, target: edge.target }
  }
  if (sourceHandle === 'target' && targetHandle === 'source') {
    return { source: edge.target, target: edge.source }
  }
  return null
}

function wouldCreateCycle(sourceId: string, targetId: string) {
  if (sourceId === targetId) return true

  const stack = [targetId]
  const visited = new Set<string>()
  const edges = (getEdges.value as Edge[])
    .filter(edge => !isTempEdge(edge))
    .map(getCanonicalEdgeEndpoints)
    .filter((edge): edge is { source: string; target: string } => Boolean(edge))

  while (stack.length > 0) {
    const current = stack.pop()!
    if (current === sourceId) return true
    if (visited.has(current)) continue
    visited.add(current)

    for (const edge of edges) {
      if (edge.source === current && !visited.has(edge.target)) {
        stack.push(edge.target)
      }
    }
  }

  return false
}

function isSameCanonicalConnection(edge: Edge, connection: Connection) {
  const edgeEndpoints = getCanonicalEdgeEndpoints(edge)
  const canonical = toCanonicalConnection(connection)
  if (!edgeEndpoints || !canonical) return false

  return (
    edgeEndpoints.source === canonical.source &&
    edgeEndpoints.target === canonical.target
  )
}

function findSameConnection(connection: Connection) {
  return (getEdges.value as Edge[]).find(edge =>
    !isTempEdge(edge) &&
    isSameCanonicalConnection(edge, connection)
  ) as Edge | undefined
}

function getInvalidConnectionReason(connection: Connection) {
  const canonical = toCanonicalConnection(connection)
  if (!canonical?.source || !canonical.target) return '无法连接'
  if (canonical.source === canonical.target) return '无法连接'
  if (findSameConnection(canonical)) return '无法连接'
  if (wouldCreateCycle(canonical.source, canonical.target)) return '无法连接'
  return ''
}

function clearInvalidConnectionFeedback() {
  canvas.connectionState.invalidFeedbackNodeId = null
  canvas.connectionState.invalidFeedbackPoint = null
  canvas.connectionState.invalidFeedbackMessage = ''
}

function setInvalidConnectionFeedback(nodeId: string | null, point: { x: number; y: number } | null, message = '无法连接') {
  canvas.connectionState.invalidFeedbackNodeId = nodeId
  canvas.connectionState.invalidFeedbackPoint = point
  canvas.connectionState.invalidFeedbackMessage = nodeId ? message : ''
}

// --- connection validation ---
function isValidConnection(connection: Connection): boolean {
  const normalized = normalizeConnection(connection)

  if (!normalized.source || !normalized.target) {
    console.warn('[连线拦截] 缺少源节点或目标节点:', connection)
    return false
  }
  if (normalized.sourceHandle === normalized.targetHandle) {
    console.warn('[连线拦截] 不能连接两个相同类型端口:', {
      sourceHandle: normalized.sourceHandle,
      targetHandle: normalized.targetHandle,
    })
    return false
  }
  if (normalized.source === normalized.target) {
    console.warn('[连线拦截] 不能连接自己:', normalized.source)
    return false
  }
  const canonical = toCanonicalConnection(normalized)
  if (!canonical) {
    console.warn('[连线拦截] 端口方向不合法:', normalized)
    return false
  }

  const src = getConnectableNode(canonical.source)
  const tgt = getConnectableNode(canonical.target)
  if (!src || !tgt) {
    console.warn('[连线拦截] 节点不存在:', { source: canonical.source, target: canonical.target })
    return false
  }
  if (!src.sourcePosition) { console.warn('[连线拦截] 源节点无输出端口:', src.id); return false }
  if (!tgt.targetPosition) { console.warn('[连线拦截] 目标节点无输入端口:', tgt.id); return false }
  if (wouldCreateCycle(canonical.source, canonical.target)) {
    console.warn('[连线拦截] 禁止循环连接:', { source: canonical.source, target: canonical.target })
    return false
  }
  return true
}

/** 修复已存在连线的类型和数据 */
function repairExistingConnection(edge: Edge, connection: Connection) {
  edge.type = 'custom'
  edge.sourceHandle = connection.sourceHandle
  edge.targetHandle = connection.targetHandle
  edge.data = {
    ...makeEdgeData(),
    ...(edge.data || {}),
  }
}

/** 创建新连线：验证 → 去重 → 添加。source 参数标识触发来源 */
function createConnection(connection: Connection, source = 'manual') {
  const normalized = toCanonicalConnection(connection)
  if (!normalized) return false
  if (!isValidConnection(normalized)) return false

  const existingEdge = findSameConnection(normalized)
  if (existingEdge) {
    repairExistingConnection(existingEdge, normalized)

    const renderedEdge = (getEdges.value as Edge[]).find(edge => edge.id === existingEdge.id)
    if (!renderedEdge) {
      vueFlowInstance.addEdges([{ ...existingEdge }])
      console.info('[连线修复] store 已有但 VueFlow 未渲染，已补回:', {
        trigger: source,
        id: existingEdge.id,
        source: normalized.source,
        target: normalized.target,
      })
      return true
    }

    console.warn('[连线拦截] 连接已存在:', normalized)
    return false
  }

  const edgeId = `e-${normalized.source}-${normalized.target}-${Date.now()}`
  console.log('[Canvas] 创建连线:', {
    trigger: source,
    id: edgeId,
    source: normalized.source,
    target: normalized.target,
    sourceHandle: normalized.sourceHandle,
    targetHandle: normalized.targetHandle,
    totalEdges: getEdges.value.length + 1,
  })
  const edge: Edge = {
    id: edgeId,
    type: 'custom',
    source: normalized.source,
    target: normalized.target,
    sourceHandle: normalized.sourceHandle,
    targetHandle: normalized.targetHandle,
    data: makeEdgeData(),
  }
  vueFlowInstance.addEdges([edge])
  return true
}

/** 屏幕坐标 → 画布坐标系坐标（考虑视口偏移和缩放） */
function toFlowPosition(clientX: number, clientY: number) {
  const viewport = vueFlowInstance.viewport.value
  const zoom = viewport.zoom || 1
  const pane = document.querySelector('.vue-flow')?.getBoundingClientRect()
  const originX = pane?.left ?? 0
  const originY = pane?.top ?? 0
  return {
    x: (clientX - originX - viewport.x) / zoom,
    y: (clientY - originY - viewport.y) / zoom,
  }
}


// NODE_TYPE_DEFAULT_SIZE removed - use nodeRegistry.getDefaultSize() instead

function createNodeFromMenuItem(item: CanvasMenuItem, position: { x: number; y: number }, options: { requireTarget?: boolean; requireSource?: boolean } = {}) {
  const nodeId = `node-${item.id}-${Date.now()}`
  const canReceiveInput = options.requireTarget || nodeRegistry.canReceiveInput(item.id)
  const defaultSize = nodeRegistry.getDefaultSize(item.id)
  const node: Node = {
    id: nodeId,
    type: 'custom',
    position: {
      x: position.x - defaultSize.cardWidth / 2,
      y: position.y - defaultSize.cardHeight / 2,
    },
    data: {
      label: item.label,
      nodeType: item.id,
      cardWidth: defaultSize.cardWidth,
      cardHeight: defaultSize.cardHeight,
      resizable: item.id === 'text',
    },
    ...(options.requireSource !== false ? { sourcePosition: Position.Right } : {}),
    ...(canReceiveInput ? { targetPosition: Position.Left } : {}),
  }

  vueFlowInstance.addNodes([node])
  return node
}

/** 打开右键菜单：设置菜单状态和上下文 */
function openMenu(next: Omit<CanvasMenuState, 'visible'>, context: MenuContext = {}) {
  menuState.visible = true
  menuState.title = next.title
  menuState.mode = next.mode
  menuState.position = next.position
  menuState.items = next.items
  menuContext.value = context
}

/** 移除连线菜单中的临时节点和边 */
function removeTempConnection() {
  const pending = menuContext.value.pendingConnection
  if (!pending) return

  vueFlowInstance.removeEdges([pending.tempEdgeId])
  vueFlowInstance.removeNodes([pending.tempNodeId])
}

/** 关闭右键菜单：清理临时连线 */
function closeMenu() {
  if (menuState.mode === 'connection') {
    removeTempConnection()
  }
  menuState.visible = false
  menuContext.value = {}
}

/** 打开"创建节点"菜单：合并 NodeRegistry + MenuRegistry 生成菜单项 */
function openCreateNodeMenu(position: { x: number; y: number }, mode: CanvasMenuMode, title: string, context: MenuContext) {
  openMenu({
    mode,
    title,
    position,
    items: resolveMenuItems({ mode, nodeId: context.nodeId, nodeType: context.nodeType, edgeId: context.edgeId, flowPosition: context.flowPosition }, menuRegistry, nodeRegistry),
  }, context)
}

/** 菜单项选中回调：创建节点或执行连线 */
async function onMenuSelect(item: CanvasMenuItem) {
  const context = menuContext.value

  if (menuState.mode === 'connection' && context.pendingConnection) {
    const pending = { ...context.pendingConnection }
    menuState.visible = false
    menuContext.value = {}
    vueFlowInstance.removeEdges([pending.tempEdgeId])
    vueFlowInstance.removeNodes([pending.tempNodeId])
    await nextTick()

    const isReverseConnection = pending.sourceHandle === 'target'
    const node = createNodeFromMenuItem(item, pending.flowPosition, {
      requireSource: isReverseConnection,
      requireTarget: !isReverseConnection,
    })
    await nextTick()

    createConnection(isReverseConnection
      ? {
          source: node.id,
          target: pending.sourceNodeId,
          sourceHandle: 'source',
          targetHandle: pending.sourceHandle,
        }
      : {
          source: pending.sourceNodeId,
          target: node.id,
          sourceHandle: pending.sourceHandle,
          targetHandle: 'target',
        }, 'blank-menu')
    return
  }

  if ((menuState.mode === 'pane' || menuState.mode === 'node') && context.flowPosition) {
    createNodeFromMenuItem(item, context.flowPosition)
    menuState.visible = false
    menuContext.value = {}
    return
  }

  closeMenu()
}

/** VueFlow connect 事件：从端口拖出连线成功时触发 */
function onConnect(connection: Connection) {
  lastNativeConnectAt = Date.now()
  createConnection(connection, 'handle')
}

/** VueFlow connectStart 事件：开始拖拽连线时记录源节点信息 */
function onConnectStart(payload: ({ event?: MouseEvent | TouchEvent } & OnConnectStartParams)) {
  canvas.connectionState.isConnecting = true
  canvas.connectionState.sourceNodeId = payload.nodeId || null
  canvas.connectionState.sourceHandle = payload.handleId || null
  canvas.connectionState.suppressHandles = true
  canvas.connectionState.hoverFeedbackNodeId = null
  canvas.connectionState.hoverFeedbackPoint = null
  clearInvalidConnectionFeedback()
}

/** 从 MouseEvent 或 TouchEvent 提取屏幕坐标 */
function getMousePoint(event?: MouseEvent | TouchEvent) {
  if (!event) return null
  if ('changedTouches' in event && event.changedTouches.length > 0) {
    const touch = event.changedTouches[0]
    return { x: touch.clientX, y: touch.clientY }
  }
  if ('clientX' in event) {
    return { x: event.clientX, y: event.clientY }
  }
  return null
}

/** 从 DOM 元素上提取节点 ID（data-id / data-nodeid） */
function getNodeIdFromElement(el: Element) {
  return (
    el.getAttribute('data-id') ||
    (el as HTMLElement).dataset?.id ||
    el.getAttribute('data-nodeid') ||
    ''
  )
}

/** 获取节点卡片 DOM 元素的屏幕矩形 */
function getNodeCardRectFromNodeElement(el: Element) {
  return (el.querySelector('.custom-node-card') || el).getBoundingClientRect()
}

/** 判断节点是否为临时节点（连线菜单中的占位节点） */
function isTempNode(node: Node | undefined | null) {
  return Boolean(node?.type === 'tempTarget' || node?.data?.isTemp)
}

/** 判断边是否为临时边（连线菜单中的占位边） */
function isTempEdge(edge: Edge | undefined | null) {
  return Boolean(edge?.data?.isTemp)
}

/** 在屏幕坐标附近查找最近的可连线目标节点（考虑吸附区域） */
function findNearestValidTarget(clientX: number, clientY: number, sourceNodeIdOverride?: string, excludedNodeIdsOverride?: Iterable<string>) {
  const sourceNodeId = sourceNodeIdOverride || canvas.connectionState.sourceNodeId
  const sourceHandle = sourceNodeIdOverride ? 'source' : canvas.connectionState.sourceHandle
  if (!sourceNodeId || sourceHandle !== 'source') return null

  const excludedNodeIds = new Set(excludedNodeIdsOverride ?? [sourceNodeId])
  let bestNode: Node | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  const snapHeight = canvas.state.core.handleRadius * canvas.state.core.connectionSnapHeightRatio
  const snapOuter = canvas.state.core.handleRadius * canvas.state.core.connectionSnapOuterRatio
  const snapInner = canvas.state.core.handleRadius * canvas.state.core.connectionSnapInnerRatio
  const nodeEls = document.querySelectorAll('.vue-flow__node')

  for (const el of nodeEls) {
    const nodeId = getNodeIdFromElement(el)
    if (!nodeId || excludedNodeIds.has(nodeId)) continue

    const node = nodesById.value.get(nodeId)
    if (!node || isTempNode(node) || !node.targetPosition) continue

    const rect = getNodeCardRectFromNodeElement(el)
    const nodeSize = getNodeSize(node)
    const zoomScale = nodeSize.width > 0 ? rect.width / nodeSize.width : 1
    const snapOuterInScreen = snapOuter * zoomScale
    const snapInnerInScreen = snapInner * zoomScale
    const snapHeightInScreen = snapHeight * zoomScale
    const centerY = rect.top + rect.height / 2
    const snapTop = centerY - snapHeightInScreen / 2
    const snapBottom = centerY + snapHeightInScreen / 2

    const insideSnapArea =
      clientX >= rect.left - snapOuterInScreen &&
      clientX <= rect.left + snapInnerInScreen &&
      clientY >= snapTop &&
      clientY <= snapBottom

    if (!insideSnapArea) continue

    const centerX = rect.left
    const distance = Math.hypot(clientX - centerX, clientY - centerY)

    if (distance < bestDistance) {
      bestNode = node
      bestDistance = distance
    }
  }

  return bestNode
}

function findNearestConnectableNode(clientX: number, clientY: number, startHandle: string | null, startNodeId?: string | null) {
  if (startHandle === 'source') {
    return findNearestValidTarget(clientX, clientY, startNodeId || undefined)
  }
  if (startHandle === 'target') {
    return findNearestValidSource(clientX, clientY, new Set(startNodeId ? [startNodeId] : []))
  }
  return null
}

function findNodeBodyAtPoint(clientX: number, clientY: number, excludedNodeIds: Iterable<string> = []) {
  const excluded = new Set(excludedNodeIds)
  const nodeEls = document.querySelectorAll('.vue-flow__node')

  for (const el of nodeEls) {
    const nodeId = getNodeIdFromElement(el)
    if (!nodeId || excluded.has(nodeId)) continue

    const node = nodesById.value.get(nodeId)
    if (!node || isTempNode(node)) continue

    const rect = getNodeCardRectFromNodeElement(el)
    const inside =
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom

    if (inside) return node
  }

  return null
}

/** 从节点拖出连线后弹出"选择目标节点类型"菜单 */
function createTempConnectionMenu(point: { x: number; y: number }, sourceNodeId: string, sourceHandle: string) {
  if (sourceHandle !== 'source' && sourceHandle !== 'target') return

  const flowPosition = toFlowPosition(point.x, point.y)
  const tempNodeId = `temp-target-${Date.now()}`
  const tempEdgeId = `temp-edge-${sourceNodeId}-${Date.now()}`
  const isReverseConnection = sourceHandle === 'target'

  vueFlowInstance.addNodes([{
    id: tempNodeId,
    type: 'tempTarget',
    position: flowPosition,
    data: { isTemp: true },
    sourcePosition: isReverseConnection ? Position.Right : undefined,
    targetPosition: isReverseConnection ? undefined : Position.Left,
    draggable: false,
    selectable: false,
  } as Node])

  vueFlowInstance.addEdges([{
    id: tempEdgeId,
    type: 'custom',
    source: isReverseConnection ? tempNodeId : sourceNodeId,
    target: isReverseConnection ? sourceNodeId : tempNodeId,
    sourceHandle: isReverseConnection ? 'source' : sourceHandle,
    targetHandle: isReverseConnection ? sourceHandle : 'target',
    selectable: false,
    zIndex: 99999,
    data: {
      ...makeEdgeData(),
      isTemp: true,
    },
  } as Edge])

  openCreateNodeMenu(
    { x: point.x, y: point.y },
    'connection',
    '引用该节点生成',
    {
      pendingConnection: {
        sourceNodeId,
        sourceHandle,
        tempNodeId,
        tempEdgeId,
        flowPosition,
      },
    },
  )
}

/** 在屏幕坐标附近查找最近的可连线源节点（考虑吸附区域） */
function findNearestValidSource(clientX: number, clientY: number, targetNodeIds: Set<string>) {
  let bestNode: Node | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  const snapHeight = canvas.state.core.handleRadius * canvas.state.core.connectionSnapHeightRatio
  const snapOuter = canvas.state.core.handleRadius * canvas.state.core.connectionSnapOuterRatio
  const snapInner = canvas.state.core.handleRadius * canvas.state.core.connectionSnapInnerRatio
  const nodeEls = document.querySelectorAll('.vue-flow__node')

  for (const el of nodeEls) {
    const nodeId = getNodeIdFromElement(el)
    if (!nodeId || targetNodeIds.has(nodeId)) continue

    const node = nodesById.value.get(nodeId)
    if (!node || isTempNode(node) || !node.sourcePosition) continue

    const rect = getNodeCardRectFromNodeElement(el)
    const nodeSize = getNodeSize(node)
    const zoomScale = nodeSize.width > 0 ? rect.width / nodeSize.width : 1
    const snapOuterInScreen = snapOuter * zoomScale
    const snapInnerInScreen = snapInner * zoomScale
    const snapHeightInScreen = snapHeight * zoomScale
    const centerY = rect.top + rect.height / 2
    const snapTop = centerY - snapHeightInScreen / 2
    const snapBottom = centerY + snapHeightInScreen / 2

    const insideSnapArea =
      clientX >= rect.right - snapInnerInScreen &&
      clientX <= rect.right + snapOuterInScreen &&
      clientY >= snapTop &&
      clientY <= snapBottom

    if (!insideSnapArea) continue

    const distance = Math.hypot(clientX - rect.right, clientY - centerY)
    if (distance < bestDistance) {
      bestNode = node
      bestDistance = distance
    }
  }

  return bestNode
}

/** 移除批量连线中的临时节点和边 */
function removeBatchTempConnection(batch = batchConnectState.value) {
  if (!batch) return

  vueFlowInstance.removeEdges(batch.tempEdgeIds)
  vueFlowInstance.removeNodes([batch.tempNodeId])
}

/** 重置批量连线状态并解绑全局事件 */
function resetBatchConnectState() {
  batchConnectState.value = null
  canvas.connectionState.isConnecting = false
  canvas.connectionState.sourceNodeId = null
  canvas.connectionState.sourceHandle = null
  canvas.connectionState.suppressHandles = true
  canvas.connectionState.hoverFeedbackNodeId = null
  canvas.connectionState.hoverFeedbackPoint = null
  clearInvalidConnectionFeedback()
  document.removeEventListener('mousemove', onBatchConnectMove)
  document.removeEventListener('mouseup', onBatchConnectEnd)
  window.removeEventListener('blur', cancelBatchConnect)
  document.removeEventListener('pointercancel', cancelBatchConnect)
}

/** 取消批量连线操作 */
function cancelBatchConnect() {
  if (!batchConnectState.value) return
  removeBatchTempConnection()
  resetBatchConnectState()
}

/** 更新批量连线中临时目标节点的位置 */
function updateBatchTempTarget(point: { x: number; y: number }) {
  const batch = batchConnectState.value
  if (!batch) return

  const position = toFlowPosition(point.x, point.y)
  vueFlowInstance.updateNode(batch.tempNodeId, { position })
}

/** 批量连线时鼠标移动：更新临时目标和吸附反馈 */
function onBatchConnectMove(event: MouseEvent) {
  const point = { x: event.clientX, y: event.clientY }
  updateBatchTempTarget(point)
  updateBatchConnectFeedback(point)
}

/** 更新批量连线时的吸附反馈节点 */
function updateBatchConnectFeedback(point: { x: number; y: number }) {
  const batch = batchConnectState.value
  if (!batch) return

  let feedbackNode: Node | null = null
  let invalidNode: Node | null = null
  if (batch.type === 'source') {
    const sourceNodeIds = new Set(batch.nodeIds)
    feedbackNode = findNearestValidTarget(point.x, point.y, batch.nodeIds[0], sourceNodeIds)
    if (feedbackNode) {
      const sourceNodes = (getNodes.value as Node[]).filter(node => batch.nodeIds.includes(node.id) && node.sourcePosition)
      invalidNode = sourceNodes.some(sourceNode => wouldCreateCycle(sourceNode.id, feedbackNode!.id)) ? feedbackNode : null
    }
  } else {
    feedbackNode = findNearestValidSource(point.x, point.y, new Set(batch.nodeIds))
    if (feedbackNode) {
      const targetNodes = (getNodes.value as Node[]).filter(node => batch.nodeIds.includes(node.id) && node.targetPosition)
      invalidNode = targetNodes.some(targetNode => wouldCreateCycle(feedbackNode!.id, targetNode.id)) ? feedbackNode : null
    }
  }

  const flowPoint = feedbackNode ? toFlowPosition(point.x, point.y) : null
  canvas.connectionState.hoverFeedbackNodeId = invalidNode ? null : feedbackNode?.id ?? null
  canvas.connectionState.hoverFeedbackPoint = invalidNode ? null : flowPoint
  setInvalidConnectionFeedback(invalidNode?.id ?? null, invalidNode ? flowPoint : null)
}

/** 批量连线结束：创建实际连线或取消 */
function onBatchConnectEnd(event: MouseEvent) {
  const batch = batchConnectState.value
  if (!batch) return

  const point = { x: event.clientX, y: event.clientY }
  let tempRemoved = false
  try {
    removeBatchTempConnection(batch)
    tempRemoved = true

    if (batch.type === 'source') {
      const sourceNodes = (getNodes.value as Node[]).filter(node => batch.nodeIds.includes(node.id) && node.sourcePosition)
      const targetNode = sourceNodes.length > 0
        ? findNearestValidTarget(point.x, point.y, sourceNodes[0].id, sourceNodes.map(node => node.id))
        : null

      if (targetNode) {
        for (const sourceNode of sourceNodes) {
          createConnection({
            source: sourceNode.id,
            target: targetNode.id,
            sourceHandle: 'source',
            targetHandle: 'target',
          }, 'selection-batch')
        }
      }
      return
    }

    const targetNodes = (getNodes.value as Node[]).filter(node => batch.nodeIds.includes(node.id) && node.targetPosition)
    const sourceNode = findNearestValidSource(point.x, point.y, new Set(targetNodes.map(node => node.id)))
    if (sourceNode) {
      for (const targetNode of targetNodes) {
        createConnection({
          source: sourceNode.id,
          target: targetNode.id,
          sourceHandle: 'source',
          targetHandle: 'target',
        }, 'selection-batch')
      }
    }
  } finally {
    if (!tempRemoved) removeBatchTempConnection(batch)
    resetBatchConnectState()
  }
}

/** 框选后批量连线开始：创建临时节点和边 */
function onSelectionBatchConnectStart(payload: { event: MouseEvent; type: 'source' | 'target'; nodeIds: string[] }) {
  const activeNodes = (getNodes.value as Node[]).filter(node =>
    payload.nodeIds.includes(node.id) &&
    (payload.type === 'source' ? node.sourcePosition : node.targetPosition)
  )
  if (activeNodes.length === 0) return

  const flowPosition = toFlowPosition(payload.event.clientX, payload.event.clientY)
  const tempNodeId = `selection-batch-target-${Date.now()}`
  const tempEdgeIds = activeNodes.map(node => `selection-batch-edge-${node.id}-${Date.now()}`)

  vueFlowInstance.addNodes([{
    id: tempNodeId,
    type: 'tempTarget',
    position: flowPosition,
    data: { isTemp: true },
    sourcePosition: payload.type === 'target' ? Position.Right : undefined,
    targetPosition: payload.type === 'source' ? Position.Left : undefined,
    draggable: false,
    selectable: false,
  } as Node])

  const tempEdges: Edge[] = []
  for (const [index, node] of activeNodes.entries()) {
    tempEdges.push({
      id: tempEdgeIds[index],
      type: 'custom',
      source: payload.type === 'source' ? node.id : tempNodeId,
      target: payload.type === 'source' ? tempNodeId : node.id,
      sourceHandle: 'source',
      targetHandle: 'target',
      selectable: false,
      zIndex: 99999,
      data: {
        ...makeEdgeData(),
        isTemp: true,
      },
    } as Edge)
  }
  vueFlowInstance.addEdges(tempEdges)

  batchConnectState.value = {
    type: payload.type,
    nodeIds: activeNodes.map(node => node.id),
    tempNodeId,
    tempEdgeIds,
  }

  canvas.connectionState.isConnecting = true
  canvas.connectionState.sourceNodeId = payload.type === 'source' ? activeNodes[0].id : tempNodeId
  canvas.connectionState.sourceHandle = 'source'
  canvas.connectionState.suppressHandles = true
  canvas.connectionState.hoverFeedbackNodeId = null
  canvas.connectionState.hoverFeedbackPoint = null
  clearInvalidConnectionFeedback()

  document.addEventListener('mousemove', onBatchConnectMove)
  document.addEventListener('mouseup', onBatchConnectEnd)
  window.addEventListener('blur', cancelBatchConnect)
  document.addEventListener('pointercancel', cancelBatchConnect)
}

/** VueFlow connectEnd 事件：连线结束时尝试吸附目标或弹出菜单 */
function onConnectEnd(event?: MouseEvent | TouchEvent) {
  const point = getMousePoint(event)
  const sourceNodeId = canvas.connectionState.sourceNodeId
  const sourceHandle = canvas.connectionState.sourceHandle

  try {
    // 如果已经精确连到了 Handle，@connect 会先创建边，这里不要再抢着处理。
    if (!point || !sourceNodeId || !sourceHandle || Date.now() - lastNativeConnectAt < 80) return

    const targetNode = findNearestConnectableNode(point.x, point.y, sourceHandle, sourceNodeId)
    if (targetNode) {
      const connection = sourceHandle === 'target'
        ? {
            source: targetNode.id,
            target: sourceNodeId,
            sourceHandle: 'source',
            targetHandle: sourceHandle,
          }
        : {
            source: sourceNodeId,
            target: targetNode.id,
            sourceHandle,
            targetHandle: 'target',
          }
      if (getInvalidConnectionReason(connection)) return
      createConnection(connection, 'snap')
      return
    }

    if (findNodeBodyAtPoint(point.x, point.y, [sourceNodeId])) return

    createTempConnectionMenu(point, sourceNodeId, sourceHandle)
  } finally {
    canvas.connectionState.isConnecting = false
    canvas.connectionState.sourceNodeId = null
    canvas.connectionState.sourceHandle = null
    canvas.connectionState.suppressHandles = true
    canvas.connectionState.hoverFeedbackNodeId = null
    canvas.connectionState.hoverFeedbackPoint = null
    clearInvalidConnectionFeedback()
  }
}




// --- custom events ---
function onNodeDoubleClick({ event, node }: NodeMouseEvent) {
  const e = event as MouseEvent
  console.log('[双击-节点]', { mouse: { x: e.clientX, y: e.clientY }, node: { id: node.id, type: node.type, position: node.position, data: node.data } })
  manager.eventBus.emit('nodeDoubleClick', { nodeId: node.id, nodeType: node.type })
  window.dispatchEvent(new CustomEvent('canvas:nodeDoubleClick', { detail: { nodeId: node.id } }))
}
/** 节点右键事件：打开节点右键菜单 */
function onNodeContextMenu({ event, node }: NodeMouseEvent) {
  event.preventDefault()
  const e = event as MouseEvent
  const flowPosition = toFlowPosition(e.clientX, e.clientY)
  openCreateNodeMenu(
    { x: e.clientX, y: e.clientY },
    'node',
    `节点 ${node.id} 菜单`,
    { nodeId: node.id, flowPosition },
  )
  console.log('[右键-节点]', { mouse: { x: e.clientX, y: e.clientY }, node: { id: node.id, type: node.type, position: node.position, data: node.data } })
}
/** 画布右键事件：打开"添加节点"菜单 */
function onPaneContextMenu(event: MouseEvent) {
  event.preventDefault()
  const flowPosition = toFlowPosition(event.clientX, event.clientY)
  openCreateNodeMenu(
    { x: event.clientX, y: event.clientY },
    'pane',
    '添加节点',
    { flowPosition },
  )
  console.log('[右键-画布]', { mouse: { x: event.clientX, y: event.clientY } })
}
/** 边右键事件：打开边操作菜单 */
function onEdgeContextMenu({ event, edge }: EdgeMouseEvent) {
  event.preventDefault()
  const e = event as MouseEvent
  const flowPosition = toFlowPosition(e.clientX, e.clientY)
  openMenu({
    mode: 'edge',
    title: `连线 ${edge.id} 菜单`,
    position: { x: e.clientX, y: e.clientY },
    items: resolveMenuItems({ mode: 'edge', edgeId: edge.id, flowPosition }, menuRegistry, nodeRegistry),
  }, { edgeId: edge.id, flowPosition })
}

/** 画布空白处双击：打开"添加节点"菜单 */
function onPaneDoubleClick(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (target.closest('.vue-flow__node') || target.closest('.vue-flow__edge')) return
  const flowPosition = toFlowPosition(event.clientX, event.clientY)
  openCreateNodeMenu(
    { x: event.clientX, y: event.clientY },
    'pane',
    '添加节点',
    { flowPosition },
  )
  console.log('[双击-画布]', { mouse: { x: event.clientX, y: event.clientY } })
}

/** 节点默认尺寸（用于无法获取实际尺寸时的回退值） */
const DEFAULT_NODE_SIZE = 256

type ConnectionFeedbackZone = {
  id: string
  nodeId: string
  kind: 'body'
  x: number
  y: number
  width: number
  height: number
}

/** 获取节点的实际渲染尺寸（优先 dimensions，回退到 width/height） */
function getNodeSize(node: Node) {
  const anyNode = node as any
  return {
    width: anyNode.dimensions?.width || anyNode.width || DEFAULT_NODE_SIZE,
    height: anyNode.dimensions?.height || anyNode.height || DEFAULT_NODE_SIZE,
  }
}

/** 获取节点卡片在画布坐标系中的矩形区域 */
function getNodeCardFlowRect(nodeId: string, fallbackPosition: { x: number; y: number }, fallbackSize: { width: number; height: number }) {
  const nodeEl = [...document.querySelectorAll('.vue-flow__node')]
    .find(el => getNodeIdFromElement(el) === nodeId)

  const cardEl = nodeEl?.querySelector('.custom-node-card') as HTMLElement | null
  if (!cardEl) {
    return {
      x: fallbackPosition.x,
      y: fallbackPosition.y,
      width: fallbackSize.width,
      height: fallbackSize.height,
    }
  }

  const rect = cardEl.getBoundingClientRect()
  const viewport = vueFlowInstance.viewport.value
  const zoom = viewport.zoom || 1

  return {
    x: (rect.left - viewport.x) / zoom,
    y: (rect.top - viewport.y) / zoom,
    width: rect.width / zoom,
    height: rect.height / zoom,
  }
}

/** 构建拖拽连线时的吸附区域和反馈数据 */
function buildConnectionEdgeProps(connectionLineProps: ConnectionLineProps) {
  const sourceId = connectionLineProps.sourceNode?.id || canvas.connectionState.sourceNodeId || '__source__'
  const startHandle = canvas.connectionState.sourceHandle || (connectionLineProps as any).sourceHandleId || 'source'
  const isReverseConnection = startHandle === 'target'
  const handleRadius = canvas.state.core.handleRadius
  const snapOuter = handleRadius * canvas.state.core.connectionSnapOuterRatio
  const snapInner = handleRadius * canvas.state.core.connectionSnapInnerRatio
  const snapHeight = handleRadius * canvas.state.core.connectionSnapHeightRatio
  const snapWidth = snapOuter + snapInner

  const liveNodes = (getNodes.value as Node[])
  const connectableNodes = liveNodes
    .filter(node => node.id !== sourceId && (isReverseConnection ? node.sourcePosition : node.targetPosition))
    .map((node) => {
      const size = getNodeSize(node)
      const anyNode = node as any
      const position = anyNode.computedPosition || node.position
      const cardRect = getNodeCardFlowRect(node.id, position, size)
      return {
        node,
        size: {
          width: cardRect.width,
          height: cardRect.height,
        },
        position: {
          x: cardRect.x,
          y: cardRect.y,
        },
      }
    })

  const feedbackNodes = liveNodes
    .filter(node => node.id !== sourceId && !isTempNode(node))
    .map((node) => {
      const size = getNodeSize(node)
      const anyNode = node as any
      const position = anyNode.computedPosition || node.position
      const cardRect = getNodeCardFlowRect(node.id, position, size)
      return {
        node,
        size: {
          width: cardRect.width,
          height: cardRect.height,
        },
        position: {
          x: cardRect.x,
          y: cardRect.y,
        },
      }
    })

  const snapZones = connectableNodes
    .map(({ node, size, position }) => {
      const centerY = position.y + size.height / 2
      const anchorX = isReverseConnection ? position.x + size.width : position.x
      const snapX = isReverseConnection ? anchorX - snapInner : position.x - snapOuter
      const snapY = centerY - snapHeight / 2
      return {
        id: node.id,
        x: snapX,
        y: snapY,
        width: snapWidth,
        height: snapHeight,
        anchorX,
        anchorY: centerY,
      }
    })

  const feedbackZones: ConnectionFeedbackZone[] = feedbackNodes.map(({ node, size, position }) => ({
    id: `${node.id}-body`,
    nodeId: node.id,
    kind: 'body',
    x: position.x,
    y: position.y,
    width: size.width,
    height: size.height,
  }))

  let endX = connectionLineProps.targetX
  let endY = connectionLineProps.targetY
  let bestDistance = Number.POSITIVE_INFINITY
  let feedbackNodeId: string | null = null
  let invalidNodeId: string | null = null
  let snappedNodeId: string | null = null

  for (const zone of snapZones) {
    const inZone =
      connectionLineProps.targetX >= zone.x &&
      connectionLineProps.targetX <= zone.x + zone.width &&
      connectionLineProps.targetY >= zone.y &&
      connectionLineProps.targetY <= zone.y + zone.height

    if (!inZone) continue

    const candidateConnection = isReverseConnection
      ? {
          source: zone.id,
          target: sourceId,
          sourceHandle: 'source',
          targetHandle: startHandle,
        }
      : {
          source: sourceId,
          target: zone.id,
          sourceHandle: startHandle,
          targetHandle: 'target',
        }

    if (getInvalidConnectionReason(candidateConnection)) {
      invalidNodeId = zone.id
      continue
    }

    const distance = Math.hypot(connectionLineProps.targetX - zone.anchorX, connectionLineProps.targetY - zone.anchorY)
    if (distance < bestDistance) {
      bestDistance = distance
      endX = zone.anchorX
      endY = zone.anchorY
      snappedNodeId = zone.id
    }
  }

  // 节点主体只负责识别“你正在碰到这个节点”，不能当成合法连接区域。
  // 真正合法连接只能来自上面的端口吸附区。
  for (const zone of feedbackZones) {
    const x = connectionLineProps.targetX
    const y = connectionLineProps.targetY
    const inZone =
      x >= zone.x &&
      x <= zone.x + zone.width &&
      y >= zone.y &&
      y <= zone.y + zone.height

    if (inZone) {
      feedbackNodeId = zone.nodeId
      break
    }
  }

  if (snappedNodeId) {
    feedbackNodeId = snappedNodeId
  } else if (feedbackNodeId && !invalidNodeId) {
    invalidNodeId = feedbackNodeId
  }

  const nextFeedbackPoint = feedbackNodeId && !invalidNodeId && snappedNodeId
    ? { x: connectionLineProps.targetX, y: connectionLineProps.targetY }
    : null
  const currentFeedbackPoint = canvas.connectionState.hoverFeedbackPoint
  const nextFeedbackNodeId = invalidNodeId ? null : snappedNodeId
  const feedbackChanged =
    canvas.connectionState.hoverFeedbackNodeId !== nextFeedbackNodeId ||
    currentFeedbackPoint?.x !== nextFeedbackPoint?.x ||
    currentFeedbackPoint?.y !== nextFeedbackPoint?.y

  if (feedbackChanged) {
    canvas.connectionState.hoverFeedbackNodeId = nextFeedbackNodeId
    canvas.connectionState.hoverFeedbackPoint = nextFeedbackPoint
  }

  const invalidPoint = invalidNodeId
    ? { x: connectionLineProps.targetX, y: connectionLineProps.targetY }
    : null
  const invalidChanged =
    canvas.connectionState.invalidFeedbackNodeId !== invalidNodeId ||
    canvas.connectionState.invalidFeedbackPoint?.x !== invalidPoint?.x ||
    canvas.connectionState.invalidFeedbackPoint?.y !== invalidPoint?.y

  if (invalidChanged) {
    setInvalidConnectionFeedback(invalidNodeId, invalidPoint)
  }

  return {
    ...connectionLineProps,
    id: '__connection-line__',
    source: sourceId,
    target: '__connection-target__',
    type: 'custom',
    selected: true,
    data: {},
    markerStart: '',
    markerEnd: '',
    events: {},
    animated: false,
    temporary: true,
    forceFlow: true,
    targetX: endX,
    targetY: endY,
    sourceHandleId: startHandle,
    targetHandleId: isReverseConnection ? 'source' : 'target',
    targetNode: connectionLineProps.targetNode || connectionLineProps.sourceNode,
    sourceNode: connectionLineProps.sourceNode,
  } as any
}

// ========================
// VueFlow 键位同步
// ========================

/** 将 ShortcutManager 规范化后的键名还原为 VueFlow 期望的 event.key 格式 */
function toVueFlowKey(key: string): string {
  const map: Record<string, string> = {
    'backspace': 'Backspace',
    'shift': 'Shift',
    'ctrl': 'Control',
    'meta': 'Meta',
    'alt': 'Alt',
    'enter': 'Enter',
    'escape': 'Escape',
    'space': ' ',
    'delete': 'Delete',
    'tab': 'Tab',
    'arrowup': 'ArrowUp',
    'arrowdown': 'ArrowDown',
    'arrowleft': 'ArrowLeft',
    'arrowright': 'ArrowRight',
  }
  return map[key] ?? key
}

/**
 * 将 canvas.state.core.shortcutKeymap 中的 VueFlow 键位映射同步到 VueFlow store
 */
/** 将 canvas.state 中的快捷键映射同步到 VueFlow 内部 refs */
function syncVueFlowKeymap() {
  const keymap = canvas.state.core.shortcutKeymap || {}
  const vf = vueFlowInstance as any
  const mapping: Record<string, string> = {
    'vueflow.delete': 'deleteKeyCode',
    'vueflow.selection': 'selectionKeyCode',
    'vueflow.multi-selection': 'multiSelectionKeyCode',
    'vueflow.zoom': 'zoomActivationKeyCode',
    'vueflow.pan': 'panActivationKeyCode',
  }
  for (const [shortcutId, vfProp] of Object.entries(mapping)) {
    if (!keymap[shortcutId] || !vf[vfProp]) continue
    vf[vfProp].value = toVueFlowKey(keymap[shortcutId])
  }
}

// ========================
// 插件系统生命周期
// ========================
const manager = new PluginManager()
/** 节点类型注册中心：管理可创建的节点类型 */
const nodeRegistry = new NodeRegistry()
/** 菜单注册中心：管理右键菜单项 */
const menuRegistry = new MenuRegistry()
/** 命令注册中心：管理所有可执行命令 */
const commandRegistry = new CommandRegistry()
/** Toolbar 注册中心：管理节点工具栏按钮 */
const toolbarRegistry = new ToolbarRegistry()
/** 设置面板注册中心：管理全局设置项 */
const panelRegistry = new PanelRegistry()
/** 画布运行时：持有所有 Registry 实例，通过 provide/inject 共享 */
const runtime = new CanvasRuntime(manager, manager.eventBus, nodeRegistry, menuRegistry, commandRegistry, toolbarRegistry, panelRegistry, vueFlowInstance as any)
commandRegistry.setShortcutManager(ShortcutManager.getInstance())
manager.setRegistries({ commandRegistry, toolbarRegistry, panelRegistry })

/**
 * 已安装的插件名称（reactive ref）
 */
const installedPluginNames = ref<string[]>([])

const bootstrap = useCanvasBootstrap(
  vueFlowInstance,
  () => manager.getPluginAPI<StorageAPI>('storage'),
  makeEdgeData,
)

/**
 * 已安装的插件名称（reactive ref — 确保 Panel 能感知变化）
 */
// 存储状态（从 storage 插件 API 获取）
// ===========================
import type { StorageStatus, ProjectMeta, StorageAPI } from './plugins/storage/StoragePlugin'

const storageState = ref<StorageStatus & { projects: ProjectMeta[] }>({
  isConnected: false,
  mode: 'localStorage',
  workspaceName: null,
  currentProjectId: null,
  projectCount: 0,
  projects: [],
})

/** 刷新存储插件状态（连接状态、项目列表） */
function refreshStorageState() {
  const api = manager.getPluginAPI<any>('storage')
  if (!api) return
  const status = api.status as StorageStatus
  storageState.value = {
    ...status,
    projects: api.listProjects?.() || [],
  }
}


// ===========================
// provide ref — setup 阶段提供，onMounted 后赋值
const canvasStorageApi = shallowRef<StorageAPI | null>(null)
provide('canvasStorageApi', canvasStorageApi)

onMounted(async () => {
  updateCanvasContainerSize()
  if (canvasContainerRef.value && typeof ResizeObserver !== 'undefined') {
    canvasResizeObserver = new ResizeObserver(updateCanvasContainerSize)
    canvasResizeObserver.observe(canvasContainerRef.value)
  }
  window.addEventListener('resize', updateCanvasContainerSize)

  const pluginList = props.plugins || []
  if (pluginList.length === 0) {
    // 无插件时，直接初始化画布数据（持久化监听已注册）
    return
  }

  // 注入插件配置（如果提供了 pluginConfigs）
  const configs = props.pluginConfigs || {}

  // 监听选中变化 → 写入 Pinia store（SelectionFrame 从此读取）
  // 注意：Canvas.vue 的 onNodesChange 也在做相同的事，双重保障
  manager.eventBus.on('selection:change', (payload: any) => {
    canvas.setSelection({
      nodeIds: payload?.nodeIds || [],
      edgeIds: payload?.edgeIds || [],
    })
  })

  // 监听插件要求修改画布全局 flag
  manager.eventBus.on('canvas:setFlag', (payload: any) => {
    if (!payload || !payload.key) return
    if (payload.key === 'selectedNodeIds') {
      canvas.setSelectedNodeIds(payload.value || [])
      return
    }
    if (payload.key === 'selectedEdgeIds') {
      canvas.setSelectedEdgeIds(payload.value || [])
      return
    }
    const stateKey = payload.key as keyof typeof canvas.state
    if (stateKey in canvas.state) {
      ; (canvas.state as any)[stateKey] = payload.value
      console.log(`[Canvas] 插件设置 flag: ${payload.key} = ${typeof payload.value === 'object' ? JSON.stringify(payload.value instanceof Set ? [...payload.value] : payload.value) : payload.value}`)
    }
  })

  try {
    await manager.install({
      plugins: pluginList.map(p => ({
        ...p,
        options: { ...((p as any).options || {}), ...(configs[p.name] || {}) },
      })),
      createContext: (pluginName: string) => createPluginContext(pluginName, {
        canvasId: 'main-canvas',
        vueFlowInstance: vueFlowInstance as any,
        canvasStore: canvas,
        pluginManager: manager,
        canvasState: canvas.state as any,
        eventBus: manager.eventBus,
        nodeRegistry,
        menuRegistry,
        commandRegistry,
        toolbarRegistry,
        panelRegistry,
      }),
    })

    installedPluginNames.value = pluginList.map(p => p.name)
    console.log(`[Canvas] ✅ ${installedPluginNames.value.length} 个插件已加载:`, installedPluginNames.value)
  } catch (err) {
    console.error('[Canvas] 插件安装失败，降级运行:', err)
    installedPluginNames.value = []
  }

  // auto-layout 插件配置已通过 panelRegistry 注册
  // 从 StoragePlugin 加载画布数据（或创建默认数据）
  await bootstrap.loadInitialCanvas()

  // 注册通用设置项到面板（通过 PanelRegistry → DynamicSettingsPanel 自动渲染）
  const core = canvas.state.core
  const registerCore = (id: string, rest: Record<string, unknown>) => {
    panelRegistry.registerSetting("canvas-core", {
      id: "core." + id,
      ...rest,
    } as any)
  }

  // --- 节点交互 toggles ---
  registerCore('nodesDraggable', { title: '可拖拽', type: 'boolean', group: '交互', order: 10, defaultValue: core.nodesDraggable })
  registerCore('nodesConnectable', { title: '可连线', type: 'boolean', group: '交互', order: 11, defaultValue: core.nodesConnectable })
  registerCore('elementsSelectable', { title: '可选中', type: 'boolean', group: '交互', order: 12, defaultValue: core.elementsSelectable })
  registerCore('edgesUpdatable', { title: '边可编辑', type: 'boolean', group: '交互', order: 13, defaultValue: core.edgesUpdatable })
  registerCore('snapToGrid', { title: '网格吸附', type: 'boolean', group: '交互', order: 14, defaultValue: core.snapToGrid })
  registerCore('selectNodesOnDrag', { title: '拖拽选中', type: 'boolean', group: '交互', order: 15, defaultValue: core.selectNodesOnDrag })

  // --- 视口交互 ---
  registerCore('zoomOnScroll', { title: '滚轮缩放', type: 'boolean', group: '视口', order: 20, defaultValue: core.zoomOnScroll })
  registerCore('panOnScroll', { title: '滚轮平移', type: 'boolean', group: '视口', order: 21, defaultValue: core.panOnScroll })
  registerCore('panOnDrag', { title: '拖拽平移', type: 'boolean', group: '视口', order: 22, defaultValue: core.panOnDrag })
  registerCore('connectOnClick', { title: '点击连线', type: 'boolean', group: '视口', order: 23, defaultValue: core.connectOnClick })
  registerCore('zoomOnDoubleClick', { title: '双击缩放', type: 'boolean', group: '视口', order: 24, defaultValue: core.zoomOnDoubleClick })
  registerCore('onlyRenderVisibleElements', { title: '只渲染可见', type: 'boolean', group: '视口', order: 25, defaultValue: core.onlyRenderVisibleElements })
  registerCore('minZoom', { title: '最小缩放', type: 'number', group: '视口', order: 26, defaultValue: core.minZoom })
  registerCore('maxZoom', { title: '最大缩放', type: 'number', group: '视口', order: 27, defaultValue: core.maxZoom })

  // --- 连线样式 ---
  registerCore('edgeLineWidth', { title: '边线宽度', type: 'slider', group: '连线', order: 30, defaultValue: core.edgeLineWidth, min: 1, max: 10, step: 0.5 })
  registerCore('edgeColor', { title: '边线颜色', type: 'color', group: '连线', order: 31, defaultValue: core.edgeColor })

  // --- 自定义端口 ---
  registerCore('handleRadius', { title: '端口半径', type: 'slider', group: '端口', order: 40, defaultValue: core.handleRadius, min: 20, max: 200, step: 1 })
  registerCore('handleRestOffset', { title: '端口偏移', type: 'slider', group: '端口', order: 41, defaultValue: core.handleRestOffset, min: 0, max: 100, step: 1 })
  registerCore('handleCursorGap', { title: '光标间隙', type: 'slider', group: '端口', order: 42, defaultValue: core.handleCursorGap, min: 0, max: 80, step: 1 })
  registerCore('handleButtonSize', { title: '按钮大小', type: 'slider', group: '端口', order: 43, defaultValue: core.handleButtonSize, min: 16, max: 64, step: 1 })
  registerCore('handleOverlap', { title: '重叠距离', type: 'slider', group: '端口', order: 44, defaultValue: core.handleOverlap, min: 0, max: 50, step: 1 })
  registerCore('connectionSnapOuterRatio', { title: '吸附外比例', type: 'slider', group: '端口', order: 45, defaultValue: core.connectionSnapOuterRatio, min: 0.1, max: 2, step: 0.05 })
  registerCore('connectionSnapInnerRatio', { title: '吸附内比例', type: 'slider', group: '端口', order: 46, defaultValue: core.connectionSnapInnerRatio, min: 0.1, max: 2, step: 0.05 })
  registerCore('connectionSnapHeightRatio', { title: '吸附高度比', type: 'slider', group: '端口', order: 47, defaultValue: core.connectionSnapHeightRatio, min: 0.1, max: 3, step: 0.05 })

  // --- 工具栏偏移 ---
  registerCore('topToolbarOffset', { title: '上工具栏偏移', type: 'slider', group: '工具栏', order: 50, defaultValue: core.topToolbarOffset, min: 0, max: 40, step: 1 })
  registerCore('bottomToolbarOffset', { title: '下工具栏偏移', type: 'slider', group: '工具栏', order: 51, defaultValue: core.bottomToolbarOffset, min: 0, max: 40, step: 1 })

  // --- 多选框 ---
  registerCore('selectionFramePaddingX', { title: '选框水平内边距', type: 'slider', group: '选框', order: 60, defaultValue: core.selectionFramePaddingX, min: 0, max: 60, step: 1 })
  registerCore('selectionFramePaddingTop', { title: '选框上内边距', type: 'slider', group: '选框', order: 61, defaultValue: core.selectionFramePaddingTop, min: 0, max: 80, step: 1 })
  registerCore('selectionFramePaddingBottom', { title: '选框下内边距', type: 'slider', group: '选框', order: 62, defaultValue: core.selectionFramePaddingBottom, min: 0, max: 80, step: 1 })

  // --- 性能面板 ---
  registerCore('performancePanelEnabled', { title: '启用性能面板', type: 'boolean', group: '性能', order: 70, defaultValue: core.performancePanelEnabled })
  registerCore('performancePanelShowCharts', { title: '显示图表', type: 'boolean', group: '性能', order: 71, defaultValue: core.performancePanelShowCharts })
  registerCore('performancePanelShowMemory', { title: '显示内存', type: 'boolean', group: '性能', order: 72, defaultValue: core.performancePanelShowMemory })

  // --- 调试 ---
  registerCore('handleDebug', { title: '端口调试', type: 'boolean', group: '调试', order: 80, defaultValue: core.handleDebug })
  registerCore('connectionSnapDebugVisible', { title: '吸附调试', type: 'boolean', group: '调试', order: 81, defaultValue: core.connectionSnapDebugVisible })



  // 初始化画布数据（必须在所有插件注册完 nodeTypes 之后，避免 VueFlow 渲染未注册的节点类型）

  // 监听存储插件状态变化
  manager.eventBus.on('storage:status', () => refreshStorageState())
  manager.eventBus.on('storage:project-created', () => refreshStorageState())
  manager.eventBus.on('storage:project-deleted', () => refreshStorageState())
  manager.eventBus.on('storage:project-switched', () => refreshStorageState())
  manager.eventBus.on('storage:connected', () => refreshStorageState())
  manager.eventBus.on('storage:disconnected', () => refreshStorageState())
  // 初始加载
  nextTick(() => refreshStorageState())

  // 赋值 storage API ref + 单例（由子组件 inject 使用）
  const storageApi = manager.getPluginAPI<any>('storage')
  if (storageApi) {
    canvasStorageApi.value = storageApi as any
  }

  // 注册 VueFlow 内置键位到 ShortcutManager（系统管理，不执行 handler）
  const mgr = ShortcutManager.getInstance()
  const vfSystemEntries = [
    { id: 'vueflow.delete', command: '删除选中', prop: 'deleteKeyCode', defaultKey: 'Backspace' },
    { id: 'vueflow.selection', command: '框选模式', prop: 'selectionKeyCode', defaultKey: 'Shift' },
    { id: 'vueflow.multi-selection', command: '多选模式', prop: 'multiSelectionKeyCode', defaultKey: 'Control' },
    { id: 'vueflow.zoom', command: '缩放', prop: 'zoomActivationKeyCode', defaultKey: 'Control' },
    { id: 'vueflow.pan', command: '平移画布', prop: 'panActivationKeyCode', defaultKey: 'Space' },
  ]
  for (const entry of vfSystemEntries) {
    const currentVal = (vueFlowInstance as any)[entry.prop]?.value
    mgr.register({
      id: entry.id,
      command: entry.command,
      keys: String(currentVal ?? entry.defaultKey),
      handler: () => { },
      priority: 0,
      pluginId: 'vueflow',
      group: 'system',
      isSystemManaged: true,
    })
  }

  // 从持久化存储加载用户自定义的快捷键映射
  const keymap = canvas.state.core.shortcutKeymap || {}
  ShortcutManager.getInstance().loadKeymap(keymap)

  // 同步 VueFlow keyboard refs
  syncVueFlowKeymap()

  // 同步 zoom 限制给 auto-layout，F 快捷键也要遵守通用设置里的缩放范围
  function pushLayoutConfig() {
    const api = manager.getPluginAPI<any>("auto-layout")
    if (api) api.setConfig({ minZoom: canvas.state.core.minZoom, maxZoom: canvas.state.core.maxZoom })
  }
  pushLayoutConfig()
  watch(
    () => [canvas.state.core.minZoom, canvas.state.core.maxZoom],
    () => pushLayoutConfig(),
    { deep: false }
  )

  // 监听快捷键重映射 → 同步到 VueFlow
  watch(
    () => canvas.state.core.shortcutKeymap,
    () => syncVueFlowKeymap(),
    { deep: true }
  )

})

onUnmounted(async () => {
  window.removeEventListener('resize', updateCanvasContainerSize)
  canvasResizeObserver?.disconnect()
  canvasResizeObserver = null
  cancelBatchConnect()

  // 持久化当前快捷键映射到 Store
  const mgr = ShortcutManager.getInstance()
  canvas.state.core.shortcutKeymap = mgr.exportKeymap()

  // 按依赖拓扑顺序反向卸载（先卸载依赖方，再卸载被依赖方）
  const names = [...manager.getLoadOrder()].reverse()
  for (const name of names) {
    try {
      await manager.uninstall(name)
    } catch (err) {
      console.error(`[Canvas] 卸载插件 "${name}" 失败:`, err)
    }
  }
  installedPluginNames.value = []
})
</script>

<template>
  <CanvasRuntimeProvider :runtime="runtime">
    <div ref="canvasContainerRef" class="canvas-container">
      <VueFlow :id="CANVAS_ID" :nodes="vueFlowInstance.nodes.value" :edges="vueFlowInstance.edges.value"
        :node-types="mergedNodeTypes" :edge-types="mergedEdgeTypes" :connection-mode="canvas.state.core.connectionMode"
        :nodes-draggable="canvas.state.core.nodesDraggable" :nodes-connectable="canvas.state.core.nodesConnectable"
        :elements-selectable="canvas.state.core.elementsSelectable" :edges-updatable="canvas.state.core.edgesUpdatable"
        :snap-to-grid="canvas.state.core.snapToGrid" :snap-grid="canvas.state.core.snapGrid"
        :zoom-on-scroll="canvas.state.core.zoomOnScroll" :zoom-on-pinch="canvas.state.core.zoomOnPinch"
        :pan-on-scroll="canvas.state.core.panOnScroll" :pan-on-drag="canvas.state.core.panOnDrag"
        :connect-on-click="canvas.state.core.connectOnClick" :min-zoom="canvas.state.core.minZoom"
        :max-zoom="canvas.state.core.maxZoom" :zoom-on-double-click="canvas.state.core.zoomOnDoubleClick"
        :selection-mode="canvas.state.core.selectionMode"
        :only-render-visible-elements="canvas.state.core.onlyRenderVisibleElements"
        :select-nodes-on-drag="canvas.state.core.selectNodesOnDrag"
        :prevent-scrolling="canvas.state.core.preventScrolling" :selection-key-code="null"
        :multi-selection-key-code="'Shift'" fit-view-on-init :is-valid-connection="isValidConnection"
        :auto-connect="false" @connect="onConnect($event); manager.eventBus.emit('connect', $event)"
        @connect-start="onConnectStart($event); manager.eventBus.emit('connectStart', $event)"
        @connect-end="onConnectEnd($event); manager.eventBus.emit('connectEnd', $event)"
        @nodes-change="onNodesChange($event); manager.eventBus.emit('nodesChange', $event)"
        @edges-change="onEdgesChange($event); manager.eventBus.emit('edgesChange', $event)"
        @node-drag="manager.eventBus.emit('nodeDrag', $event)"
        @node-drag-start="manager.eventBus.emit('nodeDragStart', $event)"
        @node-drag-stop="manager.eventBus.emit('nodeDragStop', $event)"
        @node-click="manager.eventBus.emit('nodeClick', $event)"
        @pane-click="onPaneClick(); manager.eventBus.emit('paneClick', $event)"
        @pane-mouse-down="manager.eventBus.emit('paneMouseDown', $event)"
        @pane-mouse-up="manager.eventBus.emit('paneMouseUp', $event)"
        @pane-mouse-move="manager.eventBus.emit('paneMouseMove', $event)" @node-double-click="onNodeDoubleClick"
        @node-context-menu="onNodeContextMenu" @pane-context-menu="onPaneContextMenu"
        @edge-context-menu="onEdgeContextMenu" @dblclick="onPaneDoubleClick">
        <template #connection-line="connectionLineProps">
          <CustomEdge v-bind="buildConnectionEdgeProps(connectionLineProps)" />
        </template>

      </VueFlow>

      <!-- 设置面板（Teleport 到 body，不受 VueFlow transform 影响） -->
      <Teleport to="body">
        <slot name="settings-panel" :settings="allSettings" :grouped-settings="groupedSettings"
          :get-value="getSettingValue">
          <DynamicSettingsPanel :settings="allSettings" :grouped-settings="groupedSettings"
            :get-value="getSettingValue" />
        </slot>
      </Teleport>

      <CanvasPerformancePanel :enabled="canvas.state.core.performancePanelEnabled"
        :samples="performanceMonitor.samples.value" :long-tasks="performanceMonitor.longTasks.value"
        :status="performanceMonitor.currentStatus.value" :summary="performanceMonitor.summary.value"
        :fps="performanceMonitor.fps.value" :frame-ms="performanceMonitor.lastFrameMs.value"
        :nodes="vueFlowInstance.getNodes.value" :edges-count="vueFlowInstance.getEdges.value.length"
        :viewport="vueFlowInstance.viewport.value" :container-size="canvasContainerSize"
        :selected-node-count="canvas.selectionState.selectedNodeIds.size"
        :selected-edge-count="canvas.selectionState.selectedEdgeIds.size"
        :only-render-visible-elements="canvas.state.core.onlyRenderVisibleElements"
        :show-charts="canvas.state.core.performancePanelShowCharts"
        :show-memory="canvas.state.core.performancePanelShowMemory" :memory="performanceMonitor.memory.value" />


      <!-- 多选背景框（2+ 节点选中时自动显示）
             读取 useCanvasStore.selectionState.selectedNodeIds + VueFlow getNodes -->
      <SelectionFrame v-if="canvas.selectionState.selectedNodeIds.size > 1" :nodes="vueFlowInstance.getNodes.value"
        :viewport="vueFlowInstance.viewport.value" :vf-instance="vueFlowInstance"
        @pan="(vp: any) => vueFlowInstance.setViewport(vp)" @batch-connect-start="onSelectionBatchConnectStart" />

      <slot name="context-menu" :menu-state="menuState" :on-select="onMenuSelect" :on-close="closeMenu">
        <CanvasMenu :menu="menuState" @select="onMenuSelect" @close="closeMenu" />
      </slot>
    </div>
  </CanvasRuntimeProvider>
</template>

<style scoped>
.canvas-container {
  width: 100vw;
  height: 100vh;
  position: relative;
  user-select: none;
}
</style>

<style>
body {
  user-select: none;
}

.vue-flow__edges {
  z-index: 1 !important
}
</style>
