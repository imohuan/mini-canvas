<script setup lang="ts">
/**
 * CanvasHost —— 官方**画布渲染**组件：把 VueFlow 装配/数据同步/通用交互全部收进内部，调用方一行渲染。
 *
 * 解决的问题（见 docs/plan/canvas-host-component-plan.md）：CanvasDemo.vue 那套手写装配(~340行)散落在各 demo，
 * 每个宿主都要重复 provide 令牌 + 自己 mount VueFlow + store↔flow 双向同步。本组件把这些收编并藏起来。
 *
 * 职责边界：
 * - **不启动内核**：内核由外层 <CanvasProvider> 建好并提供 ctx/host；
 *   本组件只消费基础上下文，订阅 nodeStore 变化自动重灌渲染态。
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
 * 模板结构：本组件占满父容器高度(定位 100%)，内部是准备态/错误态 + canvas-wrap(VueFlow+主题背景)。
 * 父级想加自己的 toolbar/面板，在本组件外层套一层 flex 布局即可。
 *
 * 拆分说明：具体状态与事件处理在 ./canvas-host/ 的 hooks，本文件只做装配接线。
 */
import { reactive, ref, shallowRef } from 'vue'
import type { CanvasHostHandle } from './createMiniCanvasHost'
import type { CanvasHostEmits, CanvasHostRenderProps } from './canvasHostTypes'
import { useCanvasContext } from '../contracts/canvasContext'
import { resolveCanvasInteraction, type CanvasInteractionSettings } from '../contracts/canvasInteractionSettings'
import { createInteractionState } from '../contracts/interactionContext'
import { createV2Logger } from '../utils/log'
import CanvasSurface from './CanvasSurface.vue'
import { useCanvasCulling } from './canvas-host/useCanvasCulling'
import { useCanvasLayer } from './canvas-host/useCanvasLayer'
import { useCanvasRenderState } from './canvas-host/useCanvasRenderState'
import { useCanvasTheme } from './canvas-host/useCanvasTheme'
import { useCanvasViewport } from './canvas-host/useCanvasViewport'
import { useCanvasViewportMove } from './canvas-host/useCanvasViewportMove'
import { useCanvasSelection } from './canvas-host/useCanvasSelection'
import { useCanvasNodeDrag } from './canvas-host/useCanvasNodeDrag'
import { useCanvasConnections } from './canvas-host/useCanvasConnections'
import { useCanvasKeyboard } from './canvas-host/useCanvasKeyboard'
import { useCanvasClipboard } from './canvas-host/useCanvasClipboard'
import { useCanvasContextMenu } from './canvas-host/useCanvasContextMenu'
import { useCanvasSave } from './canvas-host/useCanvasSave'
import { useCanvasLifecycle } from './canvas-host/useCanvasLifecycle'
import type { CanvasSurfaceHandle } from './canvas-host/types'

const log = createV2Logger('canvas-host')

// ==================== props / emits ====================

const props = withDefaults(defineProps<CanvasHostRenderProps>(), {
  persistViewport: true,
})

const emit = defineEmits<CanvasHostEmits>()

// ==================== 基础上下文 / 内层准备状态 ====================

/** 由外层 CanvasProvider 建好的唯一宿主；本组件只消费，不负责创建/停止。 */
const { host, api, manager } = useCanvasContext()
const hostRef = shallowRef<CanvasHostHandle>(host)

/** 内层准备状态：订阅/监听接好、CanvasSurface 可以挂载了。 */
const surfaceReady = ref(false)
const mountError = ref('')
/** 内层 CanvasSurface ref（拖线 mousemove/mouseup 要从它拿 screenToFlow / viewport / pane） */
const surfaceRef = shallowRef<CanvasSurfaceHandle | undefined>()

// ==================== 渲染子树的装配数据（经 props 交给内层 CanvasSurface 统一 provide） ====================
// provide 点已移到 CanvasSurface（boot 完成后才挂载，故能 provide 裸 ctx/host）：
// 这里只负责**准备**渲染子树要用的数据与回调，不 provide。

