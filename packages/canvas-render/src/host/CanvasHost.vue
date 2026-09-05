<script setup lang="ts">
/**
 * CanvasHost —— 官方渲染宿主组件：把 VueFlow 装配/数据同步/通用交互全部收进内部，调用方一行渲染。
 *
 * 解决的问题（见 docs/plan/canvas-host-component-plan.md）：CanvasDemo.vue 那套手写装配(~340行)散落在各 demo，
 * 每个宿主都要重复 provide 令牌 + 自己 mount VueFlow + store↔flow 双向同步。本组件把这些收编并藏起来。
 *
 * 职责边界：
 * - 建内核宿主(createMiniCanvasHost) + 冷启动插件 → 订阅 nodeStore 变化自动重灌渲染态。
 * - provide 全套渲染契约令牌(HOST/NODE_REGISTRY/NODE_WRITE/CANVAS_PARAMS/EDGE_VISUAL/EDGE_SELECTION)，
 *   供 BaseNode(壳)/content/边 这些渲染插件组件消费。
 * - 内部装配一个 <VueFlow>：读 themeRegistry 的 nodeShell/edge/edgeDefaultType/background 填给 VueFlow。
 * - 通用画布交互：拖拽落盘、点选同步内核 selection、连边校验+加边、键盘删除/撤销(经 command)。
 * - 生命周期：浏览器隐藏落盘、卸载回收插件副作用。
 *
 * 边界（不越权）：不内置业务工具栏/右键菜单(建哪些节点是 app 层的事)；父级经 defineExpose 的 host/api
 * 驱动业务操作，经 emit('context-menu') 弹自己的菜单。数据(节点增删/编辑)经 nodeStore 变化自动刷渲染态，
 * 父级/插件 service 改 store 后无需手动同步。
 *
 * 模板结构：本组件占满父容器高度(定位 100%)，内部是 booting/error + canvas-wrap(VueFlow+主题背景)。
 * 父级想加自己的 toolbar/面板，在本组件外层套一层 flex 布局即可。
 */
import { markRaw, onBeforeUnmount, onMounted, provide, reactive, ref, shallowRef } from 'vue'
import { VueFlow } from '@vue-flow/core'
import type { Connection, NodeMouseEvent, NodeDragEvent } from '@vue-flow/core'
import {
  NodeRegistry,
  type PluginModule,
  type Disposable,
  type StorageAdapter,
  MemoryStorageAdapter,
  type CanvasNode,
  validateConnection,
  typeConnectionDef,
} from '@mini-canvas/canvas-core-v2'
import {
  createMiniCanvasHost,
  type CanvasHostHandle,
  type MiniCanvasApi,
} from './createMiniCanvasHost'
import type { NodeWrite } from '../contracts/nodeRegistryKey'
import { NODE_REGISTRY_KEY, NODE_WRITE_KEY } from '../contracts/nodeRegistryKey'
import { CANVAS_PARAMS_KEY, type CanvasParams } from '../contracts/canvasParamKey'
import { HOST_KEY } from '../contracts/contentBridge'
import { EDGE_VISUAL_KEY, EDGE_SELECTION_KEY, type EdgeVisual } from '../contracts/edgeContext'
import {
  assembleTheme,
  edgeId,
  nodesFromStore,
  pruneDanglingEdges,
  DEFAULT_EDGE_VISUAL,
  DEFAULT_HANDLE_VISUAL,
} from './canvasHostCore'

// ==================== props / emits ====================

