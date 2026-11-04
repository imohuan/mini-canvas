<script setup lang="ts">
import type { RadioGroupItemProps } from 'reka-ui'

import type { HTMLAttributes } from 'vue'
import { CircleIcon } from '@lucide/vue'
import { reactiveOmit } from '@vueuse/core'
import { cn } from 'cn'
import {
  RadioGroupIndicator,
  RadioGroupItem,
  useForwardProps,
} from 'reka-ui'

const props = withDefaults(
  defineProps<
    RadioGroupItemProps & {
      class?: HTMLAttributes['class']
      /**
       * 圆点大小档位。声明它，全局「控件尺寸」才能通过注册薄层注入进来；
       * 没有这一档时，圆点永远写死 16px，用户改尺寸只有旁边的文字变、圆点不变。
       */
      size?: 'sm' | 'default' | 'lg'
    }
  >(),
  { size: 'default' },
)

const delegatedProps = reactiveOmit(props, 'class', 'size')

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <RadioGroupItem
    data-slot="radio-group-item"
    :data-size="props.size"
    v-bind="forwardedProps"
    :class="
      cn(
        'bg-input/90 data-checked:bg-primary data-checked:text-primary-foreground dark:data-checked:bg-primary border-transparent aria-invalid:border-destructive focus-visible:border-ring focus-visible:ring-ring/30 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 dark:aria-invalid:border-destructive/50 flex rounded-full focus-visible:ring-3 aria-invalid:ring-3 group/radio-group-item peer relative aspect-square shrink-0 border outline-none after:absolute after:-inset-x-3 after:-inset-y-2 disabled:cursor-not-allowed disabled:opacity-50 data-[size=sm]:size-3.5 data-[size=default]:size-4 data-[size=lg]:size-5',
        props.class,
      )
    "
  >
    <RadioGroupIndicator
      data-slot="radio-group-indicator"
      class="flex size-4 items-center justify-center"
    >
      <slot>
        <CircleIcon class="bg-primary-foreground absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full dark:size-2.5" />
      </slot>
    </RadioGroupIndicator>
  </RadioGroupItem>
</template>
