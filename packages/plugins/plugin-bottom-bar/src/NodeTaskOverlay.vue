<script setup lang="ts">
/**
 * NodeTaskOverlay —— 节点卡片上的加载/进度覆盖层。
 *
 * 数据单一来源 = props.data.runState（插件经 doc.updateNodeRuntime 写，落盘不进撤销栈）。
 * 显隐规则：running 才出现；done/error/idle/缺省一律渲染空（不占位、不拦截点击）。
 *
 * 同层顺序机制（照实说，别记错）：BaseNode 对 over:inset 是一次 v-for，DOM 顺序 =
 * 「基座条目在前、注册场条目按 order 在后」；order 只在同一条写路径内排序，跨不过基座。
 * 结论：图片/视频的编辑浮层（基座）恒在下、本覆盖层（注册场）恒在上。
 */
import { computed } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import type { NodeRunState } from './runState'
import { readRunState } from './runState'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()

const { ctx } = useCanvasRender()

const state = computed<NodeRunState>(() => readRunState(props.data))
const running = computed(() => state.value.status === 'running')
const percent = computed(() =>
  typeof state.value.progress === 'number' && Number.isFinite(state.value.progress)
    ? Math.round(state.value.progress)
    : null,
)

function onCancel(): void {
  ctx.get<{ cancel(nodeId: string): void }>('nodeTask').cancel(props.id)
}
</script>

<template>
  <!-- running 才出现；display:none 的空壳也不留（BaseNode 的包裹层不算本组件产出） -->
  <div v-if="running" class="task-overlay nodrag nopan nowheel" role="status" :aria-label="state.message || '执行中'">
    <div class="task-overlay-mask" />
    <div class="task-overlay-card">
      <span class="task-overlay-spinner" aria-hidden="true" />
      <span v-if="percent !== null" class="task-overlay-num">{{ percent }}%</span>
      <span v-else class="task-overlay-indeterminate" aria-hidden="true" />
      <span class="task-overlay-text">{{ state.message || '执行中…' }}</span>
      <button class="task-overlay-cancel" type="button" @click.stop="onCancel">取消</button>
    </div>
  </div>
</template>

<style scoped>
/* 视觉照 docs/design/ui-style-guide.md：既有 token、不新造颜色、动效带降级。 */
.task-overlay {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
}
.task-overlay-mask {
  position: absolute;
  inset: 0;
  background: var(--uic-overlay-veil, color-mix(in srgb, var(--ui-panel, #fff) 62%, transparent));
}
.task-overlay-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 16px;
  border: 1px solid var(--ui-line, rgba(0, 0, 0, 0.08));
  border-radius: 10px;
  background: var(--ui-overlay-solid, #fff);
  box-shadow: var(--ui-shadow-md, 0 20px 40px rgba(0, 0, 0, 0.08));
  font-size: 12px;
  color: var(--ui-ink, #374151);
}
.task-overlay-num {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.task-overlay-text {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-ink-mute, #9ca3af);
}
.task-overlay-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid color-mix(in srgb, var(--ui-accent, #0891b2) 35%, transparent);
  border-top-color: var(--ui-accent, #0891b2);
  border-radius: 999px;
  animation: task-overlay-spin 0.7s linear infinite;
}
.task-overlay-indeterminate {
  width: 64px;
  height: 3px;
  border-radius: 999px;
  background: var(--uic-overlay-veil, rgba(0, 0, 0, 0.06));
  overflow: hidden;
  position: relative;
}
.task-overlay-indeterminate::after {
  content: '';
  position: absolute;
  inset: 0;
  width: 32%;
  border-radius: inherit;
  background: var(--ui-accent, #0891b2);
  animation: task-overlay-slide 1.2s ease-in-out infinite;
}
.task-overlay-cancel {
  height: 24px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: var(--ui-hover-soft, rgba(0, 0, 0, 0.04));
  color: var(--ui-ink, #374151);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.15s ease-out;
}
.task-overlay-cancel:hover {
  background: var(--ui-hover-strong, rgba(0, 0, 0, 0.08));
}
.task-overlay-cancel:focus-visible {
  outline: 2px solid var(--ntb-accent-ring, rgb(8 145 178 / 0.6));
  outline-offset: 1px;
}
@keyframes task-overlay-spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes task-overlay-slide {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(320%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .task-overlay-spinner,
  .task-overlay-indeterminate::after {
    animation: none;
  }
}
</style>

