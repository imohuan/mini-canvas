<script setup lang="ts">
/**
 * ImageRunIndicator —— 图片节点上的生成运行状态条（由外层 NodeToolbar 定位/跟随节点）。
 * - 加载中：进度条 + 阶段文案 + 百分比（无百分比回落为不确定推进动画）
 * - 失败：红色错误条（常驻直到用户关闭/重试），标题取 runError
 */
import { computed } from 'vue'
import type { RunProgress } from './imageModels'

const props = defineProps<{
  running: boolean
  progress?: RunProgress
  error?: string
  percent?: number | null
}>()

const progressWidth = computed(() => {
  const p = props.percent
  if (p === null || p === undefined) return null
  return `${Math.max(0, Math.min(100, p))}%`
})

const showPercent = computed(() => progressWidth.value !== null)
</script>

<template>
  <div class="image-run-indicator" :class="running ? 'is-running' : 'is-error'">
    <template v-if="running">
      <div class="run-track">
        <div
          class="run-bar"
          :class="{ indeterminate: progressWidth === null }"
          :style="progressWidth ? { width: progressWidth } : undefined"
        />
      </div>
      <div class="run-meta">
        <span class="run-spinner" aria-hidden="true" />
        <span class="run-text">{{ progress?.message || '生成中…' }}</span>
        <span v-if="showPercent && progress?.progress !== undefined" class="run-pct">{{ Math.round(progress.progress) }}%</span>
      </div>
    </template>

    <template v-else>
      <span class="run-error-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      </span>
      <span class="run-error-text">{{ error || '生成失败' }}</span>
      <slot name="actions" />
    </template>
  </div>
</template>

<style scoped>
.image-run-indicator {
  display: flex;
  align-items: center;
  min-width: 220px;
  max-width: 320px;
  box-sizing: border-box;
  border-radius: 10px;
  padding: 8px 10px;
  gap: 8px;
  font-size: 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  backdrop-filter: blur(6px);
}

.is-running {
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid rgba(43, 109, 242, 0.25);
  color: #1f2937;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
}

.is-error {
  background: rgba(254, 242, 242, 0.98);
  border: 1px solid rgba(220, 38, 38, 0.3);
  color: #991b1b;
}

.run-track {
  height: 5px;
  border-radius: 3px;
  background: rgba(43, 109, 242, 0.14);
  overflow: hidden;
}

.run-bar {
  height: 100%;
  border-radius: 3px;
  background: linear-gradient(90deg, #2b6df2, #7aa7ff);
  transition: width 0.3s ease;
}

.run-bar.indeterminate {
  width: 36%;
  animation: run-slide 1.1s ease-in-out infinite;
}

@keyframes run-slide {
  0%   { transform: translateX(-120%); }
  100% { transform: translateX(300%); }
}

.run-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}

.run-spinner {
  width: 11px;
  height: 11px;
  border: 2px solid rgba(43, 109, 242, 0.25);
  border-top-color: #2b6df2;
  border-radius: 50%;
  animation: run-spin 0.7s linear infinite;
  box-sizing: border-box;
  flex-shrink: 0;
}

@keyframes run-spin {
  to { transform: rotate(360deg); }
}

.run-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.run-pct {
  font-weight: 600;
  color: #2b6df2;
}

.run-error-icon { flex-shrink: 0; display: inline-flex; }
.run-error-icon :deep(svg) { width: 16px; height: 16px; }
.run-error-text { flex: 1; min-width: 0; word-break: break-word; line-height: 1.4; }
</style>
