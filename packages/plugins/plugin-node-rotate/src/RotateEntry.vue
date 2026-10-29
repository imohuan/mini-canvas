<script setup lang="ts">
/**
 * RotateEntry —— 插进图片默认顶栏按钮组的一条（node-toolbar.md 方式 A）。
 *
 * 平时显示「旋转与镜像」入口；点击后进入功能模式（方式 C：顶栏整格换成 RotatePanel）。
 * 显隐自己判断（恰好选中本节点），有图才出现。
 */
import { computed } from 'vue'
import { useCanvasRender, useSoleNodeSelected, useUiComponent } from '@mini-canvas/canvas-render'
import { readImageSourceFields } from './imageRefs'
import { openRotateMode } from './rotateSession'

const props = defineProps<{ nodeId?: string; data?: Record<string, unknown> }>()

const { ctx } = useCanvasRender()
const Button = useUiComponent('toolbarButton')

const selected = useSoleNodeSelected(props.nodeId ?? '')
const hasImage = computed(() => {
  const { resourceId, legacyUrl } = readImageSourceFields(props.data)
  return resourceId !== '' || legacyUrl !== ''
})

const ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/></svg>'

function enter(): void {
  if (!props.nodeId) return
  openRotateMode(props.nodeId)
  ctx.tryGet<{ enter?(nodeId: string, modeId: string): void }>('nodeToolbar')
    ?.enter?.(props.nodeId, 'node-rotate/mode')
}
</script>

<template>
  <Button v-if="selected && hasImage" title="旋转与镜像" :icon="ICON" @click="enter" />
</template>
