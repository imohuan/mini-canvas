# Canvas Performance Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在画布页面左上角新增一个无背景的性能检测面板，用来直接判断 Vue Flow 画布当前是否卡顿，并显示可见节点压力、FPS、帧耗时和浏览器性能信息。

**Architecture:** 把“计算逻辑”和“界面显示”分开。先用纯 TypeScript helper 计算卡顿等级、采样汇总、可见节点数量；这些 helper 先写测试。再用 Vue 组件显示左上角面板、透明曲线图，并在现有 `Pannel.vue` 里加“性能”tab 控制开关。

**Tech Stack:** Vue 3 `<script setup>`、TypeScript、Vue Flow、Pinia canvas store、原生 `requestAnimationFrame`、原生 `<canvas>`、Node 内置测试工具、现有 `vue-tsc` / Vite build。

---

## File Structure

- Create: `src/canvas/core/components/performance/performanceMetrics.ts`
  - 纯函数：性能状态分级、采样裁剪、平均/最低 FPS、最大帧耗时、可见节点统计、内存格式化。
- Create: `src/canvas/core/components/performance/__tests__/performanceMetrics.test.mjs`
  - Node 内置测试。测试会临时用 `tsc` 编译 `performanceMetrics.ts`，不新增测试依赖。
- Create: `src/canvas/core/composables/useCanvasPerformance.ts`
  - 运行时采样：`requestAnimationFrame` 统计 FPS/帧耗时，可选 `PerformanceObserver` 统计 long task。
- Create: `src/canvas/core/components/performance/PerformanceSparkline.vue`
  - 无背景 `<canvas>` 折线图，只画线和小标签。
- Create: `src/canvas/core/components/performance/CanvasPerformancePanel.vue`
  - 左上角悬浮性能面板。无卡片背景，无毛玻璃。
- Create: `src/canvas/core/components/panel/PanelTabPerformance.vue`
  - 右上角设置面板里的“性能”tab。
- Modify: `src/canvas/core/composables/useCanvasStore.ts`
  - 持久化性能面板开关。
- Modify: `src/canvas/core/Pannel.vue`
  - 增加“性能”tab 和 v-model 透传。
- Modify: `src/canvas/core/Canvas.vue`
  - 渲染左上角性能面板，并把 Vue Flow 数据传进去。
- Modify: `package.json`
  - 增加 `test:performance` 脚本。

---

### Task 1: Add Tested Performance Metric Helpers

