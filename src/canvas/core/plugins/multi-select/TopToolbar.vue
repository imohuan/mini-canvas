<script setup lang="ts">
defineOptions({ inheritAttrs: false })

import { computed } from 'vue'
import { Position } from '@vue-flow/core'
import { useCanvasStore } from '../../composables/useCanvasStore'
import NodeToolbar from '../../components/Decoration/NodeToolbar.vue'
import ToolbarButton from '../../components/Decoration/ToolbarButton.vue'

const props = withDefaults(defineProps<{
  offset?: number;
  nodeIds?: string[]
}>(), {
  offset: 0,
  nodeIds: () => [],
})

const emit = defineEmits<{
  group: []
}>()

const canvas = useCanvasStore()
const selectedCount = computed(() => props.nodeIds.length)
</script>

<template>
  <NodeToolbar :node-id="nodeIds" :position="Position.Top" :offset="canvas.state.core.topToolbarOffset + offset" :is-visible="true">
    <div class="multi-select-top-toolbar">
      <span class="multi-select-top-toolbar__count">已选 {{ selectedCount }} 个节点</span>

      <ToolbarButton variant="primary" @click.stop="emit('group')">
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="4" y="4" width="7" height="7" rx="1.5" />
          <rect x="13" y="4" width="7" height="7" rx="1.5" />
          <rect x="4" y="13" width="7" height="7" rx="1.5" />
          <rect x="13" y="13" width="7" height="7" rx="1.5" />
        </svg>
        <span>打组</span>
      </ToolbarButton>
    </div>
  </NodeToolbar>
</template>

<style scoped>
.multi-select-top-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border: 1px solid var(--canvas-node-border-subtle);
  border-radius: 8px;
  background: var(--canvas-node-panel-surface);
  box-shadow: 0 8px 22px var(--canvas-node-shadow-panel);
  pointer-events: auto;
}

.multi-select-top-toolbar__count {
  padding: 0 8px;
  border-right: 1px solid var(--canvas-node-border-subtle);
  color: var(--canvas-node-text-muted);
  font-size: 12px;
  white-space: nowrap;
}
</style>
