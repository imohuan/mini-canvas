import { computed, onUnmounted, ref, watch, type Ref } from 'vue'
import {
  DEFAULT_PERFORMANCE_THRESHOLDS,
  getPerformanceStatus,
  limitSamples,
  summarizeSamples,
  type PerformanceSample,
  type PerformanceThresholds,
} from '../components/Performance/performanceMetrics'

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
