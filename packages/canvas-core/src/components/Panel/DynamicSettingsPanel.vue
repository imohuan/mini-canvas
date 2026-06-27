<script setup lang="ts">
import { ref, type Ref } from "vue"
import { AxButton } from "../Ui"
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
  <div class="ax-panel" :class="{ collapsed }">
    <div class="ax-panel-hd">
      <AxButton
        variant="ghost"
        size="icon"
        :icon="collapsed ? 'tune' : 'close'"
        @click="collapsed = !collapsed"
      />
    </div>

    <Transition name="panel-expand">
      <div v-if="!collapsed" class="ax-panel-bd">
        <template v-for="group in groupedSettings" :key="group.name">
          <div class="ax-panel-group">
            <div class="ax-panel-group-title">{{ group.name }}</div>
            <DynamicSettingField
              v-for="setting in group.items"
              :key="setting.id"
              :setting="setting"
              v-model="getValue(setting.id).value"
            />
          </div>
        </template>
        <div v-if="settings.length === 0" class="ax-panel-empty">暂无可配置项</div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.ax-panel {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 1000;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-radius: 16px;
  width: 280px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: "Geist", "Microsoft YaHei", sans-serif;
  transition: width 0.25s ease;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid var(--color-outline-variant);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.08);
}
.ax-panel.collapsed {
  width: 44px;
  border-radius: 50%;
}

.ax-panel-hd {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 6px 8px;
  border-bottom: 1px solid var(--color-outline-variant);
  background: transparent;
  flex-shrink: 0;
  transition: padding 0.2s ease, border-color 0.2s ease;
}
.ax-panel.collapsed .ax-panel-hd {
  justify-content: center;
  padding: 6px;
  border-bottom-color: transparent;
}

.ax-panel-bd {
  flex: 1;
  overflow-y: auto;
  padding: 10px 12px;
  scrollbar-width: thin;
  scrollbar-color: var(--color-outline-variant) transparent;
}

.ax-panel-group {
  margin-bottom: 14px;
}
.ax-panel-group:last-child {
  margin-bottom: 0;
}
.ax-panel-group-title {
  font-family: "JetBrains Mono", "Microsoft YaHei", monospace;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--color-on-surface-variant);
  text-transform: uppercase;
  padding: 2px 0;
  margin-bottom: 4px;
}

.ax-panel-empty {
  text-align: center;
  color: var(--color-on-surface-variant);
  font-size: 13px;
  padding: 24px 0;
}

/* 展开/折叠动画 */
.panel-expand-enter-active,
.panel-expand-leave-active {
  transition: opacity 0.2s ease, max-height 0.25s ease;
  overflow: hidden;
}
.panel-expand-enter-from,
.panel-expand-leave-to {
  opacity: 0;
  max-height: 0;
}
</style>
