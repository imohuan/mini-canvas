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

const expanded = ref(true)

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
      <span class="muted">节点 {{ visibleStats.visibleNodes }}/{{ visibleStats.totalNodes }}</span>
    </button>

    <div v-if="expanded" class="details">
      <div class="metric-grid">
        <span>平均</span><strong>{{ summary.averageFps }} FPS</strong>
        <span>最低</span><strong>{{ summary.lowestFps }} FPS</strong>
        <span>帧耗时</span><strong>{{ Math.round(frameMs) }}ms</strong>
        <span>最大帧</span><strong>{{ summary.maxFrameMs }}ms</strong>
        <span>卡顿</span><strong>{{ summary.jankCount }}</strong>
        <span>节点</span><strong>{{ visibleStats.visibleNodes }} / {{ visibleStats.totalNodes }}</strong>
        <span>连线</span><strong>{{ edgesCount }}</strong>
        <span>缩放</span><strong>{{ viewport.zoom.toFixed(2) }}</strong>
        <span>只渲染可见</span><strong>{{ onlyRenderVisibleElements ? '开' : '关' }}</strong>
        <span>选中</span><strong>{{ selectedNodeCount }} 点 / {{ selectedEdgeCount }} 线</strong>
      </div>

      <div v-if="showMemory" class="metric-grid browser-grid">
        <span>内存</span><strong>{{ formatBytes(memory?.usedJSHeapSize) }}</strong>
        <span>长任务</span><strong>{{ lastLongTask ? `${Math.round(lastLongTask.frameMs)}ms` : '暂无' }}</strong>
      </div>

      <div v-if="showCharts" class="charts">
        <PerformanceSparkline :samples="samples" metric="fps" label="FPS" color="#10b981" :width="220" :height="28" :max="70" />
        <PerformanceSparkline :samples="samples" metric="frameMs" label="FRAME" color="#ef4444" :width="220" :height="28" :max="140" />
      </div>
    </div>
  </aside>
</template>

<style scoped>
.canvas-performance-panel {
  position: absolute;
  left: 14px;
  top: 14px;
  z-index: 100;
  width: 230px;
  color: #111827;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
  font-size: 10px;
  line-height: 1.25;
  pointer-events: none;
}

.compact {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #111827;
  cursor: pointer;
  pointer-events: auto;
  font: inherit;
  font-weight: 700;
}

.compact:hover {
  color: #2563eb;
}

.canvas-mark {
  display: inline-flex;
  width: 16px;
  height: 16px;
  color: currentColor;
}

.canvas-mark svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
}

.muted {
  color: #374151;
  font-weight: 600;
}

.details {
  display: grid;
  gap: 5px;
  margin-top: 5px;
  pointer-events: auto;
}

.metric-grid {
  display: grid;
  grid-template-columns: 76px 1fr;
  gap: 2px 8px;
}

.metric-grid span {
  color: #4b5563;
  font-weight: 600;
}

.metric-grid strong {
  color: #111827;
  font-weight: 700;
}

.browser-grid {
  padding-top: 2px;
}

.charts {
  display: grid;
  gap: 4px;
  margin-top: 2px;
}

.tone-green .compact { color: #111827; }
.tone-yellow .compact { color: #92400e; }
.tone-orange .compact { color: #9a3412; }
.tone-red .compact { color: #b91c1c; }
</style>
