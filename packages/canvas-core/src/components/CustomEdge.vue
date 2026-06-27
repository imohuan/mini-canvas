<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import type { EdgeProps } from '@vue-flow/core'
import { useCanvasStore } from '../composables/useCanvasStore'
type EdgeType = 'bezier' | 'straight' | 'step' | 'smoothstep'

// ---- VueFlow-compatible Position enum and routing helpers ----
const Position = { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' } as const
type Position = (typeof Position)[keyof typeof Position]

interface XYPosition { x: number; y: number }

const handleDirections: Record<Position, XYPosition> = {
  [Position.Left]: { x: -1, y: 0 },
  [Position.Right]: { x: 1, y: 0 },
  [Position.Top]: { x: 0, y: -1 },
  [Position.Bottom]: { x: 0, y: 1 },
}

function getDirection({
  source,
  sourcePosition = Position.Bottom,
  target,
}: {
  source: XYPosition
  sourcePosition: Position
  target: XYPosition
}): XYPosition {
  if (sourcePosition === Position.Left || sourcePosition === Position.Right) {
    return source.x < target.x ? { x: 1, y: 0 } : { x: -1, y: 0 }
  }
  return source.y < target.y ? { x: 0, y: 1 } : { x: 0, y: -1 }
}

function dist(a: XYPosition, b: XYPosition) {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2)
}

function getSimpleEdgeCenter({
  sourceX, sourceY, targetX, targetY,
}: { sourceX: number; sourceY: number; targetX: number; targetY: number }): [number, number, number, number] {
  const xOffset = Math.abs(targetX - sourceX) / 2
  const centerX = targetX < sourceX ? targetX + xOffset : targetX - xOffset
  const yOffset = Math.abs(targetY - sourceY) / 2
  const centerY = targetY < sourceY ? targetY + yOffset : targetY - yOffset
  return [centerX, centerY, xOffset, yOffset]
}

// ---- map props to vue-flow Position ----
function getSourcePosition(position?: string | null, handle?: string | null): Position {
  if (handle === 'source') return Position.Right
  return normalizePosition(position) ?? Position.Right
}

function getTargetPosition(position?: string | null, handle?: string | null): Position {
  if (handle === 'target') return Position.Left
  return normalizePosition(position) ?? Position.Left
}

function normalizePosition(position?: string | null): Position | null {
  const v = String(position || '').toLowerCase()
  if (v.includes('left')) return Position.Left
  if (v.includes('right')) return Position.Right
  if (v.includes('top')) return Position.Top
  if (v.includes('bottom')) return Position.Bottom
  return null
}

type StepPathParams = {
  sourceX: number; sourceY: number; sourcePosition: Position
  targetX: number; targetY: number; targetPosition: Position
  borderRadius: number; centerX?: number; centerY?: number; offset?: number
}

/**
 * Port of vue-flow getPoints — computes intermediate junction points for step/smoothstep edges.
 */
