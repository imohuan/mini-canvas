<script setup lang="ts">
/**
 * VideoFrameOverlay —— video 节点 overlay 段的组件：编辑态下把裁剪浮层画在**卡片外面**。
 *
 * 为什么单独一段（而不是塞进 VideoContent）：
 * VideoContent 渲染在 .v2-content-clip 里（overflow:hidden），浮层挂那儿会被卡片边界裁掉 ——
 * 用户实测报的「裁剪区域被节点切掉」就是这个原因。overlay 段由 BaseNode 画在卡片**外面**
 * （与上/下控制栏同级、且 overflow 可见），于是框能贴到卡片边缘。
 *
 * 本组件只管画框：确认/取消按钮在上下控制栏（用户要求），所以这里不出现任何按钮。
 */
import { computed } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import VideoCropper from './VideoCropper.vue'
import type { Rect } from './videoCrop'
import { endOverlay, isCropping, overlayDraft, setOverlayDraft } from './videoSession'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()

const { ctx } = useCanvasRender()

const videoWidth = computed(() => (typeof props.data?.videoWidth === 'number' ? props.data.videoWidth : 0))
const videoHeight = computed(() => (typeof props.data?.videoHeight === 'number' ? props.data.videoHeight : 0))
const cropping = computed(() => isCropping(props.id))

/** 数据里已有的裁剪框（二次进入裁剪时作起点） */
const savedRect = computed<Rect | undefined>(() => {
  const r = props.data?.cropRect as Rect | undefined
  return r && r.width > 0 && r.height > 0 ? r : undefined
})

/** 会话草稿（拖拽中的临时框）优先于已保存的框 */
const draftRect = computed<Rect | undefined>(() => {
  const draft = overlayDraft(props.id)._cropRect as Rect | undefined
  return draft && draft.width > 0 && draft.height > 0 ? draft : undefined
})

function onDraft(rect: Rect): void {
  setOverlayDraft(props.id, { ...overlayDraft(props.id), _cropRect: rect })
}

/** 确认：交给命令（与顶部条/快捷键同一实现），命令负责写回并退出编辑态 */
function onConfirm(rect: Rect): void {
  ctx.get<{ execute(id: string, ...payload: unknown[]): unknown }>('command').execute('video.cropConfirm', {
    nodeId: props.id,
    rect,
  })
}

function onCancel(): void {
  endOverlay(props.id)
}
</script>

<template>
  <VideoCropper
    v-if="cropping"
    mode="crop"
    :video-width="videoWidth"
    :video-height="videoHeight"
    :initial-rect="savedRect"
    :draft-rect="draftRect"
    @update:draft="onDraft"
    @confirm="onConfirm"
    @cancel="onCancel"
  />
</template>

