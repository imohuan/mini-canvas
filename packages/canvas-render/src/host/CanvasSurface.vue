<script setup lang="ts">
// CanvasSurface —— CanvasHost 的「渲染子树宿主」：boot 完成后才挂载，向子树 provide 裸渲染上下文。
//
// 为什么单独一个组件：CanvasHost 自身在 setup 期就要 provide（那时 ctx 还没建好，只能给 Ref 盒子），
// 导致渲染组件拿 ctx 要 .value + 判空。本组件在 boot 完成(booting=false)后才由 CanvasHost 以 v-else 挂载，
// 其 setup 执行时 props.host 已就绪 —— 所以它能 provide **裸 ctx / 裸 host**，消费组件直接
// `useCanvasRender().ctx.get('nodeStore')`，零 value 零判空。
//
// 职责边界（只管「渲染 + provide 裸上下文」）：
// - 接收 CanvasHost 传入的已就绪数据(host/registry/外观/渲染态)与交互回调，原样转发给 VueFlow。
// - provide RENDER_CONTEXT_KEY(裸) 与旧 6 个 *_KEY(同引用，兼容未迁移组件)。
// - 不持有业务逻辑：所有 handler/订阅/生命周期仍在 CanvasHost，经 props 传入，避免状态双份。
import { provide, shallowRef, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import type { Connection, NodeMouseEvent, NodeDragEvent, EdgeMouseEvent } from '@vue-flow/core'
import type { CanvasHostHandle } from './createMiniCanvasHost'
import type { NodeRegistry } from '@mini-canvas/canvas-core-v2'
import type { NodeWrite } from '../contracts/nodeRegistryKey'
import { NODE_REGISTRY_KEY, NODE_WRITE_KEY } from '../contracts/nodeRegistryKey'
import type { CanvasParams } from '../contracts/canvasParamKey'
import { CANVAS_PARAMS_KEY } from '../contracts/canvasParamKey'
import { HOST_KEY } from '../contracts/contentBridge'
import type { EdgeVisual, EdgeSelection } from '../contracts/edgeContext'
import { EDGE_VISUAL_KEY, EDGE_SELECTION_KEY } from '../contracts/edgeContext'
import type { ConnectionFeedbackState } from '../contracts/connectionContext'
import type { CanvasInteractionState } from '../contracts/interactionContext'
import type { CanvasRenderContext } from '../contracts/renderContext'
import { RENDER_CONTEXT_KEY } from '../contracts/renderContext'
import type { FlowNode } from './canvasHostCore'
import type { ViewportState } from '../viewport/viewportService'
import type { CanvasDebug } from '../contracts/debugContext'
import type { SnapZoneConfig } from '../connection/geometry'
import SlotHost from '../components/SlotHost.vue'
import ConnectionLineHost from './ConnectionLineHost.vue'
import { useNodeMeasure } from './useNodeMeasure'

const props = defineProps<{
  /** boot 后已就绪的宿主句柄。模板类型上可为空(父级 v-else 保证 boot 完成才挂载本组件)，
   *  setup 里空则抛错，实际不会触发。 */
  host?: CanvasHostHandle | undefined
  registry: NodeRegistry
  nodeWrite: NodeWrite
  handleParams: CanvasParams
  edgeVisual: Partial<EdgeVisual>
  edgeSelection: EdgeSelection
  connectionState: ConnectionFeedbackState
  /** 画布交互状态（CanvasHost 维护；塞进 renderCtx 供 theme/UI 消费显隐/行为） */
  interaction: CanvasInteractionState
  /** Host 端 mousemove 实时写的 flow 坐标（VueFlow lineProps 不可靠时由这里驱动连接线端点）。可空（拖线外时段）。 */
  dragFlowPoint?: { x: number; y: number } | null
  debugVisual: CanvasDebug
  /** 吸附带配置（响应式对象，属性改实时影响吸附判定 + BaseNode 调试叠加） */
  snapZone: SnapZoneConfig
  // —— VueFlow 渲染态数据（CanvasHost 订阅 store 持续更新，经 ref 解包成裸数组传入）——
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nodes: any[]
  edges: Array<{ id: string; type: string; source: string; target: string }>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nodeTypes: Record<string, any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  edgeTypes: Record<string, any>
  backgroundComp: unknown
  /** 拖线临时连接线组件（connectionLine 槽赢家；undefined → ConnectionLineHost 回退默认线） */
  connectionLineComp: unknown
  /** 插件变更后 bump → 给 VueFlow 加 key 强制重挂 */
  nodeEpoch: number
  minZoom: number
  maxZoom: number
  // —— VueFlow 交互回调（均在 CanvasHost 持有，引用其 refs）——
  isValidConnection: (conn: Connection) => boolean
  onConnect: (conn: Connection) => void
  onConnectStart: (p: { nodeId?: string; handleId: string | null; handleType?: 'source' | 'target' }) => void
  onConnectEnd: () => void
  onNodeClick: (e: NodeMouseEvent) => void
  onEdgeClick: (e: EdgeMouseEvent) => void
  onNodeDrag: (e: NodeDragEvent) => void
  onNodeDragStart: (e: NodeDragEvent) => void
  onNodeDragStop: (e: NodeDragEvent) => void
  onMoveStart: () => void
  onMoveEnd: () => void
  onPaneClick: () => void
  onSelectionStart: () => void
  onSelectionEnd: () => void
  onNodeContextMenu: (e: NodeMouseEvent) => void
  onPaneContextMenu: (e: MouseEvent) => void
}>()

// ==================== provide 裸渲染上下文（本组件 boot 后才挂载 → ctx/host 已就绪，全是裸值） ====================
const host = props.host
if (!host) {
  // 父级 v-else 保证 boot 完成才挂载本组件，正常不会走到；防御性报错以免渲染子树拿到空宿主。
  throw new Error('[CanvasSurface] 宿主未就绪：CanvasSurface 仅应在 boot 完成后挂载')
}
// VueFlow 实例（viewport/screen-flow/flow-screen 等视图能力的来源；在 provide renderCtx 前拿到）
const vfApi = useVueFlow()

// —— 只读数据源 refs（供 renderCtx 暴露给插件；宿主/本组件维护，插件只读）——
// 渲染态节点/边：随 props.nodes/edges(宿主订阅 store 自动重灌)同步，包成稳定 ref 供上下文消费方响应式读
const renderNodesRef = shallowRef<ReadonlyArray<FlowNode>>(props.nodes ?? [])
const renderEdgesRef = shallowRef<ReadonlyArray<{ id: string; type: string; source: string; target: string }>>(props.edges ?? [])
watch(
  () => props.nodes,
  (v) => { renderNodesRef.value = v ?? [] },
)
watch(
  () => props.edges,
  (v) => { renderEdgesRef.value = v ?? [] },
)
// 视口变换：跟随 VueFlow viewport（响应式 computed）
const viewportRef = shallowRef<ViewportState>({ x: 0, y: 0, zoom: 1 })
watch(
  () => (vfApi.viewport as unknown as { value?: ViewportState })?.value,
  (v) => { if (v) viewportRef.value = { x: v.x, y: v.y, zoom: v.zoom } },
  { immediate: true },
)
// pane DOM 矩形：onMounted 后填（见下方 paneEl 捕获）；move 事件经 CanvasHost 已桥，这里 watch viewport 变化时刷新
const paneRectRef = shallowRef<DOMRect | null>(null)

/** 屏幕 client → flow（官方换算，可靠） */
function screenToFlow(clientX: number, clientY: number): { x: number; y: number } {
  const p = vfApi.screenToFlowCoordinate({ x: clientX, y: clientY }) as { x: number; y: number }
  return { x: p.x, y: p.y }
}
/** flow → 屏幕 client（官方换算） */
function flowToScreen(flowX: number, flowY: number): { x: number; y: number } {
  const p = vfApi.flowToScreenCoordinate({ x: flowX, y: flowY }) as { x: number; y: number }
  return { x: p.x, y: p.y }
}

const renderCtx: CanvasRenderContext = {
  ctx: host.ctx,
  host,
  registry: props.registry,
  nodeWrite: props.nodeWrite,
  handleParams: props.handleParams,
  edgeVisual: props.edgeVisual,
  edgeSelection: props.edgeSelection,
  connectionState: props.connectionState,
  interaction: props.interaction,
  debug: props.debugVisual,
  snapZone: props.snapZone,
  viewport: viewportRef,
  paneRect: paneRectRef,
  renderNodes: renderNodesRef,
  renderEdges: renderEdgesRef,
  screenToFlow,
  flowToScreen,
}
provide(RENDER_CONTEXT_KEY, renderCtx)

// 旧 *_KEY 兼容：仍逐个 provide。HOST_KEY 历史上是 Ref 形态，这里包成稳定 ref 以兼容旧消费方。
provide(NODE_REGISTRY_KEY, props.registry)
provide(NODE_WRITE_KEY, props.nodeWrite)
provide(CANVAS_PARAMS_KEY, props.handleParams)
provide(EDGE_VISUAL_KEY, props.edgeVisual)
provide(EDGE_SELECTION_KEY, props.edgeSelection)
provide(HOST_KEY, shallowRef(host))

// 节点实测尺寸注入 nodeLayout（ResizeObserver + MutationObserver）；start 在 onMounted 内（renderer DOM 就绪后）
const measure = useNodeMeasure({
  nodeLayout: host.nodeLayout,
  container: () => document.querySelector('.vue-flow__renderer') as HTMLElement | null,
})
onBeforeUnmount(() => {
  measure.stop()
})
const paneEl = ref<HTMLElement | null>(null)
onMounted(() => {
  // VueFlow 渲染后 .vue-flow__pane 已在 DOM，捕获以量屏幕坐标
  paneEl.value = document.querySelector('.vue-flow__pane') as HTMLElement | null
  paneRectRef.value = paneEl.value ? paneEl.value.getBoundingClientRect() : null
  // 视口服务接线：把 VueFlow 能力 attach 到 host.viewport（工厂注入的空壳），插件可 ctx.get('viewport')
  props.host?.viewport.attachBackend({
    getViewport: () => {
      const vp = (vfApi.viewport as unknown as { value?: { x: number; y: number; zoom: number } }).value
      return vp ? { x: vp.x, y: vp.y, zoom: vp.zoom } : { x: 0, y: 0, zoom: 1 }
    },
    screenToFlow: (x: number, y: number) => {
      const p = vfApi.screenToFlowCoordinate({ x, y }) as { x: number; y: number }
      return { x: p.x, y: p.y }
    },
    flowToScreen: (x: number, y: number) => {
      // 用 VueFlow 官方 flowToScreenCoordinate（处理 dom 偏移 + viewport transform），避免手算公式出错
      const p = vfApi.flowToScreenCoordinate({ x, y }) as { x: number; y: number }
      return { x: p.x, y: p.y }
    },
    zoomIn: () => vfApi.zoomIn({ duration: 200 }),
    zoomOut: () => vfApi.zoomOut({ duration: 200 }),
    zoomTo: (level: number) => vfApi.zoomTo(level, { duration: 200 }),
    fitView: (padding?: number) => vfApi.fitView({ padding: padding ?? 0.1, duration: 200 }),
    setCenter: (x: number, y: number, zoom?: number) =>
      vfApi.setCenter(x, y, zoom !== undefined ? { zoom, duration: 200 } : { duration: 200 }),
    setViewport: (v: { x: number; y: number; zoom: number }) => vfApi.setViewport(v, { duration: 200 }),
  })
  // renderer DOM 就绪后启动节点尺寸观测（在 onMounted 内，容器已挂载）
  measure.start()
})

// expose 给父：父级拖线时用 VueFlow 自带的 screenToFlowCoordinate（已处理 zoom/pan + pane 偏移，
// 比手算 rect.left / zoom 准）。paneRect 也一并暴露，兜底用。
defineExpose({
  getViewport: () => {
    const vp = (vfApi.viewport as unknown as { value?: { x: number; y: number; zoom: number } }).value
    return vp
      ? { x: vp.x, y: vp.y, zoom: vp.zoom }
      : (vfApi.viewport as unknown as { x: number; y: number; zoom: number })
  },
  getPaneRect: (): DOMRect | null => (paneEl.value ? paneEl.value.getBoundingClientRect() : null),
  /** 当前被 VueFlow 选中的节点 id（框选/多选后读；供宿主回写内核） */
  getSelectedNodeIds: () => (vfApi.getSelectedNodes.value ?? []).map((n) => n.id),
  /** 当前选中节点的最新位置（多选拖动落盘用：VueFlow 已把位移应用到全部选中节点） */
  getSelectedNodePositions: () =>
    (vfApi.getSelectedNodes.value ?? []).map((n) => ({ id: n.id, x: n.position.x, y: n.position.y })),
  /** 当前被 VueFlow 选中的边 id */
  getSelectedEdgeIds: () => (vfApi.getSelectedEdges.value ?? []).map((e) => e.id),
  /** 把屏幕坐标(clientX/Y)→flow 坐标，由 VueFlow 自身处理（缩放/平移完全可靠） */
  screenToFlow: (x: number, y: number): { x: number; y: number } => {
    const p = vfApi.screenToFlowCoordinate({ x, y }) as { x: number; y: number }
    return { x: p.x, y: p.y }
  },
  /** 把 flow 坐标→屏幕 client 坐标（供浮层定位/对齐线画在屏幕层） */
  flowToScreen: (x: number, y: number): { x: number; y: number } => {
    const p = vfApi.flowToScreenCoordinate({ x, y }) as { x: number; y: number }
    return { x: p.x, y: p.y }
  },
  // —— 视图控制（viewport 服务 backend 用）——
  zoomIn: () => vfApi.zoomIn({ duration: 200 }),
  zoomOut: () => vfApi.zoomOut({ duration: 200 }),
  zoomTo: (level: number) => vfApi.zoomTo(level, { duration: 200 }),
  fitView: (padding?: number) => vfApi.fitView({ padding: padding ?? 0.1, duration: 200 }),
  setCenter: (x: number, y: number, zoom?: number) =>
    vfApi.setCenter(x, y, zoom !== undefined ? { zoom, duration: 200 } : { duration: 200 }),
  setViewport: (v: { x: number; y: number; zoom: number }) => vfApi.setViewport(v, { duration: 200 }),
})
</script>

<template>
  <div class="csurface">
    <VueFlow
      :key="nodeEpoch"
      :nodes="nodes"
      :edges="edges"
      :node-types="nodeTypes"
      :edge-types="edgeTypes"
      :is-valid-connection="isValidConnection"
      :min-zoom="minZoom"
      :max-zoom="maxZoom"
      @connect="onConnect"
      @connect-start="onConnectStart"
      @connect-end="onConnectEnd"
      @node-click="onNodeClick"
      @edge-click="onEdgeClick"
      @node-drag="onNodeDrag"
      @node-drag-start="onNodeDragStart"
      @node-drag-stop="onNodeDragStop"
      @move-start="onMoveStart"
      @move-end="onMoveEnd"
      @pane-click="onPaneClick"
      @selection-start="onSelectionStart"
      @selection-end="onSelectionEnd"
      @node-context-menu="onNodeContextMenu"
      @pane-context-menu="onPaneContextMenu"
    >
      <!-- 主题插件提供的画布背景（垫在节点之下）；未提供则空 -->
      <component :is="backgroundComp" v-if="backgroundComp" />
      <!-- 拖线临时连接线：能力层每帧算吸附/反馈并写 connectionState，渲染主题 connectionLine 赢家或回退默认线 -->
      <template #connection-line="lineProps">
        <ConnectionLineHost
          :line-props="lineProps"
          :connection-line="connectionLineComp"
          :state="connectionState"
          :drag-flow-point="dragFlowPoint ?? null"
        />
      </template>
      <!-- 父级可经默认插槽往 VueFlow 内塞自定义背景/控件 -->
      <slot />
    </VueFlow>

    <!-- 通用 UI 槽(overlay)：渲染层封装成 SlotHost，自动读 ctx.slots.occupants('overlay') 并按序渲染 -->
    <div class="csurface-overlay">
      <SlotHost slot="overlay" item-class="csurface-overlay-item" />
    </div>

    <!-- 宿主业务 UI 区(#ui)：宿主把 toolbar/设置 dock/右键菜单等画布之上的 UI 放这里，即可经 useCanvasRender 读 ctx。
         SlotHost / SettingsHost 在本作用域内任意嵌套可用。CanvasHost 不内置任何业务 UI，只把具名插槽转发到这里。 -->
    <slot name="ui" />
  </div>
</template>

<style scoped>
.csurface {
  position: relative;
  width: 100%;
  height: 100%;
}
.csurface :deep(.vue-flow__node) {
  /* 节点卡片外观由主题 nodeShell(如 BaseNode 的 .v2-card)统一负责；这里只留布局与光标 */
  font-size: 14px;
  background: transparent;
  border: none;
  box-shadow: none;
}
.csurface-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none; /* 不挡画布交互；浮层控件自己开 pointer-events 才能点 */
  z-index: 20;
  overflow: hidden;
}
</style>

<style>
/* 浮层里的 occupant(由 SlotHost 渲染)要能点：容器 pointer-events:none，item 恢复 auto。
   放全局(非 scoped)是因为 item 元素由 SlotHost(子组件)渲染，scoped 选择器够不到。 */
.csurface-overlay .csurface-overlay-item {
  pointer-events: auto;
}
</style>

