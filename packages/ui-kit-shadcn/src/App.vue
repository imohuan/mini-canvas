<script setup lang="ts">
/**
 * ui-kit-shadcn 预览页 —— 一面卡片墙。
 *
 * 结构（用户口径 2026-11-04）：
 *  1. 顶部一条吸顶的配置栏，改哪一项立刻作用到下面的所有卡片；
 *  2. 下面是一条瀑布式卡片墙，每张卡片只讲一类组件，高度随内容自由错落，
 *     没有一张卡片横跨整行、也没有「卡片里再套一堆小卡片」的盒子套盒子。
 *
 * 正文在 theme/ComponentShowcase.vue。
 */
import ComponentShowcase from './theme/ComponentShowcase.vue'
</script>

<template>
  <!-- 暗色变量挂在 <html> 上（见脚本），根节点不需要再加 .dark -->
  <div class="min-h-dvh bg-background text-foreground">
    <ComponentShowcase />
  </div>
</template>
