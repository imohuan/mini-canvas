<script setup lang="ts">
/**
 * VideoFullscreenOverlay —— 视频节点全屏预览浮层（注册在 overlay 槽，Teleport 到 body）。
 *
 * 用户口径（2026-10-17）：双击视频节点进全屏，**不要自己实现预览组件** ——
 * 生成历史 / 底栏素材卡用的是主题注册的 MediaViewer（useUiComponent("mediaViewer")），
 * 本浮层只做一件事：把 mediaPreviewBus 的会话状态翻译成 item prop 交给它。
 */
import { computed } from 'vue'
import { useUiComponent } from '@mini-canvas/canvas-render'
import { closePreview, previewItem, setPreviewIndex } from './mediaPreviewBus'

const MediaViewer = useUiComponent('mediaViewer')

/** 与 MediaViewer 的 item 契约对齐（视频分支读 item.url） */
const viewerItem = computed(() => {
  const cur = previewItem()
  if (!cur) return null
  return { name: cur.name, kind: cur.kind, url: cur.url ?? '' }
})
</script>

<template>
  <Teleport to="body">
    <MediaViewer :item="viewerItem" @close="closePreview()" />
  </Teleport>
</template>
