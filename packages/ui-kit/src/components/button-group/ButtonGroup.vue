<script setup lang="ts">
import { computed } from 'vue'
import { useUiKit } from '../../provider/context'
import type { ButtonGroupProps } from './types'
import './button-group.css'

defineOptions({ name: 'MckButtonGroup' })

const props = withDefaults(defineProps<ButtonGroupProps>(), {
  orientation: 'horizontal',
  size: undefined,
  attached: true,
  block: false,
  ariaLabel: '按钮组',
})

const kit = useUiKit()
const resolvedSize = computed(() => props.size ?? kit.value.size)
</script>

<template>
  <div
    class="mck-button-group"
    :class="[
      'is-' + orientation,
      'is-size-' + resolvedSize,
      { 'is-attached': attached, 'is-block': block },
    ]"
    role="group"
    :aria-label="ariaLabel"
  >
    <slot />
  </div>
</template>
