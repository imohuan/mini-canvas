<script setup lang="ts">
/** 插件页页签：市场、已装（含本地与自带），以及卡片筛选、错误日志和网格。 */
import { Loader2, PackageSearch } from 'lucide-vue-next'
import { useUiComponent } from '@plume-canvas/canvas-render'
import PluginCard from '../PluginCard.vue'
import PluginDetailPanel from './PluginDetailPanel.vue'
import type { PluginManagerCardView } from '../pluginCardTypes'
import type { PluginManagerService } from '../../../pluginManagerService'
import type { TabId } from './usePluginManagerPage'

defineProps<{
  s: PluginManagerService['state']
  pluginTabs: Array<{ id: string; label: string; sourceId: string; section: string }>
  activeTabId: string
  activeSection: string
  selectTab: (id: string) => void
  npmSearching: boolean
  marketCards: PluginManagerCardView[]
  visibleInstalledCards: PluginManagerCardView[]
  showLogView: boolean
  loadLog: Array<{ pkg: string; message: string; version: string }>
  tabCount: (id: string) => number
  onCardAction: (key: string) => void
  openDetail: (pkg: string) => void
  closeDetail: () => void
}>()

const Badge = useUiComponent('Badge')
const Button = useUiComponent('Button')
const Input = useUiComponent('Input')
const Tabs = useUiComponent('Tabs')
const TabsList = useUiComponent('TabsList')
const TabsTrigger = useUiComponent('TabsTrigger')
</script>

<template>
  <PluginDetailPanel v-if="s.detailPkg" :s="s" @close="closeDetail" />
  <Tabs :model-value="activeTabId" class="pmp-tabs" @update:model-value="selectTab(String($event))">
    <div v-if="!showLogView" class="pmp-tabs-row">
      <TabsList variant="line" class="pmp-tab-list" aria-label="插件分类">
        <TabsTrigger
          v-for="tab in pluginTabs"
          :key="tab.id"
          :value="tab.id"
          class="pmp-tab"
          @click.stop="selectTab(tab.id)"
        >
          {{ tab.label }}
          <Badge v-if="tabCount(tab.id) >= 0" variant="secondary" class="pmp-tab-count">{{ tabCount(tab.id) }}</Badge>
        </TabsTrigger>
      </TabsList>
    </div>
    <!-- 日志视图（用户口径 2026-11-24）：点「日志」按钮后主区切换为插件加载日志 -->
    <div v-if="showLogView" class="pmp-panel">
      <p class="pmp-hint">插件加载日志（检测到加载失败的插件及原因）。</p>
      <div v-if="!loadLog.length" class="pmp-empty">
        <PackageSearch :size="20" aria-hidden="true" />
        没有加载失败的插件。
      </div>
      <div v-else class="pmp-log-list">
        <div v-for="(item, idx) in loadLog" :key="idx" class="pmp-log-item">
          <span class="pmp-log-pkg">{{ item.pkg }}</span>
          <span class="pmp-log-ver">{{ item.version }}</span>
          <span class="pmp-log-msg">{{ item.message }}</span>
        </div>
      </div>
    </div>

    <div v-else-if="activeSection === 'market'" class="pmp-panel">
      <div v-if="npmSearching && !marketCards.length" class="pmp-loading">
        <Loader2 class="spin" :size="16" aria-hidden="true" />
        正在加载插件…
      </div>
      <div v-else-if="!marketCards.length" class="pmp-empty">
        <PackageSearch :size="20" aria-hidden="true" />
        没有匹配的插件。
      </div>
      <div v-else class="pmp-grid">
        <PluginCard v-for="card in marketCards" :key="card.id" :card="card" @action="onCardAction" @detail="openDetail" />
      </div>
    </div>

    <div v-else-if="activeSection === 'installed'" class="pmp-panel">
      <div v-if="!visibleInstalledCards.length" class="pmp-empty">
        <PackageSearch :size="20" aria-hidden="true" />
        '还没有从 NPM 装过插件。'
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
    </div>
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
  gap: 2px;
}

/* 页签行：页签在左，搜索在右（用户口径 2026-11-24） */
.pmp-tabs-row {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  border-bottom: 1px solid var(--ui-line-soft, #eef0f4);
}

.pmp-tab-list {
  flex: none;
  justify-content: flex-start;
  gap: 4px;
  padding: 0;
  border-bottom: none;
  margin-bottom: -1px;
}

.pmp-filter-inline {
  flex: 1;
  max-width: 420px;
  margin-bottom: 6px;
}

.pmp-tab-count {
  height: 16px;
  min-width: 16px;
  padding: 0 4px;
  font-size: 10px;
  font-weight: 700;
}

.pmp-tab-list {
  justify-content: flex-start;
  gap: 4px;
  padding: 0;
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
  /* 页签行与卡片区之间的间隔（用户口径 2026-11-24：贴太近会压住页签底线） */
  margin-top: 14px;
  gap: 6px;
}

/* 日志视图：与卡片正文同一套字体字号 */
.pmp-log-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pmp-log-item {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--ui-ink, #374151);
}

.pmp-log-pkg {
  font-weight: 600;
}

.pmp-log-ver {
  color: var(--ui-ink-mute, #9ca3af);
}

.pmp-log-msg {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--ui-ink-dim, #6b7280);
}

.pmp-grid {
  display: grid;
  /* 自适应列数：容器有多宽排多少列（用户 2026-11-21：大容器不要固定两列） */
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
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

@media (prefers-reduced-motion: reduce) {
  .spin { animation: none; }
}
</style>
