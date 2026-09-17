<script setup lang="ts">
/**
 * VideoClipPanel —— 视频节点底部「剪辑」栏（**仅剪辑模式且单选时显示**）。
 *
 * 定位不在这里：贴边距离 / 水平居中 / 反缩放由节点壳 BaseNode 的下插槽定位层统一负责
 * （与图片生成栏同约定），本组件只是一段普通流式内容。
 *
 * 交互设计：一条时间轴 + 两个可拖端点 + 中间可整段平移。这是剪辑最常见的动作组合，
 * 也避开了"输入框填秒数"那种看不见结果的方式 —— 每拖一下都能在预览里立刻看到。
 *
 * 草稿归会话（不写库）：拖拽的每一帧都写库会产生几百条撤销记录。
 * 确认时经命令一次性提交（与顶部条/内容区同一实现）。
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { useCanvasRender, useSoleNodeSelected } from '@mini-canvas/canvas-render'
import { NodeToolbarButton } from '@mini-canvas/plugin-theme-default'
import {
  clampClipEnd,
  clampClipRange,
  clampClipStart,
  MIN_CLIP_DURATION,
  moveClipRange,
  readClipRange,
} from './videoClip'
import { formatTime } from './videoNodeData'
import { isClipping, overlayDraft, setOverlayDraft } from './videoSession'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()

const { ctx } = useCanvasRender()
const selected = useSoleNodeSelected(props.id)
const active = computed(() => isClipping(props.id))
const visible = computed(() => selected.value && active.value)

const ICON_CONFIRM =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
const ICON_CANCEL =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'

const hasVideo = computed(() => typeof props.data?.videoUrl === 'string' && props.data.videoUrl !== '')
const duration = computed(() => {
  const d = Number(props.data?.videoDuration)
  return Number.isFinite(d) && d > 0 ? d : 0
})

/**
 * 最短剪辑时长：来自配置（分组「视频/剪辑」的 videoMinClipDuration）。
 * 读不到就回落 MIN_CLIP_DURATION —— 绝不因为配置缺失让剪辑失效。
 */
const minClip = computed(() => {
  const settings = ctx.get<{ get(key: string): unknown } | undefined>('settings')
  const raw = settings?.get('videoMinClipDuration')
  const n = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : MIN_CLIP_DURATION
  // 最短时长不能超过视频总长（否则永远拖不出合法范围）
  return duration.value > 0 ? Math.min(n, duration.value) : n
})

/** 当前显示的范围：草稿优先，其次已保存的，最后整段 */
const range = computed(() => {
  const draft = overlayDraft(props.id)._clipRange as { start: number; end: number } | undefined
  if (draft && Number.isFinite(draft.start) && Number.isFinite(draft.end)) {
    return clampClipRange({ start: draft.start, end: draft.end, duration: duration.value, minDuration: minClip.value })
  }
  return readClipRange(props.data, minClip.value)
})

const startPct = computed(() => (duration.value > 0 ? (range.value.start / duration.value) * 100 : 0))
const endPct = computed(() => (duration.value > 0 ? (range.value.end / duration.value) * 100 : 100))
const lengthLabel = computed(() => `${formatTime(range.value.end - range.value.start)} (${(range.value.end - range.value.start).toFixed(1)}s)`)

const trackRef = ref<HTMLElement | null>(null)
let drag: { kind: 'start' | 'end' | 'move'; startX: number; from: { start: number; end: number } } | null = null

/** 指针 x 换算成时间轴上的秒数 */
function timeAt(clientX: number): number {
  const el = trackRef.value
  if (!el || duration.value <= 0) return 0
  const box = el.getBoundingClientRect()
  if (box.width <= 0) return 0
  const ratio = Math.min(Math.max((clientX - box.left) / box.width, 0), 1)
  return ratio * duration.value
}

function commit(next: { start: number; end: number }): void {
  setOverlayDraft(props.id, { ...overlayDraft(props.id), _clipRange: next })
}

function onPointerDown(ev: PointerEvent, kind: 'start' | 'end' | 'move'): void {
  if (ev.button !== 0) return
  ev.preventDefault()
  ev.stopPropagation()
  drag = { kind, startX: ev.clientX, from: { ...range.value } }
  trackRef.value?.setPointerCapture?.(ev.pointerId)
}

function onPointerMove(ev: PointerEvent): void {
  if (!drag) return
  ev.stopPropagation()
  const at = timeAt(ev.clientX)
  const opts = { duration: duration.value, minDuration: minClip.value }
  if (drag.kind === 'start') commit(clampClipStart({ start: at, end: drag.from.end, ...opts }))
  else if (drag.kind === 'end') commit(clampClipEnd({ start: drag.from.start, end: at, ...opts }))
  else {
    // 整段平移：按指针位移换算，而不是把指针位置当新起点（那样会跳）
    const el = trackRef.value
    const box = el?.getBoundingClientRect()
    const perPx = box && box.width > 0 ? duration.value / box.width : 0
    const delta = (ev.clientX - drag.startX) * perPx
    commit(moveClipRange({ ...drag.from, nextStart: drag.from.start + delta, ...opts }))
  }
}

function onPointerUp(ev: PointerEvent): void {
  if (!drag) return
  ev.stopPropagation()
  drag = null
  trackRef.value?.releasePointerCapture?.(ev.pointerId)
}

