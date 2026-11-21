<script setup lang="ts">
/**
 * 插件页顶部：插件源（高级，默认收起）、刷新、全部安装、计数。
 *
 * 中转地址是高级配置：同源部署（npx serve）默认 /plugin-catalog.json 就是对的，
 * 只有后台跑在别的机器 / 端口时才需要填。所以默认收起，不占主界面（用户 2026-11-21）。
 * 登录不在这里（归 cloud-client）。
 */
import { ref } from 'vue'
import { ChevronDown, Download, RefreshCw } from 'lucide-vue-next'
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

const showAdvanced = ref(false)
</script>

<template>
  <div class="pmp-toolbar">
    <button
      type="button"
      class="pmp-advanced-toggle"
      :aria-expanded="showAdvanced"
      @click="showAdvanced = !showAdvanced"
    >
      <ChevronDown :size="13" :class="['pmp-chev', { open: showAdvanced }]" aria-hidden="true" />
      插件源
    </button>
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
  <div v-if="showAdvanced" class="pmp-advanced">
    <label class="pmp-field pmp-url">
      <span class="pmp-label">中转后台地址（高级）</span>
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
    <p class="pmp-advanced-hint">后台和页面不在同一个地址时才需要填（例如后台跑在另一台机器或另一个端口）。日常使用保持留空即可。</p>
    <div class="pmp-advanced-actions">
      <Button variant="outline" size="sm" type="button" :disabled="s.loading" @click="emit('refresh')">
        应用并刷新
      </Button>
    </div>
  </div>
</template>

<style scoped>
.pmp-advanced-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border: 1px solid var(--ui-line-soft, rgba(127, 127, 127, 0.25));
  border-radius: 8px;
  background: transparent;
  color: var(--ui-ink-dim, #6b7280);
  font-size: 11px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.pmp-advanced-toggle:hover {
  color: var(--ui-ink, #374151);
  border-color: var(--ui-line, rgba(127, 127, 127, 0.4));
}
.pmp-chev {
  transition: transform 0.15s;
}
.pmp-chev.open {
  transform: rotate(180deg);
}
.pmp-advanced {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 8px;
  padding: 10px 12px;
  margin-top: -2px;
  border: 1px dashed var(--ui-line-soft, rgba(127, 127, 127, 0.25));
  border-top: none;
  border-radius: 0 0 10px 10px;
  background: var(--ui-veil-soft, rgba(127, 127, 127, 0.04));
}
.pmp-advanced-hint {
  width: 100%;
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--ui-ink-mute, #9ca3af);
}
.pmp-advanced-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
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
