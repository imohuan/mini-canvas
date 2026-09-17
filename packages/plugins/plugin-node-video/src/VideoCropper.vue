<script setup lang="ts">
/**
 * VideoCropper —— 视频编辑浮层（**薄封装**）。
 *
 * 框的几何、遮罩、方形控制点、拖拽会话、量测全部来自渲染层的通用件
 * @mini-canvas/canvas-render 的 MediaFrameOverlay —— 图片节点用的是同一个组件，
 * 用户明确要求「这完全可以做成一个通用组件」。
 *
 * 本文件只剩三件事：
 * 1. 把视频语汇（videoWidth/videoHeight）翻译成通用件的入参（mediaWidth/mediaHeight）；
 * 2. 把草稿/确认/取消向上冒泡。
 *
 * 只用 crop 模式：扩展（往外扩画布）对视频没有意义 —— 那需要重新编码整段视频，
 * 而本项目刻意不做浏览器端转码。通用件支持 expand 是给**图片**节点用的。
 *
 * 为什么不在这里放「确认/取消」按钮：用户要求「确认按钮应该放在上下控制栏」——
 * 编辑态下操作栏换成确认/取消，浮层只负责画框。这样按钮位置在所有编辑场景里一致，
 * 也不会被视频画面（通常是暗的）淹没。
 */
import { MediaFrameOverlay } from '@mini-canvas/canvas-render'
import type { Rect } from './videoCrop'

const props = defineProps<{
  /** 视频像素尺寸（0 = 元数据还没读出来，通用件会按容器兜底） */
  videoWidth: number
  videoHeight: number
  /** 数据里已有的框（二次进入时作起点） */
  initialRect?: Rect
  /** 会话草稿（拖拽中的临时框，优先于 initialRect） */
  draftRect?: Rect
  /** 当前比例键（来自控制栏的下拉；浮层据此把框调成对应比例） */
  ratioValue?: string
}>()

const emit = defineEmits<{
  (e: 'update:draft', rect: Rect): void
  (e: 'confirm', rect: Rect): void
  (e: 'cancel'): void
}>()
</script>

<template>
  <MediaFrameOverlay
    mode="crop"
    :media-width="props.videoWidth"
    :media-height="props.videoHeight"
    :initial-rect="props.initialRect"
    :draft-rect="props.draftRect"
    :ratio-value="props.ratioValue"
    @update:draft="emit('update:draft', $event)"
    @confirm="emit('confirm', $event)"
    @cancel="emit('cancel')"
  />
</template>