// 节点展示注册表：由 Provider 建好的宿主持有；本组件只读取。
// 插件 setup 经 ctx.get('nodeRegistry') 把 content 组件注册进来；BaseNode(壳)经此解析 content 段。
const registry = host.nodeRegistry

const { nodeWrite, edgeVisualToProvide, handleToProvide, debugToProvide, snapZoneToProvide } = useCanvasLayer({
  hostRef,
  props,
})

// 画布交互配置（「常规/画布」）：boot 后从 settings 读初值 + 订阅实时更新（见 onMounted）。
// boot 前给默认值占位（CanvasSurface boot 完成才挂载，模板绑定时实际值已就绪）。
const interactionSettings = reactive<CanvasInteractionSettings>(resolveCanvasInteraction(() => undefined))

/** 画布交互状态（拖节点/pan/缩放等活动位 + 派生 isBusyDragging；CanvasSurface 塞进 renderCtx，theme/UI 消费）。
 *  A 决策：pan 与 wheel/pinch 缩放走 VueFlow 同一套 move 事件，不拆位——视图在动一律置 paneDragging
 *  (计入 isBusyDragging，端口被压)。zooming 位保留给未来需要细分"缩放手势"的场景。 */
const interaction = createInteractionState()

// ==================== 可见剔除 + 渲染态 ====================
const culling = useCanvasCulling({
  hostRef,
  surfaceRef,
  interactionSettings,
  isNodeDragging: () => interaction.activity.value.nodeDragging,
  syncNodesFromStore: () => syncNodesFromStore(),
})
const theme = useCanvasTheme(hostRef)
const renderState = useCanvasRenderState({
  hostRef,
  surfaceRef,
  cullIds: culling.cullIds,
  linkedIds: () => culling.linkedIds(),
  compactShellsEnabled: culling.compactShellsEnabled,
  edgeVisual: () => edgeVisualToProvide,
  pruneDragProtection: culling.pruneDragProtection,
  refreshCull: culling.refreshCull,
  rebuildLinkedIds: culling.rebuildLinkedIds,
  log,
})
const { nodes, edges, syncNodesFromStore, syncFromStore, dispose: disposeRenderState } = renderState

const selection = useCanvasSelection({ hostRef, syncFromStore })

const connections = useCanvasConnections({
  hostRef,
  surfaceRef,
  edges: () => edges.value,
  edgeDefaultType: () => theme.edgeDefaultType.value,
  log,
})

const nodeDrag = useCanvasNodeDrag({
  hostRef,
  surfaceRef,
  interaction,
  interactionSettings,
  primeDragProtection: culling.primeDragProtection,
  clearDragProtection: culling.clearDragProtection,
})

const viewport = useCanvasViewport({
  hostRef,
  surfaceRef,
  persistViewport: () => props.persistViewport,
})
const viewportMove = useCanvasViewportMove({
  hostRef,
  surfaceRef,
  interaction,
  persistViewport: () => props.persistViewport,
  persist: viewport.persistViewport,
  log,
})
const keyboard = useCanvasKeyboard({
  commands: () => hostRef.value?.ctx.tryGet<{ listCommands(): Array<{ id: string }>; runCommand(id: string): unknown }>('canvas'),
  executeContext: () => hostRef.value?.ctx,
  syncFromStore,
})
const clipboard = useCanvasClipboard({ hostRef, syncFromStore })
const contextMenu = useCanvasContextMenu({
  hostRef,
  clientToFlow: connections.clientToFlow,
  emitContextMenu: (payload) => emit('context-menu', payload),
})
const save = useCanvasSave({ hostRef })

// 视口恢复 watch 与原来一样在 setup 期建立（CanvasSurface 首帧挂载时触发一次）。
viewport.bindViewportRestore()

