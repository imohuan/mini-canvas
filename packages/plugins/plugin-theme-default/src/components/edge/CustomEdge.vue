<script setup lang="ts">
// CustomEdge —— v2 自定义边/连接线（移植自 v1 components/CustomEdge.vue，金标准 core-node-contract §6）。
// 职责：按全局配置渲染边路径(bezier/straight/step/smoothstep)；默认导轨 + 同色光斑沿路径流动；
//       选中/相连/临时/force 边加亮（drop-shadow 强化）；提供加宽透明点击热区 + 双击弹剪切钮删除。
// 视觉语言（参考 canvas-core-v2/demo-html-ui/bezier_glow_flow_line）。
// 动画：纯 CSS keyframes 推进 stroke-dashoffset（不用 SVG <animate> SMIL，根因：vdom patch 把 <animate> 当 path child
//       反复比较，path 的 d 在多次 patch 后被清空、bbox=0、光斑彻底不可见——浏览器实测结果）。
// 箭头颜色：与 flowColor 同色（统一连线视觉）。颜色用 :style 内联绑定到 element.style，优先级高于 .vue-flow 全局 CSS
//       的 var(--ce-color, #3b82f6) 兜底，避免被覆盖为线色（之前就是这个 bug）。
// 几何：edgeGeometry.ts（与 v1 逐字节一致，可单测覆盖）。
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import { GRAPH_EDGES_KEY } from '@mini-canvas/canvas-core-v2'
import type { EdgeStoreService, SaveService } from '@mini-canvas/canvas-core-v2'
import type { EdgeVisual } from '@mini-canvas/canvas-render'
import {
  getSourcePosition,
  getTargetPosition,
  buildEdgePath,
  sampleEdgePath,
  findClosestPointOnPath,
  type EdgeType,
  type EdgeAppearance,
} from './edgeGeometry'

/** Custom edge render component: the minimal prop set it actually consumes (independent from VueFlow EdgeProps full-required shape).
 *  Normal edges are fed by VueFlow (id/source/target/sourceNode/targetNode/... all present);
 *  the drag-time temp line is fed by the ConnectionLine shell with the subset below. Both share this one component & one visual. */
export interface CustomEdgeProps {
  id?: string
  source?: string
  target?: string
  sourceX?: number
  sourceY?: number
  targetX?: number
  targetY?: number
  sourcePosition?: string
  targetPosition?: string
  sourceHandleId?: string | null
  targetHandleId?: string | null
  data?: { isTemp?: boolean } | null
  selected?: boolean
  temporary?: boolean
  forceFlow?: boolean
  visual?: EdgeVisual
  geometry?: EdgeAppearance
}

const props = withDefaults(defineProps<CustomEdgeProps>(), {
  sourceX: 0,
  sourceY: 0,
  targetX: 0,
  targetY: 0,
})
const { ctx, edgeVisual, edgeSelection } = useCanvasRender()
const visual = computed<EdgeVisual>(() => ({ ...edgeVisual, ...(props.visual || {}) }))
const selectionNodeIds = computed<ReadonlySet<string>>(() => edgeSelection.selectedNodeIds.value)
const selectionEdgeIds = computed<ReadonlySet<string>>(() => edgeSelection.selectedEdgeIds.value)
const isTemporaryEdge = computed(() => Boolean(props.temporary || props.data?.isTemp))

const edgeType = computed<EdgeType>(() => (visual.value.edgeType as EdgeType) || 'bezier')
const lineWidth = computed(() => visual.value.edgeLineWidth ?? 2)
const edgeColor = computed(() => visual.value.edgeColor ?? '#3b82f6')
const dashArray = computed(() =>
  visual.value.edgeDashed ? `${lineWidth.value * 4} ${lineWidth.value * 2}` : undefined,
)
const edgeAnimated = computed(() => visual.value.edgeAnimated ?? true)
const edgeMarkerEnd = computed(() => visual.value.edgeMarkerEnd ?? false)
const edgeMarkerSize = computed(() => visual.value.edgeMarkerSize ?? 8)
const edgeVisibleBase = computed(() => visual.value.edgeVisible ?? true)
// 连线可见性：临时拖线(ConnectionLine 委托渲染)永远显示，不受"隐藏连线"影响；
// 普通连线 = edgeVisible 且 (edgeVisibleOnSelect 关闭 || 无选中相关节点)。
const edgeVisibleOnSelect = computed(() => visual.value.edgeVisibleOnSelect ?? false)
const edgeShowVisual = computed(() => {
  // 临时拖线：永远显示（隐藏连线不影响拖线预览）
  if (isTemporaryEdge.value) return true
  if (!edgeVisibleBase.value) {
    // 隐藏连线：仅当开启"选中节点显示相连连线"且本边有端点被选中才显示
    if (!edgeVisibleOnSelect.value) return false
    return (
      selectionNodeIds.value.has(props.source ?? '') ||
      selectionNodeIds.value.has(props.target ?? '')
    )
  }
  return true
})
const edgeGlowEnabled = computed(() => visual.value.edgeGlowEnabled ?? true)
const edgeGlowIntensity = computed(() => visual.value.edgeGlowIntensity ?? 1)
const edgeGlowColor = computed(() => visual.value.edgeGlowColor || edgeColor.value)
const flowEnabled = computed(() => visual.value.edgeFlowEnabled ?? true)
const flowBlockSize = computed(() => visual.value.edgeFlowBlockSize ?? 90)
const flowGap = computed(() => visual.value.edgeFlowGap ?? 260)
const flowSpeed = computed(() => visual.value.edgeFlowSpeed ?? 2.5)
const flowFade = computed(() => visual.value.edgeFlowFade ?? 35)
const flowIntensity = computed(() => visual.value.edgeFlowIntensity ?? 0.9)
const geometry = computed(() => props.geometry)

