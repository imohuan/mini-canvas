<script setup lang="ts">
/**
 * ImageOverlays —— image 节点 over:inset 段的统一入口。
 *
 * 段是每区域一个组件（Partial Record），不能挂两个 —— 所以这里做一层薄分发：
 * 裁剪/扩展浮层与绘制浮层都从这里渲染，各自按会话状态显隐，互不干扰。
 *
 * 绘制浮层必须**在这里**门控（v-if isPainting），不能只靠浮层内部的 v-if：
 * 浮层 setup 里读会话/挂监听，常驻挂载会让每个 image 节点都拖着一套死代码。
 */
import { computed } from 'vue'
import ImageFrameOverlay from './ImageFrameOverlay.vue'
import ImagePaintOverlay from './ImagePaintOverlay.vue'
import { isPainting } from './paintSession'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()

const paintActive = computed(() => isPainting(props.id))
</script>

<template>
  <div class="io-root">
    <ImageFrameOverlay :id="props.id" :data="props.data" />
    <ImagePaintOverlay v-if="paintActive" :id="props.id" :data="props.data" />
  </div>
</template>

<style scoped>
/* 分发容器不占布局、不挡事件：浮层们自己 absolute 铺满 */
.io-root {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.io-root > * {
  pointer-events: auto;
}
</style>
