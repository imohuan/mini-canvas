<script setup lang="ts">
import type { NodeProps } from '@vue-flow/core'

defineOptions({ inheritAttrs: false })
const props = defineProps<NodeProps>()
</script>

<template>
  <div class="w-full h-full p-4 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl">
    <svg class="w-12 h-12 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
    <span class="text-indigo-600 text-sm font-medium">{{ props.data?.label || '导演台' }}</span>
  </div>
</template>
