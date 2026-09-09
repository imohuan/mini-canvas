<script setup lang="ts">
// ConnectionLine - thin shell for the drag-time temporary connection line.
// Rendering is FULLY delegated to CustomEdge (same component used by existing edges), so the
// temp line shares the exact same visual: rail / light blocks / arrow / config / animation.
// This shell only adapts canvas-render props (source/target endpoints) into CustomEdge props
// with temporary=true semantics.
//
// IMPORTANT: sourcePosition / targetPosition must come from vue-flow (fromHandle.position /
// toPosition), NOT be hardcoded to Right/Left. When dragging from a Left port, hardcoding
// Right here would flip the bezier control points inward and the curve would bend the wrong
// way. The same applies to Top/Bottom ports (hardcoding Right would crush the curve vertically).
defineProps<{
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition?: string
  targetPosition?: string
  /** hasSnap kept for prop compatibility with the canvas-render host; CustomEdge temporary highlight already covers it */
  hasSnap?: boolean
}>()
</script>

<template>
  <!-- All rendering is delegated to CustomEdge so the temp line is identical to a normal edge.
       Pass through the real sourcePosition/targetPosition from vue-flow so the curve bends
       OUT of the source port and INTO the mouse (mirroring what a real edge would do). -->
  <g class="conn-line-shell">
    <CustomEdge
      id="__connection_line__"
      temporary
      :source-position="sourcePosition"
      :target-position="targetPosition"
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