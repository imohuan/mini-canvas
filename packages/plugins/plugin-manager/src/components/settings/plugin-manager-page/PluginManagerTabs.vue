<script setup lang="ts">
/** 插件页页签：市场、已装、本地清单、自带，以及卡片筛选和网格。 */
import { Loader2, PackageSearch, Search } from 'lucide-vue-next'
import { useUiComponent } from '@plume-canvas/canvas-render'
import PluginCard from '../PluginCard.vue'
import type { PluginManagerCardView } from '../pluginCardTypes'
import type { PluginManagerService } from '../../../pluginManagerService'
import type { TabId } from './usePluginManagerPage'

defineProps<{
  s: PluginManagerService['state']
  tabs: Array<{ id: TabId; label: string }>
  npmError: string
  npmSearching: boolean
  marketCards: PluginManagerCardView[]
  visibleInstalledCards: PluginManagerCardView[]
  visibleLocalCards: PluginManagerCardView[]
  visibleBuiltinCards: PluginManagerCardView[]
  tabCount: (id: TabId) => number
  onCardAction: (key: string) => void
  onNpmSearch: () => void
}>()

const npmTab = defineModel<TabId>('npmTab', { required: true })
const npmQuery = defineModel<string>('npmQuery', { required: true })
const cardFilter = defineModel<string>('cardFilter', { required: true })

const Badge = useUiComponent('Badge')
const Button = useUiComponent('Button')
const Input = useUiComponent('Input')
const Tabs = useUiComponent('Tabs')
const TabsContent = useUiComponent('TabsContent')
const TabsList = useUiComponent('TabsList')
const TabsTrigger = useUiComponent('TabsTrigger')
</script>

<template>
  <Tabs v-model="npmTab" class="pmp-tabs">
    <TabsList variant="line" class="pmp-tab-list" aria-label="插件分类">
      <TabsTrigger v-for="tab in tabs" :key="tab.id" :value="tab.id" class="pmp-tab">
        {{ tab.label }}
        <Badge variant="secondary" class="pmp-tab-count">{{ tabCount(tab.id) }}</Badge>
      </TabsTrigger>
    </TabsList>

    <div class="pmp-filter">
      <Search :size="14" class="pmp-filter-icon" aria-hidden="true" />
      <Input
        v-model="cardFilter"
        class="pmp-input pmp-filter-input"
        type="text"
        spellcheck="false"
        aria-label="筛选插件卡片"
        placeholder="筛选当前卡片：名字、说明或包名"
      />
    </div>

    <p v-if="npmError" class="pmp-error" role="alert">{{ npmError }}</p>
    <p v-if="s.error" class="pmp-error" role="alert">{{ s.error }}</p>

    <TabsContent value="market" class="pmp-panel">
      <form class="pmp-search" @submit.prevent="onNpmSearch">
        <Input
          v-model="npmQuery"
          class="pmp-input"
          type="text"
          spellcheck="false"
          aria-label="搜索 NPM 插件"
          placeholder="搜索包名（留空 = 列出全部可安装插件）"
          @keydown.enter.prevent="onNpmSearch"
        />
        <Button variant="outline" size="sm" type="submit" :disabled="npmSearching">
          <Loader2 v-if="npmSearching" class="spin" :size="14" aria-hidden="true" />
          <Search v-else :size="14" aria-hidden="true" />
          {{ npmSearching ? '加载中' : '搜索' }}
        </Button>
      </form>

      <p class="pmp-hint">只列出声明了 plume.installable、并在允许前缀里的 NPM 包。</p>

      <div v-if="npmSearching && !marketCards.length" class="pmp-loading">
        <Loader2 class="spin" :size="16" aria-hidden="true" />
        正在加载插件…
      </div>
      <div v-else-if="!marketCards.length" class="pmp-empty">
        <PackageSearch :size="20" aria-hidden="true" />
        {{ cardFilter ? '没有符合筛选的插件。' : '没有匹配的插件。' }}
      </div>
      <div v-else class="pmp-grid">
        <PluginCard v-for="card in marketCards" :key="card.id" :card="card" @action="onCardAction" />
      </div>
    </TabsContent>

    <TabsContent value="installed" class="pmp-panel">
      <div v-if="!visibleInstalledCards.length" class="pmp-empty">
        <PackageSearch :size="20" aria-hidden="true" />
        {{ cardFilter ? '没有符合筛选的已装插件。' : '还没有从 NPM 装过插件。' }}
      </div>
      <div v-else class="pmp-grid">
        <PluginCard
          v-for="card in visibleInstalledCards"
          :key="card.id"
          :card="card"
          @action="onCardAction"
        />
      </div>
    </TabsContent>

    <TabsContent value="local" class="pmp-panel">
      <div v-if="!visibleLocalCards.length" class="pmp-empty">
        <PackageSearch :size="20" aria-hidden="true" />
        {{ cardFilter ? '没有符合筛选的插件。' : '服务端目录里没有可装卸的插件。' }}
      </div>
      <div v-else class="pmp-grid">
        <PluginCard
          v-for="card in visibleLocalCards"
          :key="card.id"
          :card="card"
          @action="onCardAction"
        />
      </div>
    </TabsContent>

    <TabsContent value="builtin" class="pmp-panel">
      <div v-if="!visibleBuiltinCards.length" class="pmp-empty">
        <PackageSearch :size="20" aria-hidden="true" />
        {{ cardFilter ? '没有符合筛选的自带插件。' : '没有自带插件。' }}
      </div>
      <div v-else class="pmp-grid">
        <PluginCard
          v-for="card in visibleBuiltinCards"
          :key="card.id"
          :card="card"
          @action="onCardAction"
        />
      </div>
    </TabsContent>
  </Tabs>