function getPoints({
  source, sourcePosition, target, targetPosition, center, offset,
}: {
  source: XYPosition; sourcePosition: Position; target: XYPosition; targetPosition: Position
  center: Partial<XYPosition>; offset: number
}): [XYPosition[], number, number] {
  const sourceDir = handleDirections[sourcePosition]
  const targetDir = handleDirections[targetPosition]
  const sourceGapped: XYPosition = { x: source.x + sourceDir.x * offset, y: source.y + sourceDir.y * offset }
  const targetGapped: XYPosition = { x: target.x + targetDir.x * offset, y: target.y + targetDir.y * offset }
  const dir = getDirection({ source: sourceGapped, sourcePosition, target: targetGapped })
  const dirAccessor = dir.x !== 0 ? 'x' : 'y'
  const currDir = dir[dirAccessor]

  let points: XYPosition[]
  let labelX: number, labelY: number

  const sourceGapOffset: XYPosition = { x: 0, y: 0 }
  const targetGapOffset: XYPosition = { x: 0, y: 0 }

  const [defaultCenterX, defaultCenterY] = getSimpleEdgeCenter({
    sourceX: source.x, sourceY: source.y, targetX: target.x, targetY: target.y,
  })

  // opposite handle positions
  if (sourceDir[dirAccessor] * targetDir[dirAccessor] === -1) {
    const cx = center.x ?? defaultCenterX
    const cy = center.y ?? defaultCenterY
    const verticalSplit: XYPosition[] = [
      { x: cx, y: sourceGapped.y },
      { x: cx, y: targetGapped.y },
    ]
    const horizontalSplit: XYPosition[] = [
      { x: sourceGapped.x, y: cy },
      { x: targetGapped.x, y: cy },
    ]
    if (sourceDir[dirAccessor] === currDir) {
      points = dirAccessor === 'x' ? verticalSplit : horizontalSplit
    } else {
      points = dirAccessor === 'x' ? horizontalSplit : verticalSplit
    }
    labelX = cx
    labelY = cy
  } else {
    // same side or mixed handle positions
    const sourceTarget: XYPosition[] = [{ x: sourceGapped.x, y: targetGapped.y }]
    const targetSource: XYPosition[] = [{ x: targetGapped.x, y: sourceGapped.y }]

    if (dirAccessor === 'x') {
      points = sourceDir.x === currDir ? targetSource : sourceTarget
    } else {
      points = sourceDir.y === currDir ? sourceTarget : targetSource
    }

    if (sourcePosition === targetPosition) {
      const diff = Math.abs(source[dirAccessor] - target[dirAccessor])
      if (diff <= offset) {
        const gapOffset = Math.min(offset - 1, offset - diff)
        if (sourceDir[dirAccessor] === currDir) {
          const sign = sourceGapped[dirAccessor] > source[dirAccessor] ? -1 : 1
          sourceGapOffset[dirAccessor] = sign * gapOffset
        } else {
          const sign = targetGapped[dirAccessor] > target[dirAccessor] ? -1 : 1
          targetGapOffset[dirAccessor] = sign * gapOffset
        }
      }
    }

    if (sourcePosition !== targetPosition) {
      const dirAccOpp = dirAccessor === 'x' ? 'y' : 'x'
      const isSameDir = sourceDir[dirAccessor] === targetDir[dirAccOpp]
      const sourceGt = sourceGapped[dirAccOpp] > targetGapped[dirAccOpp]
      const sourceLt = sourceGapped[dirAccOpp] < targetGapped[dirAccOpp]
      const flip =
        (sourceDir[dirAccessor] === 1 && ((!isSameDir && sourceGt) || (isSameDir && sourceLt))) ||
        (sourceDir[dirAccessor] !== 1 && ((!isSameDir && sourceLt) || (isSameDir && sourceGt)))
      if (flip) {
        points = dirAccessor === 'x' ? sourceTarget : targetSource
      }
    }

    const sourceGapPoint = { x: sourceGapped.x + sourceGapOffset.x, y: sourceGapped.y + sourceGapOffset.y }
    const targetGapPoint = { x: targetGapped.x + targetGapOffset.x, y: targetGapped.y + targetGapOffset.y }
    const maxX = Math.max(Math.abs(sourceGapPoint.x - points[0].x), Math.abs(targetGapPoint.x - points[0].x))
    const maxY = Math.max(Math.abs(sourceGapPoint.y - points[0].y), Math.abs(targetGapPoint.y - points[0].y))
    if (maxX >= maxY) {
      labelX = (sourceGapPoint.x + targetGapPoint.x) / 2
      labelY = points[0].y
    } else {
      labelX = points[0].x
      labelY = (sourceGapPoint.y + targetGapPoint.y) / 2
    }
  }

  const pathPoints = [
    source,
    { x: sourceGapped.x + sourceGapOffset.x, y: sourceGapped.y + sourceGapOffset.y },
    ...points,
    { x: targetGapped.x + targetGapOffset.x, y: targetGapped.y + targetGapOffset.y },
    target,
  ]

  return [pathPoints, labelX, labelY]
}

function getBend(a: XYPosition, b: XYPosition, c: XYPosition, size: number): string {
  const bendSize = Math.min(dist(a, b) / 2, dist(b, c) / 2, size)
  const { x, y } = b
  if ((a.x === x && x === c.x) || (a.y === y && y === c.y)) {
    return `L${x} ${y}`
  }
  // first segment is horizontal, bend to vertical
  if (a.y === y) {
    const xDir = a.x < c.x ? -1 : 1
    const yDir = a.y < c.y ? 1 : -1
    return `L ${x + bendSize * xDir},${y}Q ${x},${y} ${x},${y + bendSize * yDir}`
  }
  // first segment is vertical, bend to horizontal
  const xDir = a.x < c.x ? 1 : -1
  const yDir = a.y < c.y ? -1 : 1
  return `L ${x},${y + bendSize * yDir}Q ${x},${y} ${x + bendSize * xDir},${y}`
}

