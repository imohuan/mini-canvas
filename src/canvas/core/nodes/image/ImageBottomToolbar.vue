<script setup lang="ts">
defineOptions({ inheritAttrs: false })

import { Position } from '@vue-flow/core'
import { useCanvasStore } from '../../../useCanvasStore'
import NodeToolbar from '../../Decoration/NodeToolbar.vue'
import ToolbarButton from '../../Decoration/ToolbarButton.vue'

const canvas = useCanvasStore()
</script>

<template>
  <NodeToolbar :position="Position.Bottom" :offset="canvas.state.bottomToolbarOffset">
    <div class="flex items-center gap-0.5 bg-white border border-gray-200 rounded-lg p-1 shadow-sm">
      <ToolbarButton>
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
        </svg>
        <span>旋转</span>
      </ToolbarButton>
      <ToolbarButton>
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        <span>下载</span>
      </ToolbarButton>
    </div>
  </NodeToolbar>
</template>
