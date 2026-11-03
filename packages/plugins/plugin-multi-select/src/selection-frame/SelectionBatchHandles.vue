<script setup lang="ts">
import { Position, useCanvasRender, useUiComponent } from '@mini-canvas/canvas-render'
import type { BatchSide } from '../batchConnect'

const props = defineProps<{
  outer: { x: number; y: number; w: number; h: number } | null
  handleParams: ReturnType<typeof useCanvasRender>['handleParams']
  portZoneWidth: number
  portZoneHeight: number
  portZoneOffset: number
  portZoneShape: 'rect' | 'arc'
  portZoneArcRatio: number
  onStart: (event: MouseEvent, side: BatchSide) => void
  show: boolean
}>()

const MovingHandle = useUiComponent('movingHandle')

function batchStyle(_side: 'left' | 'right'): Record<string, string> {
  const g = props.outer
  if (!g) return {}
  return {
    top: `${g.y + g.h / 2 - props.portZoneHeight / 2}px`,
    height: `${props.portZoneHeight}px`,
    left: _side === 'left' ? `${g.x}px` : `${g.x + g.w}px`,
  }
}
</script>

<template>
  <div
    v-if="show"
    class="selection-frame-batch-slot is-left"
    :style="batchStyle('left')"
    @mousedown="onStart($event, 'target')"
  >
    <MovingHandle
      v-if="show"
      id="multi-select-batch-left"
      type="target"
      :position="Position.Left"
      preview
      :selected="true"
      :visible="true"
      :disabled="false"
      :rest-offset="handleParams.handleRestOffset"
      :cursor-gap="handleParams.handleCursorGap"
      :button-size="handleParams.handleButtonSize"
      :zone-width="portZoneWidth"
      :zone-height="portZoneHeight"
      :zone-offset="portZoneOffset"
      :zone-shape="portZoneShape"
      :zone-arc-ratio="portZoneArcRatio"
      class="selection-frame-batch-handle"
      @connect-start="onStart($event.event, 'target')"
    />
  </div>
  <div
    v-if="show"
    class="selection-frame-batch-slot is-right"
    :style="batchStyle('right')"
    @mousedown="onStart($event, 'source')"
  >
    <MovingHandle
      v-if="show"
      id="multi-select-batch-right"
      type="source"
      :position="Position.Right"
      preview
      :selected="true"
      :visible="true"
      :disabled="false"
      :rest-offset="handleParams.handleRestOffset"
      :cursor-gap="handleParams.handleCursorGap"
      :button-size="handleParams.handleButtonSize"
      :zone-width="portZoneWidth"
      :zone-height="portZoneHeight"
      :zone-offset="portZoneOffset"
      :zone-shape="portZoneShape"
      :zone-arc-ratio="portZoneArcRatio"
      class="selection-frame-batch-handle"
      @connect-start="onStart($event.event, 'source')"
    />
  </div>
</template>

<style scoped>
.selection-frame-batch-slot {
  position: absolute;
  width: 0;
  pointer-events: none;
  z-index: 2;
  overflow: visible;
}
</style>
