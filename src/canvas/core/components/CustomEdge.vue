<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import type { EdgeProps } from '@vue-flow/core'
import { useCanvasStore } from '../composables/useCanvasStore'

type CustomEdgeExtraProps = {
  temporary?: boolean
  forceFlow?: boolean
}

const props = defineProps<EdgeProps & CustomEdgeExtraProps>()
const { removeEdges } = useVueFlow()

const isTemporaryEdge = computed(() => Boolean(props.temporary || props.data?.isTemp))

// ---- 状态及配置 ----
const canvas = useCanvasStore()

const edgeType = computed(() => canvas.state.edgeType as 'bezier' | 'straight' | 'step' || 'bezier')
const lineWidth = computed(() => canvas.state.edgeLineWidth)
const edgeColor = computed(() => canvas.state.edgeColor)
const dashArray = computed(() => canvas.state.edgeDashed ? `${lineWidth.value * 4} ${lineWidth.value * 2}` : undefined)

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
  const { sourceX, sourceY, targetX, targetY } = props
  switch (edgeType.value) {
    case 'straight':
      return `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`
    case 'step': {
      const mx = (sourceX + targetX) / 2
      return `M ${sourceX} ${sourceY} L ${mx} ${sourceY} L ${mx} ${targetY} L ${targetX} ${targetY}`
    }
    case 'bezier':
    default: {
      const dx = (targetX - sourceX) * 0.5
      return `M ${sourceX} ${sourceY} C ${sourceX + dx} ${sourceY}, ${targetX - dx} ${targetY}, ${targetX} ${targetY}`
    }
  }
})

// ---- 路径采样 ----
function samplePath(t: number): { x: number; y: number } {
  const { sourceX, sourceY, targetX, targetY } = props
  switch (edgeType.value) {
    case 'straight':
      return {
        x: sourceX + (targetX - sourceX) * t,
        y: sourceY + (targetY - sourceY) * t,
      }
    case 'step': {
      const mx = (sourceX + targetX) / 2
      if (t < 0.25) {
        const s = t / 0.25
        return { x: sourceX + (mx - sourceX) * s, y: sourceY }
      } else if (t < 0.75) {
        const s = (t - 0.25) / 0.5
        return { x: mx, y: sourceY + (targetY - sourceY) * s }
      } else {
        const s = (t - 0.75) / 0.25
        return { x: mx + (targetX - mx) * s, y: targetY }
      }
    }
    default: {
      const dx = (targetX - sourceX) * 0.5
      const c1x = sourceX + dx; const c1y = sourceY
      const c2x = targetX - dx; const c2y = targetY
      const mt = 1 - t
      return {
        x: mt ** 3 * sourceX + 3 * mt ** 2 * t * c1x + 3 * mt * t ** 2 * c2x + t ** 3 * targetX,
        y: mt ** 3 * sourceY + 3 * mt ** 2 * t * c1y + 3 * mt * t ** 2 * c2y + t ** 3 * targetY,
      }
    }
  }
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
