<script setup lang="ts">
defineProps<{
  frames: Map<number, string>
  frameIndices: number[]
  startPct: number
  endPct: number
  atLeft: boolean
  atRight: boolean
  isDragging: boolean
  labelBelow: boolean
  lengthLabel: string
  playheadPct: number | null
  range: { start: number; end: number }
  duration: number
}>()

const emit = defineEmits<{
  (e: 'handle-down', ev: PointerEvent, kind: 'start' | 'end' | 'move'): void
}>()
</script>

<template>
  <div class="vclip-film" role="group" aria-label="视频片段选择">
    <!-- 帧图底板：贴边时这一侧的圆角要取消，否则会露出黑色方角（demo 几何约定第 7 条） -->
    <div class="vclip-frames" :class="{ 'is-at-left': atLeft, 'is-at-right': atRight }" aria-hidden="true">
      <div v-for="i in frameIndices" :key="i" class="vclip-frame" :style="frames.get(i) ? { backgroundImage: 'url(' + frames.get(i) + ')' } : undefined" />
    </div>
    <div class="vclip-shade is-left" :style="{ width: startPct + '%' }" />
    <div class="vclip-shade is-right" :style="{ left: endPct + '%', width: Math.max(0, 100 - endPct) + '%' }" />
    <div
      class="vclip-selection"
      :class="{ 'is-dragging': isDragging, 'is-at-left': atLeft, 'is-at-right': atRight }"
      :style="{ left: startPct + '%', width: Math.max(0, endPct - startPct) + '%' }"
      @pointerdown="emit('handle-down', $event, 'move')"
    >
      <div class="vclip-handle is-start" role="slider" aria-label="片段起点" :aria-valuemin="0" :aria-valuemax="duration" :aria-valuenow="range.start" tabindex="0" @pointerdown.stop="emit('handle-down', $event, 'start')" />
      <div class="vclip-handle is-end" role="slider" aria-label="片段终点" :aria-valuemin="0" :aria-valuemax="duration" :aria-valuenow="range.end" tabindex="0" @pointerdown.stop="emit('handle-down', $event, 'end')" />
      <!-- 装得下就居中显示；装不下改到下方那一条（见 labelBelow） -->
      <span v-if="!labelBelow" class="vclip-length">{{ lengthLabel }}</span>
    </div>
    <!-- 时间线：拖拽时也常显（用户口径 2026-10-31）——
         拖动端点会把画面 seek 到那一端，白线据此跟到新位置，用户能一路看着走。 -->
    <div v-if="playheadPct !== null" class="vclip-playhead" :style="{ left: playheadPct + '%' }" />
    <!-- 隐藏量尺：只用来量同一串文字的像素宽度，不参与视觉（visibility 保留布局，能读出 offsetWidth） -->
    <span class="vclip-ruler" aria-hidden="true">{{ lengthLabel }}</span>
  </div>
</template>

<style scoped>
/* 胶片条：黑底 12px 圆角；内部 flex 铺满 */
.vclip-film {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  /* 帧图高度下限（用户 2026-10-31）：外框再被压扁也不低于 55px */
  min-height: 55px;
  overflow: visible;
  border-radius: 12px;
  background: var(--vclip-film);
  /* 两侧留白（用户 2026-10-31 定的 16px）：选区把手要伸到胶片外面，留白是它们的落点 */
  margin: 0 16px;
  touch-action: none;
  user-select: none;
}
.vclip-frames {
  position: absolute;
  inset: 0;
  display: flex;
  overflow: hidden;
  border-radius: 12px;
  background: var(--vclip-frame-bg);
}
/* 选区贴到某一侧（≤12px）：那一侧帧图变直角，把胶片的圆角盖住 ——
   否则圆角下方会露出黑色方角，看起来像选区被削掉一块（demo 几何约定第 7 条）。 */
.vclip-frames.is-at-left { border-top-left-radius: 0; border-bottom-left-radius: 0; }
.vclip-frames.is-at-right { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.vclip-frame {
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  background-color: var(--vclip-frame);
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
}
.vclip-frame + .vclip-frame { border-left: 1px solid var(--vclip-divider); }

/* 选区外遮罩（demo 同款半透明黑） */
.vclip-shade {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 2;
  background: var(--vclip-shade);
  pointer-events: none;
}
.vclip-shade.is-left { left: 0; }
.vclip-shade.is-right { right: 0; }

/* 胶囊选区：矩形透明块 + 上下 2px 蓝线（::after）；贴边时外角变直角 */
.vclip-selection {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 4;
  min-width: 2px;
  cursor: grab;
  touch-action: none;
  box-sizing: border-box;
}
.vclip-selection.is-dragging { cursor: grabbing; }
.vclip-selection::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 10;
  border-top: 2px solid var(--vclip-accent);
  border-bottom: 2px solid var(--vclip-accent);
  pointer-events: none;
}
/* 选区本身是直角矩形（圆角只在帧图底板上），所以贴边只需要处理 .vclip-frames */

/* 两只蓝色耳朵：绝对定位、不占布局宽度、可以越过胶片边界（demo capsule 同款） */
.vclip-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 9;
  width: 16px;
  border: 0;
  background: var(--vclip-accent);
  box-shadow: none;
  cursor: ew-resize;
  touch-action: none;
}
.vclip-handle.is-start { left: -16px; border-radius: 12px 0 0 12px; }
.vclip-handle.is-end { right: -16px; border-radius: 0 12px 12px 0; }
.vclip-handle::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 1px;
  height: 13px;
  margin-top: -6.5px;
  margin-left: -0.5px;
  border-radius: 999px;
  background: var(--vclip-handle-line);
  opacity: 0.85;
  transition: opacity 0.14s ease;
}
.vclip-selection:hover .vclip-handle::after,
.vclip-selection.is-dragging .vclip-handle::after { opacity: 1; }
.vclip-handle:focus-visible { outline: 2px solid var(--vclip-accent-ring); outline-offset: 2px; }

/* 时长 pill（3.36 s）：居中悬浮 */
.vclip-length {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 10;
  transform: translate(-50%, -50%);
  max-width: calc(100% - 16px);
  overflow: hidden;
  padding: 8px 12px;
  border-radius: 10px;
  color: var(--vclip-ink-strong);
  background: var(--vclip-length-bg);
  box-shadow: 0 4px 14px var(--vclip-divider);
  font-size: 14px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.01em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  text-overflow: ellipsis;
  pointer-events: none;
}

/* 时间线（白线）：视频当前时间，拖拽时也常显（用户口径 2026-10-31） */
.vclip-playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 7;
  width: 2px;
  background: var(--vclip-ink-strong);
  box-shadow: 0 0 0 1px var(--vclip-divider), 0 0 10px var(--vclip-playhead-glow);
  pointer-events: none;
  transform: translate3d(-1px, 0, 0);
}

/* 隐藏量尺：与 pill 同一套字体/内边距，量出来的宽度才和真实标签一致。
   visibility:hidden 而不是 display:none —— 后者量不到 offsetWidth。 */
.vclip-ruler {
  position: absolute;
  top: 0;
  left: 0;
  z-index: -1;
  visibility: hidden;
  padding: 8px 12px;
  font-size: 14px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.01em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  .vclip-handle::after {
    transition: none !important;
  }
}
</style>
