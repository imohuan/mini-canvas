<script setup lang="ts">
/**
 * 插件管理页：顶部（搜索 + 设置(插件源) + 刷新）→ 页签（市场/已装/各第三方源）→ 卡片网格。
 * 数据与状态在 usePluginManagerPage；工具条与页签正文各自拆成子组件。
 * 登录不在这里：认证与它的界面归 cloud-client（用户口径 2026-11-12）。
 */
import { usePluginManagerPage } from './plugin-manager-page/usePluginManagerPage'
import PluginManagerToolbar from './plugin-manager-page/PluginManagerToolbar.vue'
import PluginManagerTabs from './plugin-manager-page/PluginManagerTabs.vue'

const {
  svc,
  s,
  pluginTabs,
  activeTabId,
  selectTab,
  activeSection,
  tabCount,
  showLogView,
  loadLog,
  setShowLogView,
  npmQuery,
  npmSearching,
  onNpmSearch,
  marketCards,
  visibleInstalledCards,
  installedCount,
  onRefresh,
  onCardAction,
  openDetail,
  closeDetail,
} = usePluginManagerPage()
</script>

<template>
  <div class="pmp">
    <PluginManagerToolbar
      v-if="!s.detailPkg && !showLogView"
      :s="s"
      :service="svc"
      :installed-count="installedCount"
      :npm-searching="npmSearching"
      :show-log-view="showLogView"
      @update:show-log-view="setShowLogView"
      v-model:npm-query="npmQuery"
      @npm-search="onNpmSearch"
      @refresh="onRefresh"
    />

    <PluginManagerTabs
      v-if="!s.detailPkg"
      :s="s"
      :plugin-tabs="pluginTabs"
      :active-tab-id="activeTabId"
      :select-tab="selectTab"
      :active-section="activeSection"
      :npm-searching="npmSearching"
      :market-cards="marketCards"
      :visible-installed-cards="visibleInstalledCards"
      :show-log-view="showLogView"
      :load-log="loadLog"
      :tab-count="tabCount"
      :on-card-action="onCardAction"
      :open-detail="openDetail"
      :close-detail="closeDetail"
    />
  </div>
</template>

<style scoped>
/* 整页只负责排布，卡片与工具栏样式在各自子组件。 */
.pmp {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
</style>
