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
import { computed } from 'vue'
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

/**
 * ui-kit 的 Tooltip 使用固定 8px 间距；调用方显式传其他值时补一层外边距，
 * 避免“参数被默默忽略”。默认值 8 时零副作用。
 */
const extraGap = computed(() => Math.max(0, props.offset - 8))
</script>

<template>
  <UiKitTooltip
    class="tlt-root"
    :content="content"
    :placement="placement"
    :delay="delay"
    :disabled="disabled"
    :arrow="false"
    :max-width="'min(560px, calc(100vw - 16px))'"
  >
    <span class="tlt-trigger" :style="extraGap ? { margin: extraGap + 'px' } : undefined"><slot /></span>
    <template #content>
      <span class="tlt-bubble">
        <slot name="content">{{ content }}</slot>
        <span v-if="arrow" class="tlt-arrow" aria-hidden="true" />
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
.tlt-arrow {
  position: absolute;
  left: 50%;
  bottom: -4px;
  width: 10px;
  height: 10px;
  margin-left: -5px;
  background: var(--ui-tip, rgb(0 0 0 / 0.9));
  transform: rotate(45deg);
}
</style>
