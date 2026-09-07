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
 * AlignGuideOverlay —— 对齐辅助线浮层（注册进 overlay 槽，宿主 CanvasSurface 已渲染该槽）。
 *
 * 职责：订阅渲染层拖拽事件（canvas:node:drag-start / drag / drag-end），
 * 拖拽帧里用 alignGuideEngine 算吸附与参考线：
 * - 有吸附位移 → 调 useCanvasRender().updateNodeVisual 写 VueFlow 内部节点视觉位置（不落盘、不整组重灌）；
 * - 把参考线画在本层（overlay 与 VueFlow pane 同原点，用 v1 公式 flow*zoom+viewport 换算屏幕 px）。
 * 拖拽结束清线。纯渲染/订阅职责，引擎在 alignGuideEngine.ts（可单测）。
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { useCanvasRender, RenderEvents, type NodeLayoutService } from '@mini-canvas/canvas-render'
import { computeAlignGuides } from './alignGuideEngine'

const { ctx, viewport, updateNodeVisual } = useCanvasRender()

/** 当前要画的参考线（拖拽帧更新；垂直/水平各至多一条） */
const vGuide = ref<number | null>(null)
const hGuide = ref<number | null>(null)
/** 屏幕像素：flow 参考线位置 → overlay 层内 px（v1 公式：pos*zoom + viewport.x/y） */
const vScreen = computed(() => (vGuide.value !== null ? vGuide.value * viewport.value.zoom + viewport.value.x : 0))
const hScreen = computed(() => (hGuide.value !== null ? hGuide.value * viewport.value.zoom + viewport.value.y : 0))

/** 计算并应用吸附 + 更新参考线（单次 drag 事件；宿主已 rAF 节流，无需再节流） */
function handleDragFrame(nodeId: string, position: { x: number; y: number }): void {
  const layout = ctx.get<NodeLayoutService>('nodeLayout')
  if (!layout) return
  // 被拖节点当前矩形：事件给的是 VueFlow 实时 position（flow 绝对坐标）；尺寸走 nodeLayout 实测/声明
  const size = layout.nodeSize(nodeId)
  if (size.w <= 0 || size.h <= 0) return
  const dragged = { id: nodeId, x: position.x, y: position.y, w: size.w, h: size.h }
  // 其它存活节点矩形（绝对坐标+实测尺寸）；先排除被拖节点自身
  const others = layout.getAllRects().filter((r) => r.id !== nodeId)
  const { deltaX, deltaY, guides } = computeAlignGuides(dragged, others)
  // 有吸附位移 → 写 VueFlow 内部节点视觉位置（不触发 store/整组重灌；dragEnd 宿主统一落盘）
  if (deltaX !== 0 || deltaY !== 0) {
    updateNodeVisual(nodeId, { x: position.x + deltaX, y: position.y + deltaY })
  }
  const v = guides.find((g) => g.type === 'vertical')
  const h = guides.find((g) => g.type === 'horizontal')
  vGuide.value = v ? v.position : null
  hGuide.value = h ? h.position : null
}

function handleDragEnd(): void {
  vGuide.value = null
  hGuide.value = null
}

// 订阅渲染层拖拽事件（ctx 同一 bus；组件随宿主 overlay 槽卸载自动清理）
const disposers: Array<{ dispose(): void }> = []
disposers.push(
  ctx.on(RenderEvents.NodeDragStart, (payload: { nodeId: string; position: { x: number; y: number } }) => {
    // 拖拽开始：重置上一会话残留参考线（拖拽期间以 NodeDrag 帧为准）
    vGuide.value = null
    hGuide.value = null
  }),
  ctx.on(RenderEvents.NodeDrag, (payload: { nodeId: string; position: { x: number; y: number } }) => {
    handleDragFrame(payload.nodeId, payload.position)
  }),
  ctx.on(RenderEvents.NodeDragEnd, () => handleDragEnd()),
  // 视口变化不迁移参考线层（overlay 层不动）；但缩放时换算已用响应式 viewport，无需额外处理
)

onBeforeUnmount(() => {
  for (const d of disposers) d.dispose()
})
</script>

<style scoped>
.align-guide-layer {
  position: absolute;
  inset: 0;
  pointer-events: none; /* 参考线不挡画布交互 */
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
