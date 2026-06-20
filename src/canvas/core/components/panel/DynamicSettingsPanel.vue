<script setup lang="ts">
import { computed, ref, type Ref } from "vue"
import DynamicSettingField from './DynamicSettingField.vue'
import type { PanelSettingDefinition } from '../../registry/types'

const props = defineProps<{
  settings: PanelSettingDefinition[]
  groupedSettings: { name: string; items: PanelSettingDefinition[] }[]
  getValue: (id: string) => Ref<unknown>
}>()

const collapsed = ref(false)
</script>

<template>
  <div class="ax-settings-panel" :class="{ collapsed }">
    <div class="ax-panel-header">
      <button
        class="ax-panel-toggle"
        :title="collapsed ? '展开设置' : '折叠设置'"
        @click="collapsed = !collapsed"
      >
        <svg v-if="collapsed" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>

    <Transition name="panel-expand">
      <div v-if="!collapsed" class="ax-panel-body">
      <div v-for="group in groupedSettings" :key="group.name" class="ax-settings-group">
        <div class="ax-group-title">{{ group.name }}</div>
        <DynamicSettingField
          v-for="setting in group.items"
          :key="setting.id"
          :setting="setting"
          v-model="getValue(setting.id).value"
        />
      </div>
      <div v-if="settings.length === 0" class="ax-settings-empty">暂无可配置项</div>
    </div>
      </Transition>
  </div>
</template>

<style scoped>
.ax-settings-panel {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 1000;
  background: #ffffff;
  border: 1px solid #c8c5ca;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04);
  width: 280px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: "Geist", "Microsoft YaHei", sans-serif;
  transition: width 0.2s ease;
}
.ax-settings-panel.collapsed {
  width: auto;
  min-width: 0;
}
.ax-panel-header {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 8px 10px;
  border-bottom: 1px solid #c8c5ca;
  background: #f3f3f4;
  flex-shrink: 0;
}
.ax-panel-toggle {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  border-radius: 8px;
  color: #5f5e61;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.ax-panel-toggle:hover {
  background: #e8e8e9;
  color: #1a1c1d;
}
.ax-panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  scrollbar-width: thin;
  scrollbar-color: #c8c5ca transparent;
}
.ax-settings-group {
  margin-bottom: 16px;
}
.ax-settings-group:last-child {
  margin-bottom: 0;
}
.ax-group-title {
  font-family: "JetBrains Mono", "Microsoft YaHei", monospace;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: #5f5e61;
  text-transform: uppercase;
  padding: 4px 0;
  margin-bottom: 4px;
}
.ax-settings-empty {
  text-align: center;
  color: #78767b;
  font-size: 13px;
  padding: 24px 0;
}

/* ===== 展开/折叠过渡 ===== */
.panel-expand-enter-active {
  transition: opacity 0.2s ease, max-height 0.25s ease;
  overflow: hidden;
}
.panel-expand-leave-active {
  transition: opacity 0.15s ease, max-height 0.2s ease;
  overflow: hidden;
}
.panel-expand-enter-from {
  opacity: 0;
  max-height: 0;
}
.panel-expand-leave-to {
  opacity: 0;
  max-height: 0;
}
</style>