</template>

<style scoped>
.pmp-input {
  width: 100%;
  font-size: 12px;
}

.pmp-tabs {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
}

.pmp-tab-list {
  width: 100%;
  justify-content: flex-start;
  gap: 4px;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 0;
  border-bottom: 1px solid var(--ui-line-soft, #eef0f4);
  border-radius: 0;
  scrollbar-width: none;
}

.pmp-tab-list::-webkit-scrollbar {
  display: none;
}

.pmp-tab {
  flex: none;
  height: 32px;
  gap: 5px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 600;
}

/* 页签未选中态也保持可读（深色主题下 muted 偏暗） */
.pmp-tab:not([data-state="active"]) {
  color: var(--ui-ink-dim, #6b7280);
}

.pmp-tab-count {
  height: 16px;
  min-width: 16px;
  padding: 0 4px;
  font-size: 10px;
  font-weight: 700;
}

.pmp-filter {
  position: relative;
  display: flex;
  align-items: center;
}

.pmp-filter-icon {
  position: absolute;
  left: 10px;
  z-index: 1;
  color: var(--ui-ink-mute, #9ca3af);
  pointer-events: none;
}

.pmp-filter-input { padding-left: 30px; }

.pmp-error {
  margin: 0;
  padding: 8px 10px;
  border: 1px solid var(--ui-danger, #ef4444);
  border-radius: var(--radius-control, 8px);
  font-size: 12px;
  color: var(--ui-danger, #ef4444);
}

.pmp-panel {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 10px;
}

.pmp-search {
  display: flex;
  gap: 8px;
}

.pmp-hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--ui-ink-mute, #9ca3af);
}

.pmp-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: stretch;
  gap: 10px;
}

.pmp-loading,
.pmp-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 32px 12px;
  font-size: 12px;
  color: var(--ui-ink-dim, #6b7280);
  text-align: center;
}

.spin { animation: pmp-spin 0.9s linear infinite; }

@keyframes pmp-spin {
  to { transform: rotate(360deg); }
}

/* 窄屏：两列变一列，卡片文字不被压扁。 */
@media (max-width: 640px) {
  .pmp-grid { grid-template-columns: minmax(0, 1fr); }
}

@media (prefers-reduced-motion: reduce) {
  .spin { animation: none; }
}
</style>
