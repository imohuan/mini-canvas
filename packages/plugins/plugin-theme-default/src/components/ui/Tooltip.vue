<script setup lang="ts">
/**
 * Tooltip —— 通用悬浮提示（设计系统件，登记在 registryOf('ui') 的 'tooltip' 名下）。
 *
 * 定位、翻转、视口收边、悬停延迟、外部锚点全部交给 @mini-canvas/ui-kit 的 Tooltip
 * （它作为 Dropdown 的预设，复用同一套浮层）；这里只保留**默认皮的气泡外观**与原有插槽契约。
 *
 * 用法：
 *   <Tooltip content="上下文剩余 96%"><span class="ring" /></Tooltip>
 *   需要自由内容时用 #content 插槽。
 */
import { Tooltip as UiKitTooltip } from '@mini-canvas/ui-kit'

const props = withDefaults(
  defineProps<{
    /** 提示文字（用 #content 插槽时可省略） */
    content?: string
    /** 气泡贴着触发器哪一侧：top / bottom / left / right */
    placement?: 'top' | 'bottom' | 'left' | 'right'
    /** 与触发器之间的间距（px） */
    offset?: number
    /** 是否画指向触发器的小三角 */
    arrow?: boolean
    /** 悬停多久才出现（ms）——太灵敏会让鼠标扫过时到处闪 */
    delay?: number
    disabled?: boolean
  }>(),
  { content: '', placement: 'top', offset: 8, arrow: true, delay: 120, disabled: false },
)

</script>

<template>
  <UiKitTooltip
    class="tlt-root"
    :content="content"
    :placement="placement"
    :delay="delay"
    :disabled="disabled"
    :offset="offset"
    :arrow="arrow"
    arrow-class="tlt-arrow"
    :max-width="'min(560px, calc(100vw - 16px))'"
  >
    <span class="tlt-trigger"><slot /></span>
    <template #content>
      <span class="tlt-bubble">
        <slot name="content">{{ content }}</slot>
      </span>
    </template>
  </UiKitTooltip>
</template>

<style>
/* 非 scoped：气泡由 ui-kit 的 Dropdown Teleport 到 body，scoped 选择器命不中。类名带 tlt- 前缀避撞。 */
.tlt-root { display: inline-flex; }
.tlt-trigger { display: inline-flex; }
.tlt-bubble {
  position: relative;
  display: block;
  box-sizing: border-box;
  width: max-content;
  max-width: inherit;
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--ui-tip, rgb(0 0 0 / 0.9));
  color: var(--ui-tip-ink, #fff);
  box-shadow: 0 4px 6px -1px var(--ui-scrim-soft, rgb(0 0 0 / 0.1));
  font-size: 12px;
  line-height: 1.6;
  white-space: normal;
  overflow-wrap: anywhere;
  pointer-events: none;
}
/* 箭头由 ui-kit 按真实弹出方向画（贴哪条边、翻到哪一侧都跟定位走）；这里只把它染成气泡色。 */
.mck-dropdown__arrow.tlt-arrow {
  --mck-dropdown-arrow-bg: var(--ui-tip, rgb(0 0 0 / 0.9));
  --mck-dropdown-arrow-line: transparent;
}
</style>
