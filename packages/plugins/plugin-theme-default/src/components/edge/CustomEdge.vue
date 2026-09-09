<script setup lang="ts">
// CustomEdge —— v2 自定义边/连接线（移植自 v1 components/CustomEdge.vue，金标准 core-node-contract §6）。
// 职责：按全局配置渲染边路径(bezier/straight/step/smoothstep)；默认导轨 + 同色光斑沿路径流动；
//       选中/相连/临时/force 边加亮（drop-shadow 强化）；提供加宽透明点击热区 + 双击弹剪切钮删除。
// 视觉语言（参考 canvas-core-v2/demo-html-ui/bezier_glow_flow_line）。
// 流动动画：不用 SVG <animate> SMIL（根因：vdom patch 把 <animate> 当 path child 反复比较，
//       path 的 d 在多次 patch 后被清空、bbox=0、光斑不可见——浏览器实测）；也不用纯 CSS stroke-dashoffset
//       keyframes（那样光斑是"等不透明度硬块"，两端没有 demo 的渐隐）。两段渐隐靠 JS rAF + 每块一个
//       linearGradient 钉在块两端实现（见文件底部"胶囊渐变"渲染器）。
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

// ============================================================================
// 光斑"胶囊渐变"渲染器（参考 canvas-core-v2/demo-html-ui/bezier_glow_flow_line）
// ----------------------------------------------------------------------------
// 需求：当前流光块是整段等不透明度的"硬块"（软辉光层+亮芯层，stroke-dashoffset 硬切），
//       缺少 demo 里每个色斑"头尾两端渐隐"的胶囊感（flowFade 配置项长期闲置未生效）。
//
// 为什么不能沿用纯 CSS 的 stroke-dashoffset 动画实现两端渐隐：
//   块在路径上由 dashoffset 平移，而 alpha 渐变要么是"世界坐标固定"(gradientUnits=userSpaceOnUse，
//   块移动后渐变的淡出点不再跟着块走)，要么是对象包围盒(非路径长度向)。要让"随块移动的两端渐隐"
//   必须 JS 驱动：每个可见块一个 path + 一个 linearGradient，逐帧把渐变坐标钉在块的两端世界坐标上。
//
// 为什么用"直接 DOM 写入"(非响应式 v-for)：
//   本仓库踩过 vdom patch 反复比较 SVG 子元素把 path 的 d 清空的坑，故这里全部走
//   createElementNS + setAttribute 手工管理，块的数量/属性不进 Vue 响应式，杜绝 patch 干扰。
//
// 逐帧成本：O(可见块数) 次 setAttribute(渐变 4 坐标 + path 偏移)，块每 ~(block+gap)px 一个，
//   仅在 flowActive && 有几何长度时跑，空闲直接 return(几乎零开销)。配置/几何变化走签名比对。
// ============================================================================

// 供渐变 unique id 使用：跨实例、跨重挂载保证全局唯一
let _edgeFxUid = 0
const _fxIdBase = `efx_${(Date.now() & 0xffffff).toString(36)}_${_edgeFxUid++}`
const _svgNS = 'http://www.w3.org/2000/svg'

// 流动层容器与可测长的导轨（同一条 path d，rails 负责"测长 + 采样点"，胶囊块负责"画"）
const capsuleHostEl = ref<SVGGElement | null>(null)
const railEl = ref<SVGPathElement | null>(null)

// 胶囊块池（每块 = 软辉光 path + 亮芯 path + 各自 linearGradient），全部非响应式
let _capSoftGrads: SVGLinearGradientElement[] = []
let _capHotGrads: SVGLinearGradientElement[] = []
let _capSoftPaths: SVGPathElement[] = []
let _capHotPaths: SVGPathElement[] = []
let _capRaf = 0
let _capPrevTs = 0
let _capAnimDist = 0
let _capConfigSig = ''
let _capOwnHost: SVGGElement | null = null

// 合并可见层所需常量（随配置实时算）
function _capsuleLayerConst() {
  const glow = edgeGlowEnabled.value
  const softA = glow ? Math.max(0.15, flowIntensity.value * 0.45) : 0
  const hotA = Math.min(1, flowIntensity.value + 0.1)
  return {
    softW: Math.max(2, lineWidth.value * 2.4),
    hotW: Math.max(1.5, lineWidth.value),
    softA,
    hotA,
    color: flowColor.value,
    fade: Math.max(1, Math.min(50, flowFade.value)),
    softOn: glow,
  }
}

