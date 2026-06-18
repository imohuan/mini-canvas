<script lang="ts" setup>
defineOptions({ inheritAttrs: false })

import { computed, inject } from 'vue'
import type { CSSProperties } from 'vue'
import type { GraphNode, Rect, ViewportTransform } from '@vue-flow/core'
import { NodeIdInjection, Position, getRectOfNodes, useVueFlow } from '@vue-flow/core'

type Align = 'center' | 'start' | 'end'

interface Props {
  nodeId?: string | string[]
  isVisible?: boolean
  position?: Position
  offset?: number
  align?: Align
}

const props = withDefaults(defineProps<Props>(), {
  position: Position.Top,
  offset: 10,
  align: 'center',
  isVisible: undefined,
})

const contextNodeId = inject(NodeIdInjection, null)

const { viewportRef, viewport, getSelectedNodes, findNode } = useVueFlow()

const nodes = computed(() => {
  const nodeIds = Array.isArray(props.nodeId) ? props.nodeId : [props.nodeId || contextNodeId || '']
  return nodeIds.reduce<GraphNode[]>((acc, id) => {
    const node = findNode(id)
    if (node) acc.push(node)
    return acc
  }, [] as GraphNode[])
})

const isActive = computed(() =>
  typeof props.isVisible === 'boolean'
    ? props.isVisible
    : nodes.value.length === 1 && nodes.value[0].selected && getSelectedNodes.value.length === 1,
)

const nodeRect = computed(() => getRectOfNodes(nodes.value))

const zIndex = computed(() => Math.max(...nodes.value.map((node) => (node.computedPosition.z || 1) + 1)))

const wrapperStyle = computed<CSSProperties>(() => ({
  position: 'absolute',
  transform: getTransform(nodeRect.value, viewport.value, props.position, props.offset, props.align),
  zIndex: zIndex.value,
}))

function getTransform(nodeRect: Rect, transform: ViewportTransform, position: Position, offset: number, align: Align): string {
  let alignmentOffset = 0.5
  if (align === 'start') alignmentOffset = 0
  else if (align === 'end') alignmentOffset = 1

  const zoomedOffset = offset * transform.zoom

  let pos = [
    (nodeRect.x + nodeRect.width * alignmentOffset) * transform.zoom + transform.x,
    nodeRect.y * transform.zoom + transform.y - zoomedOffset,
  ]
  let shift = [-100 * alignmentOffset, -100]

  switch (position) {
    case Position.Top:
      break
    case Position.Right:
      pos = [
        (nodeRect.x + nodeRect.width) * transform.zoom + transform.x + zoomedOffset,
        (nodeRect.y + nodeRect.height * alignmentOffset) * transform.zoom + transform.y,
      ]
      shift = [0, -100 * alignmentOffset]
      break
    case Position.Bottom:
      pos = [
        (nodeRect.x + nodeRect.width * alignmentOffset) * transform.zoom + transform.x,
        (nodeRect.y + nodeRect.height) * transform.zoom + transform.y + zoomedOffset,
      ]
      shift = [-100 * alignmentOffset, 0]
      break
    case Position.Left:
      pos = [
        nodeRect.x * transform.zoom + transform.x - zoomedOffset,
        (nodeRect.y + nodeRect.height * alignmentOffset) * transform.zoom + transform.y,
      ]
      shift = [-100, -100 * alignmentOffset]
      break
  }

  return `translate(${pos[0]}px, ${pos[1]}px) translate(${shift[0]}%, ${shift[1]}%)`
}
</script>

<template>
  <Teleport :to="viewportRef" :disabled="!viewportRef">
    <div v-if="isActive && nodes.length" :style="wrapperStyle" class="vf-node-toolbar select-none">
      <slot />
    </div>
  </Teleport>
</template>
