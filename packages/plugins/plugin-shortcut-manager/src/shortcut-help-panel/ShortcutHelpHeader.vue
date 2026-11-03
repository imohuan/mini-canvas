<script setup lang="ts">
/** 快捷键面板顶部：标题、导出/导入/恢复默认/关闭。内联 SVG 与文案原样保留。 */
defineProps<{
  onExport: () => void
  onImport: () => void
  onReset: () => void
  onClose: () => void
}>()
</script>

<template>
  <div class="shortcut-help-header">
    <div class="shortcut-help-title-block">
      <span class="shortcut-help-eyebrow">键盘</span>
      <h2 class="shortcut-help-title">快捷键参考</h2>
    </div>
    <div class="shortcut-help-header-actions">
      <button class="shortcut-help-icon-btn" title="导出配置" @click="onExport">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/>
        </svg>
      </button>
      <button class="shortcut-help-icon-btn" title="导入配置" @click="onImport">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 21V9"/><path d="M7 14l5-5 5 5"/><path d="M5 3h14"/>
        </svg>
      </button>
      <button class="shortcut-help-icon-btn" title="恢复默认" @click="onReset">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>
        </svg>
      </button>
      <button class="shortcut-help-icon-btn close-btn" title="关闭" @click="onClose">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 6l12 12"/><path d="M18 6L6 18"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.shortcut-help-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 6px 10px;
}

.shortcut-help-title-block {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 4px;
}

.shortcut-help-eyebrow {
  color: var(--ui-ink-mute, #9ca3af);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.shortcut-help-title {
  margin: 0;
  color: var(--ui-ink, #111827);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.2;
}

.shortcut-help-header-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.shortcut-help-icon-btn {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: var(--ui-veil, rgba(0, 0, 0, 0.04));
  color: var(--ui-ink-dim, #6b7280);
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease;
}
.shortcut-help-icon-btn :deep(svg) {
  width: 16px;
  height: 16px;
}
.shortcut-help-icon-btn:hover {
  background: var(--ui-hover, rgba(0, 0, 0, 0.08));
  color: var(--ui-ink, #111827);
}
.shortcut-help-icon-btn.close-btn:hover {
  color: var(--ui-danger, #ef4444);
}
</style>