**Files:**
- Create: `src/canvas/core/components/performance/__tests__/performanceMetrics.test.mjs`
- Create: `src/canvas/core/components/performance/performanceMetrics.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test**

Create `src/canvas/core/components/performance/__tests__/performanceMetrics.test.mjs`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const repoRoot = process.cwd()
const sourcePath = join(repoRoot, 'src/canvas/core/components/performance/performanceMetrics.ts')
const tempDir = mkdtempSync(join(tmpdir(), 'canvas-performance-metrics-'))
const tempSource = join(tempDir, 'performanceMetrics.ts')
const tempOutput = join(tempDir, 'performanceMetrics.js')
const tscBin = join(repoRoot, 'node_modules/typescript/bin/tsc')
writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ type: 'module' }))

try {
  writeFileSync(tempSource, readFileSync(sourcePath, 'utf8'))
  execFileSync(process.execPath, [
    tscBin,
    '--ignoreConfig',
    tempSource,
    '--target',
    'ES2022',
    '--module',
    'ES2022',
    '--moduleResolution',
    'Bundler',
    '--skipLibCheck',
    '--outDir',
    tempDir,
  ], { cwd: repoRoot, stdio: 'pipe' })
} catch (error) {
  rmSync(tempDir, { recursive: true, force: true })
  throw error
}

const metrics = await import(pathToFileURL(tempOutput).href)

test.after(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

test('classifies smooth, unstable, slow, and jank states', () => {
  const thresholds = metrics.DEFAULT_PERFORMANCE_THRESHOLDS

  assert.equal(metrics.getPerformanceStatus({ fps: 58, frameMs: 17, thresholds }).level, 'smooth')
  assert.equal(metrics.getPerformanceStatus({ fps: 50, frameMs: 22, thresholds }).level, 'unstable')
  assert.equal(metrics.getPerformanceStatus({ fps: 38, frameMs: 35, thresholds }).level, 'slow')
  assert.equal(metrics.getPerformanceStatus({ fps: 24, frameMs: 45, thresholds }).level, 'jank')
  assert.equal(metrics.getPerformanceStatus({ fps: 58, frameMs: 126, thresholds }).level, 'jank')
})

test('summarizes samples with average fps, lowest fps, max frame time, and jank count', () => {
  const summary = metrics.summarizeSamples([
    { timestamp: 1, fps: 60, frameMs: 16 },
    { timestamp: 2, fps: 42, frameMs: 24 },
    { timestamp: 3, fps: 20, frameMs: 125 },
  ], metrics.DEFAULT_PERFORMANCE_THRESHOLDS)

  assert.equal(summary.averageFps, 41)
  assert.equal(summary.lowestFps, 20)
  assert.equal(summary.maxFrameMs, 125)
  assert.equal(summary.jankCount, 1)
})

test('keeps only the newest samples within the requested limit', () => {
  const samples = Array.from({ length: 6 }, (_, index) => ({
    timestamp: index,
    fps: 60 - index,
    frameMs: 16 + index,
  }))

  assert.deepEqual(metrics.limitSamples(samples, 3).map((sample) => sample.timestamp), [3, 4, 5])
})

test('counts nodes visible inside the viewport with a small preload margin', () => {
  const nodes = [
    { id: 'inside', position: { x: 50, y: 50 }, dimensions: { width: 80, height: 60 } },
    { id: 'edge', position: { x: 780, y: 560 }, dimensions: { width: 80, height: 60 } },
    { id: 'outside', position: { x: 2000, y: 2000 }, dimensions: { width: 80, height: 60 } },
  ]

  const result = metrics.getVisibleNodeStats({
    nodes,
    viewport: { x: 0, y: 0, zoom: 1 },
    containerSize: { width: 800, height: 600 },
    margin: 80,
  })

  assert.equal(result.totalNodes, 3)
  assert.equal(result.visibleNodes, 2)
})

test('converts screen viewport into flow-space bounds', () => {
  assert.deepEqual(metrics.getViewportBounds({
    viewport: { x: -200, y: -100, zoom: 2 },
    containerSize: { width: 800, height: 600 },
    margin: 0,
  }), {
    left: 100,
    top: 50,
    right: 500,
    bottom: 350,
  })
})
```

- [ ] **Step 2: Add the test script**

Modify `package.json` scripts:

```json
"test:performance": "node src/canvas/core/components/performance/__tests__/performanceMetrics.test.mjs"
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```powershell
npm run test:performance
```

Expected: FAIL，因为 `performanceMetrics.ts` 还不存在。

- [ ] **Step 4: Implement the helper module**

Create `src/canvas/core/components/performance/performanceMetrics.ts` with:

```ts
export type PerformanceLevel = 'smooth' | 'unstable' | 'slow' | 'jank'

export interface PerformanceThresholds {
  smoothFps: number
  unstableFps: number
  slowFps: number
  jankFrameMs: number
}

export interface PerformanceSample {
  timestamp: number
  fps: number
  frameMs: number
}

export interface PerformanceStatus {
  level: PerformanceLevel
  label: string
  tone: 'green' | 'yellow' | 'orange' | 'red'
  message: string
}

export interface ViewportState {
  x: number
  y: number
  zoom: number
}

export interface Size {
  width: number
  height: number
}

export interface NodeLike {
  id: string
  position?: { x: number; y: number }
  computedPosition?: { x: number; y: number }
  dimensions?: { width?: number; height?: number }
  width?: unknown
  height?: unknown
}

export interface Bounds {
  left: number
  top: number
  right: number
  bottom: number
}

export interface VisibleNodeStats {
  totalNodes: number
  visibleNodes: number
}

export interface PerformanceSummary {
  averageFps: number
  lowestFps: number
  maxFrameMs: number
  jankCount: number
}

export const DEFAULT_PERFORMANCE_THRESHOLDS: PerformanceThresholds = {
  smoothFps: 55,
  unstableFps: 45,
  slowFps: 30,
  jankFrameMs: 100,
}

const DEFAULT_NODE_WIDTH = 180
const DEFAULT_NODE_HEIGHT = 120

