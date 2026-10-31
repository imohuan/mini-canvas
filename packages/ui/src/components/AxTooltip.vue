<script setup lang="ts">
// AxTooltip —— 成品应用对 @mini-canvas/ui-kit Tooltip 的**薄适配层**。
//
// 定位、翻转、视口收边、悬停延迟、焦点触发、箭头方向全在库里；
// 这里只保留宿主原有的 props 名与 `.axt-*` 外观钩子（首页懒挂载判定按 `.axt-root` 取件）。
//
// 用法：
//   <AxTooltip content="生成历史"><button aria-label="生成历史">…</button></AxTooltip>
//   需要自定义内容时用 #content 插槽。
import { computed } from 'vue'
import { Tooltip as UiKitTooltip } from '@mini-canvas/ui-kit'

const props = withDefaults(
  defineProps<{
    content?: string
    placement?: string
    offset?: number
    /** 是否显示小箭头（目标页的纯文字气泡不带箭头，默认关） */
    arrow?: boolean
    /** 悬停多久才显示（ms） */
    delay?: number
    /** 应用到触发器包一层的 class（组件是双根，外部 class 会丢） */
    triggerClass?: string
    disabled?: boolean
  }>(),
  {
    content: '',
    placement: 'top',
    offset: 8,
    arrow: false,
    delay: 200,
    triggerClass: '',
    disabled: false,
  },
)

const placement = computed(() => props.placement as never)
</script>

<template>
  <UiKitTooltip
    class="axt-root"
    :class="triggerClass"
    :content="content"
    :placement="placement"
    :offset="offset"
    :arrow="arrow"
    arrow-class="axt-arrow"
    :delay="delay"
    :disabled="disabled"
    :max-width="'260px'"
    body-class="axt-bubble"
  >
    <slot />
    <template #content><slot name="content">{{ content }}</slot></template>
  </UiKitTooltip>
</template>

<style>
/* 非 scoped：气泡被 Teleport 到 body，scoped 选择器命不中。
   气泡外观继承 ui-kit 的 --ui-tip 主题变量，宿主不再自己画一份。 */
.axt-root { display: inline-flex; }
.mck-tooltip__body.axt-bubble { max-width: 260px; line-height: 16px; white-space: nowrap; }
.mck-dropdown__arrow.axt-arrow {
  --mck-dropdown-arrow-bg: var(--ui-tip);
  --mck-dropdown-arrow-line: transparent;
}
</style>
