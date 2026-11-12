<script setup lang="ts">
import type { NumberFieldRootEmits, NumberFieldRootProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { cn } from 'cn'
import { NumberFieldRoot, useForwardPropsEmits } from 'reka-ui'
import type { NumberFieldSize } from '.'

const props = withDefaults(
  defineProps<
    NumberFieldRootProps & {
      class?: HTMLAttributes['class']
      /** 与全局「控件尺寸」对齐：由注册薄层注入，子件据此换算高度 */
      size?: NumberFieldSize
    }
  >(),
  { size: undefined },
)
const emits = defineEmits<NumberFieldRootEmits>()

const delegatedProps = reactiveOmit(props, 'class', 'size')
const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <NumberFieldRoot v-slot="slotProps" v-bind="forwarded" :class="cn('grid gap-1.5', props.class)">
    <slot v-bind="slotProps" />
  </NumberFieldRoot>
</template>