export function getPerformanceStatus(input: {
  fps: number
  frameMs: number
  thresholds?: PerformanceThresholds
}): PerformanceStatus {
  const thresholds = input.thresholds ?? DEFAULT_PERFORMANCE_THRESHOLDS

  if (input.frameMs >= thresholds.jankFrameMs || input.fps < thresholds.slowFps) {
    return { level: 'jank', label: '明显卡顿', tone: 'red', message: `卡顿 ${Math.round(input.frameMs)}ms` }
  }

  if (input.fps < thresholds.unstableFps) {
    return { level: 'slow', label: '偏卡', tone: 'orange', message: `${Math.round(input.fps)} FPS · 偏卡` }
  }

  if (input.fps < thresholds.smoothFps) {
    return { level: 'unstable', label: '波动', tone: 'yellow', message: `${Math.round(input.fps)} FPS · 波动` }
  }

  return { level: 'smooth', label: '流畅', tone: 'green', message: `${Math.round(input.fps)} FPS · 流畅` }
}

export function limitSamples(samples: PerformanceSample[], limit: number): PerformanceSample[] {
  if (limit <= 0) return []
  if (samples.length <= limit) return samples
  return samples.slice(samples.length - limit)
}

export function summarizeSamples(
  samples: PerformanceSample[],
  thresholds: PerformanceThresholds = DEFAULT_PERFORMANCE_THRESHOLDS,
): PerformanceSummary {
  if (samples.length === 0) {
    return { averageFps: 0, lowestFps: 0, maxFrameMs: 0, jankCount: 0 }
  }

  let fpsTotal = 0
  let lowestFps = Number.POSITIVE_INFINITY
  let maxFrameMs = 0
  let jankCount = 0

  for (const sample of samples) {
    fpsTotal += sample.fps
    lowestFps = Math.min(lowestFps, sample.fps)
    maxFrameMs = Math.max(maxFrameMs, sample.frameMs)
    if (sample.frameMs >= thresholds.jankFrameMs || sample.fps < thresholds.slowFps) {
      jankCount++
    }
  }

  return {
    averageFps: Math.round(fpsTotal / samples.length),
    lowestFps: Math.round(lowestFps),
    maxFrameMs: Math.round(maxFrameMs),
    jankCount,
  }
}

export function getViewportBounds(input: {
  viewport: ViewportState
  containerSize: Size
  margin?: number
}): Bounds {
  const zoom = input.viewport.zoom || 1
  const margin = input.margin ?? 0
  const left = (-input.viewport.x / zoom) - margin
  const top = (-input.viewport.y / zoom) - margin
  const right = ((input.containerSize.width - input.viewport.x) / zoom) + margin
  const bottom = ((input.containerSize.height - input.viewport.y) / zoom) + margin
  return { left, top, right, bottom }
}

export function getVisibleNodeStats(input: {
  nodes: NodeLike[]
  viewport: ViewportState
  containerSize: Size
  margin?: number
}): VisibleNodeStats {
  const bounds = getViewportBounds(input)
  let visibleNodes = 0

  for (const node of input.nodes) {
    const position = node.computedPosition ?? node.position ?? { x: 0, y: 0 }
    const rawWidth = node.dimensions?.width ?? node.width
    const rawHeight = node.dimensions?.height ?? node.height
    const width = typeof rawWidth === 'number' && Number.isFinite(rawWidth) ? rawWidth : DEFAULT_NODE_WIDTH
    const height = typeof rawHeight === 'number' && Number.isFinite(rawHeight) ? rawHeight : DEFAULT_NODE_HEIGHT
    const nodeBounds = {
      left: position.x,
      top: position.y,
      right: position.x + width,
      bottom: position.y + height,
    }

    const intersects = nodeBounds.right >= bounds.left
      && nodeBounds.left <= bounds.right
      && nodeBounds.bottom >= bounds.top
      && nodeBounds.top <= bounds.bottom

    if (intersects) visibleNodes++
  }

  return { totalNodes: input.nodes.length, visibleNodes }
}

export function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '不支持'
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${Math.round(bytes / 1024 / 1024)} MB`
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```powershell
npm run test:performance
```

Expected: PASS。

---

### Task 2: Add Runtime Performance Sampling

**Files:**
- Create: `src/canvas/core/composables/useCanvasPerformance.ts`

- [ ] **Step 1: Create the composable**

Create `src/canvas/core/composables/useCanvasPerformance.ts`:

```ts
import { computed, onUnmounted, ref, watch, type Ref } from 'vue'
import {
  DEFAULT_PERFORMANCE_THRESHOLDS,
  getPerformanceStatus,
  limitSamples,
  summarizeSamples,
  type PerformanceSample,
  type PerformanceThresholds,
} from '../components/performance/performanceMetrics'

