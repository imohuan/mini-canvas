/** 通用工具栏按钮组件（纯样式）。节点 Toolbar 迁移到 BaseToolbar 后，旧节点 Toolbar 中仍在使用。 */
<script setup lang="ts">
withDefaults(defineProps<{
  variant?: 'default' | 'primary'
}>(), {
  variant: 'default',
})
</script>

<template>
  <button
    class="toolbar-button"
    :class="variant === 'primary' ? 'toolbar-button--primary' : ''"
  >
    <slot />
  </button>
</template>

<style scoped>
.toolbar-button {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--canvas-node-text);
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease;
}

.toolbar-button:hover {
  background: var(--canvas-node-panel-surface-hover);
  color: var(--canvas-node-text-strong);
}

.toolbar-button--primary {
  color: var(--canvas-node-text-strong);
}

.toolbar-button--primary:hover {
  background: var(--canvas-node-panel-surface-active);
  color: var(--canvas-node-text-strong);
}
</style>
