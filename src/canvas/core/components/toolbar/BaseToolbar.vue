<script setup lang="ts">
import { computed } from 'vue'
import { Position } from '@vue-flow/core'
import type { NodeProps } from '@vue-flow/core'
import NodeToolbar from '../Decoration/NodeToolbar.vue'
import ToolbarButton from '../Decoration/ToolbarButton.vue'
import { useCanvasRuntime } from '../../runtime/useCanvasRuntime'
import { useCanvasStore } from '../../composables/useCanvasStore'
import type { ToolbarButtonDefinition, CommandContext } from '../../registry/types'

const props = defineProps<NodeProps & {
  toolbarPosition: 'top' | 'bottom'
}>()

const runtime = useCanvasRuntime()
const canvas = useCanvasStore()

const nodeType = computed(() => props.data?.nodeType as string | undefined)

const visibleButtons = computed<ToolbarButtonDefinition[]>(() => {
  const all = runtime.toolbarRegistry.getByPosition(props.toolbarPosition)
  return all.filter((btn) => {
    if (btn.nodeTypes && btn.nodeTypes.length > 0 && nodeType.value) {
      if (!btn.nodeTypes.includes(nodeType.value)) return false
    }
    return true
  })
})

const nodeToolbarPosition = computed(() =>
  props.toolbarPosition === 'top' ? Position.Top : Position.Bottom
)
const nodeToolbarOffset = computed(() =>
  props.toolbarPosition === 'top'
    ? canvas.state.core.topToolbarOffset
    : canvas.state.core.bottomToolbarOffset
)

function buildContext(): CommandContext {
  return {
    runtime, actions: null, selection: null, viewport: null, store: null,
    logger: console, node: props as any, nodeType: nodeType.value,
  }
}

function isDisabled(btn: ToolbarButtonDefinition): boolean {
  if (btn.disabled === undefined) return false
  if (typeof btn.disabled === 'boolean') return btn.disabled
  try { return btn.disabled(buildContext()) } catch { return true }
}

function onButtonAction(btn: ToolbarButtonDefinition) {
  if (isDisabled(btn)) return
  runtime.commandRegistry.execute(btn.commandId, buildContext())
}

function onDropdownSelect(btn: ToolbarButtonDefinition, itemId: string) {
  const item = btn.dropdown?.find(d => d.id === itemId)
  if (!item) return
  const itemDisabled = typeof item.disabled === 'function' ? item.disabled(buildContext()) : item.disabled
  if (itemDisabled) return
  if (item.commandId) {
    runtime.commandRegistry.execute(item.commandId, buildContext(), { filter: itemId })
  } else {
    runtime.commandRegistry.execute(btn.commandId, buildContext(), { filter: itemId })
  }
}
</script>

<template>
  <NodeToolbar v-if="visibleButtons.length > 0" :position="nodeToolbarPosition" :offset="nodeToolbarOffset">
    <div class="base-toolbar">
      <ToolbarButton v-for="btn in visibleButtons" :key="btn.id"
        :icon="btn.icon" :title="btn.title" :tooltip="btn.tooltip"
        :disabled="isDisabled(btn)" :dropdown="btn.dropdown" :custom-render="btn.customRender"
        @action="onButtonAction(btn)"
        @dropdown-select="(id: string) => onDropdownSelect(btn, id)" />
    </div>
  </NodeToolbar>
</template>

<style scoped>
.base-toolbar {
  display: flex; align-items: center; gap: 2px; padding: 4px;
  border: 1px solid rgba(0,0,0,0.08); border-radius: 8px;
  background: rgba(255,255,255,0.92); backdrop-filter: blur(12px);
  box-shadow: 0 4px 16px rgba(0,0,0,0.08); pointer-events: auto;
}
</style>
