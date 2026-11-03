<script setup lang="ts">
import { useUiComponent } from '@mini-canvas/canvas-render'
import type { BatchGuideLine, BatchSide } from '../batchConnect'

defineProps<{
  guideLines: BatchGuideLine[]
  batchSide: BatchSide | null
}>()

const ConnectionLine = useUiComponent('connectionLine')
</script>

<template>
  <svg v-if="guideLines.length > 0" class="selection-frame-batch-guide" aria-hidden="true">
    <g
      v-for="(line, i) in guideLines"
      :key="line.nodeId + '-' + i"
      class="selection-frame-batch-guide-line"
      :class="{ 'is-rejected': line.willConnect === false }"
    >
      <ConnectionLine
        :source-x="Math.round(line.from.x)"
        :source-y="Math.round(line.from.y)"
        :target-x="Math.round(line.to.x)"
        :target-y="Math.round(line.to.y)"
        :source-position="line.fromPosition"
        :target-position="batchSide === 'source' ? 'left' : 'right'"
      />
    </g>
  </svg>
</template>

<style scoped>
.selection-frame-batch-guide {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
  z-index: var(--layer-gesture, 900);
  overflow: visible;
}

.selection-frame-batch-guide-line.is-rejected {
  opacity: 0.28;
  filter: grayscale(0.7);
}
</style>

