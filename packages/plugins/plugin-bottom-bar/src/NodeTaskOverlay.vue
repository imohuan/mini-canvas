<script setup lang="ts">
/**
 * NodeTaskOverlay —— 节点卡片上的加载/进度覆盖层。
 *
 * 数据单一来源 = props.data.runState（插件经 doc.updateNodeRuntime 写，落盘不进撤销栈）。
 * 显隐规则：running 才出现；done/error/idle/缺省一律渲染空。
 *
 * 视觉要求（用户明确）：
 * 版式照用户给的参考稿（node_loading_ui_showcase.html）重做 —— **流光扰动**：
 * - 底：一整块不透明底色（把底下的卡片内容与其它浮层 UI 完全盖住）；
 * - 上面压 3 个粗糙模糊的光斑，各自缓慢位移/缩放/旋转（GPU transform，低成本），
 *   形成「液体光在卡片后面缓缓流动」的观感；不做扫光、不闪烁（用户嫌原来那种晃眼）；
 * - **两种主题各一套配色**（暗：深海青紫 / 亮：极光浅晕），跟随 <html class="dark">；
 * - 只放 3 个元素：右上「耗时」小胶囊、中间超大百分比、下方一行提示文案；
 * - 文案**单独一行**（可能很长且一直在变），整块居中不动，不会把百分比挤跑。
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
  // 只在真的变了才写 —— 低频轮询下也避免无谓的重渲染
  if (r && r !== radius.value) radius.value = r
}
// 不用 rAF 逐帧（多节点同时跑时是每秒几十次白读），250ms 够覆盖"缩放/换主题改圆角"这种场景。
let timerId: ReturnType<typeof setInterval> | null = null

const state = computed<NodeRunState>(() => readRunState(props.data))
const running = computed(() => state.value.status === 'running')
const percent = computed(() =>
  typeof state.value.progress === 'number' && Number.isFinite(state.value.progress)
    ? Math.max(0, Math.min(100, Math.round(state.value.progress)))
    : null,
)

/**
 * 已耗时（右上角那个小胶囊）。
 * 从 runState.startedAt 起算（提交那一刻插件写进去的），每秒走一格；
 * 没有 startedAt（老数据/外部写入）就不显示，不瞎编一个数。
 */
const elapsedSec = ref(0)
let tickTimer: ReturnType<typeof setInterval> | null = null
function tickElapsed(): void {
  const startedAt = state.value.startedAt
  elapsedSec.value = typeof startedAt === 'number' ? Math.max(0, (Date.now() - startedAt) / 1000) : 0
}
const elapsedText = computed(() => {
  if (typeof state.value.startedAt !== 'number') return ''
  return elapsedSec.value < 60
    ? elapsedSec.value.toFixed(1) + 's'
    : Math.floor(elapsedSec.value / 60) + '分' + Math.round(elapsedSec.value % 60) + '秒'
})

onMounted(() => {
  syncRadius()
  timerId = setInterval(syncRadius, 250)
  tickElapsed()
  tickTimer = setInterval(tickElapsed, 1000)
})
onBeforeUnmount(() => {
  if (timerId) clearInterval(timerId)
  if (tickTimer) clearInterval(tickTimer)
})

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
    <!-- ① 底色：不透明，把底下的卡片内容与其它浮层完全盖住 -->
    <div class="ld-base" aria-hidden="true" />
    <!-- ② 流光层：3 个模糊光斑缓慢扰动（暗/亮两套配色，靠 html.dark 切换） -->
    <div class="ld-fluid" aria-hidden="true">
      <span class="ld-blob ld-blob--1" />
      <span class="ld-blob ld-blob--2" />
      <span class="ld-blob ld-blob--3" />
    </div>

    <!-- 元素 1：右上角耗时 -->
    <div class="ld-top">
      <span class="ld-state"><i class="ld-dot" />生成中</span>
      <span v-if="elapsedText" class="ld-timer">{{ elapsedText }}</span>
    </div>

    <!-- 元素 2：中间超大百分比 -->
    <div class="ld-progress">
      <span class="ld-num">{{ percent === null ? '···' : percent }}</span>
      <span v-if="percent !== null" class="ld-pct">%</span>
    </div>

    <!-- 元素 3：下方提示文案（单独一行，居中，不挤百分比） -->
    <p class="ld-prompt">{{ state.message || '执行中…' }}</p>

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
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  /* 圆角由 JS 跟随卡片实算值（见 syncRadius）：不写死，换主题/换节点类型都对得上 */
  overflow: hidden;
  animation: ld-in 0.18s ease-out;
}

