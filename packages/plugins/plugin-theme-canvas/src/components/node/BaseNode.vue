<script setup lang="ts">
// BaseNode —— 节点壳入口（对外契约：NodeProps + inheritAttrs:false，渲染由 NodeCardShell 实现）。
// 纯拆分：组件名、props、对外行为不变；模板/样式/初始化顺序全部保留在 NodeCardShell.vue。
import type { NodeProps } from '@plume-canvas/canvas-render'
import NodeCardShell from './base-node/NodeCardShell.vue'

defineProps<NodeProps>()
defineOptions({ inheritAttrs: false })
</script>

<template>
  <NodeCardShell v-bind="$props" />
</template>
