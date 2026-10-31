<script setup lang="ts">
import { Comment, Fragment, Text, computed, useSlots, type VNode } from 'vue'
import { useUiKit } from '../../provider/context'
import type { ButtonProps } from './types'
import './button.css'

defineOptions({ name: 'MckButton', inheritAttrs: false })

const props = withDefaults(defineProps<ButtonProps>(), {
  variant: 'secondary',
  size: undefined,
  block: false,
  disabled: false,
  loading: false,
  type: 'button',
  ariaLabel: '',
  title: '',
  iconOnly: undefined,
  round: false,
})

const emit = defineEmits<{ click: [event: MouseEvent] }>()
const slots = useSlots()
const kit = useUiKit()
const size = computed(() => props.size ?? kit.value.size)
/**
 * 插槽存在不等于有内容：`v-if` 没成立时插槽函数仍在，只会产出空片段或注释。
 * 递归检查文本和元素，空白文字不算标签。
 */
function hasSlotContent(nodes: VNode[] | undefined): boolean {
  if (!nodes?.length) return false
  return nodes.some((node) => {
    if (node.type === Comment) return false
    if (node.type === Text) return typeof node.children === 'string' && node.children.trim().length > 0
    if (node.type === Fragment) return hasSlotContent(Array.isArray(node.children) ? node.children as VNode[] : undefined)
    return true
  })
}

const hasLabel = computed(() => hasSlotContent(slots.default?.()))

/** 图标按钮：显式指定优先，否则只有 icon 插槽、没有文字。 */
const onlyIcon = computed(() => props.iconOnly ?? (Boolean(slots.icon) && !hasLabel.value))

function onClick(event: MouseEvent): void {
  if (props.disabled || props.loading) return
  emit('click', event)
}
</script>

<template>
  <button
    v-bind="$attrs"
    :type="type"
    :disabled="disabled || loading"
    :aria-label="ariaLabel || (onlyIcon ? title || '图标按钮' : undefined)"
    :aria-busy="loading ? 'true' : undefined"
    :title="title || undefined"
    class="mck-button"
    :class="[
      'mck-button--' + variant,
      'mck-button--' + size,
      {
        'is-block': block,
        'is-icon-only': onlyIcon,
        'is-loading': loading,
        'is-round': round,
      },
    ]"
    @click="onClick"
  >
    <span v-if="loading" class="mck-button__spinner" aria-hidden="true"></span>
    <span v-else-if="$slots.icon" class="mck-button__icon" aria-hidden="true">
      <slot name="icon" />
    </span>
    <span v-if="hasLabel && !onlyIcon" class="mck-button__label"><slot /></span>
  </button>
</template>
