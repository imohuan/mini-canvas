<script setup lang="ts">
/** 插件页顶部：中转地址、刷新、全部安装、计数。登录不在这里（归 cloud-client）。 */
import { Download, RefreshCw } from 'lucide-vue-next'
import { useUiComponent } from '@plume-canvas/canvas-render'
import type { PluginManagerService } from '../../../pluginManagerService'

defineProps<{
  s: PluginManagerService['state']
  service: PluginManagerService
  urlDraft: string
  installedCount: number
}>()

const emit = defineEmits<{
  'update:urlDraft': [value: string]
  refresh: []
}>()

const Button = useUiComponent('Button')
const Input = useUiComponent('Input')
</script>

<template>
  <div class="pmp-toolbar">
    <label class="pmp-field pmp-url">
      <span class="pmp-label">中转后台地址</span>
      <Input
        :model-value="urlDraft"
        class="pmp-input"
        type="text"
        spellcheck="false"
        aria-label="中转后台地址"
        placeholder="留空 = 同源 /plugin-catalog.json"
        @update:model-value="emit('update:urlDraft', $event)"
        @keydown.enter.prevent="emit('refresh')"
      />
    </label>
    <div class="pmp-toolbar-actions">
      <Button variant="outline" size="sm" type="button" :disabled="s.loading" @click="emit('refresh')">
        <RefreshCw :size="14" :class="{ spin: s.loading }" aria-hidden="true" />
        刷新
      </Button>
      <Button size="sm" type="button" :disabled="s.loading || s.installingAll" @click="service.installAll()">
        <Download :size="14" aria-hidden="true" />
        全部安装
      </Button>
    </div>
    <span class="pmp-count">{{ installedCount }} / {{ s.rows.length }} 已装</span>
  </div>

</template>

<style scoped>
.pmp-toolbar {
  display: flex;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--ui-line-soft, #eef0f4);
}

.pmp-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 220px;
}

.pmp-url { flex: 1; }

.pmp-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ui-ink-mute, #9ca3af);
}

.pmp-input {
  width: 100%;
  font-size: 12px;
}

.pmp-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pmp-count {
  padding-bottom: 7px;
  font-size: 11px;
  color: var(--ui-ink-dim, #6b7280);
  white-space: nowrap;
}

@media (max-width: 640px) {
  .pmp-toolbar-actions { width: 100%; }
  .pmp-count { padding-bottom: 0; }
}
</style>
