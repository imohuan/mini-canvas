<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import type { EdgeProps } from '@vue-flow/core'
import { useCanvasStore } from '../composables/useCanvasStore'
type EdgeType = 'bezier' | 'straight' | 'step'
type PortSide = 'left' | 'right'

type CustomEdgePathOptions = {
  edgeType: EdgeType
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourceHandle?: string | null
  targetHandle?: string | null
  sourcePosition?: string | null
  targetPosition?: string | null
  temporaryTargetHandle?: boolean
}

function normalizePosition(position?: string | null): PortSide | null {
  const value = String(position || '').toLowerCase()
  if (value.includes('left')) return 'left'
  if (value.includes('right')) return 'right'
  return null
}

function getPortSide(handle?: string | null, position?: string | null): PortSide | null {
  if (handle === 'source') return 'right'
  if (handle === 'target') return 'left'
  return normalizePosition(position)
}

function getSideDirection(side: PortSide) {
  return side === 'right' ? 1 : -1
}

function getControlDistance(sourceX: number, targetX: number) {
  return Math.max(Math.abs(targetX - sourceX) * 0.5, 80)
}

function getEdgeGeometry(options: CustomEdgePathOptions) {
  const sourceSide = getPortSide(options.sourceHandle, options.sourcePosition) ?? 'right'
  const targetSide = options.temporaryTargetHandle
    ? (sourceSide === 'right' ? 'left' : 'right')
    : getPortSide(options.targetHandle, options.targetPosition) ?? 'left'
  const distance = getControlDistance(options.sourceX, options.targetX)

  return {
    sourceDirection: getSideDirection(sourceSide),
    targetDirection: getSideDirection(targetSide),
    distance,
  }
}

function buildCustomEdgePath(options: CustomEdgePathOptions) {
  const { edgeType, sourceX, sourceY, targetX, targetY } = options
  const { sourceDirection, targetDirection, distance } = getEdgeGeometry(options)

  switch (edgeType) {
    case 'straight':
      return `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`
    case 'step': {
      const sourceBendX = sourceX + sourceDirection * distance
      const targetBendX = targetX + targetDirection * distance
      const midX = (sourceBendX + targetBendX) / 2
      return `M ${sourceX} ${sourceY} L ${sourceBendX} ${sourceY} L ${midX} ${sourceY} L ${midX} ${targetY} L ${targetBendX} ${targetY} L ${targetX} ${targetY}`
    }
    case 'bezier':
    default: {
      const c1x = sourceX + sourceDirection * distance
      const c2x = targetX + targetDirection * distance
      return `M ${sourceX} ${sourceY} C ${c1x} ${sourceY}, ${c2x} ${targetY}, ${targetX} ${targetY}`
    }
  }
}

function sampleCustomEdgePath(t: number, options: CustomEdgePathOptions): { x: number; y: number } {
  const { edgeType, sourceX, sourceY, targetX, targetY } = options
  const { sourceDirection, targetDirection, distance } = getEdgeGeometry(options)

  switch (edgeType) {
    case 'straight':
      return {
        x: sourceX + (targetX - sourceX) * t,
        y: sourceY + (targetY - sourceY) * t,
      }
    case 'step': {
      const sourceBendX = sourceX + sourceDirection * distance
      const targetBendX = targetX + targetDirection * distance
      const midX = (sourceBendX + targetBendX) / 2
      const points = [
        { x: sourceX, y: sourceY },
        { x: sourceBendX, y: sourceY },
        { x: midX, y: sourceY },
        { x: midX, y: targetY },
        { x: targetBendX, y: targetY },
        { x: targetX, y: targetY },
      ]
      const segment = Math.min(points.length - 2, Math.floor(t * (points.length - 1)))
      const segmentStart = segment / (points.length - 1)
      const segmentT = (t - segmentStart) * (points.length - 1)
      const from = points[segment]
      const to = points[segment + 1]
      return {
        x: from.x + (to.x - from.x) * segmentT,
        y: from.y + (to.y - from.y) * segmentT,
      }
    }
    case 'bezier':
    default: {
      const c1x = sourceX + sourceDirection * distance
      const c2x = targetX + targetDirection * distance
      const mt = 1 - t
      return {
        x: mt ** 3 * sourceX + 3 * mt ** 2 * t * c1x + 3 * mt * t ** 2 * c2x + t ** 3 * targetX,
        y: mt ** 3 * sourceY + 3 * mt ** 2 * t * sourceY + 3 * mt * t ** 2 * targetY + t ** 3 * targetY,
      }
    }
  }
}