function _setGradStops(g: SVGLinearGradientElement, maxAlpha: number, color: string, fade: number) {
  g.innerHTML = ''
  const mk = (off: number, op: number) => {
    const s = document.createElementNS(_svgNS, 'stop')
    s.setAttribute('offset', `${off}%`)
    s.setAttribute('stop-color', color)
    s.setAttribute('stop-opacity', String(op))
    g.appendChild(s)
  }
  mk(0, 0)
  mk(fade, maxAlpha)
  mk(100 - fade, maxAlpha)
  mk(100, 0)
}

function _makeGrad(host: SVGGElement, id: string, maxAlpha: number, color: string, fade: number): SVGLinearGradientElement {
  const g = document.createElementNS(_svgNS, 'linearGradient')
  g.id = id
  g.setAttribute('gradientUnits', 'userSpaceOnUse')
  host.appendChild(g)
  _setGradStops(g, maxAlpha, color, fade)
  return g
}

function _makeFlowPath(host: SVGGElement, gradId: string, width: number): SVGPathElement {
  const p = document.createElementNS(_svgNS, 'path')
  p.setAttribute('fill', 'none')
  p.setAttribute('stroke', `url(#${gradId})`)
  p.setAttribute('stroke-width', String(width))
  p.setAttribute('stroke-linecap', 'round')
  p.setAttribute('pointer-events', 'none')
  host.appendChild(p)
  return p
}

/** 配置/高亮变化（不含逐帧几何）→ 整体重建池子，保证新块按最新配置取色
 *  注意：isHighlighted / edgeGlowIntensity 只作用于容器 drop-shadow，逐帧直接改 style.filter，不纳入重建签名。 */
function _syncCapsuleConfig(host: SVGGElement) {
  const c = _capsuleLayerConst()
  const sig = [
    c.softOn, c.softA, c.hotA, c.color, c.fade, c.softW, c.hotW,
  ].join('|')
  if (sig === _capConfigSig) return
  _capConfigSig = sig
  // 清空重建（配置改动罕见）
  host.innerHTML = ''
  _capSoftGrads = []
  _capHotGrads = []
  _capSoftPaths = []
  _capHotPaths = []
}

function _appendCapsuleBlock(host: SVGGElement, color: string, fade: number, softW: number, hotW: number, softA: number, hotA: number) {
  const i = _capSoftGrads.length
  const sg = _makeGrad(host, `${_fxIdBase}_sg_${i}`, softA, color, fade)
  const hg = _makeGrad(host, `${_fxIdBase}_hg_${i}`, hotA, color, fade)
  const sp = _makeFlowPath(host, sg.id, softW)
  const hp = _makeFlowPath(host, hg.id, hotW)
  _capSoftGrads.push(sg)
  _capHotGrads.push(hg)
  _capSoftPaths.push(sp)
  _capHotPaths.push(hp)
}

function _dropCapsuleBlock(host: SVGGElement) {
  const take = (arr: SVGElement[]) => arr.pop()!
  const sg = take(_capSoftGrads)
  const hg = take(_capHotGrads)
  const sp = take(_capSoftPaths)
  const hp = take(_capHotPaths)
  for (const el of [sg, hg, sp, hp]) host.removeChild(el)
}

