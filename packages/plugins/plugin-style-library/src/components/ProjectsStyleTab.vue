<script setup lang="ts">
/**
 * 项目页「风格库」整页页签。
 *
 * 用**内容本体**，不套弹窗外壳：没有遮罩、没有居中卡片、没有圆角与展开动画，
 * 直接铺满项目页主内容区。广场 / 详情 / 收藏 / 加入画布仍是画布里的同一份组件。
 */
import StyleLibraryContent from './StyleLibraryContent.vue'
</script>

<template>
  <StyleLibraryContent mode="project" />
</template>
