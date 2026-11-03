<script setup lang="ts">
/**
 * SelectionFrame —— 多选群组框（对齐老版 multi-select/SelectionFrame.vue 的"小框 + 大框"）。
 *
 * 入口只负责组合：双框、批量端口、控制栏、引导线与各类监听都由同目录子件/hooks 拆出。
 * 这里保留原组件名、模板根结构与 `inheritAttrs: false`，不对执行逻辑做优化。
 */
import { computed, onBeforeUnmount } from 'vue'
import { pointerDown, bindPointerPressWatchers } from './pointerPress'
import { resolveBatchHandleVisible } from './multiSelectEngine'
import { useGroupDrag } from './selection-frame/useGroupDrag'
import { useSelectionFrame } from './selection-frame/useSelectionFrame'
import { useBatchConnect, useBatchHandleGeometry } from './selection-frame/useBatchConnect'
import { useToolbarAnchor } from './selection-frame/useToolbarAnchor'
import { useWheelPassthrough } from './selection-frame/useWheelPassthrough'
import { useFrameCapture } from './selection-frame/useFrameCapture'
import SelectionBox from './selection-frame/SelectionBox.vue'
import SelectionToolbar from './selection-frame/SelectionToolbar.vue'
import SelectionBatchHandles from './selection-frame/SelectionBatchHandles.vue'
import SelectionBatchGuide from './selection-frame/SelectionBatchGuide.vue'

defineOptions({ inheritAttrs: false })

const frameState = useSelectionFrame()
const {
  drag,
  ctx,
  viewport,
  pane,
  rootEl,
  sel,
  layout,
  graph,
  edgeStore,
  nodeStore,
  frame,
  frameConfig,
  isVisible,
  wrapperStyle,
  outerStyle,
  innerStyle,
  showInner,
  isDragging,
  nodeDragging,
  dragStartUnion,
  dragDelta,
  lastClient,
  dragFrameGeometry,
  refreshFrame,
  screenToFlowPoint,
  pointInRect,
  hitsAnyNode,
  stopFrameTracking,
  handleParams,
  connectionState,
  snapZone,
  updateNodeVisual,
} = frameState

const dragController = useGroupDrag({
  ctx,
  viewport,
  sel,
  layout,
  nodeStore,
  graph,
  frame,
  isDragging,
  dragStartUnion,
  dragDelta,
  lastClient,
  dragStartPositions: drag.dragStartPositions,
  livePositions: drag.livePositions,
  updateNodeVisual,
  dragFrameGeometry,
  refreshFrame,
  pointInRect,
  hitsAnyNode,
  screenToFlowPoint,
})

const batch = useBatchConnect({
  sel,
  layout,
  nodeStore,
  edgeStore,
  graph,
  screenToFlowPoint,
  pane,
  viewport,
  handleParams,
  connectionState,
  snapZone,
})
const { portZoneWidth, portZoneHeight, portZoneOffset, portZoneShape, portZoneArcRatio } =
  useBatchHandleGeometry({ sel, layout, frame, handleParams })
const toolbar = useToolbarAnchor({ ctx, viewport, flow: frameState.flow, frame })
const { wrapperRef } = useWheelPassthrough(pane)
useFrameCapture({
  rootEl,
  onPaneCaptureDown: dragController.onPaneCaptureDown,
  onOwnerCaptureClick: dragController.onOwnerCaptureClick,
})

const pointerPressed = pointerDown
bindPointerPressWatchers()
const showBatchHandles = computed(() =>
  resolveBatchHandleVisible({
    visible: isVisible.value,
    pressed: pointerPressed.value,
    groupDragging: isDragging.value,
    nodeDragging: nodeDragging.value,
  }),
)

onBeforeUnmount(() => {
  stopFrameTracking()
  dragController.stopGroupDrag()
  window.removeEventListener('pointermove', batch.onBatchMove)
  window.removeEventListener('pointerup', batch.onBatchUp)
})
</script>

<template>
  <div
    v-if="isVisible"
    ref="wrapperRef"
    class="selection-frame-wrapper"
    :class="{ 'is-node-dragging': nodeDragging || isDragging || pointerPressed }"
    :style="wrapperStyle"
  >
    <SelectionBox :outer-style="outerStyle" :inner-style="innerStyle" :show-inner="showInner" />
    <SelectionToolbar
      :toolbar-anchor-style="toolbar.toolbarAnchorStyle"
      :top-regions="toolbar.topRegions"
      :bottom-regions="toolbar.bottomRegions"
      :top-regions-style="toolbar.topRegionsStyle"
      :bottom-regions-style="toolbar.bottomRegionsStyle"
      :top-clamp-style="toolbar.topClampStyle"
      :bottom-clamp-style="toolbar.bottomClampStyle"
      :selection-capability-cache="toolbar.selectionCapabilityCache"
      :is-dev="ctx.isDev === true"
    />
    <SelectionBatchHandles
      :outer="frame?.outer ?? null"
      :handle-params="handleParams"
      :port-zone-width="portZoneWidth"
      :port-zone-height="portZoneHeight"
      :port-zone-offset="portZoneOffset"
      :port-zone-shape="portZoneShape"
      :port-zone-arc-ratio="portZoneArcRatio"
      :show="showBatchHandles"
      :on-start="batch.onBatchConnectStart"
    />
  </div>
  <SelectionBatchGuide :guide-lines="batch.guideLines.value" :batch-side="batch.batchSide.value" />
</template>

<style scoped>
.selection-frame-wrapper {
  position: absolute;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  pointer-events: none;
  z-index: 5;
  overflow: visible;
}

.selection-frame-wrapper.is-node-dragging .selection-frame-batch-slot {
  display: none !important;
}

body.mc-pointer-down .selection-frame-batch-slot {
  display: none !important;
}

.vue-flow:has(.vue-flow__node.dragging) .selection-frame-batch-slot {
  display: none !important;
}
</style>
