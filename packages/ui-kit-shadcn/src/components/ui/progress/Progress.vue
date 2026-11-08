<script setup lang="ts">
import type { ProgressRootProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { cn } from 'cn'
import { ProgressRoot, ProgressIndicator as RekaIndicator } from 'reka-ui'

const props = withDefaults(defineProps<ProgressRootProps & { class?: HTMLAttributes['class'] }>(), {
  modelValue: 0,
})

const delegatedProps = reactiveOmit(props, 'class')

/** 百分比文字的显示值（0–100 取整） */
const shown = (): string => String(Math.round(Math.min(100, Math.max(0, Number(props.modelValue) || 0))))
</script>

<template>
  <ProgressRoot
    data-slot="progress"
    v-bind="delegatedProps"
    :class="cn('relative h-1.5 w-full overflow-hidden rounded-full bg-muted', props.class)"
  >
    <RekaIndicator
      data-slot="progress-indicator"
      class="h-full w-full flex-1 rounded-full bg-primary transition-transform duration-300"
      :style="{ transform: 'translateX(-' + (100 - Number(modelValue || 0)) + '%)' }"
    />
    <span class="sr-only">{{ shown() }}%</span>
  </ProgressRoot>
</template>
