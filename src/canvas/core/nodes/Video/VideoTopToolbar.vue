<script setup lang="ts">
defineOptions({ inheritAttrs: false })

import { Position } from '@vue-flow/core'
import { useCanvasStore } from '../../composables/useCanvasStore'
import NodeToolbar from '../../components/Decoration/NodeToolbar.vue'
import ToolbarButton from '../../components/Decoration/ToolbarButton.vue'

const canvas = useCanvasStore()
</script>

<template>
  <NodeToolbar :position="Position.Top" :offset="canvas.state.core.topToolbarOffset">
    <div class="flex items-center gap-0.5 bg-white border border-gray-200 rounded-lg p-1 shadow-sm">
      <ToolbarButton>
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="5,3 19,12 5,21" />
        </svg>
        <span>播放</span>
      </ToolbarButton>
      <ToolbarButton>
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5" />
          <polyline points="16 3 21 3 21 8" /><line x1="21" y1="3" x2="11" y2="13" />
        </svg>
        <span>裁剪</span>
      </ToolbarButton>
    </div>
  </NodeToolbar>
</template>