function buildStepPath(params: StepPathParams, borderRadius: number): [string, XYPosition[]] {
  const offset = params.offset ?? canvas.state.core.edgeStepOffset
  const { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, centerX, centerY } = params

  const [points] = getPoints({
    source: { x: sourceX, y: sourceY },
    sourcePosition,
    target: { x: targetX, y: targetY },
    targetPosition,
    center: { x: centerX, y: centerY },
    offset,
  })

  const path = points.reduce((res, p, i) => {
    let segment: string
    if (i > 0 && i < points.length - 1) {
      segment = getBend(points[i - 1], p, points[i + 1], borderRadius)
    } else {
      segment = `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`
    }
    return res + segment
  }, '')

  return [path, points]
}

function buildCustomEdgePath(
  sourceX: number, sourceY: number, targetX: number, targetY: number,
  sourcePosition: Position, targetPosition: Position,
  edgeType: EdgeType,
): string {
  switch (edgeType) {
    case 'straight':
      return `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`
    case 'step': {
      const [path] = buildStepPath(
        { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 0, offset: canvas.state.core.edgeStepOffset },
        0,
      )
      return path
    }
    case 'smoothstep': {
      const [path] = buildStepPath(
        { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: canvas.state.core.edgeSmoothRadius, offset: canvas.state.core.edgeStepOffset },
        canvas.state.core.edgeSmoothRadius,
      )
      return path
    }
    case 'bezier':
    default: {
      const sourceSign = sourcePosition === Position.Left ? -1 : 1
      const targetSign = targetPosition === Position.Left ? -1 : 1
      const distX = Math.max(Math.abs(targetX - sourceX) * 0.5, 80)
      const c1x = sourceX + sourceSign * distX
      const c2x = targetX + targetSign * distX
      return `M ${sourceX} ${sourceY} C ${c1x} ${sourceY}, ${c2x} ${targetY}, ${targetX} ${targetY}`
    }
  }
}

