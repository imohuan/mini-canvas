<script setup lang="ts">
/**
 * 底栏末尾演示按钮：点击动作由 props 传入。
 *
 * index.ts 在 apply(ctx) 里把“执行 shell:open-drawer 命令”收成 onOpen 回调再传进来；
 * 本组件不读 window、不 import @mini-canvas/ui。
 */
defineProps<{ onOpen?: () => void }>()
</script>

<template>
  <button class="ss-demo-btn" type="button" data-testid="ssd-dock-end" @click="onOpen?.()">
    插槽按钮
  </button>
</template>

<style scoped>
.ss-demo-btn {
  height: 32px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid var(--ui-line, rgba(0 0 0 / 0.12));
  background: var(--ui-panel, #fff);
  color: var(--ui-ink, #18202b);
  font: 600 13px system-ui, 'Microsoft YaHei', sans-serif;
  cursor: pointer;
}
.ss-demo-btn:hover { background: var(--ui-hover, rgba(0 0 0 / 0.05)); }
</style>
