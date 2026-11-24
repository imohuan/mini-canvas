<script setup lang="ts">
/**
 * 插件页顶部：左 = 搜索框 + 搜索按钮；右 = 设置（插件源配置）+ 刷新（用户口径 2026-11-24）。
 * 设置展开后是插件源列表：一行一个源（名称 + 地址 + 删除）+ 添加行。
 * 全部安装按钮已删（用户口径：没有意义）。登录不在这里（归 cloud-client）。
 */
import { ref } from 'vue'
import { Loader2, RefreshCw, Search, Settings2 } from 'lucide-vue-next'
import { useUiComponent } from '@plume-canvas/canvas-render'
import type { PluginManagerService } from '../../../pluginManagerService'

const props = defineProps<{
  s: PluginManagerService['state']
  service: PluginManagerService
  installedCount: number
  npmQuery: string
  npmSearching: boolean
  showLogView: boolean
}>()

const emit = defineEmits<{
  'update:npmQuery': [value: string]
  npmSearch: []
  refresh: []
  'update:showLogView': [value: boolean]
}>()

const Button = useUiComponent('Button')
const Input = useUiComponent('Input')

const showSources = ref(false)
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
    <div class="pmp-search">
      <Search :size="14" class="pmp-filter-icon" aria-hidden="true" />
      <Input
        :model-value="npmQuery"
        class="pmp-input pmp-search-input"
        type="text"
        spellcheck="false"
        aria-label="搜索插件：名字、说明或包名"
        placeholder="搜索插件：名字、说明或包名（回车搜索 NPM 市场）"
        @update:model-value="emit('update:npmQuery', String($event))"
        @keydown.enter.prevent="emit('npmSearch')"
      />
      <Button variant="outline" size="sm" type="button" :disabled="npmSearching" @click="emit('npmSearch')">
        <Loader2 v-if="npmSearching" class="spin" :size="14" aria-hidden="true" />
        <Search v-else :size="14" aria-hidden="true" />
        搜索
      </Button>
    </div>
    <div class="pmp-toolbar-actions">
      <Button variant="outline" size="sm" type="button" :aria-pressed="showSources" @click="showSources = !showSources">
        <Settings2 :size="14" aria-hidden="true" />
        设置
      </Button>
      <Button
        variant="outline"
        size="sm"
        type="button"
        :aria-pressed="showLogView"
        @click="emit('update:showLogView', !showLogView)"
      >
        日志
      </Button>
      <Button variant="outline" size="sm" type="button" :disabled="s.loading" @click="emit('refresh')">
        <RefreshCw :size="14" :class="{ spin: s.loading }" aria-hidden="true" />
        刷新
      </Button>
    </div>
  </div>
  <div v-if="showSources" class="pmp-sources">
    <p class="pmp-label">插件源（每个源 = 一个插件清单体系；一级页签对应各源，安装/更新走对应源）</p>
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
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  /* 上/左留出聚焦环绘制空间；下边距收紧（用户口径 2026-11-24） */
  padding: 6px 8px 8px;
  border-bottom: 1px solid var(--ui-line-soft, #eef0f4);
}

.pmp-search {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  max-width: 420px;
  min-width: 260px;
}

.pmp-search-input { padding-left: 30px; }

.pmp-filter-icon {
  position: absolute;
  left: 10px;
  z-index: 1;
  color: var(--ui-ink-mute, #9ca3af);
  pointer-events: none;
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
