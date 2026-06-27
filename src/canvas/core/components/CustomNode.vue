<script setup lang="ts">
import type { NodeProps } from '@vue-flow/core'
import { computed, type Component } from 'vue'
import { Position } from '@vue-flow/core'
import BaseNode from './Decoration/BaseNode.vue'
import NodeToolbar from './Decoration/NodeToolbar.vue'
import BaseToolbar from './Toolbar/BaseToolbar.vue'
import { useCanvasRuntime } from '../runtime/useCanvasRuntime'
import { useCanvasStore } from '../composables/useCanvasStore'

const props = defineProps<NodeProps>()
const runtime = useCanvasRuntime()
const canvas = useCanvasStore()

const nodeDef = computed(() => {
  const nodeType = props.data?.nodeType as string | undefined
  if (!nodeType) return null
  return runtime.nodeRegistry.get(nodeType)
})

const ContentComponent = computed<Component | null>(() => nodeDef.value?.node ?? null)
const TopToolbarComponent = computed<Component | null>(() => nodeDef.value?.topToolbar ?? null)
const BottomToolbarComponent = computed<Component | null>(() => nodeDef.value?.bottomToolbar ?? null)
const selfRender = computed(() => nodeDef.value?.selfRender === true)

const topOffset = computed(() => canvas.state.core.topToolbarOffset)
const bottomOffset = computed(() => canvas.state.core.bottomToolbarOffset)
</script>

<template>
  <!-- 自渲染节点：完全自定义，不做 BaseNode 组装 -->
  <component v-if="selfRender && ContentComponent" :is="ContentComponent" v-bind="$props" />
  <BaseNode v-else v-bind="$props">
    <template #top-toolbar>
      <slot name="top-toolbar">
        <NodeToolbar v-if="TopToolbarComponent" :node-id="id" :position="Position.Top" :offset="topOffset">
          <component :is="TopToolbarComponent" v-bind="$props" />
        </NodeToolbar>
        <BaseToolbar v-else v-bind="$props" toolbar-position="top" />
      </slot>
    </template>
    <template #content>
      <component v-if="ContentComponent" :is="ContentComponent" v-bind="$props" />
    </template>
    <template #bottom-toolbar>
      <slot name="bottom-toolbar">
        <NodeToolbar v-if="BottomToolbarComponent" :node-id="id" :position="Position.Bottom" :offset="bottomOffset">
          <component :is="BottomToolbarComponent" v-bind="$props" />
        </NodeToolbar>
        <BaseToolbar v-else v-bind="$props" toolbar-position="bottom" />
      </slot>
    </template>
  </BaseNode>
</template>