function onConfirm(): void {
  ctx.get<{ execute(id: string, ...payload: unknown[]): unknown }>('command').execute('video.clipConfirm', {
    nodeId: props.id,
    start: range.value.start,
    end: range.value.end,
  })
}

function onCancel(): void {
  ctx.get<{ execute(id: string, ...payload: unknown[]): unknown }>('command').execute('video.clipCancel', {
    nodeId: props.id,
  })
}

onBeforeUnmount(() => {
  drag = null
})
</script>

<template>
  <div v-if="visible" class="vclip nodrag nopan nowheel" @dblclick.stop>
    <div v-if="!hasVideo" class="vclip-empty">这里还没有视频，先上传一段再剪辑</div>

    <template v-else>
      <div
        ref="trackRef"
        class="vclip-track"
        @pointerdown="onPointerDown($event, 'move')"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      >
        <!-- 已选区间：中间那块可整体拖动 -->
        <div class="vclip-range" :style="{ left: startPct + '%', width: Math.max(0, endPct - startPct) + '%' }" />
        <!-- 区间外的轨道（表示被剪掉的部分） -->
        <div class="vclip-outside is-left" :style="{ width: startPct + '%' }" />
        <div class="vclip-outside is-right" :style="{ left: endPct + '%', width: Math.max(0, 100 - endPct) + '%' }" />
        <!-- 两个端点把手 -->
        <div
          class="vclip-handle is-start"
          :style="{ left: startPct + '%' }"
          role="slider"
          aria-label="剪辑起点"
          :aria-valuemin="0"
          :aria-valuemax="duration"
          :aria-valuenow="range.start"
          tabindex="0"
          @pointerdown.stop="onPointerDown($event, 'start')"
        />
        <div
          class="vclip-handle is-end"
          :style="{ left: endPct + '%' }"
          role="slider"
          aria-label="剪辑终点"
          :aria-valuemin="0"
          :aria-valuemax="duration"
          :aria-valuenow="range.end"
          tabindex="0"
          @pointerdown.stop="onPointerDown($event, 'end')"
        />
      </div>

      <div class="vclip-info">
        <span class="vclip-time">{{ formatTime(range.start) }} → {{ formatTime(range.end) }}</span>
        <span class="vclip-len">保留 {{ lengthLabel }}</span>
      </div>

      <div class="vclip-actions">
        <NodeToolbarButton title="取消剪辑" aria-label="取消剪辑" variant="danger" :icon="ICON_CANCEL" @click="onCancel" />
        <NodeToolbarButton title="确认剪辑" aria-label="确认剪辑" variant="primary" :icon="ICON_CONFIRM" @click="onConfirm">确认</NodeToolbarButton>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* 白底小面板（与图片生成栏同材质）；位置与反缩放由壳的插槽定位层给。
   数值照 ui-style-guide：圆角 10、发丝边、e2 柔影、间隙 4/8、交互目标 32px。 */
.vclip {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 520px;
  padding: 8px 10px;
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 10px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.08);
}

.vclip-empty {
  flex: 1;
  color: #9ca3af;
  font-size: 12px;
}

/* 时间轴：轨道 6px、圆角 999、触摸区整块 20px 高（够手指/鼠标好按） */
.vclip-track {
  position: relative;
  flex: 1;
  min-width: 160px;
  height: 20px;
  cursor: grab;
  touch-action: none;
}
.vclip-track:active {
  cursor: grabbing;
}
.vclip-track::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 7px;
  height: 6px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.06);
}

/* 被剪掉的区间：灰底（轨道本身就是这个色，这里只是显式地压在两端上，便于将来加深） */
.vclip-outside {
  position: absolute;
  top: 7px;
  height: 6px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.06);
}
.vclip-outside.is-left {
  left: 0;
}

/* 保留区间：青色（品牌强调色，全界面只此一处实心底长条，不会与别的抢） */
.vclip-range {
  position: absolute;
  top: 7px;
  height: 6px;
  border-radius: 999px;
  background: #0891b2;
  pointer-events: none;
}

/* 端点把手：白色胶囊 + 发丝边，中间一条青线，视觉上"可以抓住" */
.vclip-handle {
  position: absolute;
  top: 0;
  width: 12px;
  height: 20px;
  margin-left: -6px;
  border: 1px solid var(--line-hair, rgba(0, 0, 0, 0.08));
  border-radius: 6px;
  background: #fff;
  cursor: ew-resize;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06);
}
.vclip-handle::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 5px;
  width: 2px;
  height: 10px;
  margin-left: -1px;
  border-radius: 999px;
  background: #0891b2;
}
.vclip-handle:focus-visible {
  outline: 2px solid rgba(8, 145, 178, 0.6);
  outline-offset: 1px;
}

.vclip-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: none;
  min-width: 96px;
  font-variant-numeric: tabular-nums;
}
.vclip-time {
  color: #111827;
  font-size: 12px;
  font-weight: 600;
}
.vclip-len {
  color: #9ca3af;
  font-size: 11px;
}

.vclip-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
}

@media (prefers-reduced-motion: reduce) {
  .vclip-handle {
    transition: none !important;
  }
}
</style>
