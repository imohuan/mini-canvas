<script setup lang="ts">
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import { ref, onMounted, onUnmounted, computed, nextTick, watch, shallowRef, markRaw, provide } from 'vue'
import {
  VueFlow, useVueFlow,
} from '@vue-flow/core'
import type { Node, Edge, EdgeChange, NodeMouseEvent, EdgeMouseEvent } from '@vue-flow/core'
import DynamicSettingsPanel from './components/Panel/DynamicSettingsPanel.vue'
import CanvasPerformancePanel from './components/Performance/CanvasPerformancePanel.vue'
import SelectionFrame from './plugins/multi-select/SelectionFrame.vue'
import CustomEdge from './components/CustomEdge.vue'
import { useCanvasStore } from './composables/useCanvasStore'
import { storeToRefs } from 'pinia'
import { useCanvasPerformance } from './composables/useCanvasPerformance'
import type { CanvasPlugin } from './plugins/types.ts'
import { PluginManager } from './plugins/PluginManager.ts'
import { createPluginContext } from './plugins/PluginContext.ts'
import { ShortcutManager } from './plugins/ShortcutManager'
import { useCanvasBootstrap } from './composables/useCanvasBootstrap'
import { useCanvasConnection } from './composables/useCanvasConnection'
import { CanvasRuntime, CanvasRuntimeProvider } from './runtime'
import { NodeRegistry } from './registry/NodeRegistry'
import { CommandRegistry } from './registry/CommandRegistry'
import { ToolbarRegistry } from './registry/ToolbarRegistry'
import { PanelRegistry } from './registry/PanelRegistry'
import { MenuRegistry } from './registry/MenuRegistry'

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
// 拿到 ref/computed 本身（store 直接访问会被自动解包成值）。
// 此处仅在 setup 顶层取 ref 引用并透传给插件系统，不在 computed 内读 .value，
// 规避操作指南中记录的 storeToRefs + VueFlow Teleport 断链场景。
const { connectionState, isConnecting, canShowConnectionMenu } = storeToRefs(canvas)

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

// ========================
// 插件管理器（提前创建，供 composable 使用 eventBus）
// ========================
const manager = new PluginManager()

// ========================
// 连接线 Core Composable
// ========================
const conn = useCanvasConnection({
  getNodes: vueFlowInstance.getNodes as any,
  getEdges: vueFlowInstance.getEdges as any,
  addNodes: (nodes: Node[]) => vueFlowInstance.addNodes(nodes),
  addEdges: (edges: Edge[]) => vueFlowInstance.addEdges(edges),
  removeNodes: (ids: string[]) => vueFlowInstance.removeNodes(ids),
  removeEdges: (ids: string[]) => vueFlowInstance.removeEdges(ids),
  updateNode: (id: string, data: Partial<Omit<Node, 'id'>>) => vueFlowInstance.updateNode(id, data),
  viewport: vueFlowInstance.viewport as any,
  eventBus: manager.eventBus,
})

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

// NODE_MENU_ITEMS removed - use nodeRegistry.getMenuItems() instead

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

