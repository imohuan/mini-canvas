<script setup lang="ts">
// ImageContent —— 最简 image 节点 content 组件（随 plugin-node-image 插件包发布，经 BaseNode 壳 content 段渲染）
// 只显示 data.imageUrl 对应的图（URL / dataURL / objectURL）；连接点 Handle 由 BaseNode 统一提供。
// 【红线】不带 M6 复杂件：裁剪/蒙版/扩展/backend 生成模型/ImageBottomToolbar 全不做。
import { ref } from 'vue'
defineProps<{ data: { imageUrl?: string } }>()
// P1-14 表现层降级：objectURL/dataURL 刷新后可能失效（img 加载失败）→ 显示占位而非破图
const loadFailed = ref(false)
function onImgError(): void { loadFailed.value = true }
function onImgLoad(): void { loadFailed.value = false }</script>

<template>
  <div class="image-node">
    <div class="frame">
      <img v-if="data.imageUrl && !loadFailed" :src="data.imageUrl" alt="image" class="img" @error="onImgError" @load="onImgLoad" />
      <div v-else-if="loadFailed" class="empty is-broken">图片已失效（会话级 URL 刷新后不可恢复）</div>
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
.empty.is-broken {
  color: #b45309;
  font-size: 12px;
  padding: 8px;
  text-align: center;
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




