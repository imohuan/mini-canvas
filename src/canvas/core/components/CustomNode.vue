<script setup lang="ts">
import type { NodeProps } from '@vue-flow/core'
import { computed, type Component } from 'vue'
import BaseNode from './Decoration/BaseNode.vue'
import BaseToolbar from './Toolbar/BaseToolbar.vue'
import { useCanvasRuntime } from '../runtime/useCanvasRuntime'

const props = defineProps<NodeProps>()
const runtime = useCanvasRuntime()

const ContentComponent = computed<Component | null>(() => {
  const nodeType = props.data?.nodeType as string | undefined
  if (!nodeType) return null
  return runtime.nodeRegistry.get(nodeType)?.node ?? null
})
</script>

<template>
  <BaseNode v-bind="$props">
    <template #top-toolbar>
      <slot name="top-toolbar">
        <BaseToolbar v-bind="$props" toolbar-position="top" />
      </slot>
    </template>
    <template #content>
      <component v-if="ContentComponent" :is="ContentComponent" v-bind="$props" />
    </template>
    <template #bottom-toolbar>
      <slot name="bottom-toolbar">
        <BaseToolbar v-bind="$props" toolbar-position="bottom" />
      </slot>
    </template>
  </BaseNode>
</template>