interface UseCanvasPerformanceOptions {
  enabled: Ref<boolean>
  maxSamples?: number
  thresholds?: PerformanceThresholds
}

interface MemoryInfo {
  usedJSHeapSize?: number
  totalJSHeapSize?: number
  jsHeapSizeLimit?: number
}

const DEFAULT_MAX_SAMPLES = 90

export function useCanvasPerformance(options: UseCanvasPerformanceOptions) {
  const maxSamples = options.maxSamples ?? DEFAULT_MAX_SAMPLES
  const thresholds = options.thresholds ?? DEFAULT_PERFORMANCE_THRESHOLDS
  const samples = ref<PerformanceSample[]>([])
  const longTasks = ref<PerformanceSample[]>([])
  const memory = ref<MemoryInfo | null>(null)
  const lastFrameMs = ref(0)
  const fps = ref(0)

  let frameHandle = 0
  let lastTimestamp = 0
  let observer: PerformanceObserver | null = null

  const currentStatus = computed(() => getPerformanceStatus({
    fps: fps.value,
    frameMs: lastFrameMs.value,
    thresholds,
  }))

  const summary = computed(() => summarizeSamples(samples.value, thresholds))

  function readMemory() {
    const perf = performance as Performance & { memory?: MemoryInfo }
    memory.value = perf.memory ?? null
  }

  function pushSample(sample: PerformanceSample) {
    samples.value = limitSamples([...samples.value, sample], maxSamples)
  }

  function tick(timestamp: number) {
    if (!options.enabled.value) return

    if (lastTimestamp > 0) {
      const frameMs = timestamp - lastTimestamp
      const nextFps = frameMs > 0 ? 1000 / frameMs : 0
      lastFrameMs.value = Math.round(frameMs)
      fps.value = Math.round(nextFps)
      pushSample({ timestamp, fps: nextFps, frameMs })
      readMemory()
    }

    lastTimestamp = timestamp
    frameHandle = requestAnimationFrame(tick)
  }

  function startLongTaskObserver() {
    if (typeof PerformanceObserver === 'undefined') return
    try {
      observer = new PerformanceObserver((list) => {
        const next = list.getEntries().map((entry) => ({
          timestamp: entry.startTime,
          fps: fps.value,
          frameMs: entry.duration,
        }))
        if (next.length > 0) {
          longTasks.value = limitSamples([...longTasks.value, ...next], 20)
        }
      })
      observer.observe({ entryTypes: ['longtask'] })
    } catch {
      observer = null
    }
  }

  function start() {
    stop()
    samples.value = []
    longTasks.value = []
    lastTimestamp = 0
    readMemory()
    startLongTaskObserver()
    frameHandle = requestAnimationFrame(tick)
  }

  function stop() {
    if (frameHandle) cancelAnimationFrame(frameHandle)
    frameHandle = 0
    lastTimestamp = 0
    if (observer) observer.disconnect()
    observer = null
  }

  function clear() {
    samples.value = []
    longTasks.value = []
  }

  watch(options.enabled, (enabled) => {
    if (enabled) start()
    else stop()
  }, { immediate: true })

  onUnmounted(stop)

  return {
    samples,
    longTasks,
    memory,
    fps,
    lastFrameMs,
    currentStatus,
    summary,
    clear,
  }
}
```

- [ ] **Step 2: Run typecheck**

Run:

```powershell
npm run build
```

Expected: 如果只有后续 UI 未接入导致的问题，继续；如果这个文件本身报错，先修。

---

### Task 3: Add Transparent Sparkline Component

**Files:**
- Create: `src/canvas/core/components/performance/PerformanceSparkline.vue`

- [ ] **Step 1: Create the component**

Create `src/canvas/core/components/performance/PerformanceSparkline.vue`:

```vue
<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import type { PerformanceSample } from './performanceMetrics'

