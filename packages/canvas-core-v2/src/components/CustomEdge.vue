<script setup lang="ts">
// CustomEdge —— v2 自定义边/连接线（移植自 v1 components/CustomEdge.vue，金标准 core-node-contract §6）。
// 职责：按全局配置渲染边路径(bezier/straight/step/smoothstep)；默认淡线；选中/相连/临时/force 边跑流光(辉光+热斑)+箭头；
//       提供加宽透明点击热区 + 双击弹剪切钮删除。
// 与 v1 差异：v1 读 canvas.state.core.* 与 pinia selectionState；v2 改为 props 显式传入(解耦 store)，
//       默认值对齐 core-node-contract §0 配置默认表。几何逻辑抽到 ./edgeGeometry.ts(可单测)，此处只做装配。
import { computed, inject, ref, onMounted, onUnmounted } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import type { EdgeProps } from '@vue-flow/core'
import {
  Position,
  getSourcePosition,
  getTargetPosition,
  buildEdgePath,
  sampleEdgePath,
  findClosestPointOnPath,
  type EdgeType,
  type EdgeAppearance,
} from './edgeGeometry'
import {
  EDGE_VISUAL_KEY,
  EDGE_SELECTION_KEY,
  type EdgeVisual,
} from './edgeContext'

interface CustomEdgeExtraProps {
  /** 临时拖线/批量临时边 */
  temporary?: boolean
  /** 强制走流光 */
  forceFlow?: boolean
  /** 显式外观覆盖（优先级高于 provide 的 EDGE_VISUAL_KEY） */
  visual?: EdgeVisual
  /** 几何参数（曲率/step 偏移等） */
  geometry?: EdgeAppearance
}

const props = defineProps<EdgeProps & CustomEdgeExtraProps>()
const { removeEdges } = useVueFlow()

// 宿主注入：外观(静态) + 选中集合(响应式)。缺省回落内置默认值 + 空集合。
const injectedVisual = inject(EDGE_VISUAL_KEY, {})
const injectedSel = inject(EDGE_SELECTION_KEY, {})
const visual = computed<EdgeVisual>(() => ({ ...injectedVisual, ...(props.visual || {}) }))
const selectionNodeIds = computed<ReadonlySet<string>>(
  () => injectedSel.selectedNodeIds?.value ?? new Set<string>(),
)
const selectionEdgeIds = computed<ReadonlySet<string>>(
  () => injectedSel.selectedEdgeIds?.value ?? new Set<string>(),
)

const isTemporaryEdge = computed(() => Boolean(props.temporary || props.data?.isTemp))

// ---- 外观配置（缺省回落到 contract §0 默认值）----
const edgeType = computed<EdgeType>(() => (visual.value.edgeType as EdgeType) || 'bezier')
const lineWidth = computed(() => visual.value.edgeLineWidth ?? 2)
const edgeColor = computed(() => visual.value.edgeColor ?? '#3b82f6')
const dashArray = computed(() =>
  visual.value.edgeDashed ? `${lineWidth.value * 4} ${lineWidth.value * 2}` : undefined,
)
const edgeAnimated = computed(() => visual.value.edgeAnimated ?? true)
const edgeMarkerEnd = computed(() => visual.value.edgeMarkerEnd ?? false)
const edgeMarkerSize = computed(() => visual.value.edgeMarkerSize ?? 8)
const edgeVisible = computed(() => visual.value.edgeVisible ?? true)
const edgeGlowEnabled = computed(() => visual.value.edgeGlowEnabled ?? true)
const edgeGlowIntensity = computed(() => visual.value.edgeGlowIntensity ?? 1)
const edgeGlowColor = computed(() => visual.value.edgeGlowColor || edgeColor.value)
const geometry = computed(() => props.geometry)

// ---- 高亮判断：临时恒高亮 / 相连任一节点被选 / 边自身被选 ----
const isHighlighted = computed(() =>
  isTemporaryEdge.value ||
  selectionNodeIds.value.has(props.source) ||
  selectionNodeIds.value.has(props.target) ||
  selectionEdgeIds.value.has(props.id) ||
  Boolean((props as { selected?: boolean }).selected),
)

// ---- 路径 ----
const sourcePos = computed(() => getSourcePosition(props.sourcePosition, props.sourceHandleId))
const targetPos = computed(() =>
  isTemporaryEdge.value
    ? (sourcePos.value === Position.Right ? Position.Left : Position.Right)
    : getTargetPosition(props.targetPosition, props.targetHandleId),
)

const edgePath = computed(() =>
  buildEdgePath(
    props.sourceX, props.sourceY,
    props.targetX, props.targetY,
    sourcePos.value, targetPos.value,
    edgeType.value,
    geometry.value,
  ),
)

function samplePath(t: number) {
  return sampleEdgePath(
    t,
    props.sourceX, props.sourceY,
    props.targetX, props.targetY,
    sourcePos.value, targetPos.value,
    edgeType.value,
    geometry.value,
  )
}

// ---- 剪切按钮 ----
const showCutButton = ref(false)
const cutButtonPosition = ref({ x: 0, y: 0 })

function updateCutButtonPosition(ev: MouseEvent) {
  const svg = (ev.currentTarget as SVGElement).closest('svg')
  if (!svg) return
  const pt = svg.createSVGPoint()
  pt.x = ev.clientX; pt.y = ev.clientY
  const ctm = svg.getScreenCTM()
  if (!ctm) return
  const { x, y } = pt.matrixTransform(ctm.inverse())
  cutButtonPosition.value = findClosestPointOnPath(
    x, y,
    props.sourceX, props.sourceY,
    props.targetX, props.targetY,
    sourcePos.value, targetPos.value,
    edgeType.value,
    geometry.value,
  )
}

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

// ---- 手绘箭头：从路径采样计算角度 ----
const arrowPath = computed(() => {
  if (!edgeMarkerEnd.value) return ''
  const pNear = samplePath(0.92)
  const pEnd = samplePath(1.0)
  const dx = pEnd.x - pNear.x
  const dy = pEnd.y - pNear.y
  const angle = Math.atan2(dy, dx)
  const len = edgeMarkerSize.value
  const halfOpen = Math.PI / 6.5
  const tipX = pEnd.x - Math.cos(angle) * len * 0.15
  const tipY = pEnd.y - Math.sin(angle) * len * 0.15
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

      <!-- 高亮态：原始连接线 + 辉光流光 -->
      <template v-else>
        <path
          class="ef-base"
          :d="edgePath"
          fill="none"
          :stroke="edgeColor"
          :stroke-width="lineWidth"
          stroke-linecap="round"
          :stroke-dasharray="dashArray"
        />
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

      <!-- 箭头 -->
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
        :data-edge-id="id"
        :d="edgePath"
        fill="none"
        stroke="transparent"
        :stroke-width="Math.max(12, lineWidth)"
        stroke-linecap="round"
      />

      <!-- 双击剪切按钮 -->
      <foreignObject
        v-if="showCutButton"
        :x="cutButtonPosition.x - 16"
        :y="cutButtonPosition.y - 16"
        width="32"
        height="32"
        style="overflow: visible"
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

.ef-base {
  opacity: 0.45;
}
.ef-base--dim {
  opacity: 0.3;
}

.ef-runner {
  stroke-dasharray: 24 76;
  stroke-dashoffset: 0;
  animation:
    ef-dash 1.2s linear infinite,
    ef-breathe 1.6s ease-in-out infinite;
}
.ef-runner-glow {
  opacity: 0.55;
}
.ef-runner-hot {
  opacity: 0.92;
}

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
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.95);
  color: #374151;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
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