const props = withDefaults(
  defineProps<{
    /** 冷启动插件（顺序即装载序）。宿主负责给全：主题 + 业务节点插件。 */
    plugins: PluginModule[]
    /** 存储后端。缺省内存 adapter（刷新即丢）。想要持久化传 LocalStorageAdapter。 */
    adapter?: StorageAdapter
    /** 首次(存储为空)生成默认画布；返回的节点会 replaceAll。 */
    seed?: () => CanvasNode[]
    /** 覆盖默认的标题写回实现（BaseNode 就地重命名用）。缺省：改 store data + 落盘。 */
    nodeWrite?: NodeWrite
    /** 自定义边外观覆盖（缺省对齐 contract §0）。传响应式对象可实时生效。 */
    edgeVisual?: Partial<EdgeVisual>
    /** 浮动端口尺寸覆盖（缺省对齐 contract §0）。BaseNode 读 handle 字段无回落，故需传含全部字段的响应式对象。 */
    handleVisual?: CanvasParams
    /** VueFlow 缩放范围 */
    minZoom?: number
    maxZoom?: number
    /** 挂到 window 的调试 key；传空则不挂 */
    windowKey?: string
  }>(),
  {
    minZoom: 0.2,
    maxZoom: 2,
  },
)

const emit = defineEmits<{
  /** 右键菜单请求（已在内部 preventDefault）。父级据此弹业务菜单。 */
  (e: 'context-menu', payload: { kind: 'node' | 'pane'; clientX: number; clientY: number; nodeId?: string }): void
  /** 宿主就绪 */
  (e: 'ready', host: CanvasHostHandle): void
  (e: 'boot-error', error: Error): void
}>()

// ==================== boot 状态 ====================

const booting = ref(true)
const bootError = ref('')
const hostRef = shallowRef<CanvasHostHandle | undefined>()
const apiRef = shallowRef<MiniCanvasApi | undefined>()

// ==================== setup 期同步 provide 的令牌 ====================

// 节点展示注册表：宿主自建并同步 provide，同时传入 boot(createMiniCanvasHost)。
// 插件 setup 经 ctx.get('nodeRegistry') 把 content 组件注册进来；BaseNode(壳)经此解析 content 段。
const registry = new NodeRegistry()
provide(NODE_REGISTRY_KEY, registry)

// 宿主引用：boot 异步完成后填充；content 组件经 inject(HOST_KEY).value.ctx.get(...) 调插件服务。
provide(HOST_KEY, hostRef)

// 标题就地重命名写回：缺省 = 改内核 nodeStore data 并落盘。nodeStore.subscribe 会自动刷新渲染态，
// 无需像旧 demo 那样手动 map 改 nodes 数组。
function defaultWrite(id: string, patch: Record<string, unknown>): void {
  const h = hostRef.value
  if (!h) return
  const node = h.nodeStore.getNode(id)
  if (!node) return
  h.nodeStore.updateNodeData(id, patch) // 触发 subscribe → 渲染态自动更新
  void h.save.set('graph', h.nodeStore.getNodes(), 'canvas')
}
const nodeWrite: NodeWrite = props.nodeWrite ?? defaultWrite
provide(NODE_WRITE_KEY, nodeWrite)

// 外观参数注入：EDGE_VISUAL(边) / CANVAS_PARAMS(浮动端口)。
// 父级若传 props.edgeVisual / props.handleVisual（应为响应式对象，改属性实时生效），
// 我们直接 provide 那个引用；未传则用内部 DEFAULT reactive 回落。
// 注意：BaseNode 读 handle 字段不做默认回落，故 handleVisual 需含全部 5 个字段（通常传一个全字段 reactive）。
const edgeDefaultR = reactive({ ...DEFAULT_EDGE_VISUAL })
const handleDefaultR = reactive({ ...DEFAULT_HANDLE_VISUAL })
const edgeVisualToProvide = props.edgeVisual ?? edgeDefaultR
const handleToProvide = props.handleVisual ?? handleDefaultR
provide(EDGE_VISUAL_KEY, edgeVisualToProvide)
provide(CANVAS_PARAMS_KEY, handleToProvide)

// 选中集合注入给 CustomEdge：相连节点被选 → 边高亮流光。
// 以 ReadonlySet 形状暴露（消费方只读）；内部整体替换新集合以触发响应式。
const selectedIds = ref<ReadonlySet<string>>(new Set())
const emptyEdgeSel = ref<ReadonlySet<string>>(new Set())
provide(EDGE_SELECTION_KEY, { selectedNodeIds: selectedIds, selectedEdgeIds: emptyEdgeSel })