function sampleCustomEdgePath(
  t: number,
  sourceX: number, sourceY: number, targetX: number, targetY: number,
  sourcePosition: Position, targetPosition: Position,
  edgeType: EdgeType,
): { x: number; y: number } {
  switch (edgeType) {
    case 'straight':
      return {
        x: sourceX + (targetX - sourceX) * t,
        y: sourceY + (targetY - sourceY) * t,
      }
    case 'step':
    case 'smoothstep': {
      const borderRadius = edgeType === 'smoothstep' ? canvas.state.core.edgeSmoothRadius : 0
      const [, points] = buildStepPath(
        { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius, offset: canvas.state.core.edgeStepOffset },
        borderRadius,
      )
      const total = points.length - 1
      const segment = Math.min(total - 1, Math.floor(t * total))
      const segStart = segment / total
      const segT = (t - segStart) * total
      const from = points[segment]
      const to = points[segment + 1]
      return {
        x: from.x + (to.x - from.x) * segT,
        y: from.y + (to.y - from.y) * segT,
      }
    }
    case 'bezier':
    default: {
      const sourceSign = sourcePosition === Position.Left ? -1 : 1
      const targetSign = targetPosition === Position.Left ? -1 : 1
      const distX = Math.max(Math.abs(targetX - sourceX) * 0.5, 80)
      const c1x = sourceX + sourceSign * distX
      const c2x = targetX + targetSign * distX
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
const edgeGlowEnabled = computed(() => canvas.state.core.edgeGlowEnabled ?? true)
const edgeGlowIntensity = computed(() => canvas.state.core.edgeGlowIntensity ?? 1)
const edgeGlowColor = computed(() => canvas.state.core.edgeGlowColor || edgeColor.value)

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
const sourcePos = computed(() => getSourcePosition(props.sourcePosition, props.sourceHandleId))
const targetPos = computed(() => isTemporaryEdge.value
  ? (sourcePos.value === Position.Right ? Position.Left : Position.Right)
  : getTargetPosition(props.targetPosition, props.targetHandleId))

const edgePath = computed(() => {
  return buildCustomEdgePath(
    props.sourceX, props.sourceY,
    props.targetX, props.targetY,
    sourcePos.value, targetPos.value,
    edgeType.value,
  )
})

// ---- 路径采样 ----
function samplePath(t: number): { x: number; y: number } {
  return sampleCustomEdgePath(t,
    props.sourceX, props.sourceY,
    props.targetX, props.targetY,
    sourcePos.value, targetPos.value,
    edgeType.value,
  )
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

// ---- 手绘箭头：从路径采样计算角度，不依赖 SVG marker ----
const arrowPath = computed(() => {
  if (!edgeMarkerEnd.value) return ''
  // 采样路径末端方向
  const pNear = samplePath(0.92)
  const pEnd = samplePath(1.0)
  const dx = pEnd.x - pNear.x
  const dy = pEnd.y - pNear.y
  const angle = Math.atan2(dy, dx)
  // 箭头长度（像素），翼展
  const len = edgeMarkerSize.value
  const halfOpen = Math.PI / 6.5 // ~28° 半开角
  // 尖端位置：从终点沿反方向回退 len*0.15，避免被节点遮挡
  const tipX = pEnd.x - Math.cos(angle) * len * 0.15
  const tipY = pEnd.y - Math.sin(angle) * len * 0.15
  // 两翼端点：从尖端沿反方向 ±halfOpen 角度延伸 len
  const w1x = tipX - Math.cos(angle - halfOpen) * len
  const w1y = tipY - Math.sin(angle - halfOpen) * len
  const w2x = tipX - Math.cos(angle + halfOpen) * len
  const w2y = tipY - Math.sin(angle + halfOpen) * len
  return `M ${w1x} ${w1y} L ${tipX} ${tipY} L ${w2x} ${w2y}`
})
</script>

<template>
  <g
    class="custom-edge"
    :class="{ highlight: isHighlighted, 'is-temporary': isTemporaryEdge }"
    :style="{
      '--ce-da': dashArray || 'none',
      '--ce-color': edgeColor,
      '--ce-linew': lineWidth + 'px',
      '--ce-arrow-opacity': animateFlow ? 1 : 0.35,
    }"
    @dblclick="showCutButtonAtPointer"
    @mousemove="onMouseMove"
  >
    <template v-if="edgeVisible">

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
      />
    </template>

    <!-- 高亮态：原始连接线 + 辉光流光色块 -->
    <template v-else>
      <!-- 底层原始连接线（保持完整颜色和宽度） -->
      <path
        class="ef-base"
        :d="edgePath"
        fill="none"
        :stroke="edgeColor"
        :stroke-width="lineWidth"
        stroke-linecap="round"
        :stroke-dasharray="dashArray"
      />
      <!-- 辉光流光色块（edgeAnimated + edgeGlowEnabled 均开启时） -->
      <template v-if="edgeAnimated && edgeGlowEnabled">
        <path
          class="ef-runner ef-runner-glow"
          :d="edgePath"
          fill="none"
          :stroke="edgeGlowColor"
          :stroke-width="lineWidth"
          stroke-linecap="round"
          pathLength="300"
          :style="{
            filter: `drop-shadow(0 0 ${5 * edgeGlowIntensity}px ${edgeGlowColor}) drop-shadow(0 0 ${10 * edgeGlowIntensity}px ${edgeGlowColor})`,
          }"
        />
        <path
          class="ef-runner ef-runner-hot"
          :d="edgePath"
          fill="none"
          :stroke="edgeGlowColor"
          :stroke-width="Math.max(1, lineWidth * 0.65)"
          stroke-linecap="round"
          pathLength="300"
        />
      </template>
      <!-- 无辉光时的热斑（仅 edgeAnimated 开启，edgeGlowEnabled 关闭时） -->
      <template v-else-if="edgeAnimated && !edgeGlowEnabled">
        <path
          class="ef-runner ef-runner-hot"
          :d="edgePath"
          fill="none"
          :stroke="edgeGlowColor"
          :stroke-width="Math.max(1, lineWidth * 0.65)"
          stroke-linecap="round"
          pathLength="300"
        />
      </template>
    </template>

    <!-- 手绘箭头：角度从路径采样计算，宽度 = 线宽，inline style 强制颜色 -->
    <path
      v-if="edgeMarkerEnd && edgeVisible"
      class="ef-arrow"
      :d="arrowPath"
      fill="none"
      :stroke="edgeColor"
      :stroke-width="lineWidth"
      stroke-linecap="round"
      stroke-linejoin="round"
    />

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
  stroke: rgba(255, 255, 255, 0.8);
  opacity: 0.82;
}

/* ===== 流光块（pathLength=300, dash-cycle=100） ===== */
.ef-runner {
  stroke-dasharray: 24 76;
  stroke-dashoffset: 0;
  animation:
    ef-dash 1.2s linear infinite,
    ef-breathe 1.6s ease-in-out infinite;
}

/* 辉光散斑：拖尾发光效果，blur 半径通过 inline style 动态控制 */
.ef-runner-glow {
  opacity: 0.55;
}

/* 热斑：高亮核心，制造"前亮后暗"的深度感 */
.ef-runner-hot {
  opacity: 0.92;
}

/* 箭头：!important 确保不被外部 CSS 覆盖 */
.ef-arrow {
  stroke: var(--ce-color, #3b82f6) !important;
  stroke-width: var(--ce-linew, 2px) !important;
  opacity: var(--ce-arrow-opacity, 1);
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
