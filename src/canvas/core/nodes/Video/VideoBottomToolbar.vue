<script setup lang="ts">
defineOptions({ inheritAttrs: false })

import { Position } from '@vue-flow/core'
import { useCanvasStore } from '../../useCanvasStore'
import NodeToolbar from '../../components/Decoration/NodeToolbar.vue'
import ToolbarButton from '../../components/Decoration/ToolbarButton.vue'

const canvas = useCanvasStore()
</script>

<template>
  <NodeToolbar :position="Position.Bottom" :offset="canvas.state.bottomToolbarOffset">
    <div class="flex items-center gap-0.5 bg-white border border-gray-200 rounded-lg p-1 shadow-sm">
      <ToolbarButton>
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" />
        </svg>
        <span>导出帧</span>
      </ToolbarButton>
      <ToolbarButton>
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <span>替换</span>
      </ToolbarButton>
    </div>
  </NodeToolbar>
</template>