const isHighlighted = computed(() =>
  isTemporaryEdge.value ||
  selectionNodeIds.value.has(props.source ?? '') ||
  selectionNodeIds.value.has(props.target ?? '') ||
  selectionEdgeIds.value.has(props.id ?? '') ||
  Boolean((props as { selected?: boolean }).selected),
)

const sourcePos = computed(() => getSourcePosition(props.sourcePosition, props.sourceHandleId))
// 临时拖线：sourcePosition/targetPosition 由 vue-flow 从源端口真实方向透传过来（ConnectionLine 已不再硬编码），
// 直接复用 getTargetPosition 的默认归一逻辑即可，无需再在组件层做位置翻转。
const targetPos = computed(() => getTargetPosition(props.targetPosition, props.targetHandleId))

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
function onMouseMove(ev: MouseEvent) { if (showCutButton.value) updateCutButtonPosition(ev) }
function cutEdge(ev: MouseEvent) {
  ev.stopPropagation(); ev.preventDefault()
  const command = ctx.get<{ has(id: string): boolean; execute(id: string, ...payload: unknown[]): unknown }>('command')
  if (command?.has('command:delete-edge')) {
    command.execute('command:delete-edge', { edgeId: props.id ?? '' })
  } else {
    const edgeStore = ctx.get<EdgeStoreService>('edgeStore')
    const save = ctx.get<SaveService>('save')
    edgeStore.removeEdge(props.id ?? '')
    save.set(GRAPH_EDGES_KEY, edgeStore.getEdges(), 'canvas')
  }
  showCutButton.value = false
}
function closeCutButton() { showCutButton.value = false }
onMounted(() => document.addEventListener('click', closeCutButton))
onUnmounted(() => document.removeEventListener('click', closeCutButton))

// 箭头：长度 = max(edgeMarkerSize, lineWidth*3.5)，线宽联动；颜色 = flowColor（与光斑同款，视觉一致）。
// 用 :style 绑到 element.style.strokeInline，优先级高于 .vue-flow 全局 .animated path 的 CSS 兜底。
const arrowLen = computed(() => Math.max(edgeMarkerSize.value, lineWidth.value * 3.5))
const arrowStroke = computed(() => Math.max(1, lineWidth.value + 0.5))
// Arrow color = line color (edgeColor), not flow color. The arrow is structural like the line itself; the flow color is reserved for the moving light blocks along the path.
const arrowColor = computed(() => edgeColor.value)
const arrowPath = computed(() => {
  if (!edgeMarkerEnd.value) return ""
  const pNear = samplePath(0.92)
  const pEnd = samplePath(1.0)
  const dx = pEnd.x - pNear.x
  const dy = pEnd.y - pNear.y
  const angle = Math.atan2(dy, dx)
  const len = arrowLen.value
  const halfOpen = Math.PI / 6.5
  const tipX = pEnd.x - Math.cos(angle) * len * 0.15
  const tipY = pEnd.y - Math.sin(angle) * len * 0.15
  const w1x = tipX - Math.cos(angle - halfOpen) * len
  const w1y = tipY - Math.sin(angle - halfOpen) * len
  const w2x = tipX - Math.cos(angle + halfOpen) * len
  const w2y = tipY - Math.sin(angle + halfOpen) * len
  return `M ${w1x} ${w1y} L ${tipX} ${tipY} L ${w2x} ${w2y}`
})

// 流动总开关：edgeFlowEnabled && edgeAnimated。色块一直跑。
// 颜色：flowColor = edgeGlowColor（设置里"辉光颜色"，缺省跟随线色），箭头/光斑/亮核同色 = 一种效果。
const flowActive = computed(() => flowEnabled.value && edgeAnimated.value)
const dashCycle = computed(() => Math.max(20, flowBlockSize.value + flowGap.value))
const cssDurSec = computed(() => {
  const pxPerSec = Math.max(8, flowSpeed.value * 60)
  return Math.max(0.6, dashCycle.value / pxPerSec)
})
const railColor = computed(() => edgeColor.value)
const railWidth = computed(() => Math.max(1, lineWidth.value))
const flowColor = computed(() => edgeGlowColor.value || edgeColor.value)
const softWidth = computed(() => Math.max(2, lineWidth.value * 2.4))
const hotWidth = computed(() => Math.max(1.5, lineWidth.value))

