<script setup lang="ts">
import type { NodeProps } from '@vue-flow/core'
import { computed, ref, onErrorCaptured, type Component } from 'vue'
import { Position } from '@vue-flow/core'
import BaseNode from './Decoration/BaseNode.vue'
import NodeToolbar from './Decoration/NodeToolbar.vue'
import BaseToolbar from './Toolbar/BaseToolbar.vue'
import { useCanvasRuntime } from '../runtime/useCanvasRuntime'
import { useCanvasStore } from '../composables/useCanvasStore'

defineOptions({ inheritAttrs: false })
defineEmits<{
  updateNodeInternals: [id: string, internal: boolean]
}>()

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

// ====== Error boundary：防止单个节点崩溃导致整个画布不可用 ======
const nodeError = ref<string | null>(null)

onErrorCaptured((err: Error, _instance, info) => {
  console.error('[CustomNode] Error in node 节点:', err, info)
  nodeError.value = err.message
  return false // 阻止传播到父组件
})

const selfRender = computed(() => nodeDef.value?.selfRender === true)

const topOffset = computed(() => canvas.state.core.topToolbarOffset)
const bottomOffset = computed(() => canvas.state.core.bottomToolbarOffset)
</script>

<template>
  <!-- 节点渲染错误回退 -->
  <div v-if="nodeError" class="custom-node custom-node--error" :style="{ width: `256px`, minHeight: `100px`, padding: `12px`, background: `#fff3f3`, border: `2px solid #e53e3e`, borderRadius: `8px`, fontSize: `13px` }">
    <div class="error-indicator" style="font-weight:600;color:#c53030;margin-bottom:4px;">⚠️ 节点渲染错误</div>
    <pre class="error-detail" style="font-size:11px;color:#718096;white-space:pre-wrap;word-break:break-all;">{{ nodeError }}</pre>
  </div>
  <template v-else>
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
</template>
