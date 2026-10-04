<script setup lang="ts">
// 左导航项（与光标特效插件的导航同构）
</script>

<template>
  <span class="showcase-nav">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
    插件展示
  </span>
</template>

<style scoped>
.showcase-nav {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
</style>
