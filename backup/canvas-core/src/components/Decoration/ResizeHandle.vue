<script setup lang="ts">
import type { CSSProperties } from 'vue'

/**
 * ResizeHandle —— 通用裁剪/扩展控制柄
 *
 * 统一所有「裁剪 / 扩展」类交互框的八个方向控制柄的外观与光标：
 * 正方形、白底黑边、2px 圆角，光标按方向映射。
 *
 * 定位完全由调用方负责：
 * - 裁剪框（绝对定位，相对 crop-frame）：通过 class 方向 + scoped :deep 样式定位，
 *   或直接传 style 的 left/top/right/bottom。
 * - 扩展框（fixed 定位，相对 viewport）：通过 style 传 position/left/top。
 *
 * 本组件不内置方向定位，避免与不同定位基准（absolute vs fixed）冲突。
 */
defineProps<{
  /** 控制柄方向，决定光标样式 */
  dir: 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e'
  /** 额外样式（position/left/top/right/bottom 等由调用方决定） */
  style?: CSSProperties
}>()

const emit = defineEmits<{
  (e: 'pointerdown', ev: PointerEvent): void
}>()

const cursorMap: Record<string, string> = {
  nw: 'nw-resize',
  ne: 'ne-resize',
  sw: 'sw-resize',
  se: 'se-resize',
  n: 'n-resize',
  s: 's-resize',
  w: 'w-resize',
  e: 'e-resize',
}

function onPointerDown(ev: PointerEvent) {
  emit('pointerdown', ev)
}
</script>

<template>
  <div
    class="resize-handle"
    :style="{ cursor: cursorMap[dir], ...(style || {}) }"
    :aria-label="`resize ${dir}`"
    role="button"
    @pointerdown.stop="onPointerDown"
  />
</template>

<style scoped>
.resize-handle {
  position: absolute;
  width: 10px;
  height: 10px;
  background: #fff;
  border: 1.5px solid rgba(0, 0, 0, 0.5);
  border-radius: 2px;
  z-index: 15;
  pointer-events: auto;
  touch-action: none;
  box-sizing: border-box;
}
</style>
