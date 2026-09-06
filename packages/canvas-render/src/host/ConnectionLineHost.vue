<script setup lang="ts">
/**
 * ConnectionLineHost —— canvas-render 能力层内部的"#connection-line"桥接组件（纯渲染）。
 *
 * 职责（纯渲染，不做几何判定）：
 *   1. 渲染 themeRegistry 的 connectionLine 赢家组件作"临时连接线"；未注册时回落一条最简贝塞尔路径。
 *   2. 端点来源：start=VueFlow lineProps.sourceX/Y（handle 锚点，缩放/平移时 VueFlow 自动跟随），
 *      end=Host dragFlowPoint（拖线 mousemove 实时写的 flow 坐标；fallback lineProps.targetX/Y），
 *      hasSnap=state.hoverNode.zone==='snap'（吸附判定由 Host 解析后写共享 state）。
 *
 * 关键变更：之前本组件在 feedback computed 内自行调 resolveFeedback + rAF 写 hoverNode → 与 Host 端 resolveAtClient
 * 形成双源重复计算，每次 mousemove 触发两次 resolveFeedback + 两次 ref 写，拖线期间卡顿明显。现拆成：Host 解析
 * 几何 → 写 dragFlowPoint/hoverNode → ConnectionLineHost 只读，零额外计算，渲染与决策彻底解耦。
 */
import { computed } from 'vue'
import type { ConnectionLineProps } from '@vue-flow/core'
import type { ConnectionFeedbackState } from '../contracts/connectionContext'

const props = defineProps<{
  /** VueFlow 经 #connection-line 槽传入的连接线 props（targetX/Y 为每帧 flow 坐标） */
  lineProps: ConnectionLineProps
  /** themeRegistry connectionLine 赢家组件；未注册 = null → 回退默认线 */
  connectionLine: unknown
  /** 供能力层使用的 connectionState（同一引用，与 useCanvasRender 一致）。ConnectionLineHost 只读不写 */
  state: ConnectionFeedbackState
  /** Host 端 mousemove 实时跟踪的 flow 坐标（拖线外为 null）。优先于 lineProps.targetX/Y 用于连接线端点渲染，
   *  因为合成事件/某些输入路径下 VueFlow 自身的 lineProps 不更新。 */
  dragFlowPoint?: { x: number; y: number } | null
}>()

// 拖线中渲染数据来源：
//   - start 端：VueFlow lineProps.sourceX/Y（handle 锚点，缩放时 VueFlow 自己跟着变 → 准确）
//   - end 端：CanvasHost dragFlowPoint（拖线 mousemove 实时写的 flow 坐标；fallback 到 lineProps.targetX/Y）
//   - hasSnap：state.hoverNode.zone==='snap'（吸附判定由 CanvasHost 解析，避免双源重渲卡顿）
const start = computed(() => ({ x: props.lineProps.sourceX, y: props.lineProps.sourceY }))
const end = computed(() => props.dragFlowPoint ?? { x: props.lineProps.targetX, y: props.lineProps.targetY })
const hasSnap = computed(() => props.state.hoverNode.value?.zone === 'snap')

// 默认回落线路径（贝塞尔，两点水平控点）
const defaultPath = computed(() => {
  const sx = start.value.x
  const sy = start.value.y
  const ex = end.value.x
  const ey = end.value.y
  const mx = (sx + ex) / 2
  return `M ${sx} ${sy} C ${mx} ${sy} ${mx} ${ey} ${ex} ${ey}`
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