useCanvasLifecycle({
  host,
  hostRef,
  persistViewport: props.persistViewport,
  emitReady: (h) => emit('ready', h),
  emitPluginIssue: (payload) => emit('plugin-issue', payload),
  surfaceReady,
  mountError,
  interactionSettings,
  interaction,
  savedViewport: viewport.savedViewport,
  nodeEpoch: theme.nodeEpoch,
  syncFromStore,
  syncSelected: selection.syncSelected,
  applyTheme: theme.applyTheme,
  refreshCull: culling.refreshCull,
  rebuildLinkedIds: culling.rebuildLinkedIds,
  syncNodesFromStore,
  flushSave: save.flushSave,
  onVisibilityChange: save.onVisibilityChange,
  resetViewportMoveIfIdle: viewportMove.resetViewportMoveIfIdle,
  onKeydown: keyboard.onKeydown,
  onPaste: clipboard.onPaste,
  onCopy: clipboard.onCopy,
  onCut: clipboard.onCut,
  onGlobalPointerDown: connections.onGlobalPointerDown,
  edgeVisualToProvide,
  cleanup: {
    clearDragProtection: culling.clearDragProtection,
    disposeNodeDrag: nodeDrag.dispose,
    disposeRenderState,
    disposeViewport: viewport.dispose,
  },
})

// 暴露给父级：拿 host/api 驱动业务(建节点/撤销/读 nodeStore 等)，拿 ready 判断画布是否可交互。
// 启动成功/失败由外层 CanvasProvider 负责，这里只说“画布自己的订阅是否准备完毕”。
defineExpose({
  host,
  api,
  manager,
  get ready(): boolean {
    return surfaceReady.value && !mountError.value
  },
  get bootErrorText(): string {
    return mountError.value
  },
})
</script>

<template>
  <div class="chost">
    <div v-if="!surfaceReady" class="chost-status">正在准备画布…</div>
    <div v-else-if="mountError" class="chost-status chost-err">画布初始化失败：{{ mountError }}</div>

    <div v-else class="chost-canvas">
      <!-- 内层渲染子树宿主：订阅接好后挂载，向渲染组件 provide 裸 ctx/host（见 CanvasSurface.vue） -->
      <CanvasSurface
        ref="surfaceRef"
        :host="hostRef"
        :registry="registry"
        :node-write="nodeWrite"
        :handle-params="handleToProvide"
        :edge-visual="edgeVisualToProvide"
        :debug-visual="debugToProvide"
        :snap-zone="snapZoneToProvide"
        :edge-selection="selection.edgeSelection"
        :nodes="nodes"
        :edges="edges"
        :node-types="theme.nodeTypes.value"
        :edge-types="theme.edgeTypes.value"
        :background-comp="theme.backgroundComp.value"
        :connection-line-comp="theme.connectionLineComp.value"
        :node-epoch="theme.nodeEpoch.value"
        :interaction-settings="interactionSettings"
        :on-visible-rect-change="culling.onVisibleRectFrame"
        :is-valid-connection="connections.isValidConnection"
        :connection-state="connections.connectionState"
        :interaction="interaction"
        :drag-flow-point="connections.dragFlowPoint.value"
        :on-connect="connections.onConnect"
        :on-connect-start="connections.onConnectStart"
        :on-connect-end="connections.onConnectEnd"
        :validate-edge="connections.validateEdgeText"
        :on-node-click="selection.onNodeClick"
        :on-edge-click="selection.onEdgeClick"
        :on-node-drag="nodeDrag.onNodeDrag"
        :on-node-drag-start="nodeDrag.onNodeDragStart"
        :on-node-drag-stop="nodeDrag.onNodeDragStop"
        :on-move-start="viewportMove.onMoveStart"
        :on-move-end="viewportMove.onMoveEnd"
        :on-pane-click="selection.onPaneClick"
        :on-node-context-menu="contextMenu.onNodeContextMenu"
        :on-edge-context-menu="contextMenu.onEdgeContextMenu"
        :on-pane-context-menu="contextMenu.onPaneContextMenu"
      >
        <!-- 宿主业务 UI 区(#ui)：转发给 CanvasSurface，使宿主放在本组件 <template #ui> 里的 toolbar/设置 dock 等能经 useCanvasRender 读 ctx -->
        <template #ui>
          <slot name="ui" />
        </template>
        <!-- 父级默认插槽透传进 VueFlow（自定义背景/控件） -->
        <slot />
      </CanvasSurface>
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
  color: var(--ui-ink-dim, #6b7280);
}
.chost-status.chost-err {
  color: var(--ui-danger, #dc2626);
}
.chost-canvas {
  flex: 1;
  position: relative;
  min-height: 0;
}
</style>

