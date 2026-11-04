<script setup lang="ts">
/**
 * SettingsShortcutPanel —— 设置页里的快捷键配置面板。
 *
 * 复用帮助浮层同一套数据与管理器：分组列表、当前键位、行内 RemapPanel、
 * 冲突预检、重置、导入导出都在这里；不另写一套重映射引擎。
 * 容器由设置正文负责滚动（两套设置皮共用），本组件只画内容。
 */
import { computed, onMounted, ref } from 'vue'
import RemapPanel from './RemapPanel.vue'
import ShortcutKeys from './ShortcutKeys.vue'
import { getShortcutManager } from './shortcutState'
import { buildSettingsShortcutGroups, filterSettingsShortcutGroups, SETTINGS_SHORTCUT_GROUP_LABELS } from './settingsPanelData'
import { useShortcutHelpPanel } from './shortcut-help-panel/useShortcutHelpPanel'

const manager = getShortcutManager()
const tick = ref(0)
const searchQuery = ref('')
const remappingId = ref<string | null>(null)
const { exportKeymap, importKeymap, resetDefaults } = useShortcutHelpPanel()

const groups = computed(() => {
  void tick.value
  return buildSettingsShortcutGroups(manager)
})
const filtered = computed(() => filterSettingsShortcutGroups(groups.value, searchQuery.value))
const total = computed(() => groups.value.reduce((n, g) => n + g.items.length, 0))
const conflicts = computed(() => {
  void tick.value
  return manager?.getConflicts() ?? []
})

function refresh(): void {
  tick.value += 1
}

function openRemap(id: string): void {
  remappingId.value = remappingId.value === id ? null : id
}

function closeRemap(): void {
  remappingId.value = null
  refresh()
}

function doExport(): void {
  exportKeymap()
  refresh()
}

function doImport(): void {
  // 文件选择与 FileReader 都是异步的：等 hook 真正导入完成再刷新列表
  importKeymap(refresh)
}

function doReset(): void {
  resetDefaults()
  refresh()
}

onMounted(refresh)
</script>

<template>
  <div class="settings-shortcuts">
    <div class="settings-shortcuts__toolbar">
      <label class="settings-shortcuts__search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
        </svg>
        <input v-model="searchQuery" type="search" placeholder="搜索命令、键位或 ID…" aria-label="搜索快捷键" />
      </label>
      <span v-if="conflicts.length" class="settings-shortcuts__conflict">⚠ {{ conflicts.length }} 个冲突</span>
      <div class="settings-shortcuts__actions">
        <button type="button" class="ss-btn" @click="doExport">导出</button>
        <button type="button" class="ss-btn" @click="doImport">导入</button>
        <button type="button" class="ss-btn" @click="doReset">恢复默认</button>
      </div>
    </div>

    <p v-if="!total" class="settings-shortcuts__empty">还没有可配置的快捷键。</p>
    <p v-else-if="!filtered.length" class="settings-shortcuts__empty">没有匹配的快捷键。</p>

    <section v-for="group in filtered" :key="group.group" class="settings-shortcuts__group">
      <h4 class="settings-shortcuts__title">{{ SETTINGS_SHORTCUT_GROUP_LABELS[group.group] || group.group }}</h4>
      <div class="settings-shortcuts__rows">
        <div
          v-for="item in group.items"
          :key="item.id"
          class="settings-shortcuts__row"
          :class="{ 'is-open': remappingId === item.id }"
        >
          <div class="settings-shortcuts__line">
            <div class="settings-shortcuts__copy">
              <span class="settings-shortcuts__name">{{ item.command }}</span>
              <span v-if="item.description" class="settings-shortcuts__desc">{{ item.description }}</span>
            </div>
            <span v-if="item.systemReserved" class="settings-shortcuts__reserved" title="系统/浏览器可能优先响应这个键">系统冲突</span>
            <ShortcutKeys :keys="item.keys" :id-prefix="'settings-' + item.id" size="sm" />
            <button type="button" class="ss-btn" @click="openRemap(item.id)">
              {{ remappingId === item.id ? '收起' : '重映射' }}
            </button>
          </div>
          <RemapPanel
            v-if="remappingId === item.id"
            :item="item"
            class="settings-shortcuts__remap"
            @close="closeRemap"
          />
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.settings-shortcuts {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 4px 0 8px;
}

.settings-shortcuts__toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.settings-shortcuts__search {
  display: inline-flex;
  flex: 1 1 220px;
  align-items: center;
  gap: 6px;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: var(--radius-control, 8px);
  background: var(--ui-panel, #fff);
  color: var(--ui-ink-mute, #9ca3af);
}

.settings-shortcuts__search svg {
  width: 14px;
  height: 14px;
  flex: none;
}

.settings-shortcuts__search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--ui-ink, #18202b);
  font: inherit;
  font-size: 12px;
}

.settings-shortcuts__conflict {
  padding: 2px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-warn, #b45309) 14%, transparent);
  color: var(--ui-warn, #b45309);
  font-size: 11px;
  font-weight: 700;
}

.settings-shortcuts__actions {
  display: inline-flex;
  gap: 4px;
}

.ss-btn {
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: var(--radius-control, 8px);
  background: transparent;
  color: var(--ui-ink-dim, #6b7280);
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.ss-btn:hover {
  background: var(--ui-hover, rgba(0, 0, 0, 0.05));
  color: var(--ui-ink, #18202b);
}

.settings-shortcuts__group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.settings-shortcuts__title {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  color: var(--ui-ink, #18202b);
}

.settings-shortcuts__rows {
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: var(--radius-panel, 16px);
  background: var(--ui-panel, #fff);
  overflow: hidden;
}

.settings-shortcuts__row {
  padding: 4px 12px;
}

.settings-shortcuts__row + .settings-shortcuts__row {
  border-top: 1px solid var(--ui-line-faint, var(--ui-line-soft, #eef0f4));
}

.settings-shortcuts__row.is-open {
  background: color-mix(in srgb, var(--ui-accent, #0891b2) 5%, transparent);
}

.settings-shortcuts__line {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
}

.settings-shortcuts__copy {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.settings-shortcuts__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
  color: var(--ui-ink, #18202b);
}

.settings-shortcuts__desc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--ui-ink-dim, #6b7280);
}

.settings-shortcuts__reserved {
  flex: none;
  padding: 2px 6px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--ui-warn, #b45309) 14%, transparent);
  color: var(--ui-warn, #b45309);
  font-size: 10px;
  font-weight: 700;
}

.settings-shortcuts__remap {
  margin: 0 0 8px;
}

.settings-shortcuts__empty {
  margin: 0;
  padding: 18px 0;
  text-align: center;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 12px;
}

@media (max-width: 560px) {
  .settings-shortcuts__line {
    flex-wrap: wrap;
    padding: 6px 0;
  }

  .settings-shortcuts__copy {
    flex-basis: 100%;
  }
}
</style>
