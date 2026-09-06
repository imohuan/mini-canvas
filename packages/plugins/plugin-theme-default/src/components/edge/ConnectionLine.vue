<script setup lang="ts">
// ConnectionLine —— 默认主题的拖线临时连接线（canvas-render 的 #connection-line 槽渲染它）。
// 纯视觉：拖线时画一条跟随鼠标/吸附端点的贝塞尔线，带箭头 + 流光高亮，依当前 hover 合法性着色。
// 数据来源：props(source/target 端点) 由 canvas-render ConnectionLineHost 每帧算好（target 已吸附或随鼠标）；
//         connectionState 读当前拖线状态与 hover 合法性来定颜色。
// 角色：canvas-render 只提供"能力/端点"，视觉走线(bezier/箭头/流光/配色)由本主题组件决定 —— 这就是"UI 渲染"层。
import { computed } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'

const props = defineProps<{
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  /** 是否吸附到某个合法可连目标（canvas-render 判定） */
  hasSnap?: boolean
}>()

// 读统一上下文：当前拖线 hover 合法性（决定线的颜色语义）
const { connectionState } = useCanvasRender()
const isConnecting = computed(() => connectionState.isConnecting.value)
const hoverNode = computed(() => connectionState.hoverNode.value)

// 路径：贝塞尔（源在左，鼠标/吸附在右，水平控点）
const path = computed(() => {
  const sx = props.sourceX
  const sy = props.sourceY
  const ex = props.targetX
  const ey = props.targetY
  const mx = (sx + ex) / 2
  return `M ${sx} ${sy} C ${mx} ${sy} ${mx} ${ey} ${ex} ${ey}`
})

// 手绘箭头：沿三次贝塞尔路径末端采样方向
const arrowPath = computed(() => {
  const sx = props.sourceX
  const sy = props.sourceY
  const ex = props.targetX
  const ey = props.targetY
  const cx = (sx + ex) / 2
  const cy = (sy + ey) / 2 // 控点 = 两端中点，与 path 一致
  // 三次贝塞尔点
  const bez = (t: number) => {
    const u = 1 - t
    const a = u * u * u
    const b = 3 * u * u * t
    const c = 3 * u * t * t
    const d = t * t * t
    return { x: a * sx + b * cx + c * cx + d * ex, y: a * sy + b * cy + c * cy + d * ey }
  }
  const p0 = bez(0.88)
  const p1 = bez(1)
  const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x)
  const len = 9
  const half = Math.PI / 6
  const w1x = p1.x - Math.cos(angle - half) * len
  const w1y = p1.y - Math.sin(angle - half) * len
  const w2x = p1.x - Math.cos(angle + half) * len
  const w2y = p1.y - Math.sin(angle + half) * len
  return `M ${w1x} ${w1y} L ${p1.x} ${p1.y} L ${w2x} ${w2y}`
})

// 状态着色：非法 → 红；合法吸附/hover 合法 → 亮蓝辉光；普通拖线 → 主题蓝
const stateClass = computed(() => {
  if (!isConnecting.value) return 'idle'
  if (hoverNode.value?.status === 'invalid') return 'invalid'
  if (props.hasSnap || hoverNode.value?.status === 'valid') return 'valid'
  return 'idle'
})
</script>

<template>
  <g class="theme-conn-line" :class="`is-${stateClass}`">
    <path class="tcl-base" :d="path" fill="none" stroke-width="2" stroke-linecap="round" pathLength="300" />
    <path class="tcl-runner" :d="path" fill="none" stroke-width="1.4" stroke-linecap="round" pathLength="300" />
    <path class="tcl-arrow" :d="arrowPath" fill="none" stroke-width="2" stroke-linecap="round"
      stroke-linejoin="round" />
  </g>
</template>

<style scoped>
.theme-conn-line {
  pointer-events: none;
}

.tcl-base {
  opacity: 0.55;
  stroke: #3b82f6;
}

.tcl-runner {
  opacity: 0.9;
  stroke: #2563eb;
  stroke-dasharray: 24 76;
  stroke-dashoffset: 0;
  animation: tcl-dash 1.1s linear infinite;
}

.tcl-arrow {
  stroke: #3b82f6;
  opacity: 0.9;
}

.theme-conn-line.is-invalid .tcl-base,
.theme-conn-line.is-invalid .tcl-arrow {
  stroke: #ef4444;
  opacity: 0.8;
}

.theme-conn-line.is-invalid .tcl-runner {
  display: none;
}

.theme-conn-line.is-valid .tcl-base {
  stroke: #2563eb;
  filter: drop-shadow(0 0 4px rgba(37, 99, 235, 0.6));
  opacity: 1;
}

@keyframes tcl-dash {
  to {
    stroke-dashoffset: -100;
  }
}
</style>
