<script setup lang="ts">
// ConnectionLine - thin shell for the drag-time temporary connection line.
// Rendering is FULLY delegated to CustomEdge (same component used by existing edges), so the
// temp line shares the exact same visual: rail / light blocks / arrow / config / animation.
// This shell only adapts canvas-render props (source/target endpoints) into CustomEdge props
// with temporary=true semantics (source handle on the right, target at the mouse on the left).
import CustomEdge from './CustomEdge.vue'
import { Position } from '@vue-flow/core'

defineProps<{
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  /** hasSnap kept for prop compatibility with the canvas-render host; CustomEdge temporary highlight already covers it */
  hasSnap?: boolean
}>()
</script>

<template>
  <!-- All rendering is delegated to CustomEdge so the temp line is identical to a normal edge -->
  <g class="conn-line-shell">
    <CustomEdge
      id="__connection_line__"
      temporary
      :source-position="Position.Right"
      :target-position="Position.Left"
      :source-x="sourceX"
      :source-y="sourceY"
      :target-x="targetX"
      :target-y="targetY"
    />
  </g>
</template>

<style scoped>
/* Temp line must not capture any canvas interaction while dragging */
.conn-line-shell {
  pointer-events: none;
}
</style>