// ==================== 渲染态（VueFlow 消费）====================

const nodes = ref<ReturnType<typeof nodesFromStore>>([])
const edges = ref<Array<{ id: string; type: string; source: string; target: string }>>([])
// 组件句柄(opaque，来自 themeRegistry/registry)塞给 VueFlow 的 node-types/edge-types。
// 必须用 shallowRef：里面存的是 .vue 组件对象，ref 会深代理组件触发 Vue "组件被 reactive 化" 警告，
// 且我们总是整体替换 .value，浅层响应式就够。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeTypes = shallowRef<Record<string, any>>({})
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const edgeTypes = shallowRef<Record<string, any>>({})
// 背景也是组件句柄，同样浅层即可。
const backgroundComp = shallowRef<unknown>(undefined)
const edgeDefaultType = ref('custom')
const nodeEpoch = ref(0) // 插件变更后 bump → 触发 VueFlow 子树重挂

// 选中态：与内核 selection 双向——CustomEdge 高亮读 selectedIds；命令(command:delete)读内核 selection。
const canUndo = ref(false)
const canRedo = ref(false)

// ==================== 装配：主题 + nodeTypes ====================

function applyTheme(): void {
  const h = hostRef.value
  if (!h) return
  const asm = assembleTheme(h.themeRegistry, h.nodeStore.types.keys())
  // markRaw 组件句柄：防止它们被 VueFlow/响应式系统 proxy，避免 Vue "组件被 reactive 化" 警告与性能损耗。
  if (asm.nodeShell) {
    const shell = markRaw(asm.nodeShell)
    nodeTypes.value = {}
    for (const t of asm.nodeTypes) nodeTypes.value[t] = shell
  }
  if (asm.edge) edgeTypes.value = { custom: markRaw(asm.edge) }
  edgeDefaultType.value = asm.edgeDefaultType
  backgroundComp.value = asm.background ? markRaw(asm.background) : undefined
}

// ==================== 通用 UI 槽(overlay)：按序渲染插件塞的浮层控件 ====================
// 插件用 ctx.slots.register('overlay', { component, order }) 往画布叠加 UI(如 dock/浮标)；
// 宿主在这里读内核 slots 服务，把某槽全部 occupant 按 order 顺序同屏渲染(Goal A 渲染收口)。
// 注：不放主题(nodeShell/edge/background)那几个语义槽，那些走 themeRegistry 装配；这里是"通用 UI 浮层槽"。
const overlaySlotName = 'overlay'
const uiOverlay = ref<Array<{ id: string; order: number; component: unknown }>>([])

function syncUiOverlay(): void {
  const h = hostRef.value
  if (!h) return
  let list: Array<{ id: string; order: number; value: unknown }> = []
  try {
    const slots = h.ctx.get<{ list(slot: string): Array<{ id: string; order: number; value: unknown }> }>('slots')
    list = slots.list(overlaySlotName)
  } catch {
    list = []
  }
  uiOverlay.value = list.map((e) => ({ id: e.id, order: e.order, component: markRaw(e.value as object) }))
}

// 订阅 nodeStore：任何增删改(命令/插件 service/拖拽/历史 undo redo)都自动重灌渲染态。
let unsubStore: (() => void) | undefined

function syncFromStore(): void {
  const h = hostRef.value
  if (!h) return
  const alive = new Set(h.nodeStore.getNodes().map((n) => n.id))
  edges.value = pruneDanglingEdges(edges.value, alive)
  nodes.value = nodesFromStore(h.nodeStore)
  canUndo.value = h.history.canUndo()
  canRedo.value = h.history.canRedo()
}

// ==================== 通用交互事件 ====================

function onNodeDragStop(e: NodeDragEvent): void {
  const h = hostRef.value
  if (!h) return
  const pos = e.node.position
  // VueFlow 内部已更新自身节点位置；这里把最终 position 写回内核 store（replaceAll 触发订阅自动刷新）。
  const graph: CanvasNode[] = h.nodeStore.getNodes().map((n) => {
    const moved = e.node.id === n.id && pos ? { x: pos.x, y: pos.y } : { ...n.position }
    return { ...n, position: moved }
  })
  h.nodeStore.replaceAll(graph)
  void h.save.set('graph', h.nodeStore.getNodes(), 'canvas')
}

