<script setup lang="ts">
defineOptions({ inheritAttrs: false })

import ToolbarButton from '../../components/Decoration/ToolbarButton.vue'

</script>

<template>
  <div class="node-toolbar-inline">
    <div class="flex items-center gap-0.5 bg-white border border-gray-200 rounded-lg p-1 shadow-sm">
      <ToolbarButton>
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6z" />
          <path d="M6 12h9a4 4 0 014 4 4 4 0 01-4 4H6z" />
        </svg>
        <span>加粗</span>
      </ToolbarButton>
      <ToolbarButton>
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="4 7 4 4 20 4 20 7" />
          <line x1="9" y1="20" x2="15" y2="20" />
          <line x1="12" y1="4" x2="12" y2="20" />
        </svg>
        <span>字号</span>
      </ToolbarButton>
      <ToolbarButton>
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2a10 10 0 100 20 10 10 0 000-20z" />
          <path d="M12 2a10 10 0 010 20" />
        </svg>
        <span>颜色</span>
      </ToolbarButton>
      <ToolbarButton>
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="21" y1="6" x2="3" y2="6" />
          <line x1="17" y1="12" x2="7" y2="12" />
          <line x1="19" y1="18" x2="5" y2="18" />
        </svg>
        <span>对齐</span>
      </ToolbarButton>
    </div>
  </div>
</template>
