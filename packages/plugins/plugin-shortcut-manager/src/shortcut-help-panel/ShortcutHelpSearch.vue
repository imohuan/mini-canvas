<script setup lang="ts">
/** 快捷键面板搜索条：查询词与冲突计数。 */
const searchQuery = defineModel<string>({ required: true })

defineProps<{ conflictsCount: number }>()
</script>

<template>
  <div class="shortcut-help-search">
    <span class="search-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>
      </svg>
    </span>
    <input
      v-model="searchQuery"
      placeholder="搜索命令、键位或 ID..."
      class="search-input"
      autofocus
    />
    <span v-if="conflictsCount > 0" class="conflict-warning">
      ⚠ {{ conflictsCount }} 个冲突
    </span>
  </div>
</template>

<style scoped>
.shortcut-help-search {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px 6px 12px;
  margin: 4px 4px 8px;
  border-radius: 10px;
  background: var(--ui-veil, rgba(0, 0, 0, 0.04));
  transition: background 0.18s ease;
}
.shortcut-help-search:focus-within {
  background: var(--ui-hover, rgba(0, 0, 0, 0.06));
}
.search-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ui-ink-mute, #9ca3af);
}
.search-icon :deep(svg) {
  width: 14px;
  height: 14px;
}
.search-input {
  flex: 1;
  min-width: 0;
  padding: 6px 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--ui-ink, #111827);
  font-size: 13px;
  font-weight: 500;
}
.search-input::placeholder {
  color: var(--ui-ink-mute, #9ca3af);
}
.conflict-warning {
  flex: 0 0 auto;
  white-space: nowrap;
  padding: 2px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-warn, #b45309) 14%, transparent);
  color: var(--ui-warn, #b45309);
  font-size: 11px;
  font-weight: 700;
}
</style>
