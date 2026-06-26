<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import type { EdgeProps } from '@vue-flow/core'
import { useCanvasStore } from '../composables/useCanvasStore'
type EdgeType = 'bezier' | 'straight' | 'step' | 'smoothstep'
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
    case 'smoothstep': {
      // 标准 smoothstep: 水平段 → 圆角 → 垂直段 → 圆角 → 水平段
      const sourceBendX = sourceX + sourceDirection * distance
      const targetBendX = targetX + targetDirection * distance
      // 圆角半径，不超过水平段长度的一半
      const r = Math.min(Math.abs(targetBendX - sourceBendX) * 0.2, Math.abs(targetY - sourceY) * 0.2, 20)
      // 确保圆角半径不为负且不会导致路径退化
      const safeR = Math.max(0.1, Math.min(r, Math.abs(sourceBendX - sourceX) * 0.9, Math.abs(targetX - targetBendX) * 0.9))

      const segments: string[] = []
      // 起点
      segments.push(`M ${sourceX} ${sourceY}`)

      if (targetY > sourceY) {
        // 目标在源下方: 先向右→向下弯→垂直→向上弯到目标水平线→向右到目标
        // 1) 水平: source → 接近 bendX（留出圆角空间）
        segments.push(`L ${sourceBendX - sourceDirection * safeR} ${sourceY}`)
        // 2) Q 圆角: 从水平转向下
        segments.push(`Q ${sourceBendX} ${sourceY} ${sourceBendX} ${sourceY + safeR}`)
        // 3) 垂直下降到目标 Y 上方
        segments.push(`L ${sourceBendX} ${targetY - safeR}`)
        // 4) Q 圆角: 从垂直转向右（朝向 target）
        segments.push(`Q ${sourceBendX} ${targetY} ${sourceBendX + sourceDirection * safeR} ${targetY}`)
        // 5) 水平到达 target
        segments.push(`L ${targetX} ${targetY}`)
      } else if (targetY < sourceY) {
        // 目标在源上方: 先向右→向上弯→垂直→向下弯到目标水平线→向右到目标
        segments.push(`L ${sourceBendX - sourceDirection * safeR} ${sourceY}`)
        segments.push(`Q ${sourceBendX} ${sourceY} ${sourceBendX} ${sourceY - safeR}`)
        segments.push(`L ${sourceBendX} ${targetY + safeR}`)
        segments.push(`Q ${sourceBendX} ${targetY} ${sourceBendX + sourceDirection * safeR} ${targetY}`)
        segments.push(`L ${targetX} ${targetY}`)
      } else {
        // Y 相同: 退化为带圆角的直线（或直接 bezier）
        segments.push(`L ${targetX} ${targetY}`)
      }

      return segments.join(' ')
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
    case 'smoothstep': {
      // 与 buildCustomEdgePath smoothstep 分段一致
      const sourceBendX = sourceX + sourceDirection * distance
      const r = Math.min(Math.abs(targetX - sourceX) * 0.2, Math.abs(targetY - sourceY) * 0.2, 20)
      const safeR = Math.max(0.1, r)
      const points: { x: number; y: number }[] = [
        { x: sourceX, y: sourceY },
        { x: sourceBendX - sourceDirection * safeR, y: sourceY },
        { x: sourceBendX, y: targetY > sourceY ? sourceY + safeR : sourceY - safeR },
        { x: sourceBendX, y: targetY > sourceY ? targetY - safeR : targetY + safeR },
        { x: sourceBendX + sourceDirection * safeR, y: targetY },
        { x: targetX, y: targetY },
      ]
      // Y 相同时退化
      if (Math.abs(targetY - sourceY) < 0.5) {
        return { x: sourceX + (targetX - sourceX) * t, y: sourceY }
      }
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

const edgeType = computed(() => canvas.state.core.edgeType as EdgeType || 'bezier')
const lineWidth = computed(() => canvas.state.core.edgeLineWidth)
const edgeColor = computed(() => canvas.state.core.edgeColor)
const dashArray = computed(() => canvas.state.core.edgeDashed ? `${lineWidth.value * 4} ${lineWidth.value * 2}` : undefined)
const edgeAnimated = computed(() => canvas.state.core.edgeAnimated ?? true)
const edgeMarkerEnd = computed(() => canvas.state.core.edgeMarkerEnd ?? false)
const edgeMarkerSize = computed(() => canvas.state.core.edgeMarkerSize ?? 8)
const edgeVisible = computed(() => canvas.state.core.edgeVisible ?? true)

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
    class="custom-edge"
    :class="{ highlight: isHighlighted, 'is-temporary': isTemporaryEdge }"
    :style="{
      '--ce-da': dashArray || 'none',
    }"
    @dblclick="showCutButtonAtPointer"
    @mousemove="onMouseMove"
  >
    <template v-if="edgeVisible">
    <!-- 线条箭头: orient=auto 自动沿路径切线方向旋转 -->
    <defs>
      <marker
        :id="`ce-arrow-${id}`"
        :markerWidth="edgeMarkerSize"
        :markerHeight="edgeMarkerSize"
        :refX="edgeMarkerSize * 0.85"
        :refY="edgeMarkerSize * 0.5"
        orient="auto"
      >
        <!-- 开口 V 形箭头，尖在 X+ 方向(右)。
             refX=85% 处对齐路径终点 → 尖端伸出终点 15%，不会被节点遮挡 -->
        <path
          :d="`M ${edgeMarkerSize * 0.15} 0 L ${edgeMarkerSize} ${edgeMarkerSize * 0.5} L ${edgeMarkerSize * 0.15} ${edgeMarkerSize}`"
          fill="none"
          :stroke="edgeColor"
          :stroke-width="Math.max(1, lineWidth)"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </marker>
    </defs>

    <!-- 默认态：淡灰线 -->
    <template v-if="!animateFlow">
      <path
        class="ef-base ef-base--dim"
        :d="edgePath"
        fill="none"
        :stroke="edgeColor"
        :stroke-width="lineWidth"
        stroke-linecap="round"
        :stroke-dasharray="dashArray"
        :marker-end="edgeMarkerEnd ? `url(#ce-arrow-${id})` : undefined"
      />
    </template>

    <!-- 高亮态：底线 + 白芯 + 可选流光 -->
    <template v-else>
      <!-- 底线 -->
      <path
        class="ef-base"
        :d="edgePath"
        fill="none"
        :stroke="edgeColor"
        :stroke-width="lineWidth"
        stroke-linecap="round"
        :stroke-dasharray="dashArray"
        :marker-end="edgeMarkerEnd ? `url(#ce-arrow-${id})` : undefined"
      />
      <!-- 白芯 -->
      <path
        class="ef-core"
        :d="edgePath"
        fill="none"
        :stroke-width="Math.max(1, lineWidth * 0.42)"
        stroke-linecap="round"
      />
      <!-- 经典 3 块流光（仅 edgeAnimated 开启时） -->
      <template v-if="edgeAnimated">
        <path
          class="ef-runner ef-runner-glow"
          :d="edgePath"
          fill="none"
          :stroke="edgeColor"
          :stroke-width="lineWidth"
          stroke-linecap="round"
          pathLength="300"
        />
        <path
          class="ef-runner ef-runner-hot"
          :d="edgePath"
          fill="none"
          :stroke="edgeColor"
          :stroke-width="lineWidth"
          stroke-linecap="round"
          pathLength="300"
        />
      </template>
    </template>

    <!-- 点击热区 -->
    <path
      class="edge-hit-area"
      :d="edgePath"
      fill="none"
      stroke="transparent"
      :stroke-width="Math.max(12, lineWidth)"
      stroke-linecap="round"
    />

    <!-- 剪切按钮 -->
    <foreignObject
      v-if="showCutButton"
      :x="cutButtonPosition.x - 16"
      :y="cutButtonPosition.y - 16"
      width="32"
      height="32"
      style="overflow:visible"
    >
      <button class="cut-btn" @click.stop="cutEdge" @mousedown.stop title="删除连线">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="w-4 h-4">
          <path d="M14.1 14.1L19 19m-7-7l7-7m-7 7l-2.9 2.9M12 12L9.1 9.1" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </foreignObject>
    </template>
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

/* ===== 底线 ===== */
.ef-base {
  opacity: 0.45;
}
.ef-base--dim {
  opacity: 0.3;
}

/* ===== 白芯 ===== */
.ef-core {
  stroke: rgba(255, 255, 255, 0.72);
  opacity: 0.78;
}

/* ===== 经典 3 块流光（pathLength=300, dash-cycle=100） ===== */
.ef-runner {
  stroke-dasharray: 28 72;
  stroke-dashoffset: 0;
  animation:
    ef-dash 1.35s linear infinite,
    ef-breathe 1.8s ease-in-out infinite;
}

/* 光晕散斑：与热斑同宽，仅靠 opacity 区分层级 */
.ef-runner-glow {
  opacity: 0.42;
}

/* 热斑：高亮，制造"前亮后暗"的深度感 */
.ef-runner-hot {
  opacity: 0.88;
}

@keyframes ef-dash {
  to {
    stroke-dashoffset: -100;
  }
}
@keyframes ef-breathe {
  0%, 100% { opacity: 0.55; }
  50%      { opacity: 1; }
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
