<script setup lang="ts">
// DefaultBackground —— 主题插件提供的画布背景（示例：跟随画布平移/缩放的圆点网格）。
// 背景没有 vue-flow 注册口 → 走"低层 child 叠加组件"通用法：宿主把它垫在节点/边之下渲染。
// 用 useVueFlow() 读 viewport(x,y,zoom) 把网格平移/缩放对齐内容坐标。
import { computed } from 'vue'
// 渲染原语经内核精选出口统一 import（不各自依赖 @vue-flow/core，见 vueFlowBridge）
import { useVueFlow } from '@mini-canvas/canvas-core-v2'

const { viewport } = useVueFlow()

// 网格间距(内容坐标)，随 zoom 放大避免过密
const GRID = 24
const zoom = computed(() => Math.max(viewport.value?.zoom || 1, 0.01))
const vx = computed(() => viewport.value?.x ?? 0)
const vy = computed(() => viewport.value?.y ?? 0)

// 屏幕尺寸(近似取整页)；这里用固定大值保证覆盖可视区
const W = 4000
const H = 4000

// 生成该"内容网格"下落在视口的圆点（简化：画一满屏内容坐标点，交给 transform 缩放平移）
const dots = computed(() => {
  const z = zoom.value
  const g = GRID
  const step = Math.max(g * z, 14) // 屏幕间距下限，避免缩放后过密
  const list: Array<{ cx: number; cy: number }> = []
  // 屏幕左上/右下对应的内容坐标范围
  const x0 = -vx.value / z
  const y0 = -vy.value / z
  const x1 = (W - vx.value) / z
  const y1 = (H - vy.value) / z
  for (let x = Math.floor(x0 / g) * g; x <= x1; x += step) {
    for (let y = Math.floor(y0 / g) * g; y <= y1; y += step) {
      list.push({ cx: x, cy: y })
    }
  }
  return list
})
</script>

<template>
  <!-- 铺满、不挡交互；圆点按内容坐标随画布平移/缩放 -->
  <div class="theme-default-bg">
    <svg :width="W" :height="H" class="bg-svg">
      <g :transform="`translate(${vx} ${vy}) scale(${zoom})`">
        <circle v-for="(d, i) in dots" :key="i" :cx="d.cx" :cy="d.cy" r="1.6" class="dot" />
      </g>
    </svg>
  </div>
</template>

<style scoped>
.theme-default-bg {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 0; /* 垫在节点之下：宿主保证层级 */
  background: #f8fafc;
}
.bg-svg {
  position: absolute;
  left: 0;
  top: 0;
}
.dot {
  fill: #cbd5e1;
}
</style>