type CustomEdgeExtraProps = {
  temporary?: boolean
  forceFlow?: boolean
}

const props = defineProps<EdgeProps & CustomEdgeExtraProps>()
const { removeEdges } = useVueFlow()

const isTemporaryEdge = computed(() => Boolean(props.temporary || props.data?.isTemp))

// ---- 状态及配置 ----
const canvas = useCanvasStore()

const edgeType = computed(() => canvas.state.core.edgeType as 'bezier' | 'straight' | 'step' || 'bezier')
const lineWidth = computed(() => canvas.state.core.edgeLineWidth)
const edgeColor = computed(() => canvas.state.core.edgeColor)
const dashArray = computed(() => canvas.state.core.edgeDashed ? `${lineWidth.value * 4} ${lineWidth.value * 2}` : undefined)

// 剪切按钮
const showCutButton = ref(false)
const cutButtonPosition = ref({ x: 0, y: 0 })

// ---- 高亮判断（直接读 Pinia store 中的选中 ID 集合，O(1)）----
const isHighlighted = computed(() =>
  isTemporaryEdge.value ||
  canvas.selectionState.selectedNodeIds.has(props.source) ||
  canvas.selectionState.selectedNodeIds.has(props.target) ||
  canvas.selectionState.selectedEdgeIds.has(props.id)
)

// ---- 路径计算 ----
const edgePath = computed(() => {
  return buildCustomEdgePath({
    edgeType: edgeType.value,
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourceHandle: props.sourceHandleId,
    targetHandle: props.targetHandleId,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
    temporaryTargetHandle: isTemporaryEdge.value,
  })
})

// ---- 路径采样 ----
function samplePath(t: number): { x: number; y: number } {
  return sampleCustomEdgePath(t, {
    edgeType: edgeType.value,
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourceHandle: props.sourceHandleId,
    targetHandle: props.targetHandleId,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
    temporaryTargetHandle: isTemporaryEdge.value,
  })
}

function findClosestPoint(mx: number, my: number) {
  let best = { x: 0, y: 0, dist: Infinity }
  for (let i = 0; i <= 50; i++) {
    const p = samplePath(i / 50)
    const d = (p.x - mx) ** 2 + (p.y - my) ** 2
    if (d < best.dist) { best = { ...p, dist: d } }
  }
  return { x: best.x, y: best.y }
}

function updateCutButtonPosition(ev: MouseEvent) {
  const svg = (ev.currentTarget as SVGElement).closest('svg')
  if (!svg) return
  const pt = svg.createSVGPoint()
  pt.x = ev.clientX; pt.y = ev.clientY
  const ctm = svg.getScreenCTM()
  if (!ctm) return
  const { x, y } = pt.matrixTransform(ctm.inverse())
  cutButtonPosition.value = findClosestPoint(x, y)
}

// ---- 双击：显示剪切按钮 ----
function showCutButtonAtPointer(ev: MouseEvent) {
  if (isTemporaryEdge.value) return
  ev.stopPropagation()
  updateCutButtonPosition(ev)
  showCutButton.value = true
}

function onMouseMove(ev: MouseEvent) {
  if (!showCutButton.value) return
  updateCutButtonPosition(ev)
}

function cutEdge(ev: MouseEvent) {
  ev.stopPropagation(); ev.preventDefault()
  removeEdges([props.id])
  showCutButton.value = false
}

function closeCutButton() {
  showCutButton.value = false
}
onMounted(() => document.addEventListener('click', closeCutButton))
onUnmounted(() => document.removeEventListener('click', closeCutButton))

// 只有临时连线、被选中的连线，或连接到选中节点的线才走颜色 + 流光
const animateFlow = computed(() => props.forceFlow || isHighlighted.value)

</script>

