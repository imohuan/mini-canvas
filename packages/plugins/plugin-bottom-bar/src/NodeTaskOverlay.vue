<script setup lang="ts">
/**
 * NodeTaskOverlay —— 节点卡片上的加载/进度覆盖层。
 *
 * 数据单一来源 = props.data.runState（插件经 doc.updateNodeRuntime 写，落盘不进撤销栈）。
 * 显隐规则：running 才出现；done/error/idle/缺省一律渲染空。
 *
 * 视觉要求（用户明确）：
 * - **不要中间那个黑底小卡片**：整张卡变成一个「加载态」——铺满卡片区域的柔光 + 一圈进度环，
 *   没有盒子、没有边框；
 * - 加动效（环形进度 + 1.2s 青色脉冲 + 缓慢扫过的高光；走 transform/opacity，带 reduced-motion 降级）；
 * - 取消按钮放**右下角**、做小（一般不用它）；
 * - **不挡拖拽**：根 pointer-events: none，只有取消按钮是 pointer-events: auto。
 *   （此前根写 auto 会把整卡盖住，节点拖不动——用户实测反馈的正是这条。）
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
    ? Math.max(0, Math.min(100, Math.round(state.value.progress)))
    : null,
)

/** 进度环几何：r=26 的圆，周长用于 dashoffset */
const RING_R = 26
const RING_C = 2 * Math.PI * RING_R

/** 有百分比 → 按比例；没有（外部只给阶段）→ 不确定态（转圈弧线） */
const ringOffset = computed(() =>
  percent.value === null ? RING_C * 0.72 : RING_C * (1 - percent.value / 100),
)

function onCancel(): void {
  ctx.get<{ cancel(nodeId: string): void }>('nodeTask').cancel(props.id)
}
</script>

<template>
  <div
    v-if="running"
    class="task-overlay"
    role="status"
    :aria-label="state.message || '执行中'"
    data-testid="task-overlay"
  >
    <!-- 铺满整卡的加载材质：柔光 + 缓慢扫过的高光（无盒子、无边框） -->
    <div class="task-overlay-veil" aria-hidden="true" />
    <div class="task-overlay-sheen" aria-hidden="true" />

    <!-- 居中：进度环 + 百分比 + 阶段文案（直接落在卡上，没有卡片底） -->
    <div class="task-overlay-center">
      <svg class="task-overlay-ring" viewBox="0 0 64 64" aria-hidden="true">
        <circle class="task-overlay-ring-track" cx="32" cy="32" :r="RING_R" />
        <circle
          class="task-overlay-ring-arc"
          :class="{ 'is-indeterminate': percent === null }"
          cx="32"
          cy="32"
          :r="RING_R"
          :stroke-dasharray="RING_C"
          :stroke-dashoffset="ringOffset"
        />
      </svg>
      <span class="task-overlay-readout">
        <span v-if="percent !== null" class="task-overlay-num">{{ percent }}%</span>
        <span class="task-overlay-text">{{ state.message || '执行中…' }}</span>
      </span>
    </div>

    <!-- 取消：右下角、小号（一般不用） -->
    <button class="task-overlay-cancel" type="button" title="取消任务" @click.stop="onCancel">
      取消
    </button>
  </div>
</template>

<style scoped>
/* 根不接指针事件：整卡仍可拖拽/选中，只有取消按钮收事件。 */
.task-overlay {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  overflow: hidden;
  animation: task-overlay-in 0.18s ease-out;
}

/* 铺满整卡的柔光（用面板色混合，浅深主题都成立；不新造颜色） */
.task-overlay-veil {
  position: absolute;
  inset: 0;
  /* 要让底下的内容若隐若现（加载态），但必须盖住可读性 → 92% 不透明 + 轻微模糊 */
  background: color-mix(in srgb, var(--ui-panel, #fff) 92%, transparent);
  backdrop-filter: blur(2px);
}

/* 缓慢扫过的高光：动的是 transform，不是 width/left */
.task-overlay-sheen {
  position: absolute;
  inset: -40%;
  background: linear-gradient(
    115deg,
    transparent 38%,
    color-mix(in srgb, var(--ui-accent, #0891b2) 9%, transparent) 50%,
    transparent 62%
  );
  animation: task-overlay-sheen 1.9s linear infinite;
}

.task-overlay-center {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
}

/* 进度环：轨道 + 弧；外层 1.2s 青色脉冲（样式规范里唯一允许的循环动画） */
.task-overlay-ring {
  width: 44px;
  height: 44px;
  flex: none;
  transform: rotate(-90deg);
  border-radius: 999px;
  animation: task-overlay-pulse 1.2s ease-in-out infinite;
}
.task-overlay-ring-track {
  fill: none;
  stroke: color-mix(in srgb, var(--ui-accent, #0891b2) 22%, transparent);
  stroke-width: 4;
}
.task-overlay-ring-arc {
  fill: none;
  stroke: var(--ui-accent, #0891b2);
  stroke-width: 4;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.2s ease-out;
}
/* 不确定态（外部只给阶段）：弧线自己转圈 */
.task-overlay-ring-arc.is-indeterminate {
  animation: task-overlay-spin 1.1s linear infinite;
  transform-origin: 32px 32px;
}

.task-overlay-readout {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.task-overlay-num {
  font-size: 15px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--ui-ink, #18202b);
}
.task-overlay-text {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
  color: var(--ui-ink-dim, #6b7280);
}

/* 取消：右下角小号文本按钮 */
.task-overlay-cancel {
  position: absolute;
  right: 6px;
  bottom: 6px;
  height: 22px;
  padding: 0 8px;
  border: 1px solid var(--ui-line, rgba(0, 0, 0, 0.08));
  border-radius: 6px;
  background: var(--ui-overlay-solid, #fff);
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  pointer-events: auto;
  transition: color 0.15s ease-out, background-color 0.15s ease-out;
}
.task-overlay-cancel:hover {
  color: var(--ui-danger, #ef4444);
  background: var(--ui-danger-soft, color-mix(in srgb, var(--ui-danger, #ef4444) 14%, transparent));
}
.task-overlay-cancel:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-accent, #0891b2) 60%, transparent);
  outline-offset: 1px;
}

@keyframes task-overlay-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@keyframes task-overlay-sheen {
  from {
    transform: translateX(-38%);
  }
  to {
    transform: translateX(38%);
  }
}
@keyframes task-overlay-spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes task-overlay-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--ui-accent, #0891b2) 30%, transparent);
  }
  50% {
    box-shadow: 0 0 0 6px color-mix(in srgb, var(--ui-accent, #0891b2) 0%, transparent);
  }
}

@media (prefers-reduced-motion: reduce) {
  .task-overlay,
  .task-overlay-sheen,
  .task-overlay-ring,
  .task-overlay-ring-arc.is-indeterminate {
    animation: none;
  }
  .task-overlay-ring-arc {
    transition: none;
  }
}
</style>
