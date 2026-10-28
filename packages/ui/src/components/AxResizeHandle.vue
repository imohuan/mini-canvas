<script setup lang="ts">
/**
 * AxResizeHandle —— 面板宽度拖拽手柄（左侧抽屉 / 右侧 Agent 面板共用）。
 *
 * 为什么单独成组件：两处原来各画一套（一个用 Tailwind 白渐变、一个用 scoped CSS 白渐变），
 * 换主题后仍是白的，而且两边会慢慢长得不一样。这里统一成一条线：
 * 悬停 = 主题色细线；按住拖拽 = 线加粗 + 背后一层很淡的主题色底。
 *
 * 只负责外观与「正在拖」状态，真正改宽度仍交给各面板自己的处理器
 * （左右两侧的增长方向相反，计算逻辑本来就不同）。
 */
import { onBeforeUnmount, ref } from 'vue'

const props = withDefaults(defineProps<{
  /** 无障碍名称：读屏会念「调整 XX 宽度」 */
  label: string
  /** 线贴面板哪条边：left = 右侧面板（线在左缘）；right = 左侧面板（线在右缘） */
  edge?: 'left' | 'right'
}>(), { edge: 'left' })

const emit = defineEmits<{ (e: 'resize-start', ev: PointerEvent): void }>()

/** 按住期间才加粗：用窗口 pointerup 收尾，拖出 12px 热区也不会一直亮着 */
const dragging = ref(false)

function stopDrag(): void {
  dragging.value = false
  window.removeEventListener('pointerup', stopDrag)
  window.removeEventListener('pointercancel', stopDrag)
}

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return
  dragging.value = true
  window.addEventListener('pointerup', stopDrag)
  window.addEventListener('pointercancel', stopDrag)
  emit('resize-start', e)
}

onBeforeUnmount(stopDrag)
</script>

<template>
  <div
    class="ax-rh"
    :class="[`ax-rh--${props.edge}`, { 'is-dragging': dragging }]"
    role="separator"
    aria-orientation="vertical"
    :aria-label="props.label"
    @pointerdown.prevent="onPointerDown"
  >
    <span class="ax-rh-line" aria-hidden="true"></span>
  </div>
</template>

<style scoped>
/* 12px 热区保持好抓；真正看见的是一根 2px 线，拖拽时加粗到 4px */
.ax-rh {
  position: absolute;
  width: 12px;
  cursor: col-resize;
  touch-action: none;
}

.ax-rh::before {
  content: '';
  position: absolute;
  inset: 0;
  opacity: 0;
  pointer-events: none;
  transition: opacity 160ms ease;
}

/* 底板淡淡的主题色：从线那一侧向外渐隐，不把整条 12px 涂成实心块 */
.ax-rh--left::before {
  background: linear-gradient(to right, var(--ui-accent-soft, rgb(8 145 178 / 0.12)), transparent);
}

.ax-rh--right::before {
  background: linear-gradient(to left, var(--ui-accent-soft, rgb(8 145 178 / 0.12)), transparent);
}

.ax-rh-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  border-radius: 1px;
  background: transparent;
  transition: width 160ms ease, background-color 160ms ease;
}

.ax-rh--left .ax-rh-line {
  left: 0;
}

.ax-rh--right .ax-rh-line {
  right: 0;
}

/* 悬停先给一点暗示；真正拖的时候用满主题色并把线加粗 */
.ax-rh:hover .ax-rh-line,
.ax-rh.is-dragging .ax-rh-line {
  background: color-mix(in srgb, var(--ui-accent, #0891b2) 70%, transparent);
}

.ax-rh.is-dragging::before {
  opacity: 1;
}

.ax-rh.is-dragging .ax-rh-line {
  width: 4px;
  background: var(--ui-accent, #0891b2);
}

@media (prefers-reduced-motion: reduce) {
  .ax-rh::before,
  .ax-rh-line {
    transition: none;
  }
}
</style>
