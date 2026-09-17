<script setup lang="ts">
/**
 * ImageFrameOverlay —— image 节点 overlay 段的组件：编辑态下把浮层画在**卡片外面**。
 *
 * 为什么单独一段（而不是塞进 ImageContent）：
 * ImageContent 渲染在 .v2-content-clip 里（overflow:hidden），浮层挂那儿会被卡片边界裁掉 ——
 * 用户实测报的「裁剪区域被节点切掉」就是这个原因。overlay 段由 BaseNode 画在卡片**外面**
 * （与上/下控制栏同级、overflow 可见），于是框能贴到卡片边缘；**扩展框还必须能画到卡片之外**
 * （往外扩的部分本来就在原图外面），这一条只有浮层在卡片外才做得到。
 *
 * 本组件只管画框：确认/取消按钮在上下控制栏（用户要求），所以这里不出现任何按钮。
 */
import { computed } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import type { Rect } from '@mini-canvas/canvas-render'
import { MediaFrameOverlay } from '@mini-canvas/canvas-render'
import { editDraft, endEdit, isCropping, isExpanding, setEditDraft } from './cropSession'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()

const { ctx } = useCanvasRender()

const imageWidth = computed(() => (typeof props.data?.imageWidth === 'number' ? props.data.imageWidth : 0))
const imageHeight = computed(() => (typeof props.data?.imageHeight === 'number' ? props.data.imageHeight : 0))
const cropping = computed(() => isCropping(props.id))
const expanding = computed(() => isExpanding(props.id))
const active = computed(() => cropping.value || expanding.value)
const mode = computed<'crop' | 'expand'>(() => (expanding.value ? 'expand' : 'crop'))

/** 数据里已有的框（二次进入时作起点）：裁剪看 cropRect，扩展从"整幅画面"起（没有已存框） */
const savedRect = computed<Rect | undefined>(() => {
  if (!cropping.value) return undefined
  const r = props.data?.cropRect as Rect | undefined
  return r && r.width > 0 && r.height > 0 ? r : undefined
})

/** 会话草稿（拖拽中的临时框）优先于已保存的框 */
const draftRect = computed<Rect | undefined>(() => {
  const key = expanding.value ? '_expandRect' : '_cropRect'
  const draft = editDraft(props.id)[key] as Rect | undefined
  return draft && draft.width > 0 && draft.height > 0 ? draft : undefined
})

function onDraft(rect: Rect): void {
  const key = expanding.value ? '_expandRect' : '_cropRect'
  setEditDraft(props.id, { ...editDraft(props.id), [key]: rect })
}

/** 确认：交给命令（与顶部条/快捷键同一实现），命令负责写回并退出编辑态 */
function onConfirm(rect: Rect): void {
  const command = ctx.get<{ execute(id: string, ...payload: unknown[]): unknown }>('command')
  command.execute(expanding.value ? 'image.expandConfirm' : 'image.cropConfirm', { nodeId: props.id, rect })
}

function onCancel(): void {
  endEdit(props.id)
}
</script>

<template>
  <MediaFrameOverlay
    v-if="active"
    :mode="mode"
    :media-width="imageWidth"
    :media-height="imageHeight"
    :initial-rect="savedRect"
    :draft-rect="draftRect"
    @update:draft="onDraft"
    @confirm="onConfirm"
    @cancel="onCancel"
  />
</template>

