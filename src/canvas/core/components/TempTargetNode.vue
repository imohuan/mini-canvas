<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import type { NodeProps } from '@vue-flow/core'

defineProps<NodeProps>()
</script>

<template>
  <div class="temp-target-node">
    <Handle id="target" type="target" :position="Position.Left" class="temp-target-handle" />
  </div>
</template>

<style scoped>
.temp-target-node {
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.temp-target-handle {
  width: 1px;
  height: 1px;
  border: 0;
  background: transparent;
  opacity: 0;
}
</style>