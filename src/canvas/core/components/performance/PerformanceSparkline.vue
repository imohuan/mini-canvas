<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import type { PerformanceSample } from './performanceMetrics'

const props = withDefaults(defineProps<{
  samples: PerformanceSample[]
  metric: 'fps' | 'frameMs'
  color: string
  label: string
  width?: number
  height?: number
  max?: number
}>(), {
  width: 260,
  height: 54,
  max: undefined,
})

const canvasRef = ref<HTMLCanvasElement | null>(null)

function draw() {
  const canvas = canvasRef.value
  if (!canvas) return

  const dpr = window.devicePixelRatio || 1
  const width = props.width
  const height = props.height
  canvas.width = width * dpr
  canvas.height = height * dpr
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)

  const values = props.samples.map((sample) => props.metric === 'fps' ? sample.fps : sample.frameMs)
  if (values.length < 2) return

  const maxValue = props.max ?? Math.max(...values, 1)
  const minValue = props.metric === 'fps' ? 0 : Math.min(0, ...values)
  const range = Math.max(maxValue - minValue, 1)

  ctx.lineWidth = 1.5
  ctx.strokeStyle = props.color
  ctx.beginPath()

  values.forEach((value, index) => {
    const x = (index / (values.length - 1)) * width
    const normalized = (value - minValue) / range
    const y = height - normalized * (height - 8) - 4
    if (index === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })

  ctx.stroke()
}

watch(() => [props.samples, props.metric, props.color, props.width, props.height, props.max], draw, { deep: true })
onMounted(draw)
</script>

<template>
  <div class="performance-sparkline">
    <div class="sparkline-label">{{ label }}</div>
    <canvas ref="canvasRef" aria-hidden="true"></canvas>
  </div>
</template>

<style scoped>
.performance-sparkline {
  display: grid;
  gap: 2px;
}

.sparkline-label {
  color: #111827;
  font-size: 9px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

canvas {
  display: block;
  background: transparent;
}
</style>

