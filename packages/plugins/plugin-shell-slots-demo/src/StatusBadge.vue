<script setup lang="ts">
/**
 * 状态条末尾演示徽章：只展示 props 里的节点数。
 *
 * 节点数由 index.ts 在 apply(ctx) 里订阅 doc 后传进来；
 * 本组件不取 ctx、不读 window、不 import 画布包。
 */
defineProps<{ count: number }>()
</script>

<template>
  <span class="ss-demo-badge" data-testid="ssd-status" :title="'当前节点数：' + count">节点 {{ count }}</span>
</template>

<style scoped>
.ss-demo-badge {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 10px;
  margin: 0 4px;
  border-radius: 10px;
  background: var(--ui-accent-soft, rgba(8 145 178 / 0.12));
  color: var(--ui-accent, #0891b2);
  font: 700 12px system-ui, 'Microsoft YaHei', sans-serif;
}
</style>
