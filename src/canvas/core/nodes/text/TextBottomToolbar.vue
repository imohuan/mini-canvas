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
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
        </svg>
        <span>复制</span>
      </ToolbarButton>
      <ToolbarButton>
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
        </svg>
        <span>删除</span>
      </ToolbarButton>
    </div>
  </NodeToolbar>
</template>
