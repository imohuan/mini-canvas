<script setup lang="ts">
/**
 * NodeTaskOverlay —— 节点卡片上的加载/进度覆盖层。
 *
 * 数据单一来源 = props.data.runState（插件经 doc.updateNodeRuntime 写，落盘不进撤销栈）。
 * 显隐规则：running 才出现；done/error/idle/缺省一律渲染空。
 *
 * 视觉要求（用户明确）：
 * - **整块铺满的不透明纯色底**：用纯黑把底下那张卡（图片/视频内容、其它浮层 UI）**完全盖住**。
 *   为什么不用半透明：节点里还有别的 UI（标题条、端口、各种浮层），半透明会让它们透出来跟加载态糊在一起（用户反馈）。
 * - 加动效（环形进度 + 1.2s 脉冲 + 缓慢扫过的高光；走 transform/opacity，带 reduced-motion 降级）；
 * - **文案单独一行、布局稳定**：百分比与文案分两行（文案可能很长且一直在变），
 *   整块居中不动 —— 否则文案一变宽窄就跳、进度环跟着位移（用户反馈）。
 * - 取消按钮放**右下角**、做小（一般不用它）；
 * - **不挡拖拽**：根 pointer-events: none，只有取消按钮是 pointer-events: auto。
 *   （此前根写 auto 会把整卡盖住，节点拖不动——用户实测反馈的正是这条。）
 *
 * 同层顺序机制（照实说，别记错）：BaseNode 对 over:inset 是一次 v-for，DOM 顺序 =
 * 「基座条目在前、注册场条目按 order 在后」；order 只在同一条写路径内排序，跨不过基座。
 * 结论：图片/视频的编辑浮层（基座）恒在下、本覆盖层（注册场）恒在上。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import type { NodeRunState } from './runState'
import { readRunState } from './runState'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()

const { ctx } = useCanvasRender()

/**
 * 跟随卡片圆角。
 *
 * 为什么必须跟：覆盖层挂在节点的 `over:inset` 区域容器里，而那个容器是**方角**（border-radius: 0），
 * 我又铺了一层不透明纯黑 —— 结果把卡片自己的 4 个圆角**涂平成了直角**（用户实测反馈）。
 * 圆角由主题按节点类型给（BaseNode 内联 cardFrame.borderRadius），所以这里**读卡片实算值**，
 * 不写死数字：换主题/换节点类型都跟得上。
 */
const rootEl = ref<HTMLElement | null>(null)
const radius = ref('8px')
function syncRadius(): void {
  const nodeEl = rootEl.value?.closest('.v2-node') as HTMLElement | null
  const cardEl = nodeEl?.querySelector('.v2-card') as HTMLElement | null
  if (!cardEl) return
  const r = getComputedStyle(cardEl).borderRadius
  if (r) radius.value = r
}
let rafId = 0
function loop(): void {
  syncRadius()
  rafId = requestAnimationFrame(loop)
}
onMounted(() => {
  syncRadius()
  // 视口缩放/换主题都可能改圆角，逐帧跟最省事（只读一个值，代价可忽略）
  rafId = requestAnimationFrame(loop)
})
onBeforeUnmount(() => {
  if (rafId) cancelAnimationFrame(rafId)
})

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
    ref="rootEl"
    class="task-overlay"
    role="status"
    :aria-label="state.message || '执行中'"
    :style="{ borderRadius: radius }"
    data-testid="task-overlay"
  >
    <!-- 铺满整卡的加载材质：柔光 + 缓慢扫过的高光（无盒子、无边框） -->
    <!-- 铺满整卡的不透明纯黑底：把底下的卡片内容与其它浮层 UI 完全盖住 -->
    <div class="task-overlay-veil" aria-hidden="true" />
    <div class="task-overlay-sheen" aria-hidden="true" />

    <!-- 居中：上一行「进度环 + 百分比」，下一行文案**单独换行**（整块居中，文案变长变短都不位移） -->
    <div class="task-overlay-center">
      <div class="task-overlay-head">
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
        <span v-if="percent !== null" class="task-overlay-num">{{ percent }}%</span>
      </div>
      <p class="task-overlay-text">{{ state.message || '执行中…' }}</p>
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
  /* 圆角由 JS 跟随卡片实算值（见 syncRadius）：不写死，换主题/换节点类型都对得上 */
  overflow: hidden;
  animation: task-overlay-in 0.18s ease-out;
}

/* 铺满整卡的加载材质。
   用户明确要求：用**纯黑不透明**把底下的卡片内容整个盖住（节点里还有别的 UI，半透明会透出来糊在一起）。
   所以这一层是**恒定全不透明**的纯黑，自身不做 opacity 动画 ——
   透明度一起伏，底下内容就会忽隐忽现（实测连 0.88~1 的呼吸都会透出"（无视频）"这类字）。
   动效交给上面那层扫光与进度环：观感是活的，但内容始终被盖死。 */
.task-overlay-veil {
  position: absolute;
  inset: 0;
  /* 主题色白名单: 加载遮罩刻意纯黑无装饰，与主题无关（同全屏播放层的做法） */
  background: #000;
}


/* 缓慢扫过的高光：动的是 transform，不是 width/left */
.task-overlay-sheen {
  position: absolute;
  inset: -40%;
  background: linear-gradient(
    115deg,
    transparent 38%,
    color-mix(in srgb, var(--ui-accent, #0891b2) 15%, transparent) 50%,
    transparent 62%
  );
  animation: task-overlay-sheen 1.9s linear infinite;
}

.task-overlay-center {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  /* 两侧留白：文案再长也不贴到卡片边缘 */
  max-width: 100%;
  padding: 0 16px;
  box-sizing: border-box;
}

/* 上一行：环 + 百分比（这一行只随进度变，文案变长变短不影响它） */
.task-overlay-head {
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

.task-overlay-num {
  font-size: 20px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  /* 压在纯黑底上：固定用白字（不随主题走，否则亮色主题下会黑底黑字） */
  color: #fff; /* 主题色白名单: 加载遮罩恒为纯黑底，前景需恒定白字才有对比 */
}
.task-overlay-text {
  /* 文案**单独一行**：允许换到第二行，居中；不再用省略号（省略号会让“看起来在变宽”而跳动） */
  margin: 0;
  max-width: 100%;
  text-align: center;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.75); /* 主题色白名单: 同上，纯黑遮罩上的次级白字 */
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