/* ============================================================
   流光扰动（照用户给的参考稿 node_loading_ui_showcase.html）
   底色 + 3 个模糊光斑缓慢扰动；只动 transform/opacity（GPU 层），
   不做扫光、不闪烁 —— 几十个节点同屏也不掉帧。
   两套配色：默认（亮·极光浅晕）/ html.dark（暗·深海青紫）。
   色值刻意用固定值：这是用户给了明确色稿的**加载装饰**，不是界面配色。
   ============================================================ */

/* ① 底色：不透明，把卡片内容与其它浮层完全盖住 */
.ld-base {
  position: absolute;
  inset: 0;
  /* 主题色白名单: 加载遮罩底色（亮），照参考稿：白卡 */
  background: #ffffff;
}
html.dark .ld-base {
  /* 主题色白名单: 加载遮罩底色（暗），照参考稿：深板岩 */
  background: #0f172a;
}

/* ② 流光层：整体模糊，光斑在里面缓慢游走 */
.ld-fluid {
  position: absolute;
  inset: -20px;
  overflow: hidden;
  filter: blur(28px);
  opacity: 0.75;
  pointer-events: none;
}
html.dark .ld-fluid {
  opacity: 0.85;
}
.ld-blob {
  position: absolute;
  border-radius: 999px;
  will-change: transform, opacity;
}
/* —— 亮色主题：极光浅晕 —— */
.ld-blob--1 {
  top: 15%;
  left: 15%;
  width: 70%;
  height: 70%;
  /* 主题色白名单: 流光光斑（亮），照参考稿 */
  background: radial-gradient(circle, rgba(56, 189, 248, 0.35) 0%, transparent 70%);
  animation: ld-orbit-1 9s ease-in-out infinite;
}
.ld-blob--2 {
  bottom: 15%;
  right: 15%;
  width: 75%;
  height: 75%;
  /* 主题色白名单: 流光光斑（亮），照参考稿 */
  background: radial-gradient(circle, rgba(129, 140, 248, 0.3) 0%, transparent 70%);
  animation: ld-orbit-2 11s ease-in-out infinite;
}
.ld-blob--3 {
  top: 50%;
  left: 50%;
  width: 60%;
  height: 60%;
  margin: -30% 0 0 -30%;
  /* 主题色白名单: 流光光斑（亮），照参考稿 */
  background: radial-gradient(circle, rgba(45, 212, 191, 0.3) 0%, transparent 70%);
  animation: ld-pulse 8s ease-in-out infinite;
}
/* —— 暗色主题：深海青紫 —— */
html.dark .ld-blob--1 {
  /* 主题色白名单: 流光光斑（暗），照参考稿 */
  background: radial-gradient(circle, rgba(14, 165, 233, 0.45) 0%, rgba(56, 189, 248, 0) 70%);
}
html.dark .ld-blob--2 {
  /* 主题色白名单: 流光光斑（暗），照参考稿 */
  background: radial-gradient(circle, rgba(99, 102, 241, 0.4) 0%, rgba(139, 92, 246, 0) 70%);
}
html.dark .ld-blob--3 {
  /* 主题色白名单: 流光光斑（暗），照参考稿 */
  background: radial-gradient(circle, rgba(20, 184, 166, 0.35) 0%, transparent 70%);
}