function onNodeClick(e: NodeMouseEvent): void {
  const h = hostRef.value
  selectedIds.value = new Set([e.node.id])
  h?.selection.set(selectedIds.value)
}

function onPaneClick(): void {
  selectedIds.value = new Set()
  hostRef.value?.selection.clear()
}

// 连边校验走内核 connection 服务(自连/环/重复/朝向/类型声明)。
function isValidConnection(conn: Connection): boolean {
  const h = hostRef.value
  if (!h || !conn.source || !conn.target) return false
  const map = new Map(h.nodeStore.getNodes().map((n) => [n.id, { id: n.id, type: n.type }]))
  const res = validateConnection(
    { source: conn.source, sourceHandle: conn.sourceHandle ?? undefined, target: conn.target, targetHandle: conn.targetHandle ?? undefined },
    { nodes: map, edges: edges.value, getTypeConn: (t) => typeConnectionDef(h.nodeStore.types.get(t)) },
  )
  return res.ok
}

function onConnect(conn: Connection): void {
  if (!isValidConnection(conn) || !conn.source || !conn.target) return
  const id = edgeId(conn.source, conn.target)
  edges.value = edges.value
    .filter((e) => e.id !== id)
    .concat([{ id, type: edgeDefaultType.value, source: conn.source, target: conn.target }])
  // 边目前是 VueFlow 视觉态(未落盘)——内核尚无 edge store。删除/撤销经 onKeydown 清相关边。
}

// —— 键盘：Delete 删选中、Ctrl/Cmd+Z 撤销/重做（编辑输入框内不劫持）——
function onKeydown(e: KeyboardEvent): void {
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return
  const h = hostRef.value
  if (!h) return
  if (e.key === 'Delete') {
    e.preventDefault()
    const ids = selectedIds.value
    if (ids.size > 0) {
      h.selection.set(ids)
      h.command.execute('command:delete')
      selectedIds.value = new Set()
      syncFromStore()
    }
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    h.command.execute(e.shiftKey ? 'command:redo' : 'command:undo')
    selectedIds.value = new Set()
    syncFromStore()
  }
}

// 右键菜单：内部统一 preventDefault，把坐标透给父级弹业务菜单。
function onNodeContextMenu(e: NodeMouseEvent): void {
  const ev = e.event as MouseEvent
  ev.preventDefault()
  emit('context-menu', { kind: 'node', clientX: ev.clientX, clientY: ev.clientY, nodeId: e.node.id })
}
function onPaneContextMenu(e: MouseEvent): void {
  e.preventDefault()
  emit('context-menu', { kind: 'pane', clientX: e.clientX, clientY: e.clientY })
}

// ==================== 生命周期 ====================

let subs: Disposable[] = []
let keydownBound = false

onMounted(async () => {
  try {
    const { host, api, exposeToWindow } = await createMiniCanvasHost({
      adapter: props.adapter ?? new MemoryStorageAdapter(),
      coldPlugins: props.plugins,
      nodeRegistry: registry,
      seedDefault: props.seed,
    })
    hostRef.value = host
    apiRef.value = api
    if (props.windowKey) exposeToWindow(props.windowKey)

    // 订阅 store 变化自动刷渲染态
    unsubStore = host.nodeStore.subscribe(syncFromStore)

    // 主题 + nodeTypes 装配
    applyTheme()

    // 初始灌入：seed/restore 发生在 subscribe 建立之前(createMiniCanvasHost 内部)，
    // 不会触发回调，这里主动同步一次把当前 store 节点渲染出来。
    syncFromStore()
    syncUiOverlay()

    // 订阅插件热装/热卸：重装配主题与 nodeTypes + 重读 overlay 槽 + bump epoch 触发 VueFlow 重挂
    subs.push(
      host.ctx.on('ctx:plugin-installed', () => {
        applyTheme()
        syncUiOverlay()
        nodeEpoch.value += 1
      }),
      host.ctx.on('ctx:plugin-uninstalled', () => {
        applyTheme()
        syncUiOverlay()
        nodeEpoch.value += 1
      }),
    )

    // 键盘
    window.addEventListener('keydown', onKeydown)
    keydownBound = true

    // 页面隐藏/离开落盘
    window.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', flushSave)

    booting.value = false
    emit('ready', host)
  } catch (err) {
    bootError.value = err instanceof Error ? err.message : String(err)
    booting.value = false
    emit('boot-error', err instanceof Error ? err : new Error(String(err)))
  }
})

