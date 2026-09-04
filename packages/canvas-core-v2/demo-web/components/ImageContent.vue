<script setup lang="ts">
// ImageContent —— 最简 image 节点 content 组件（经 BaseNode 壳的 content 段渲染，M1/M2 红线内）
// 只显示 data.imageUrl 对应的图（URL / dataURL / objectURL）；连接点 Handle 由 BaseNode 统一提供。
// 【禁止】带进 M6 复杂件：裁剪/蒙版/扩展/backend 生成模型/ImageBottomToolbar 全不做。
defineProps<{ data: { imageUrl?: string } }>()
</script>

<template>
  <div class="image-node">
    <div class="frame">
      <img v-if="data.imageUrl" :src="data.imageUrl" alt="image" class="img" />
      <div v-else class="empty">（无图片）</div>
    </div>
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
