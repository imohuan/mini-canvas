<script setup lang="ts">
/** 插件页页签：市场、已装（含本地与自带），以及卡片筛选、错误日志和网格。 */
import { Loader2, PackageSearch, Search } from 'lucide-vue-next'
import { useUiComponent } from '@plume-canvas/canvas-render'
import PluginCard from '../PluginCard.vue'
import PluginDetailPanel from './PluginDetailPanel.vue'
import type { PluginManagerCardView } from '../pluginCardTypes'
import type { PluginManagerService } from '../../../pluginManagerService'
import type { TabId } from './usePluginManagerPage'

defineProps<{
  s: PluginManagerService['state']
  sourceTabs: Array<{ id: string; name: string; url: string; enabled: boolean }>
  activeSourceId: string
  tabs: Array<{ id: TabId; label: string }>
  npmError: string
  npmSearching: boolean
  marketCards: PluginManagerCardView[]
  visibleInstalledCards: PluginManagerCardView[]
  visibleLocalCards: PluginManagerCardView[]
  errorLog: Array<{ time: string; pkg: string; message: string }>
  tabCount: (id: TabId) => number
  onCardAction: (key: string) => void
  onNpmSearch: () => void
  openDetail: (pkg: string) => void
  closeDetail: () => void
}>()

const npmTab = defineModel<TabId>('npmTab', { required: true })
const activeSource = defineModel<string>('activeSourceId', { required: true })
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
  <PluginDetailPanel v-if="s.detailPkg" :s="s" @close="closeDetail" />
  <!-- 一级切换 = 插件源（用户口径 2026-11-24）：切到哪个源，数据就来自哪个源 -->
  <div v-if="sourceTabs.length > 1" class="pmp-source-bar" role="tablist" aria-label="插件源">
    <button
      v-for="src in sourceTabs"
      :key="src.id"
      type="button"
      class="pmp-source-tab"
      :class="{ active: src.id === activeSource }"
      :aria-pressed="src.id === activeSource"
      @click="activeSource = src.id"
    >
      {{ src.name }}
    </button>
  </div>
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
        aria-label="搜索插件：名字、说明或包名"
        placeholder="搜索插件：名字、说明或包名（回车搜索 NPM 市场）"
        @keydown.enter.prevent="onNpmSearch"
      />
      <Button
        variant="outline"
        size="sm"
        type="button"
        :disabled="npmSearching"
        @click="onNpmSearch"
      >
        <Loader2 v-if="npmSearching" class="spin" :size="14" aria-hidden="true" />
        <Search v-else :size="14" aria-hidden="true" />
        搜索
      </Button>
    </div>

    <p v-if="npmError" class="pmp-error" role="alert">{{ npmError }}</p>
    <p v-if="s.error" class="pmp-error" role="alert">{{ s.error }}</p>

    <!-- 错误日志（用户口径 2026-11-23）：安装/卸载/更新失败在这里可查，不用猜。 -->
    <div v-if="errorLog.length" class="pmp-error-log">
      <p class="pmp-error-log-title">最近失败记录（{{ errorLog.length }}）</p>
      <p v-for="(item, idx) in errorLog" :key="idx" class="pmp-error-log-item">
        <span class="pmp-error-log-time">{{ item.time }}</span>
        <span class="pmp-error-log-pkg">{{ item.pkg }}</span>
        <span class="pmp-error-log-msg">{{ item.message }}</span>
      </p>
    </div>

    <TabsContent value="market" class="pmp-panel">
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
        <PluginCard v-for="card in marketCards" :key="card.id" :card="card" @action="onCardAction" @detail="openDetail" />
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
          @detail="openDetail"
        />
      </div>
    </TabsContent>

    <TabsContent value="local" class="pmp-panel">
      <p class="pmp-hint">本地或 dev 服务检测到、但不在 NPM 安装记录里的插件。</p>
      <div v-if="!visibleLocalCards.length" class="pmp-empty">
        <PackageSearch :size="20" aria-hidden="true" />
        {{ cardFilter ? '没有符合筛选的插件。' : '没有本地检测到的插件。' }}
      </div>
      <div v-else class="pmp-grid">
        <PluginCard
          v-for="card in visibleLocalCards"
          :key="card.id"
          :card="card"
          @action="onCardAction"
          @detail="openDetail"
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

/* 源切换条：多个插件源时显示 */
.pmp-source-bar {
  display: flex;
  gap: 6px;
  overflow-x: auto;
}

.pmp-source-tab {
  flex: none;
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ui-ink-dim, #6b7280);
  border: 1px solid var(--ui-line-soft, #eef0f4);
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
}

.pmp-source-tab.active {
  color: var(--ui-primary, #6366f1);
  border-color: var(--ui-primary, #6366f1);
  background: var(--ui-primary-soft, rgba(99, 102, 241, 0.08));
}

.pmp-tab-count {
  height: 16px;
  min-width: 16px;
  padding: 0 4px;
  font-size: 10px;
  font-weight: 700;
}

.pmp-tab-list {
  width: 100%;
  justify-content: flex-start;
  gap: 4px;
  padding: 0;
  border-bottom: 1px solid var(--ui-line-soft, #eef0f4);
  border-radius: 0;
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
  /* 自适应列数：容器有多宽排多少列（用户 2026-11-21：大容器不要固定两列） */
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  align-items: stretch;
  gap: 10px;
}

/* 错误日志面板（用户口径 2026-11-23）：安装/卸载/更新失败可查。 */
.pmp-error-log {
  margin: 0;
  padding: 8px 10px;
  border: 1px solid var(--ui-danger-soft, #fecaca);
  border-radius: 10px;
  background: var(--ui-danger-veil, rgba(239, 68, 68, 0.06));
}

.pmp-error-log-title {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ui-danger, #ef4444);
}

.pmp-error-log-item {
  display: flex;
  gap: 8px;
  margin: 2px 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--ui-ink-dim, #6b7280);
}

.pmp-error-log-time {
  flex: none;
  color: var(--ui-ink-mute, #9ca3af);
}

.pmp-error-log-pkg {
  flex: none;
  font-weight: 600;
  color: var(--ui-ink, #374151);
}

.pmp-error-log-msg {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--ui-danger, #ef4444);
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

@media (prefers-reduced-motion: reduce) {
  .spin { animation: none; }
}
</style>
