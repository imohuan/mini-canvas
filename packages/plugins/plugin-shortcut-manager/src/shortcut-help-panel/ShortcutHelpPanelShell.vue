<script setup lang="ts">
/** 快捷键面板的完整内容；入口只负责 Teleport、可见性和 Esc 监听。 */
import ShortcutHelpHeader from './ShortcutHelpHeader.vue'
import ShortcutHelpSearch from './ShortcutHelpSearch.vue'
import ShortcutHelpList from './ShortcutHelpList.vue'
import type { DecoratedItem } from './useShortcutHelpPanel'

defineProps<{
  conflictsCount: number
  groups: Array<{ group: string; items: DecoratedItem[] }>
  groupLabels: Record<string, string>
  remappingId: string | null
  shortcutIcon: (keys: string) => string
  onSelectRow: (item: DecoratedItem) => void
  onOpenRemap: (item: DecoratedItem) => void
  onCloseRemap: () => void
  onExport: () => void
  onImport: () => void
  onReset: () => void
  onClose: () => void
}>()

const searchQuery = defineModel<string>({ required: true })
</script>

<template>
  <div class="shortcut-help-panel" @pointerdown.stop>
    <ShortcutHelpHeader
      :on-export="onExport"
      :on-import="onImport"
      :on-reset="onReset"
      :on-close="onClose"
    />

    <ShortcutHelpSearch v-model="searchQuery" :conflicts-count="conflictsCount" />

    <ShortcutHelpList
      :groups="groups"
      :group-labels="groupLabels"
      :remapping-id="remappingId"
      :shortcut-icon="shortcutIcon"
      :on-select-row="onSelectRow"
      :on-open-remap="onOpenRemap"
      :on-close-remap="onCloseRemap"
    />
  </div>
</template>

<style scoped>
/* 配色全部走通用 UI token（--ui-*，由 <html class="dark"> 切换；值见 canvas-render 的
   styles/ui-theme.css）—— 原先写死浅色值，暗色主题下面板会变成"白底黑字"贴块。
   兜底值保留改造前的浅色值：脱离主题表单独渲染（单测/别的宿主）行为不变。 */
.shortcut-help-panel {
  position: relative;
  width: min(640px, 100%);
  max-height: min(80vh, 720px);
  display: flex;
  flex-direction: column;
  padding: 12px;
  border: 1px solid var(--ui-line, rgba(0, 0, 0, 0.08));
  border-radius: 16px;
  background: var(--ui-glass, rgba(255, 255, 255, 1));
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  box-shadow: var(--ui-shadow-md, 0 20px 40px rgba(0, 0, 0, 0.08));
  color: var(--ui-ink, #374151);
  animation: menu-pop-in 0.24s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes menu-pop-in {
  from {
    opacity: 0;
    transform: scale(0.94) translateY(-4px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .shortcut-help-panel {
    animation: none !important;
    transition: none !important;
  }
}
</style>
