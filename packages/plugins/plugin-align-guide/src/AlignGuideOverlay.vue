<template>
  <div class="align-guide-layer" style="pointer-events: none">
    <div
      v-if="vGuide !== null"
      class="align-guide-line align-guide-vline"
      :style="{ transform: `translateX(${vScreen}px)` }"
    />
    <div
      v-if="hGuide !== null"
      class="align-guide-line align-guide-hline"
      :style="{ transform: `translateY(${hScreen}px)` }"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * AlignGuideOverlay -- reference-line floating layer (host CanvasSurface already renders this slot).
 *
 * 显隐生命周期（重做）：不再靠"window pointerup/blur + 无操作 150ms 定时器"猜拖拽何时结束
 * ——那套既会漏(某些终止被监听不到)，又会在拖拽中鼠标停顿 >150ms 时把线误清。
 * 改为以渲染层提供的权威拖拽状态 `interaction.isNodeDragging` 为门：
 *   线在"确实正在拖节点"期间持续存在(鼠标停下也不消失)，`nodeDragStop` 翻转该位→统一清线，
 *   拖拽结束的判定交给宿主(VueFlow nodeDragStart/nodeDragStop 驱动)，稳定可靠、不会残留。
 *
 * 主节点锁定：多选手势里 VueFlow 会为被拖的一组节点都发 NodeDrag 帧；吸附只对
 * 真正被鼠标抓住的"主节点"计算(NodeDragStart 锁定其 id，NodeDrag 帧 id 不同即忽略)，
 * 避免整组拖拽时线在成员节点间跳动/串扰。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useCanvasRender, RenderEvents, type NodeLayoutService } from '@mini-canvas/canvas-render'
import { computeAlignGuides } from './alignGuideEngine'

const { ctx, interaction, viewport, updateNodeVisual } = useCanvasRender()

const vGuide = ref<number | null>(null)
const hGuide = ref<number | null>(null)

/** 本次拖拽真正被鼠标抓住的"主节点"id；NodeDragStart 锁定，其它成员的帧忽略 */
let primaryId: string | null = null

function clearGuides(): void {
  primaryId = null
  vGuide.value = null
  hGuide.value = null
}

const vScreen = computed(() => (vGuide.value !== null ? vGuide.value * viewport.value.zoom + viewport.value.x : 0))
const hScreen = computed(() => (hGuide.value !== null ? hGuide.value * viewport.value.zoom + viewport.value.y : 0))

function handleDragFrame(nodeId: string, position: { x: number; y: number }): void {
  const layout = ctx.get<NodeLayoutService>('nodeLayout')
  if (!layout) return
  const size = layout.nodeSize(nodeId)
  if (size.w <= 0 || size.h <= 0) return
  const dragged = { id: nodeId, x: position.x, y: position.y, w: size.w, h: size.h }
  const others = layout.getAllRects().filter((r) => r.id !== nodeId)
  const { deltaX, deltaY, guides } = computeAlignGuides(dragged, others)
  if (deltaX !== 0 || deltaY !== 0) {
    updateNodeVisual(nodeId, { x: position.x + deltaX, y: position.y + deltaY })
  }
  const v = guides.find((g) => g.type === 'vertical')
  const h = guides.find((g) => g.type === 'horizontal')
  vGuide.value = v ? v.position : null
  hGuide.value = h ? h.position : null
}

const disposers: Array<{ dispose(): void }> = []
disposers.push(
  ctx.on(RenderEvents.NodeDragStart, (payload: { nodeId: string; position: { x: number; y: number } }) => {
    clearGuides()
    primaryId = payload.nodeId
  }),
  ctx.on(RenderEvents.NodeDrag, (payload: { nodeId: string; position: { x: number; y: number } }) => {
    // 只对主节点计算吸附与画线；被一起拖动的其它成员帧一律忽略，防线串扰
    if (primaryId === null || payload.nodeId !== primaryId) return
    handleDragFrame(primaryId, payload.position)
  })
)

// 拖拽结束的权威信号：宿主在 VueFlow nodeDragStop 翻转 isNodeDragging=false → 统一清线。
// 这比监听 window pointerup/cancel/blur 可靠（后者可能被吞），也比每帧等事件干净。
watch(interaction.isNodeDragging, (dragging) => {
  if (!dragging) clearGuides()
})

onBeforeUnmount(() => {
  for (const d of disposers) d.dispose()
})
</script>

<style scoped>
.align-guide-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}
.align-guide-line {
  position: absolute;
  top: 0;
  left: 0;
  background: rgba(99, 102, 241, 0.6);
  pointer-events: none;
}
.align-guide-vline {
  width: 1px;
  height: 100%;
}
.align-guide-hline {
  width: 100%;
  height: 1px;
}
</style>