/** 逐帧：把每个可见块的渐变坐标钉到块两端、dash 揭示该段 */
function _renderFlowFrame(ts: number) {
  _capRaf = requestAnimationFrame(_renderFlowFrame)
  const rail = railEl.value
  const host = capsuleHostEl.value
  const active =
    flowActive.value && edgeShowVisual.value && Boolean(rail) && Boolean(host)
  if (!active) {
    _capPrevTs = 0
    return
  }
  // 时间归一流速（px/frame @60fps）
  const cycle = Math.max(1, flowBlockSize.value + flowGap.value)
  if (_capPrevTs) {
    const dt = ts - _capPrevTs
    const adv = flowSpeed.value * (dt / (1000 / 60))
    _capAnimDist = ((_capAnimDist + adv) % cycle + cycle) % cycle
  }
  _capPrevTs = ts

  const railNode = rail!
  const hostNode = host!
  let totalLen = 0
  try {
    totalLen = railNode.getTotalLength()
  } catch {
    /* 几何尚未就绪 */
  }
  if (!(totalLen > 0)) {
    hostNode.style.display = 'none'
    return
  }
  hostNode.style.display = ''
  // 宿主重挂载(flowActive 开关/v-show 重建)时池子里是旧的已卸载节点 → 归零重建，避免对无关宿主 removeChild
  if (hostNode !== _capOwnHost) {
    _capOwnHost = hostNode
    _capSoftGrads = []
    _capHotGrads = []
    _capSoftPaths = []
    _capHotPaths = []
    _capConfigSig = ''
  }
  const c = _capsuleLayerConst()
  _syncCapsuleConfig(hostNode)

  // 遍历当前应可见的所有块起点
  const starts: number[] = []
  const startD = _capAnimDist - cycle
  for (let dist = startD; dist < totalLen + cycle; dist += cycle) {
    if (dist + flowBlockSize.value >= 0 && dist <= totalLen) starts.push(dist)
  }
  // 增删池子到匹配
  while (_capSoftGrads.length < starts.length) {
    _appendCapsuleBlock(hostNode, c.color, c.fade, c.softW, c.hotW, c.softA, c.hotA)
  }
  while (_capSoftGrads.length > starts.length) {
    _dropCapsuleBlock(hostNode)
  }

  const dAttr = railNode.getAttribute('d') || ''
  const dashGap = Math.max(totalLen * 2, 1)
  const block = flowBlockSize.value
  const clampN = (n: number) => Math.max(0, Math.min(totalLen, n))
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i]
    const e = s + block
    const vs = clampN(s)
    const ve = clampN(e)
    if (ve - vs <= 0) continue
    const ps = railNode.getPointAtLength(vs)
    const pe = railNode.getPointAtLength(ve)
    const sg = _capSoftGrads[i]
    const hg = _capHotGrads[i]
    const sp = _capSoftPaths[i]
    const hp = _capHotPaths[i]
    sg.setAttribute('x1', String(ps.x)); sg.setAttribute('y1', String(ps.y))
    sg.setAttribute('x2', String(pe.x)); sg.setAttribute('y2', String(pe.y))
    hg.setAttribute('x1', String(ps.x)); hg.setAttribute('y1', String(ps.y))
    hg.setAttribute('x2', String(pe.x)); hg.setAttribute('y2', String(pe.y))
    sp.setAttribute('d', dAttr)
    sp.setAttribute('stroke-dasharray', `${block} ${dashGap}`)
    sp.setAttribute('stroke-dashoffset', String(-s))
    hp.setAttribute('d', dAttr)
    hp.setAttribute('stroke-dasharray', `${block} ${dashGap}`)
    hp.setAttribute('stroke-dashoffset', String(-s))
  }
  // 高亮光晕：整组 drop-shadow，跟随所有胶囊块一起移动
  hostNode.style.filter = isHighlighted.value
    ? `drop-shadow(0 0 ${4 * edgeGlowIntensity.value}px ${c.color})`
    : 'none'
}

onMounted(() => {
  _capRaf = requestAnimationFrame(_renderFlowFrame)
})
onUnmounted(() => {
  cancelAnimationFrame(_capRaf)
  _capRaf = 0
})
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
          ref="railEl"
          class="ef-rail"
          :d="edgePath"
          fill="none"
          :stroke="railColor"
          :stroke-width="railWidth"
          stroke-linecap="round"
          :stroke-dasharray="dashArray"
        />
        <!-- 胶囊渐变光斑容器：子节点(每块 soft/hot path + 各自 linearGradient)由 JS 逐帧直接 DOM 写入，
             不进 Vue 响应式(规避 vdom patch 清空 d 的坑)。railEl 与胶囊块共享同一 d，负责测长/采样点。 -->
        <g ref="capsuleHostEl" class="ef-capsules"></g>
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
/* 胶囊渐变光斑容器：子 path 均为 pointer-events:none（由 _makeFlowPath 内联设置），容器再兜底一次 */
.ef-capsules { pointer-events: none; }
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