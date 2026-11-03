<script setup lang="ts">
/** 快捷键面板列表：分组、搜索空态、系统冲突提醒与行内重映射。 */
import RemapPanel from '../RemapPanel.vue'
import ShortcutKeys from '../ShortcutKeys.vue'
import type { DecoratedItem, V2Group } from './useShortcutHelpPanel'

defineProps<{
  groups: Array<{ group: string; items: DecoratedItem[] }>
  groupLabels: Record<string, string>
  remappingId: string | null
  shortcutIcon: (keys: string) => string
  onSelectRow: (item: DecoratedItem) => void
  onOpenRemap: (item: DecoratedItem) => void
  onCloseRemap: () => void
}>()
</script>

<template>
  <div class="shortcut-help-list">
    <div v-if="groups.length === 0" class="no-results">无匹配结果</div>

    <template v-for="(group, gIdx) in groups" :key="group.group">
      <div v-if="gIdx > 0" class="canvas-menu-divider" />
      <div class="shortcut-group">
        <h3 class="group-title">{{ groupLabels[group.group as V2Group] || group.group }}</h3>
        <template v-for="(item, iIdx) in group.items" :key="item.id">
          <div
            class="canvas-menu-item shortcut-row"
            :class="{ hasDescription: item.description, 'is-remapping-open': remappingId === item.id }"
            role="button"
            tabindex="0"
            :style="{ '--item-index': iIdx }"
            @click="onSelectRow(item)"
          >
            <div class="remap-head">
              <span class="canvas-menu-icon" v-html="shortcutIcon(item.keys)" />
              <span class="canvas-menu-copy">
                <span class="canvas-menu-label">{{ item.command }}</span>
                <span v-if="item.description" class="canvas-menu-description">{{ item.description }}</span>
              </span>
              <ShortcutKeys :keys="item.keys" :id-prefix="`row-${item.id}`" />
              <span
                v-if="item.systemReserved"
                class="canvas-menu-badge sys-reserved-badge"
                title="该键位与系统/浏览器快捷键冲突（如 ctrl+f 会同时触发浏览器查找），按此键可能无效或触发原生行为"
              >⚠ 系统冲突</span>
              <button
                class="canvas-menu-badge remap-badge"
                :class="{ 'is-open': remappingId === item.id }"
                @click.stop="onOpenRemap(item)"
                type="button"
              >
                {{ remappingId === item.id ? '收起' : '重映射' }}
              </button>
            </div>

            <div v-if="remappingId === item.id" class="remap-slot" @click.stop>
              <RemapPanel :item="item" @close="onCloseRemap" />
            </div>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.shortcut-help-list {
  flex: 1;
  min-height: 0;
  padding: 0 4px 4px;
  overflow-y: auto;
  scrollbar-width: thin;
}

.shortcut-group {
  margin-top: 4px;
}

.group-title {
  margin: 4px 6px 4px;
  color: var(--ui-ink-mute, #9ca3af);
  font-size: 12px;
  font-weight: 700;
}

.canvas-menu-divider {
  height: 1px;
  margin: 6px 4px;
  background: var(--ui-line, rgba(0, 0, 0, 0.06));
}

.canvas-menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 44px;
  padding: 6px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.18s cubic-bezier(0.34, 1.56, 0.64, 1), height 0.24s ease;
  animation: menu-item-in 0.2s ease both;
  animation-delay: calc(var(--item-index, 0) * 18ms);
}

.canvas-menu-item.is-remapping-open {
  flex-direction: column;
  align-items: stretch;
  height: auto;
  gap: 0;
  padding: 6px;
  background: var(--ui-accent-soft, rgba(8, 145, 178, 0.1));
  overflow: hidden;
  border-radius: 12px;
}

.remap-head {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 32px;
}

.remap-head {
  outline: none;
}
.remap-head:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-accent, #0891b2) 60%, transparent);
  outline-offset: -1px;
  border-radius: 8px;
}

.is-remapping-open .remap-head {
  cursor: pointer;
}

.is-remapping-open .remap-head .canvas-menu-description {
  display: none;
}
.is-remapping-open .remap-head .canvas-menu-label {
  top: 50%;
  transform: translateY(-50%);
  transition: none;
}

.canvas-menu-item:hover:not(.is-disabled) {
  background: var(--ui-hover, rgba(0, 0, 0, 0.05));
}