function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') flushSave()
}
function flushSave(): void {
  const h = hostRef.value
  if (h?.save.isDirty()) void h.save.flush()
}

// 暴露给父级：boot 后拿 host/api 驱动业务(建节点/撤销/读 nodeStore 等)，拿 ready 判断是否可用。
// 父级经 ref 拿实例：`const c = ref(); c.value.host` / `c.value.host?.command.execute(...)`。
defineExpose({
  get host(): CanvasHostHandle | undefined {
    return hostRef.value
  },
  get api(): MiniCanvasApi | undefined {
    return apiRef.value
  },
  get ready(): boolean {
    return !booting.value && !bootError.value
  },
  get bootErrorText(): string {
    return bootError.value
  },
})

onBeforeUnmount(() => {
  unsubStore?.()
  for (const s of subs) s.dispose()
  if (keydownBound) window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('visibilitychange', onVisibilityChange)
  window.removeEventListener('pagehide', flushSave)
  void hostRef.value?.save.flush()
  hostRef.value?.stop()
})
</script>

<template>
  <div class="chost">
    <div v-if="booting" class="chost-status">正在启动内核…</div>
    <div v-else-if="bootError" class="chost-status chost-err">启动失败：{{ bootError }}</div>

    <div v-else class="chost-canvas">
      <VueFlow
        :key="nodeEpoch"
        :nodes="nodes"
        :edges="edges"
        :node-types="nodeTypes"
        :edge-types="edgeTypes"
        :is-valid-connection="isValidConnection"
        :min-zoom="props.minZoom"
        :max-zoom="props.maxZoom"
        @connect="onConnect"
        @node-click="onNodeClick"
        @node-drag-stop="onNodeDragStop"
        @pane-click="onPaneClick"
        @node-context-menu="onNodeContextMenu"
        @pane-context-menu="onPaneContextMenu"
      >
        <!-- 主题插件提供的画布背景（垫在节点之下）；未提供则空 -->
        <component :is="backgroundComp" v-if="backgroundComp" />
        <!-- 父级可经默认插槽往 VueFlow 内塞自定义背景/控件 -->
        <slot />
      </VueFlow>

      <!-- 通用 UI 槽(overlay)：插件塞的浮层控件按 order 顺序同屏叠在画布之上(Goal A 渲染) -->
      <div v-if="uiOverlay.length" class="chost-overlay">
        <component
          v-for="oc in uiOverlay"
          :key="oc.id"
          :is="oc.component"
          class="chost-overlay-item"
          :data-slot-order="oc.order"
          :data-slot-id="oc.id"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.chost {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}
.chost-status {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6b7280;
}
.chost-status.chost-err {
  color: #dc2626;
}
.chost-canvas {
  flex: 1;
  position: relative;
  min-height: 0;
}
.chost-canvas :deep(.vue-flow__node) {
  /* 节点卡片外观由主题 nodeShell(如 BaseNode 的 .v2-card)统一负责；这里只留布局与光标 */
  font-size: 14px;
  background: transparent;
  border: none;
  box-shadow: none;
}
.chost-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none; /* 不挡画布交互；浮层控件自己开 pointer-events 才能点 */
  z-index: 20;
  overflow: hidden;
}
.chost-overlay-item {
  pointer-events: auto;
}
</style>
