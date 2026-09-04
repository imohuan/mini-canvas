<script setup lang="ts">
// ImageContent —— 最简 image 节点内容组件（demo 视觉层，M1 红线内）
// 只显示 data.imageUrl 对应的图（URL / dataURL / objectURL）。
// 【禁止】带进 M6 复杂件：裁剪/蒙版/扩展/backend 生成模型/ImageBottomToolbar 全不做。
import { Handle, Position } from '@vue-flow/core'

defineProps<{ data: { imageUrl?: string } }>()
// VueFlow 会透传一堆内部 props 给节点组件；不落到根元素避免脏属性
defineOptions({ inheritAttrs: false })
const pos = Position
</script>

<template>
  <div class="image-node">
    <Handle :type="'target'" :position="pos.Left" />
    <div class="frame">
      <img v-if="data.imageUrl" :src="data.imageUrl" alt="image" class="img" />
      <div v-else class="empty">（无图片）</div>
    </div>
    <Handle :type="'source'" :position="pos.Right" />
  </div>
</template>

<style scoped>
.image-node {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.frame {
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #9ca3af;
  font-size: 13px;
}
</style>