.canvas-menu-item.is-remapping-open:hover {
  background: var(--ui-accent-soft, rgba(8, 145, 178, 0.1));
}

.canvas-menu-item.is-disabled {
  cursor: not-allowed;
  opacity: 0.38;
}

.canvas-menu-item.is-danger {
  color: var(--ui-danger, #ef4444);
}

.canvas-menu-item.is-danger:hover:not(.is-disabled) {
  background: var(--ui-danger-soft, rgba(239, 68, 68, 0.1));
}

.canvas-menu-icon {
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: var(--ui-ink-dim, #6b7280);
  background: var(--ui-veil, rgba(0, 0, 0, 0.04));
}
.canvas-menu-icon :deep(svg) {
  width: 16px;
  height: 16px;
}

.canvas-menu-copy {
  min-width: 0;
  flex: 1;
  align-self: stretch;
  position: relative;
  overflow: hidden;
  min-height: 34px;
}

.canvas-menu-label {
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  display: block;
  position: absolute;
  top: 50%;
  left: 0;
  color: var(--ui-ink, #111827);
  transform: translateY(-50%);
}

.hasDescription .canvas-menu-label {
  transition: top 0.3s ease-out, transform 0.3s ease-out;
}
.hasDescription:hover .canvas-menu-label,
.hasDescription:focus-within .canvas-menu-label {
  top: 3px;
  transform: translateY(0);
}

.canvas-menu-description {
  color: var(--ui-ink-mute, #9ca3af);
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  position: absolute;
  bottom: 3px;
  left: 0;
  opacity: 0;
  transform: translateY(6px);
  transition: opacity 0.3s ease-out, transform 0.3s ease-out;
}
.hasDescription:hover .canvas-menu-description,
.hasDescription:focus-within .canvas-menu-description {
  opacity: 1;
  transform: translateY(0);
}

:deep(.shortcut-keys) {
  margin-right: 4px;
}

.canvas-menu-badge {
  padding: 2px 6px;
  border: 0;
  border-radius: 6px;
  color: var(--ui-accent, #0891b2);
  background: var(--ui-accent-soft, rgba(8, 145, 178, 0.12));
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease;
}
.canvas-menu-badge:hover {
  background: color-mix(in srgb, var(--ui-accent, #0891b2) 20%, transparent);
  color: var(--ui-accent-hover, #0e7490);
}

.remap-badge {
  font-family: inherit;
}

.remap-badge.is-open {
  background: color-mix(in srgb, var(--ui-accent, #0891b2) 22%, transparent);
  color: var(--ui-accent-hover, #0e7490);
}

.sys-reserved-badge {
  flex: 0 0 auto;
  white-space: nowrap;
  background: color-mix(in srgb, var(--ui-warn, #b45309) 16%, transparent);
  color: var(--ui-warn, #b45309);
  cursor: default;
}
.sys-reserved-badge:hover {
  background: color-mix(in srgb, var(--ui-warn, #b45309) 16%, transparent);
  color: var(--ui-warn, #b45309);
}

.remap-slot {
  margin: 6px 0 0;
}

.no-results {
  text-align: center;
  color: var(--ui-ink-mute, #9ca3af);
  padding: 24px 0;
  font-size: 13px;
}

@keyframes menu-item-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .canvas-menu-item,
  .canvas-menu-label,
  .canvas-menu-description,
  .remap-slot,
  .remap-expand-enter-active,
  .remap-expand-leave-active {
    animation: none !important;
    transition: none !important;
  }
  .hasDescription:hover .canvas-menu-label,
  .hasDescription:focus-within .canvas-menu-label {
    top: 3px;
    transform: translateY(0);
  }
  .hasDescription:hover .canvas-menu-description,
  .hasDescription:focus-within .canvas-menu-description {
    opacity: 1;
    transform: translateY(0);
  }
}

.shortcut-help-list::-webkit-scrollbar {
  width: 8px;
}
.shortcut-help-list::-webkit-scrollbar-thumb {
  border-radius: 4px;
  background: var(--ui-scroll-thumb, rgba(0, 0, 0, 0.12));
}
.shortcut-help-list::-webkit-scrollbar-thumb:hover {
  background: var(--ui-scroll-thumb-hover, rgba(0, 0, 0, 0.2));
}
</style>