<template>
  <g
    class="custom-edge" :class="{ highlight: isHighlighted, 'is-temporary': isTemporaryEdge }"
    :style="{
      '--ce-da': dashArray || 'none',
      '--flow-color': edgeColor,
      '--flow-width': lineWidth,
    }"
    @dblclick="showCutButtonAtPointer" @mousemove="onMouseMove"
  >
    <!-- 高亮 / 动画：底线 + 光晕 + 跑动光段 -->
    <template v-if="animateFlow">
      <defs>
        <filter :id="`ce-glow-${id}`" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <!-- 柔和外发光：只比配置线宽略宽，不再把线撑得很粗 -->
      <path class="edge-flow-glow" :d="edgePath" fill="none" :stroke="edgeColor"
        :stroke-width="lineWidth * 1.8" stroke-linecap="round" />

      <!-- 蓝色底线：宽度严格跟随面板线宽 -->
      <path class="edge-flow-base" :d="edgePath" fill="none" :stroke="edgeColor"
        :stroke-width="lineWidth" stroke-linecap="round" :stroke-dasharray="dashArray" />

      <!-- 白色芯线：在内部，不额外扩宽整体视觉 -->
      <path class="edge-flow-core" :d="edgePath" fill="none"
        :stroke-width="Math.max(1, lineWidth * 0.42)" stroke-linecap="round" />

      <!-- 流光：pathLength 归一化后固定 3 段，不随线条长短改变数量 -->
      <path class="edge-flow-runner edge-flow-runner--halo" :d="edgePath" fill="none" :stroke="edgeColor"
        :stroke-width="lineWidth * 1.25" stroke-linecap="round" pathLength="300" />
      <path class="edge-flow-runner edge-flow-runner--hot" :d="edgePath" fill="none" :stroke="edgeColor"
        :stroke-width="lineWidth" stroke-linecap="round" pathLength="300" />
    </template>

    <!-- 默认：淡灰线 -->
    <template v-else>
      <path :d="edgePath" fill="none" stroke="rgba(128,128,128,0.35)"
        :stroke-width="lineWidth" stroke-linecap="round" :stroke-dasharray="dashArray" />
    </template>

    <path class="edge-hit-area" :d="edgePath" fill="none" stroke="transparent"
      :stroke-width="Math.max(12, lineWidth * 1)" stroke-linecap="round" />

    <!-- 剪切按钮 -->
    <foreignObject
      v-if="showCutButton"
      :x="cutButtonPosition.x - 16" :y="cutButtonPosition.y - 16"
      width="32" height="32"
      style="overflow:visible"
    >
      <button
        class="cut-btn"
        @click.stop="cutEdge" @mousedown.stop
        title="删除连线"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
          class="w-4 h-4">
          <path d="M14.1 14.1L19 19m-7-7l7-7m-7 7l-2.9 2.9M12 12L9.1 9.1" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </foreignObject>
  </g>
</template>

<style scoped>
.custom-edge {
  cursor: pointer;
}
.custom-edge path {
  transition: stroke 0.2s, stroke-width 0.2s;
}
.edge-hit-area {
  pointer-events: stroke;
}

.edge-flow-glow {
  opacity: 0.18;
  filter: blur(4px);
  animation: edge-flow-breathe 1.8s ease-in-out infinite;
}

.edge-flow-base {
  opacity: 0.45;
}

.edge-flow-core {
  stroke: rgba(255, 255, 255, 0.72);
  opacity: 0.78;
}

.edge-flow-runner {
  /* pathLength=300，28+72=100，所以整条线上永远是 3 段光 */
  stroke-dasharray: 28 72;
  stroke-dashoffset: 0;
  animation:
    edge-flow-dash 1.35s linear infinite,
    edge-flow-breathe 1.8s ease-in-out infinite;
}

.edge-flow-runner--halo {
  opacity: 0.42;
  filter: blur(3px);
}

.edge-flow-runner--hot {
  opacity: 0.95;
  filter: drop-shadow(0 0 4px color-mix(in srgb, var(--flow-color) 70%, white));
}

@keyframes edge-flow-dash {
  from {
    stroke-dashoffset: 100;
  }
  to {
    stroke-dashoffset: 0;
  }
}

@keyframes edge-flow-breathe {
  0%, 100% {
    opacity: 0.45;
  }
  50% {
    opacity: 1;
  }
}

.cut-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px; height: 32px;
  border-radius: 50%;
  border: none;
  background: rgba(255,255,255,0.95);
  color: #374151;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  cursor: pointer;
  padding: 0;
  transition: background 0.15s;
}
.cut-btn:hover {
  background: #ef4444;
  color: #fff;
}
</style>

<style>
/* 覆盖 Vue Flow 的 .animated path { stroke-dasharray: 5 }，改为走 CSS 变量 */
.vue-flow__edge.animated .custom-edge path {
  stroke-dasharray: var(--ce-da) !important;
}
</style>
