<script setup lang="ts">
import type { NodeProps } from '@vue-flow/core'
import { computed, type Component } from 'vue'
import BaseNode from './Decoration/BaseNode.vue'
import { useCanvasRuntime } from '../runtime/useCanvasRuntime'

const props = defineProps<NodeProps>()
const runtime = useCanvasRuntime()

interface NodeTypeBundle {
  node?: Component
  topToolbar?: Component
  bottomToolbar?: Component
}

const bundle = computed<NodeTypeBundle>(() => {
  const nodeType = props.data?.nodeType as string | undefined
  if (!nodeType) return {}
  const definition = runtime.nodeRegistry.get(nodeType)
  if (!definition) return {}
  return {
    node: definition.node,
    topToolbar: definition.topToolbar,
    bottomToolbar: definition.bottomToolbar,
  }
})

const ContentComponent = computed(() => bundle.value.node || null)
const TopToolbarComponent = computed(() => bundle.value.topToolbar || null)
const BottomToolbarComponent = computed(() => bundle.value.bottomToolbar || null)
</script>

<template>
  <BaseNode v-bind="$props">
    <template #top-toolbar>
      <component v-if="TopToolbarComponent" :is="TopToolbarComponent" v-bind="$props" />
    </template>
    <template #content>
      <component v-if="ContentComponent" :is="ContentComponent" v-bind="$props" />
    </template>
    <template #bottom-toolbar>
      <component v-if="BottomToolbarComponent" :is="BottomToolbarComponent" v-bind="$props" />
    </template>
  </BaseNode>
</template>