/** 画布空白处点击：清除所有选中，同时退出所有节点的裁剪等临时模式 */
function onPaneClick() {
  // 遍历所有节点，删除 _overlay 退出临时模式（裁剪等）
  for (const node of vueFlowInstance.getNodes.value) {
    if (node.data?._overlay) {
      const data = { ...node.data }
      delete data._overlay
      delete data._cropRect
      delete data._cropMode
      vueFlowInstance.updateNode(node.id, { data })
    }
  }

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




// --- custom events ---
function onNodeDoubleClick({ event, node }: NodeMouseEvent) {
  const e = event as MouseEvent
  console.log('[双击-节点]', { mouse: { x: e.clientX, y: e.clientY }, node: { id: node.id, type: node.type, position: node.position, data: node.data } })
  manager.eventBus.emit('nodeDoubleClick', { nodeId: node.id, nodeType: node.data?.nodeType ?? node.type })
  window.dispatchEvent(new CustomEvent('canvas:nodeDoubleClick', { detail: { nodeId: node.id } }))
}
/** 节点右键事件：打开节点右键菜单 */
function onNodeContextMenu({ event, node }: NodeMouseEvent) {
  event.preventDefault()
  const e = event as MouseEvent
  manager.eventBus.emit("nodeContextMenu", { clientX: e.clientX, clientY: e.clientY, nodeId: node.id, nodeType: node.data?.nodeType ?? node.type })
  console.log("[右键-节点]", { mouse: { x: e.clientX, y: e.clientY }, node: { id: node.id, type: node.type, position: node.position, data: node.data } })
}
/** 画布右键事件：打开"添加节点"菜单 */
function onPaneContextMenu(event: MouseEvent) {
  event.preventDefault()
  const flowPosition = toFlowPosition(event.clientX, event.clientY)
  manager.eventBus.emit('paneContextMenu', { clientX: event.clientX, clientY: event.clientY, flowPosition })
  console.log('[右键-画布]', { mouse: { x: event.clientX, y: event.clientY } })
}
/** 边右键事件：打开边操作菜单 */
function onEdgeContextMenu({ event, edge }: EdgeMouseEvent) {
  event.preventDefault()
  const e = event as MouseEvent
  manager.eventBus.emit("edgeContextMenu", { clientX: e.clientX, clientY: e.clientY, edgeId: edge.id })
}
/** 画布空白处双击：打开"添加节点"菜单 */
function onPaneDoubleClick(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (target.closest('.vue-flow__node') || target.closest('.vue-flow__edge')) return
  const flowPosition = toFlowPosition(event.clientX, event.clientY)
  manager.eventBus.emit('paneDoubleClick', { clientX: event.clientX, clientY: event.clientY, flowPosition })
  console.log('[双击-画布]', { mouse: { x: event.clientX, y: event.clientY } })
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
// manager 已在上方提前创建（供 useCanvasConnection 使用 eventBus）
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
        connectionState,
        isConnecting,
        canShowConnectionMenu,
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
  registerCore('edgeType', { title: '线型', type: 'select', group: '连线', order: 32, defaultValue: core.edgeType, options: [
    { title: '贝塞尔', value: 'bezier' },
    { title: '直线', value: 'straight' },
    { title: '阶梯', value: 'step' },
    { title: '平滑阶梯', value: 'smoothstep' },
  ] })
  registerCore('edgeDashed', { title: '虚线', type: 'boolean', group: '连线', order: 33, defaultValue: core.edgeDashed })
  registerCore('edgeAnimated', { title: '流动动画', type: 'boolean', group: '连线', order: 34, defaultValue: core.edgeAnimated })
  registerCore('edgeMarkerEnd', { title: '目标箭头', type: 'boolean', group: '连线', order: 35, defaultValue: core.edgeMarkerEnd })
  registerCore('edgeMarkerSize', { title: '箭头大小', type: 'slider', group: '连线', order: 36, defaultValue: core.edgeMarkerSize, min: 4, max: 24, step: 1 })
  registerCore('edgeVisible', { title: '显示连线', type: 'boolean', group: '连线', order: 37, defaultValue: core.edgeVisible })

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
  conn.cancelBatchConnect()

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
      <VueFlow :id="CANVAS_ID" :class="{ 'is-batch-connecting': conn.batchConnectState.value !== null }"
        :nodes="vueFlowInstance.nodes.value" :edges="vueFlowInstance.edges.value" :node-types="mergedNodeTypes"
        :edge-types="mergedEdgeTypes" :connection-mode="canvas.state.core.connectionMode"
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
        :multi-selection-key-code="'Shift'" fit-view-on-init :is-valid-connection="conn.isValidConnection"
        :auto-connect="false" @connect="conn.onConnect($event); manager.eventBus.emit('connect', $event)"
        @connect-start="conn.onConnectStart($event); manager.eventBus.emit('connectStart', $event)"
        @connect-end="conn.onConnectEnd($event); manager.eventBus.emit('connectEnd', $event); canvas.connectionState.activeConnection = null"
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
          <CustomEdge v-bind="conn.buildConnectionEdgeProps(connectionLineProps)" />
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
        :viewport="vueFlowInstance.viewport.value" :vf-instance="vueFlowInstance" :disable-pointer-events="isConnecting"
        @pan="(vp: any) => vueFlowInstance.setViewport(vp)" @batch-connect-start="conn.onSelectionBatchConnectStart" />
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

.is-batch-connecting .vue-flow__edges {
  z-index: 10 !important;
}

.vue-flow__edges {
  pointer-events: none;
}
</style>
