<script setup lang="ts">
import { provide } from 'vue'
import type { CanvasRuntime } from './CanvasRuntime'
import { CanvasRuntimeKey } from './CanvasRuntimeKey'

const props = defineProps<{ runtime: CanvasRuntime }>()
provide(CanvasRuntimeKey, props.runtime)
</script>

<template>
  <slot />
</template>