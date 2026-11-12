<script setup lang="ts">
/**
 * HoverTip —— 底栏 / 状态栏按钮的悬停提示气泡。
 *
 * 为什么不用 reka 的 Tooltip（shadcn Tooltip）：这些按钮**同时**是
 * DropdownMenuTrigger。2026-11-02 与 2026-11-06 两次实测都证实，
 * 两个浮层共用一个按钮（哪怕 Tooltip 包在外层 span 上）时会抢同一个
 * 浮层锚点，下拉菜单被定位到屏幕外（实测 top = -482px）。
 *
 * 所以这里用一个不创建浮层、不接管锚点的轻提示：
 * - 视觉参数照 shadcn TooltipContent（反色底、圆角 12、12px 字、10×5 箭头）；
 * - 用 CSS 定位在触发元素正上方，不影响任何其它浮层；
 * - 只在 hover / focus 时显示，带 120ms 淡入。
 *
 * 需要「必须能被读屏读到」的地方请继续用真 Tooltip；这里只解决视觉提示。
 */
withDefaults(
  defineProps<{
    /** 气泡文字（同时写 role=tooltip 给读屏） */
    label: string
    /** 气泡方向，默认在上方（底栏按钮都在屏幕下缘） */
    side?: 'top' | 'bottom'
  }>(),
  { side: 'top' },
)
</script>

<template>
  <span class="hover-tip-wrap" :class="'is-' + side">
    <slot />
    <span class="hover-tip" role="tooltip">{{ label }}</span>
  </span>
</template>

<style scoped>
.hover-tip-wrap {
  position: relative;
  display: inline-flex;
  flex: none;
}

/*
 * 气泡本体：反色底 + 浅色字，和 shadcn 的 TooltipContent 同一套视觉
 * （rounded-xl / px-3 py-1.5 / text-xs）。不用 box-shadow，避免和下拉菜单
 * 的阴影叠在一起显得脏。
 */
.hover-tip {
  position: absolute;
  left: 50%;
  z-index: var(--layer-modal-top, 100001);
  padding: 6px 12px;
  border-radius: 12px;
  background: var(--ui-ink, #18202b);
  color: var(--ui-panel, #fff);
  font-size: 12px;
  line-height: 1;
  font-weight: 400;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.hover-tip-wrap.is-top .hover-tip {
  bottom: calc(100% + 8px);
  transform: translate(-50%, 4px);
}
.hover-tip-wrap.is-bottom .hover-tip {
  top: calc(100% + 8px);
  transform: translate(-50%, -4px);
}

/* 箭头：10×5 的小三角，与 shadcn TooltipArrow 同尺寸 */
.hover-tip::after {
  content: '';
  position: absolute;
  left: 50%;
  width: 10px;
  height: 5px;
  margin-left: -5px;
  background: var(--ui-ink, #18202b);
}
.hover-tip-wrap.is-top .hover-tip::after {
  top: 100%;
  clip-path: polygon(0 0, 100% 0, 50% 100%);
}
.hover-tip-wrap.is-bottom .hover-tip::after {
  bottom: 100%;
  clip-path: polygon(50% 0, 100% 100%, 0 100%);
}

.hover-tip-wrap:hover .hover-tip,
.hover-tip-wrap:focus-within .hover-tip {
  opacity: 1;
  transform: translate(-50%, 0);
}

@media (prefers-reduced-motion: reduce) {
  .hover-tip { transition: none !important; }
}
</style>