const props = withDefaults(defineProps<{
  samples: PerformanceSample[]
  metric: 'fps' | 'frameMs'
  color: string
  label: string
  width?: unknown
  height?: unknown
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
  ctx.shadowColor = props.color
  ctx.shadowBlur = 5
  ctx.beginPath()

  values.forEach((value, index) => {
    const x = (index / (values.length - 1)) * width
    const normalized = (value - minValue) / range
    const y = height - normalized * (height - 8) - 4
    if (index === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })

  ctx.stroke()
  ctx.shadowBlur = 0
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
  color: rgb(226 232 240 / 0.72);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  text-shadow: 0 1px 4px rgb(0 0 0 / 0.85);
}

canvas {
  display: block;
  background: transparent;
}
</style>
```

- [ ] **Step 2: Run typecheck**

Run:

```powershell
npm run build
```

Expected: 修掉组件本地错误。

---

### Task 4: Add Top-left Canvas Performance Panel

**Files:**
- Create: `src/canvas/core/components/performance/CanvasPerformancePanel.vue`

- [ ] **Step 1: Create the component**

Create `src/canvas/core/components/performance/CanvasPerformancePanel.vue`:

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import PerformanceSparkline from './PerformanceSparkline.vue'
import {
  formatBytes,
  getVisibleNodeStats,
  type NodeLike,
  type PerformanceSample,
  type PerformanceStatus,
  type PerformanceSummary,
  type ViewportState,
} from './performanceMetrics'

const props = defineProps<{
  enabled: boolean
  samples: PerformanceSample[]
  longTasks: PerformanceSample[]
  status: PerformanceStatus
  summary: PerformanceSummary
  fps: number
  frameMs: number
  nodes: NodeLike[]
  edgesCount: number
  viewport: ViewportState
  containerSize: { width: number; height: number }
  selectedNodeCount: number
  selectedEdgeCount: number
  onlyRenderVisibleElements: boolean
  showCharts: boolean
  showMemory: boolean
  memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number; jsHeapSizeLimit?: number } | null
}>()

const expanded = ref(false)

const visibleStats = computed(() => getVisibleNodeStats({
  nodes: props.nodes,
  viewport: props.viewport,
  containerSize: props.containerSize,
  margin: 80,
}))

const toneClass = computed(() => `tone-${props.status.tone}`)
const lastLongTask = computed(() => props.longTasks.at(-1))
</script>

<template>
  <aside v-if="enabled" class="canvas-performance-panel" :class="toneClass">
    <button class="compact" type="button" @click="expanded = !expanded">
      <span class="canvas-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" role="img">
          <path d="M4 7.5C4 5.57 5.57 4 7.5 4h9C18.43 4 20 5.57 20 7.5v9c0 1.93-1.57 3.5-3.5 3.5h-9A3.5 3.5 0 0 1 4 16.5v-9Z" />
          <path d="M7 15.5c2.1-4.9 3.9-4.9 5.4 0 1.25 3.95 2.75 3.25 4.6-2.1" />
        </svg>
      </span>
      <span>{{ status.message }}</span>
      <span class="visible-short">节点 {{ visibleStats.visibleNodes }}/{{ visibleStats.totalNodes }}</span>
    </button>

    <div v-if="expanded" class="details">
      <div class="section-title">卡顿雷达</div>
      <div class="metric-grid">
        <span>当前 FPS</span><strong>{{ Math.round(fps) }}</strong>
        <span>平均 FPS</span><strong>{{ summary.averageFps }}</strong>
        <span>最低 FPS</span><strong>{{ summary.lowestFps }}</strong>
        <span>当前帧耗时</span><strong>{{ Math.round(frameMs) }}ms</strong>
        <span>最大帧耗时</span><strong>{{ summary.maxFrameMs }}ms</strong>
        <span>卡顿次数</span><strong>{{ summary.jankCount }}</strong>
      </div>

      <div class="section-title">画布压力</div>
      <div class="metric-grid">
        <span>可见 / 总节点</span><strong>{{ visibleStats.visibleNodes }} / {{ visibleStats.totalNodes }}</strong>
        <span>连线</span><strong>{{ edgesCount }}</strong>
        <span>缩放</span><strong>{{ viewport.zoom.toFixed(2) }}</strong>
        <span>视口</span><strong>{{ Math.round(viewport.x) }}, {{ Math.round(viewport.y) }}</strong>
        <span>选中节点</span><strong>{{ selectedNodeCount }}</strong>
        <span>选中连线</span><strong>{{ selectedEdgeCount }}</strong>
        <span>只渲染可见</span><strong>{{ onlyRenderVisibleElements ? '开' : '关' }}</strong>
      </div>

      <div v-if="showMemory" class="section-title">浏览器</div>
      <div v-if="showMemory" class="metric-grid">
        <span>JS 内存</span><strong>{{ formatBytes(memory?.usedJSHeapSize) }}</strong>
        <span>长任务</span><strong>{{ lastLongTask ? `${Math.round(lastLongTask.frameMs)}ms` : '暂无' }}</strong>
      </div>

      <div v-if="showCharts" class="charts">
        <PerformanceSparkline :samples="samples" metric="fps" label="FPS" color="#38f5a5" :max="70" />
        <PerformanceSparkline :samples="samples" metric="frameMs" label="Frame time" color="#fb7185" :max="140" />
      </div>
    </div>
  </aside>
</template>

<style scoped>
.canvas-performance-panel {
  position: absolute;
  left: 14px;
  top: 14px;
  z-index: 20;
  color: #e5edf7;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
  font-size: 11px;
  pointer-events: none;
}

.compact {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 0;
  border: 0;
  background: transparent;
  color: currentColor;
  cursor: pointer;
  pointer-events: auto;
  text-shadow: 0 1px 5px rgb(0 0 0 / 0.9);
}

.compact:hover {
  filter: brightness(1.15);
}

.canvas-mark {
  width: 20px;
  height: 20px;
  color: currentColor;
}

.canvas-mark svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  filter: drop-shadow(0 1px 4px rgb(0 0 0 / 0.85));
}

.visible-short {
  color: rgb(226 232 240 / 0.72);
}

.details {
  display: grid;
  gap: 8px;
  width: 284px;
  margin-top: 8px;
  pointer-events: auto;
  text-shadow: 0 1px 5px rgb(0 0 0 / 0.92);
}

.section-title {
  margin-top: 2px;
  color: rgb(226 232 240 / 0.66);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.metric-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 3px 14px;
}

.metric-grid span {
  color: rgb(226 232 240 / 0.7);
}

.metric-grid strong {
  color: #f8fafc;
  font-weight: 700;
}

.charts {
  display: grid;
  gap: 7px;
  margin-top: 2px;
}

.tone-green { color: #38f5a5; }
.tone-yellow { color: #facc15; }
.tone-orange { color: #fb923c; }
.tone-red { color: #fb7185; }
</style>
```

- [ ] **Step 2: Run typecheck**

Run:

```powershell
npm run build
```

Expected: 修掉组件本地错误。

---

### Task 5: Persist Performance Panel Settings

**Files:**
- Modify: `src/canvas/core/composables/useCanvasStore.ts`

- [ ] **Step 1: Add serializer defaults**

In `serializer.read`, after `selectionFramePaddingBottom`, add:

```ts
      performancePanelEnabled: data.performancePanelEnabled ?? false,
      performancePanelShowCharts: data.performancePanelShowCharts ?? true,
      performancePanelShowMemory: data.performancePanelShowMemory ?? true,
```

- [ ] **Step 2: Add state defaults**

In the `state` ref, after selection frame settings, add:

```ts
    // ==================== 性能检测面板 ====================
    performancePanelEnabled: false,
    performancePanelShowCharts: true,
    performancePanelShowMemory: true,
```

- [ ] **Step 3: Run focused tests and build**

Run:

```powershell
npm run test:performance
npm run build
```

Expected: tests pass；如果 build 仍缺父组件接线，继续下一任务。

---

### Task 6: Add Performance Tab to Existing Pannel.vue

**Files:**
- Create: `src/canvas/core/components/panel/PanelTabPerformance.vue`
- Modify: `src/canvas/core/Pannel.vue`

- [ ] **Step 1: Create `PanelTabPerformance.vue`**

Create `src/canvas/core/components/panel/PanelTabPerformance.vue`:

```vue
<script setup lang="ts">
defineProps<{
  performancePanelEnabled: boolean
  performancePanelShowCharts: boolean
  performancePanelShowMemory: boolean
}>()

const emit = defineEmits<{
  (e: 'update:performancePanelEnabled', v: boolean): void
  (e: 'update:performancePanelShowCharts', v: boolean): void
  (e: 'update:performancePanelShowMemory', v: boolean): void
  (e: 'clearPerformanceSamples'): void
}>()

const btnBase = 'px-2 py-1 rounded text-[11px] font-semibold transition-colors border border-transparent cursor-pointer'
const btnActive = 'bg-[#3b82f6]/15 text-[#60a5fa] border-[#3b82f6]/30'
const btnInactive = 'bg-[#2d2b30] text-[#9c9aa3] hover:bg-[#3a3740] hover:text-[#f0f0f2]'
const sectionTitle = 'text-[11px] font-bold text-[#78767b] uppercase tracking-wider mt-3 mb-2'
const rowItem = 'flex items-center justify-between gap-2 text-[11px] text-[#b2b0b9]'
</script>

<template>
  <div :class="sectionTitle">性能检测</div>
  <div class="grid gap-2">
    <div :class="rowItem">
      <span>左上角卡顿雷达</span>
      <button :class="[btnBase, performancePanelEnabled ? btnActive : btnInactive]"
        @click="emit('update:performancePanelEnabled', !performancePanelEnabled)">
        {{ performancePanelEnabled ? '开' : '关' }}
      </button>
    </div>

    <div :class="rowItem">
      <span>显示曲线</span>
      <button :class="[btnBase, performancePanelShowCharts ? btnActive : btnInactive]"
        @click="emit('update:performancePanelShowCharts', !performancePanelShowCharts)">
        {{ performancePanelShowCharts ? '开' : '关' }}
      </button>
    </div>

    <div :class="rowItem">
      <span>显示内存</span>
      <button :class="[btnBase, performancePanelShowMemory ? btnActive : btnInactive]"
        @click="emit('update:performancePanelShowMemory', !performancePanelShowMemory)">
        {{ performancePanelShowMemory ? '开' : '关' }}
      </button>
    </div>
  </div>

  <div :class="sectionTitle">采样</div>
  <button :class="[btnBase, btnInactive]" @click="emit('clearPerformanceSamples')">
    清空采样数据
  </button>

  <div :class="sectionTitle">判断规则</div>
  <div class="text-[11px] leading-5 text-[#9c9aa3]">
    <p>≥ 55 FPS：流畅</p>
    <p>45–54 FPS：波动</p>
    <p>30–44 FPS：偏卡</p>
    <p>&lt; 30 FPS 或单帧 ≥ 100ms：明显卡顿</p>
    <p class="mt-2 text-[#78767b]">左上角面板无背景，只用文字、图标和线条显示。</p>
  </div>
</template>
```

- [ ] **Step 2: Modify `Pannel.vue` imports and props**

Add import:

```ts
import PanelTabPerformance from './components/panel/PanelTabPerformance.vue'
```

Add props:

```ts
  performancePanelEnabled: boolean
  performancePanelShowCharts: boolean
  performancePanelShowMemory: boolean
```

Add emits:

```ts
  (e: 'update:performancePanelEnabled', v: boolean): void
  (e: 'update:performancePanelShowCharts', v: boolean): void
  (e: 'update:performancePanelShowMemory', v: boolean): void
  (e: 'clearPerformanceSamples'): void
```

Change tab type:

```ts
type TabKey = 'general' | 'theme' | 'storage' | 'layout' | 'performance'
```

Add tab:

```ts
  { key: 'performance', label: '性能' },
```

- [ ] **Step 3: Render the new tab**

In `Pannel.vue`, after `PanelTabLayout`, add:

```vue
        <PanelTabPerformance v-if="activeTab === 'performance'"
          :performance-panel-enabled="performancePanelEnabled"
          :performance-panel-show-charts="performancePanelShowCharts"
          :performance-panel-show-memory="performancePanelShowMemory"
          @update:performance-panel-enabled="emit('update:performancePanelEnabled', $event)"
          @update:performance-panel-show-charts="emit('update:performancePanelShowCharts', $event)"
          @update:performance-panel-show-memory="emit('update:performancePanelShowMemory', $event)"
          @clear-performance-samples="emit('clearPerformanceSamples')"
        />
```

- [ ] **Step 4: Run typecheck**

Run:

```powershell
npm run build
```

Expected: 如果只剩 `Canvas.vue` 没传 props，继续下一任务。

---

### Task 7: Wire Performance Panel into Canvas.vue

**Files:**
- Modify: `src/canvas/core/Canvas.vue`

- [ ] **Step 1: Add imports**

Add:

```ts
import CanvasPerformancePanel from './components/performance/CanvasPerformancePanel.vue'
import { useCanvasPerformance } from './composables/useCanvasPerformance'
```

- [ ] **Step 2: Add container size tracking and performance composable**

After `const { zoomIn, zoomOut, fitView, getNodes, getEdges } = vueFlowInstance`, add:

```ts
const canvasContainerRef = ref<HTMLElement | null>(null)
const canvasContainerSize = ref({ width: 0, height: 0 })
let canvasResizeObserver: ResizeObserver | null = null

const performanceEnabled = computed(() => canvas.state.performancePanelEnabled)
const performanceMonitor = useCanvasPerformance({ enabled: performanceEnabled })

function updateCanvasContainerSize() {
  const rect = canvasContainerRef.value?.getBoundingClientRect()
  canvasContainerSize.value = {
    width: rect?.width ?? window.innerWidth,
    height: rect?.height ?? window.innerHeight,
  }
}
```

- [ ] **Step 3: Start and stop resize tracking**

Inside existing `onMounted`, near the top, add:

```ts
  updateCanvasContainerSize()
  if (canvasContainerRef.value && typeof ResizeObserver !== 'undefined') {
    canvasResizeObserver = new ResizeObserver(updateCanvasContainerSize)
    canvasResizeObserver.observe(canvasContainerRef.value)
  }
  window.addEventListener('resize', updateCanvasContainerSize)
```

Inside existing `onUnmounted`, add:

```ts
  window.removeEventListener('resize', updateCanvasContainerSize)
  canvasResizeObserver?.disconnect()
  canvasResizeObserver = null
```

- [ ] **Step 4: Add the ref to the canvas container**

Change:

```vue
  <div class="canvas-container">
```

To:

```vue
  <div ref="canvasContainerRef" class="canvas-container">
```

- [ ] **Step 5: Pass performance settings into `Pannel.vue`**

In `Pannel` usage, add:

```vue
          v-model:performancePanelEnabled="canvas.state.performancePanelEnabled"
          v-model:performancePanelShowCharts="canvas.state.performancePanelShowCharts"
          v-model:performancePanelShowMemory="canvas.state.performancePanelShowMemory"
          @clear-performance-samples="performanceMonitor.clear"
```

- [ ] **Step 6: Render the top-left panel**

After `</VueFlow>` and before `SelectionFrame`, add:

```vue
    <CanvasPerformancePanel
      :enabled="canvas.state.performancePanelEnabled"
      :samples="performanceMonitor.samples.value"
      :long-tasks="performanceMonitor.longTasks.value"
      :status="performanceMonitor.currentStatus.value"
      :summary="performanceMonitor.summary.value"
      :fps="performanceMonitor.fps.value"
      :frame-ms="performanceMonitor.lastFrameMs.value"
      :nodes="vueFlowInstance.getNodes.value"
      :edges-count="vueFlowInstance.getEdges.value.length"
      :viewport="vueFlowInstance.viewport.value"
      :container-size="canvasContainerSize"
      :selected-node-count="canvas.selectionState.selectedNodeIds.size"
      :selected-edge-count="canvas.selectionState.selectedEdgeIds.size"
      :only-render-visible-elements="canvas.state.onlyRenderVisibleElements"
      :show-charts="canvas.state.performancePanelShowCharts"
      :show-memory="canvas.state.performancePanelShowMemory"
      :memory="performanceMonitor.memory.value"
    />
```

- [ ] **Step 7: Run focused tests and build**

Run:

```powershell
npm run test:performance
npm run build
```

Expected: tests pass，项目 build 成功。

---

### Task 8: Final Verification

**Files:**
- No new files unless fixes are needed.

- [ ] **Step 1: Run focused performance tests**

Run:

```powershell
npm run test:performance
```

Expected: all tests pass.

- [ ] **Step 2: Run production build**

Run:

```powershell
npm run build
```

Expected: `vue-tsc -b && vite build` exits successfully.

- [ ] **Step 3: Review changed files**

Run:

```powershell
git diff -- src/canvas/core package.json docs/superpowers/plans/2026-06-18-canvas-performance-panel.md
```

Expected: Diff only contains this plan and the performance-panel implementation.

---

## Self-review

- Spec coverage:
  - 无背景左上角面板：Task 4、Task 7。
  - `Pannel.vue` 新增“性能”tab：Task 6。
  - FPS、帧耗时、卡顿等级：Task 1、Task 2、Task 4。
  - FPS 曲线 + 帧耗时曲线，且无背景：Task 3、Task 4。
  - 节点、连线、缩放、选中数量：Task 4、Task 7。
  - 当前可见节点 / 总节点：Task 1、Task 4、Task 7。
  - `onlyRenderVisibleElements` 开关状态：Task 4、Task 7。
  - 浏览器内存和 long task：Task 2、Task 4。
- Placeholder scan: no `TBD`, no unfinished `TODO`, no “类似上一任务”。
- Type consistency:
  - `performancePanelEnabled` / `performancePanelShowCharts` / `performancePanelShowMemory` names are shared across store, `Pannel.vue`, and `Canvas.vue`.
  - `PerformanceSample`, `PerformanceStatus`, `PerformanceSummary`, `NodeLike`, `ViewportState` all come from `performanceMetrics.ts`.