const gStyle = computed(() => ({
  '--ce-color': edgeColor.value,
  '--ce-linew': lineWidth.value + 'px',
  '--ce-flow-color': flowColor.value,
  '--ce-arrow-opacity': isHighlighted.value ? 1 : 0.55,
  '--ce-cycle': dashCycle.value + 'px',
  '--ce-dur': cssDurSec.value + 's',
  '--ce-block': flowBlockSize.value + 'px',
  '--ce-gap': flowGap.value + 'px',
}))
</script>

<template>
  <g
    class="custom-edge"
    :class="{ highlight: isHighlighted, 'is-temporary': isTemporaryEdge }"
    :style="gStyle"
    @dblclick="showCutButtonAtPointer"
    @mousemove="onMouseMove"
  >
    <template v-if="edgeShowVisual">
      <template v-if="!flowActive">
        <path
          class="ef-base"
          :class="isHighlighted ? '' : 'ef-base--dim'"
          :d="edgePath"
          fill="none"
          :stroke="edgeColor"
          :stroke-width="lineWidth"
          stroke-linecap="round"
          :stroke-dasharray="dashArray"
        />
      </template>
      <template v-else>
        <path
          class="ef-rail"
          :d="edgePath"
          fill="none"
          :stroke="railColor"
          :stroke-width="railWidth"
          stroke-linecap="round"
          :stroke-dasharray="dashArray"
        />
        <path
          v-if="edgeGlowEnabled"
          class="ef-flow ef-flow--soft"
          :d="edgePath"
          fill="none"
          :stroke="flowColor"
          :stroke-width="softWidth"
          stroke-linecap="round"
          :style="{
            strokeDasharray: `${flowBlockSize}px ${flowGap}px`,
            opacity: Math.max(0.15, flowIntensity * 0.45),
            filter: isHighlighted ? `drop-shadow(0 0 ${4 * edgeGlowIntensity}px ${flowColor})` : 'none',
          }"
        />
        <path
          class="ef-flow ef-flow--hot"
          :d="edgePath"
          fill="none"
          :stroke="flowColor"
          :stroke-width="hotWidth"
          stroke-linecap="round"
          :style="{
            strokeDasharray: `${flowBlockSize}px ${flowGap}px`,
            opacity: Math.min(1, flowIntensity + 0.1),
          }"
        />
      </template>
      <path
        v-if="edgeMarkerEnd"
        class="ef-arrow"
        :d="arrowPath"
        fill="none"
        :stroke="arrowColor"
        :stroke-width="arrowStroke"
        stroke-linecap="round"
        stroke-linejoin="round"
        :style="{ opacity: isHighlighted ? 1 : 0.6 }"
      />

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
            <path d="M14.1 14.1L19 19m-7-7l7-7m-7 7l-2.9 2.9M12 12L9.1 9.1" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </foreignObject>
    </template>

    <!-- 透明点击热区：独立于可见性 —— 隐藏连线时仍可选中/双击删除；临时拖线不渲染 -->
    <path
      v-if="!isTemporaryEdge"
      class="edge-hit-area"
      :data-edge-id="id"
      :d="edgePath"
      fill="none"
      stroke="transparent"
      :stroke-width="Math.max(12, lineWidth)"
      stroke-linecap="round"
    />
  </g>
</template>

<style scoped>
.custom-edge { cursor: pointer; }
.custom-edge .ef-base,
.custom-edge .ef-rail,
.custom-edge .ef-arrow {
  transition: stroke 0.2s, stroke-width 0.2s, opacity 0.2s;
}
.edge-hit-area { pointer-events: stroke; }
/* Temporary drag line (rendered inside ConnectionLine) must never capture pointer:
   otherwise it steals hover/drop from the node/port below and causes flicker. */
.custom-edge.is-temporary path,
.custom-edge.is-temporary foreignObject {
  pointer-events: none;
}
.custom-edge.is-temporary { cursor: default; }
.ef-base { opacity: 0.45; }
.ef-base--dim { opacity: 0.3; }
.ef-rail { opacity: 0.65; }
.ef-flow--soft { pointer-events: none; }
.ef-flow--hot { pointer-events: none; }
.ef-flow--soft,
.ef-flow--hot {
  animation-name: ce-flow;
  animation-iteration-count: infinite;
  animation-timing-function: linear;
  animation-duration: var(--ce-dur, 4s);
  will-change: stroke-dashoffset;
}
@keyframes ce-flow {
  from { stroke-dashoffset: 0; }
  to   { stroke-dashoffset: calc(0px - var(--ce-cycle, 350px)); }
}
.cut-btn {
  display: flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; border-radius: 50%; border: none;
  background: rgba(255, 255, 255, 0.95); color: #374151;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15); cursor: pointer; padding: 0;
  transition: background 0.15s;
}
.cut-btn:hover { background: #ef4444; color: #fff; }
</style>

<style>
.vue-flow__edge.animated .custom-edge path.ef-base {
  stroke-dasharray: var(--ce-da) !important;
}
</style>