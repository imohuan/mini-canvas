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
import { useCanvasRender, fitEditingNodeIntoView } from '@mini-canvas/canvas-render'
import VideoCropper from './VideoCropper.vue'
import type { Rect } from './videoCrop'
import { endOverlay, isCropping, overlayDraft, setOverlayDraft } from './videoSession'
import { DEFAULT_CROP_RATIO_VALUE } from '@mini-canvas/canvas-render'

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

/** 当前比例（控制栏的下拉写进会话；浮层据此调整框） */
const ratioValue = computed(() => (overlayDraft(props.id)._ratioValue as string) ?? DEFAULT_CROP_RATIO_VALUE)

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

/**
 * 进入编辑态时把本节点拉进视野（用户实测报的"控制点错位/拖不动"）。
 *
 * 实测根因：节点停在画布靠下的位置，扩展框往四周长大之后卡片底部跑到视口之外
 * （卡片底 899px、视口只有 720px），此时下侧三个控制点在做命中测试时返回 null —— 根本点不到。
 * 解法与 v1 一致：进编辑态先把该节点（连同外扩余量）摆进视野。
 *
 * 坐标一律走内核服务：nodeLayout 给 flow 绝对矩形、viewport 给当前缩放与可视区，
 * 不自己反推屏幕↔画布换算。
 */
function fitIntoView(): void {
  fitEditingNodeIntoView(ctx, props.id)
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
    :ratio-value="ratioValue"
    :fit-into-view="fitIntoView"
    @update:draft="onDraft"
    @confirm="onConfirm"
    @cancel="onCancel"
  />
</template>
