<script setup lang="ts">
// DefaultBackground —— 主题插件提供的画布背景（圆点网格）。
// 用 <canvas> 绘制，取代"生成数千 SVG 圆点 + v-for 全量渲染"的方案，消除高节点数量导致的卡顿。
// 背景无 vue-flow 注册口 → 走"低层 child 叠加组件"通用法，宿主把它垫在节点/边之下渲染。
// 画法：canvas 尺寸 = 宿主可视区(×DPR)，每帧用 transform 把可视区内的内容系格点直接绘出，
//       圆点随 viewport(x,y,zoom) 平移缩放，与内容坐标对齐。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useVueFlow } from '@mini-canvas/canvas-render'

const { viewport } = useVueFlow()

const hostEl = ref<HTMLElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)

// 网格间距(内容坐标)；zoom 放大时用屏幕间距下限采样，避免点过密
const GRID = 24
const MIN_SCREEN_STEP = 18 // 屏幕像素下限：缩小画布时点距不小于它
const DOT_R = 1.6 // 圆点半径(内容坐标，会随 zoom 等比缩放)
const DOT_COLOR = '#cbd5e1'
const BG_COLOR = '#f8fafc'

const zoom = computed(() => Math.max(viewport.value?.zoom || 1, 0.01))
const vx = computed(() => viewport.value?.x ?? 0)
const vy = computed(() => viewport.value?.y ?? 0)

let width = 0
let height = 0
let dpr = 1
let ro: ResizeObserver | null = null

// 宿主可视区尺寸变化/DPR 变化 → 重建 canvas 位图
function fitCanvas() {
  const host = hostEl.value
  if (!host) return
  width = host.clientWidth
  height = host.clientHeight
  dpr = window.devicePixelRatio || 1
  if (canvasEl.value) {
    canvasEl.value.width = Math.max(1, Math.round(width * dpr))
    canvasEl.value.height = Math.max(1, Math.round(height * dpr))
  }
}

// 把可视区内的圆点画一帧。只在视口/尺寸变化时触发一次，非持续动画。
function redraw() {
  const cv = canvasEl.value
  const ctx = cv?.getContext('2d')
  if (!cv || !ctx || !width || !height) return

  const z = zoom.value
  const g = GRID

  // 内容系网格步长：放大足够时=GRID，过密则抬升到满足屏幕间距下限
  // 屏幕步长 stepScreen = g*z；若它 < 下限，改内容步长 = MIN_SCREEN_STEP / z
  const stepContent = Math.max(g, MIN_SCREEN_STEP / z)

  // 可视区域的内容坐标范围
  const x0 = -vx.value / z
  const y0 = -vy.value / z
  const x1 = x0 + width / z
  const y1 = y0 + height / z

  // 从内容系取整格点列/行
  const colStart = Math.floor(x0 / stepContent) * stepContent
  const rowStart = Math.floor(y0 / stepContent) * stepContent

  // canvas transform：内容坐标 → 设备像素 = dpr * (z * content + v)
  ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * vx.value, dpr * vy.value)
  ctx.fillStyle = BG_COLOR
  ctx.fillRect(x0, y0, width / z + stepContent, height / z + stepContent)
  ctx.fillStyle = DOT_COLOR
  ctx.beginPath()
  for (let cx = colStart; cx <= x1 + stepContent; cx += stepContent) {
    for (let cy = rowStart; cy <= y1 + stepContent; cy += stepContent) {
      ctx.moveTo(cx + DOT_R, cy) // moveTo 预留，让不相邻的点不连成一条线
      ctx.arc(cx, cy, DOT_R, 0, Math.PI * 2)
    }
  }
  ctx.fill()
}

function setupResizeObserver() {
  const host = hostEl.value
  if (host && typeof ResizeObserver !== 'undefined' && !ro) {
    ro = new ResizeObserver(() => {
      fitCanvas()
      redraw()
    })
    ro.observe(host)
  }
}

onMounted(() => {
  fitCanvas()
  setupResizeObserver()
  redraw()
})

onBeforeUnmount(() => {
  ro?.disconnect()
  ro = null
})

// viewport 平移/缩放变化 → 重绘（单帧，无 rAF 循环）
watch([vx, vy, zoom], redraw)
</script>

<template>
  <!-- 铺满、不挡交互；canvas 只重绘可视区点，跟随画布平移/缩放 -->
  <div ref="hostEl" class="theme-default-bg">
    <canvas ref="canvasEl" class="bg-canvas" />
  </div>
</template>

<style scoped>
.theme-default-bg {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 0; /* 垫在节点之下：宿主保证层级 */
}
.bg-canvas {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
