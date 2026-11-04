<script setup lang="ts">
import type { NumberFieldIncrementProps } from 'reka-ui'

import type { HTMLAttributes } from 'vue'
import { PlusIcon } from '@lucide/vue'
import { reactiveOmit } from '@vueuse/core'
import { cn } from 'cn'
import { NumberFieldIncrement, useForwardProps } from 'reka-ui'
import { numberFieldStepVariants } from '.'

/** 与 Button 同一套：自己声明 size，薄层会注入全局档位。 */
const props = withDefaults(
  defineProps<
    NumberFieldIncrementProps & {
      class?: HTMLAttributes['class']
      size?: 'sm' | 'default' | 'lg'
    }
  >(),
  { size: 'default' },
)

const delegatedProps = reactiveOmit(props, 'class', 'size')
const forwarded = useForwardProps(delegatedProps)
</script>

<template>
  <NumberFieldIncrement
    data-slot="increment"
    v-bind="forwarded"
    :class="cn(
      'absolute top-1/2 -translate-y-1/2 right-0 disabled:cursor-not-allowed disabled:opacity-20',
      numberFieldStepVariants({ size: props.size }),
      props.class,
    )"
  >
    <slot>
      <PlusIcon class="h-4 w-4" />
    </slot>
  </NumberFieldIncrement>
</template>
