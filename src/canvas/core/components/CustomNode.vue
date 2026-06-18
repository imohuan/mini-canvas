<script setup lang="ts">
import type { NodeProps } from '@vue-flow/core'
import { computed, type Component } from 'vue'
import BaseNode from './Decoration/BaseNode.vue'
import { TextNode, TextTopToolbar, TextBottomToolbar } from './nodes/text/index'
import { ImageNode, ImageTopToolbar, ImageBottomToolbar } from './nodes/image/index'
import { VideoNode, VideoTopToolbar, VideoBottomToolbar } from './nodes/video/index'
import { StageNode, StageTopToolbar, StageBottomToolbar } from './nodes/stage/index'

const props = defineProps<NodeProps>()

interface NodeTypeBundle {
  node?: Component
  topToolbar?: Component
  bottomToolbar?: Component
}

/** nodeType → 节点组件映射 */
const nodeTypeMap: Record<string, NodeTypeBundle> = {
  text: {
    node: TextNode,
    topToolbar: TextTopToolbar,
    bottomToolbar: TextBottomToolbar,
  },
  image: {
    node: ImageNode,
    topToolbar: ImageTopToolbar,
    bottomToolbar: ImageBottomToolbar,
  },
  video: {
    node: VideoNode,
    topToolbar: VideoTopToolbar,
    bottomToolbar: VideoBottomToolbar,
  },
  stage: {
    node: StageNode,
    topToolbar: StageTopToolbar,
    bottomToolbar: StageBottomToolbar,
  },
}

/** 根据 data.nodeType 获取对应的组件包，不存在则回退到默认 */
const bundle = computed<NodeTypeBundle>(() => {
  const nt = props.data?.nodeType as string | undefined
  if (nt && nodeTypeMap[nt]) {
    return nodeTypeMap[nt]
  }
  return {} // 回退到默认 slot 内容
})

/** 内容组件 */
const ContentComponent = computed(() => bundle.value.node || null)

/** 顶部工具栏组件（有自定义就用，没有就不显示） */
const TopToolbarComponent = computed(() => bundle.value.topToolbar || null)

/** 底部工具栏组件（有自定义就用，没有就不显示） */
const BottomToolbarComponent = computed(() => bundle.value.bottomToolbar || null)
</script>

<template>
  <BaseNode v-bind="$props">
    <template #top-toolbar>
      <component :is="TopToolbarComponent" v-bind="$props" />
    </template>
    <template #content>
      <component v-if="ContentComponent" :is="ContentComponent" v-bind="$props" />
    </template>
    <template #bottom-toolbar>
      <component :is="BottomToolbarComponent" v-bind="$props" />
    </template>
  </BaseNode>
</template>
