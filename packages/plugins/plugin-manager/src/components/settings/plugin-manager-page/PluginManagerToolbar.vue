<script setup lang="ts">
/**
 * 插件页顶部：插件源列表（一行一个源，用户口径 2026-11-24）、刷新、全部安装、计数。
 * 每个源一行：名称 + 清单地址 + 删除；添加行在最下。改完自动生效并重拉对应源数据。
 * 登录不在这里（归 cloud-client）。
 */
import { ref } from 'vue'
import { Download, RefreshCw } from 'lucide-vue-next'
import { useUiComponent } from '@plume-canvas/canvas-render'
import type { PluginManagerService } from '../../../pluginManagerService'

const props = defineProps<{
  s: PluginManagerService['state']
  service: PluginManagerService
  installedCount: number
}>()

const emit = defineEmits<{
  refresh: []
}>()

const Button = useUiComponent('Button')
const Input = useUiComponent('Input')

const newName = ref('')
const newUrl = ref('')

function addSource(): void {
  if (!newUrl.value.trim()) return
  props.service.addSource(newName.value, newUrl.value)
  newName.value = ''
  newUrl.value = ''
  emit('refresh')
}
function removeSource(id: string): void {
  props.service.removeSource(id)
  emit('refresh')
}
function updateSource(id: string, patch: { name?: string; url?: string }): void {
  props.service.updateSource(id, patch)
  emit('refresh')
}
</script>

<template>
  <div class="pmp-toolbar">
    <div class="pmp-toolbar-actions">
      <Button variant="outline" size="sm" type="button" :disabled="s.loading" @click="emit('refresh')">
        <RefreshCw :size="14" :class="{ spin: s.loading }" aria-hidden="true" />
        刷新
      </Button>
      <Button size="sm" type="button" :disabled="s.loading || s.installingAll" @click="props.service.installAll()">
        <Download :size="14" aria-hidden="true" />
        全部安装
      </Button>
    </div>
    <span class="pmp-count">{{ installedCount }} / {{ s.rows.length }} 已装</span>
  </div>
  <div class="pmp-sources">
    <p class="pmp-label">插件源（每个源 = 一个插件清单体系，安装/更新走对应源；选中页签即切换源）</p>
    <div v-for="src in s.sources" :key="src.id" class="pmp-source-row">
      <Input
        :model-value="src.name"
        class="pmp-input pmp-source-name"
        type="text"
        aria-label="插件源名称"
        @change="updateSource(src.id, { name: String($event) })"
      />
      <Input
        :model-value="src.url"
        class="pmp-input pmp-source-url"
        type="text"
        spellcheck="false"
        aria-label="插件源地址"
        @change="updateSource(src.id, { url: String($event) })"
      />
      <Button variant="outline" size="sm" type="button" @click="removeSource(src.id)">
        删除
      </Button>
    </div>
    <div class="pmp-source-row">
      <Input v-model="newName" class="pmp-input pmp-source-name" type="text" aria-label="新插件源名称" placeholder="源名称" />
      <Input v-model="newUrl" class="pmp-input pmp-source-url" type="text" spellcheck="false" aria-label="新插件源地址" placeholder="插件清单地址，如 /plugin-catalog.json" />
      <Button variant="outline" size="sm" type="button" @click="addSource">
        添加源
      </Button>
    </div>
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

.pmp-sources {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

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

.pmp-source-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.pmp-source-name { width: 140px; flex: none; }
.pmp-source-url { flex: 1; }

@media (max-width: 640px) {
  .pmp-toolbar-actions { width: 100%; }
  .pmp-count { padding-bottom: 0; }
}
</style>
