<script setup lang="ts">
/**
 * ImageToolbarShell —— 图片节点顶栏的通用外壳（用户口径 2026-10-30）。
 *
 * 所有图片功能模式（默认 / 绘制 / 未来的蒙版编辑等）都用这同一个壳：
 * 排一行的胶囊容器（ntp-root 同款样式）+ SlotComposer 可排序插槽。
 * 这样各模式的面板只管「放哪些按钮」，不再各写一份布局样式 ——
 * 之前 ImagePaintPanel 没写布局，按钮按浏览器默认流排成了三行（用户截图报的问题）。
 */
import { SlotComposer } from '@mini-canvas/canvas-render'

const props = defineProps<{
  /** 槽名（image.topToolbar / image.paintToolbar …） */
  slotName: string
  /** 传给每个条目的共享 props */
  nodeId: string
  data: Record<string, unknown>
}>()
</script>

<template>
  <div class="ntp-root its-root nodrag nopan">
    <SlotComposer
      :slot="props.slotName"
      class="its-slot"
      :shared-props="{ nodeId: props.nodeId, data: props.data }"
    >
      <slot />
    </SlotComposer>
  </div>
</template>

<style scoped>
/* SlotComposer 根容器：普通流式 div，与按钮同一横排，不另画面板 */
.its-slot {
  display: flex;
  align-items: center;
  gap: 4px;
}
</style>
