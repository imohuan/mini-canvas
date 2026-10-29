<script setup lang="ts">
/**
 * ImagePaintEntry —— 图片顶栏里的「绘制」入口按钮。
 *
 * 只做一件事：点下去进入绘制模式（beginPaint + nodeToolbar.enter）。
 * 顶栏整排换成 ImagePaintPanel（绘制模式的 topBar）。
 */
import { computed } from 'vue'
import { useCanvasRender, useSoleNodeSelected, useUiComponent } from '@mini-canvas/canvas-render'
import { readImageSourceFields } from './imageRefs'
import { beginPaint, isPainting } from './paintSession'

const props = defineProps<{ nodeId?: string; data?: Record<string, unknown> }>()

const { ctx } = useCanvasRender()
const Button = useUiComponent("toolbarButton")
const selected = useSoleNodeSelected(props.nodeId ?? "")

const ICON_PAINT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>'

/** 有图才有绘制入口（与裁剪/扩展同一门槛） */
const hasImage = computed(() => {
  const { resourceId, legacyUrl } = readImageSourceFields(props.data)
  return resourceId !== "" || legacyUrl !== ""
})

/** 绘制中入口隐藏（避免重复进入） */
const painting = computed(() => isPainting(props.nodeId ?? ""))

function enter(): void {
  if (!props.nodeId || !hasImage.value) return
  beginPaint(props.nodeId)
  ctx.tryGet<{ enter?(id: string, modeId: string): void } | undefined>("nodeToolbar")?.enter?.(props.nodeId, "image/paint")
}
</script>

<template>
  <Button v-if="selected && hasImage && !painting" title="绘制" :icon="ICON_PAINT" @click="enter" />
</template>
