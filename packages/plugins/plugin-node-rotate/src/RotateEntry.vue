<script setup lang="ts">
/**
 * RotateEntry —— 插进图片默认顶栏按钮组的一条（node-toolbar.md 方式 A）。
 *
 * 平时显示「旋转与镜像」入口；点击后**复制本节点**、连一条线，
 * 再让副本进入功能模式（方式 C：顶栏整格换成 RotatePanel）。
 * 显隐自己判断（恰好选中本节点），有图才出现。
 */
import { computed, ref } from 'vue'
import { useCanvasRender, useSoleNodeSelected, useUiComponent } from '@mini-canvas/canvas-render'
import { readImageSourceFields } from './imageRefs'
import { duplicateImageForRotate } from './rotateCopy'

const props = defineProps<{ nodeId?: string; data?: Record<string, unknown> }>()

const { ctx } = useCanvasRender()
const Button = useUiComponent('toolbarButton')

/** 复制请求进行中：挡住连点，避免一次点击复制出两份 */
const busy = ref(false)

const selected = useSoleNodeSelected(props.nodeId ?? '')
const hasImage = computed(() => {
  const { resourceId, legacyUrl } = readImageSourceFields(props.data)
  return resourceId !== '' || legacyUrl !== ''
})

const ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/></svg>'

function enter(): void {
  if (!props.nodeId || busy.value) return
  busy.value = true
  const copyId = duplicateImageForRotate(ctx, props.nodeId)
  if (!copyId) {
    busy.value = false
    ctx.tryGet<{ notify(m: string, o?: object): unknown }>('canvas')?.notify('旋转与镜像：请先选中一张图片', { followPointer: true, durationMs: 0 })
    return
  }
  // 模式在 300ms 后进入；留一点余量再放开按钮
  window.setTimeout(() => {
    busy.value = false
  }, 400)
}
</script>

<template>
  <Button v-if="selected && hasImage" title="旋转与镜像（复制并编辑副本）" :icon="ICON" :disabled="busy" @click="enter" />
</template>
