<script setup lang="ts">
import { computed, useSlots } from 'vue'
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
const hasIcon = computed(() => Boolean(slots.icon))
const hasLabel = computed(() => Boolean(slots.default))
/** 图标按钮：显式指定优先，否则只有 icon 插槽、没有文字。 */
const onlyIcon = computed(() => props.iconOnly ?? (hasIcon.value && !hasLabel.value))

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
    <span v-if="$slots.default && !onlyIcon" class="mck-button__label"><slot /></span>
  </button>
</template>
