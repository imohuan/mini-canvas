<script setup lang="ts">
/**
 * ConnectionLineHost —— canvas-render 能力层内部的"#connection-line"桥接组件。
 *
 * 职责（能力，不做视觉美化）：
 *   1. 每帧(拖线中，VueFlow 更新 #connection-line props)算出吸附终点 + hover 反馈(resolveFeedback 纯模块)，
 *      并以 rAF 节流写回 connectionState.hoverNode（供 BaseNode 做 3D/气泡/吸附带）。
 *   2. 渲染 themeRegistry 的 connectionLine 赢家组件作"临时连接线"；未注册时回落一条最简贝塞尔路径
 *      （保证不注册主题也看得出在拖线）。好看与否由主题 connectionLine 组件决定（canvas-render 不烘焙视觉）。
 *
 * 运行环境：CanvasSurface 的 <VueFlow> #connection-line 槽内 → 在 VueFlow 与 renderContext provide 作用域内，
 * 可 useVueFlow() 拿节点实测尺寸、useCanvasRender() 拿 ctx(校验)/connectionState(读写)。
 *
 * 坑（来自 v1 useCanvasConnection 注释）：在 connection-line 渲染函数里写 reactive 状态必须 rAF 节流 +
 * hoverChanged 比对，否则 hoverNode 变→BaseNode 重渲→本组件所在槽重渲→再写→Maximum recursive updates。
 * 本组件模板不读 connectionState.hoverNode（避免把它变成渲染依赖）。
 */
import { computed, onBeforeUnmount } from 'vue'
import type { ConnectionLineProps } from '@vue-flow/core'
import { useVueFlow } from '@vue-flow/core'
import { resolveFeedback } from '../connection/resolveFeedback'
import { DEFAULT_SNAP_RATIOS, type NodeRect } from '../connection/geometry'
import type { ConnectionFeedbackState, FlowPoint, HoverFeedback } from '../contracts/connectionContext'
import { hoverWriter } from '../host/connectionState'
import { createV2Logger } from '../utils/log'

const log = createV2Logger('conn-line')

const props = defineProps<{
  /** VueFlow 经 #connection-line 槽传入的连接线 props（targetX/Y 为每帧 flow 坐标） */
  lineProps: ConnectionLineProps
  /** themeRegistry connectionLine 赢家组件；未注册 = null → 回退默认线 */
  connectionLine: unknown
  /** 候选连接校验：给定(规范 source,target) 返回非法文案(空串=合法)。由 CanvasHost 封装内核 validateConnection */
  validateEdge: (sourceId: string, targetId: string) => string
  /** 端口半径(供吸附带计算)；来自 handleParams.handleRadius，CanvasHost 注入 */
  handleRadius: number
  /** 供能力层使用的 connectionState（同一引用，与 useCanvasRender 一致） */
  state: ConnectionFeedbackState
}>()

const vf = useVueFlow()

// ---- 存活节点矩形（flow 坐标，排除拖线源自身）----
const sourceId = computed(() => props.state.activeConnection.value?.sourceNodeId ?? null)
const sourceHandle = computed(() => props.state.activeConnection.value?.sourceHandle ?? 'source')

// 节点矩形来源：VueFlow 实测 (computedPosition + dimensions)，缺失回落 defaultSize
const nodeRects = computed<NodeRect[]>(() => {
  const srcId = sourceId.value
  const flows = vf.getNodes.value as Array<{
    id: string
    type: string
    computedPosition?: { x: number; y: number }
    position: { x: number; y: number }
    dimensions?: { width: number; height: number }
  }>
  const out: NodeRect[] = []
  for (const n of flows) {
    if (n.id === srcId) continue
    const pos = n.computedPosition || n.position
    const dim = n.dimensions
    out.push({
      id: n.id,
      type: n.type,
      x: pos.x,
      y: pos.y,
      width: dim?.width || 256,
      height: dim?.height || 128,
    })
  }
  return out
})

// ---- 每帧决策：吸附终点 + hover；rAF 节流写回 hoverNode ----
const writer = hoverWriter(props.state)
let rafId = 0
let pendingHover: HoverFeedback | null = null

/** 判定 hover 是否变化（与当前写回值比对，避免无谓重写导致循环） */
function scheduleHoverWrite(next: HoverFeedback | null) {
  const cur = writer.read()
  const changed =
    cur?.nodeId !== next?.nodeId ||
    cur?.status !== next?.status ||
    cur?.zone !== next?.zone ||
    cur?.reason !== next?.reason ||
    cur?.flowPosition?.x !== next?.flowPosition?.x ||
    cur?.flowPosition?.y !== next?.flowPosition?.y
  if (changed) {
    log.log('hover→', next ? `${next.nodeId}/${next.status}/${next.zone}${next.reason ? ' ' + next.reason : ''}` : 'null')
  }
  if (!changed) return
  pendingHover = next
  if (rafId) return
  rafId = requestAnimationFrame(() => {
    rafId = 0
    writer.write(pendingHover)
  })
}

// 拖线中：逐帧由 lineProps.targetX/Y 变化触发 → resolveFeedback
const feedback = computed(() => {
  const srcId = sourceId.value
  const sh = sourceHandle.value
  if (!srcId) return null
  const point: FlowPoint = { x: props.lineProps.targetX, y: props.lineProps.targetY }
  const res = resolveFeedback({
    sourceId: srcId,
    sourceHandle: sh,
    nodeRects: nodeRects.value,
    flowPoint: point,
    handleRadius: props.handleRadius || 86,
    ratios: DEFAULT_SNAP_RATIOS,
    validate: props.validateEdge,
  })
  // 副作用：把 hover 投影成 state 写的 HoverFeedback（含 flowPosition）
  scheduleHoverWrite(
    res.hover
      ? {
          nodeId: res.hover.nodeId,
          status: res.hover.status,
          zone: res.hover.zone,
          flowPosition: point,
          reason: res.hover.reason,
        }
      : null,
  )
  return res
})

// ---- 绘制数据 ----
const start = computed(() => ({ x: props.lineProps.sourceX, y: props.lineProps.sourceY }))
const end = computed(() => feedback.value?.end ?? { x: props.lineProps.targetX, y: props.lineProps.targetY })
/** 是否命中某个合法可吸附点（供默认线/主题组件改色） */
const hasSnap = computed(() => feedback.value?.snappedToId != null)

// 默认回落线路径（贝塞尔，两点水平控点）
const defaultPath = computed(() => {
  const sx = start.value.x
  const sy = start.value.y
  const ex = end.value.x
  const ey = end.value.y
  const mx = (sx + ex) / 2
  return `M ${sx} ${sy} C ${mx} ${sy} ${mx} ${ey} ${ex} ${ey}`
})

// props.state 固定同源；无需额外清理 ref
onBeforeUnmount(() => {
  if (rafId) cancelAnimationFrame(rafId)
})
</script>

<template>
  <!-- 主题注册的 connectionLine 赢家：拿吸附后终点/状态自己画漂亮线 -->
  <component
    :is="connectionLine"
    v-if="connectionLine"
    :source-x="start.x"
    :source-y="start.y"
    :target-x="end.x"
    :target-y="end.y"
    :has-snap="hasSnap"
    :validate-reason="''"
  />
  <!-- 未注册主题线：回退一条最简贝塞尔（仅表达"在拖线"，无特效） -->
  <path
    v-else
    :d="defaultPath"
    class="vue-flow__connection-path"
    fill="none"
    stroke="#b1b1b7"
    stroke-width="1.5"
    stroke-dasharray="5 5"
  />
</template>