/* 元素 1：左上「生成中」 + 右上耗时胶囊 */
.ld-top {
  position: absolute;
  top: 10px;
  left: 12px;
  right: 12px;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.ld-state {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  /* 主题色白名单: 加载装饰前景（亮），照参考稿 */
  color: #64748b;
}
html.dark .ld-state {
  /* 主题色白名单: 加载装饰前景（暗），照参考稿 */
  color: #94a3b8;
}
.ld-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  /* 主题色白名单: 状态点（亮），照参考稿 */
  background: #0ea5e9;
  animation: ld-blink 1.4s ease-in-out infinite;
}
html.dark .ld-dot {
  /* 主题色白名单: 状态点（暗），照参考稿 */
  background: #22d3ee;
}
.ld-timer {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  /* 主题色白名单: 耗时胶囊（亮），照参考稿 */
  color: #475569;
  /* 主题色白名单: 耗时胶囊底（亮），照参考稿 */
  background: rgb(241 245 249 / 0.9);
  /* 主题色白名单: 耗时胶囊边框（亮），照参考稿 */
  border: 1px solid rgb(226 232 240 / 0.9);
}
html.dark .ld-timer {
  /* 主题色白名单: 耗时胶囊（暗），照参考稿 */
  color: #cbd5e1;
  /* 主题色白名单: 耗时胶囊底（暗），照参考稿 */
  background: rgb(2 6 23 / 0.7);
  /* 主题色白名单: 耗时胶囊边框（暗），照参考稿 */
  border-color: rgb(51 65 85 / 0.6);
}

/* 元素 2：中间超大百分比 */
.ld-progress {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: flex-start;
  margin-bottom: 6px;
}
.ld-num {
  font-size: 56px;
  font-weight: 900;
  line-height: 1;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  /* 主题色白名单: 进度数字（亮），照参考稿 */
  color: #1e293b;
  /* 主题色白名单: 进度数字发光（亮），照参考稿 */
  text-shadow: 0 0 16px rgb(14 165 233 / 0.25);
}
html.dark .ld-num {
  /* 主题色白名单: 进度数字（暗），照参考稿 */
  color: #ffffff;
  /* 主题色白名单: 进度数字发光（暗），照参考稿 */
  text-shadow: 0 0 20px rgb(56 189 248 / 0.4);
}
.ld-pct {
  margin-left: 2px;
  font-size: 22px;
  font-weight: 600;
  line-height: 1;
  /* 主题色白名单: 百分号（亮），照参考稿 */
  color: #0284c7;
}
html.dark .ld-pct {
  /* 主题色白名单: 百分号（暗），照参考稿 */
  color: #22d3ee;
}

/* 元素 3：下方提示文案（单独一行、居中、可换行，不挤百分比） */
.ld-prompt {
  position: relative;
  z-index: 2;
  margin: 0;
  max-width: calc(100% - 32px);
  text-align: center;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.5;
  /* 主题色白名单: 提示文案（亮），照参考稿 */
  color: #475569;
}
html.dark .ld-prompt {
  /* 主题色白名单: 提示文案（暗），照参考稿 */
  color: #cbd5e1;
}

/* 取消：右下角小号文本按钮 */
.task-overlay-cancel {
  position: absolute;
  right: 6px;
  bottom: 6px;
  z-index: 3;
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

@keyframes ld-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@keyframes ld-orbit-1 {
  0% {
    transform: translate3d(-30%, -25%, 0) scale(1) rotate(0deg);
  }
  33% {
    transform: translate3d(30%, 15%, 0) scale(1.3) rotate(120deg);
  }
  66% {
    transform: translate3d(-10%, 35%, 0) scale(0.9) rotate(240deg);
  }
  100% {
    transform: translate3d(-30%, -25%, 0) scale(1) rotate(360deg);
  }
}
@keyframes ld-orbit-2 {
  0% {
    transform: translate3d(35%, 30%, 0) scale(1.2) rotate(360deg);
  }
  33% {
    transform: translate3d(-25%, -20%, 0) scale(0.85) rotate(240deg);
  }
  66% {
    transform: translate3d(20%, -35%, 0) scale(1.25) rotate(120deg);
  }
  100% {
    transform: translate3d(35%, 30%, 0) scale(1.2) rotate(0deg);
  }
}
@keyframes ld-pulse {
  0%,
  100% {
    transform: scale(0.8);
    opacity: 0.4;
  }
  50% {
    transform: scale(1.25);
    opacity: 0.85;
  }
}
@keyframes ld-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

@media (prefers-reduced-motion: reduce) {
  .task-overlay,
  .ld-blob,
  .ld-dot {
    animation: none;
  }
}
</style>
