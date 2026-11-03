<script setup lang="ts">
import { RegionEntryHost } from '@mini-canvas/canvas-render'
import type { CapabilityCache } from '@mini-canvas/canvas-render'
import type { NodeSegmentEntry } from '@mini-canvas/canvas-data'

defineProps<{
  toolbarAnchorStyle: Record<string, string> | null
  topRegions: NodeSegmentEntry[]
  bottomRegions: NodeSegmentEntry[]
  topRegionsStyle: Record<string, string>
  bottomRegionsStyle: Record<string, string>
  topClampStyle: Record<string, string | undefined>
  bottomClampStyle: Record<string, string | undefined>
  selectionCapabilityCache: CapabilityCache
  isDev: boolean
}>()
</script>

<template>
  <div class="selection-frame-toolbar-anchor" :style="toolbarAnchorStyle">
    <div
      v-if="topRegions.length > 0"
      class="selection-frame-slot selection-frame-slot--top nodrag nopan"
      :style="{ ...topRegionsStyle, ...topClampStyle }"
    >
      <RegionEntryHost
        v-for="seg in topRegions"
        :key="'sel-top-' + seg.id"
        :entry="seg"
        :cache="selectionCapabilityCache"
        :is-dev="isDev"
      />
    </div>
    <div
      v-if="bottomRegions.length > 0"
      class="selection-frame-slot selection-frame-slot--bottom nodrag nopan"
      :style="{ ...bottomRegionsStyle, ...bottomClampStyle }"
    >
      <RegionEntryHost
        v-for="seg in bottomRegions"
        :key="'sel-bottom-' + seg.id"
        :entry="seg"
        :cache="selectionCapabilityCache"
        :is-dev="isDev"
      />
    </div>
  </div>
</template>

<style scoped>
.selection-frame-toolbar-anchor {
  position: absolute;
  pointer-events: none;
}

.selection-frame-slot {
  position: absolute;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  pointer-events: auto;
}
</style>
