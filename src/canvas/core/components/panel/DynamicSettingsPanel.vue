<script setup lang="ts">
import { computed } from 'vue'
import { useCanvasRuntime } from '../../runtime/useCanvasRuntime'
import { useCanvasStore } from '../../composables/useCanvasStore'
import DynamicSettingField from './DynamicSettingField.vue'
import type { PanelSettingDefinition } from '../../registry/types'

const runtime = useCanvasRuntime()
const canvas = useCanvasStore()


const settings = computed<PanelSettingDefinition[]>(() => runtime.panelRegistry.getAll())

const groupedSettings = computed(() => {
  const groups = new Map<string, PanelSettingDefinition[]>()
  for (const s of settings.value) {
    const g = s.group || 'default'
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(s)
  }
  return [...groups.entries()].map(([name, items]) => ({ name, items }))
})
</script>

<template>
  <div class="dynamic-settings-panel">
    <div v-for="group in groupedSettings" :key="group.name" class="settings-group">
      <div class="settings-group-title">{{ group.name }}</div>
      <DynamicSettingField
        v-for="setting in group.items"
        :key="setting.id"
        :setting="setting"
        :model-value="runtime.panelRegistry.useValue(setting.id, canvas.state as any, setting.defaultValue)"
      />
    </div>
    <div v-if="settings.length === 0" class="settings-empty">暂无可配置项</div>
  </div>
</template>

<style scoped>
.dynamic-settings-panel { padding: 8px; }
.settings-group { margin-bottom: 12px; }
.settings-group-title { font-size: 11px; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.05em; padding: 4px 0; margin-bottom: 4px; }
.settings-empty { text-align: center; color: #9ca3af; font-size: 13px; padding: 24px; }
</style>


