<script setup lang="ts">
/**
 * PluginManagerPage —— 设置面板里「插件」这一页。
 *
 * 布局：
 *   ① 工具条：中转地址 + 刷新 + 全部安装 + 计数
 *   ② 页签：市场 / 已装 / 本地清单 / 自带
 *   ③ 筛选 + 两列卡片（窄屏一列）
 *
 * 数据仍来自 plugin-manager 服务。状态和动作在 usePluginManagerPage，
 * 工具条与页签正文各自拆成子组件。
 *
 * 登录不在这里：认证与它的界面归 cloud-client（用户口径 2026-11-12）。
 */
import { usePluginManagerPage } from './plugin-manager-page/usePluginManagerPage'
import PluginManagerToolbar from './plugin-manager-page/PluginManagerToolbar.vue'
import PluginManagerTabs from './plugin-manager-page/PluginManagerTabs.vue'

const {
  svc,
  s,
  urlDraft,
  onRefresh,
  installedCount,
  npmTab,
  TABS,
  tabCount,
  cardFilter,
  npmError,
  onNpmSearch,
  npmQuery,
  npmSearching,
  marketCards,
  visibleInstalledCards,
  visibleLocalCards,
  visibleBuiltinCards,
  onCardAction,
} = usePluginManagerPage()
</script>

<template>
  <div class="pmp">
    <PluginManagerToolbar
      :s="s"
      :service="svc"
      :url-draft="urlDraft"
      :installed-count="installedCount"
      @update:url-draft="urlDraft = $event"
      @refresh="onRefresh"
    />

    <PluginManagerTabs
      v-model:npm-tab="npmTab"
      v-model:npm-query="npmQuery"
      v-model:card-filter="cardFilter"
      :s="s"
      :tabs="TABS"
      :npm-error="npmError"
      :npm-searching="npmSearching"
      :market-cards="marketCards"
      :visible-installed-cards="visibleInstalledCards"
      :visible-local-cards="visibleLocalCards"
      :visible-builtin-cards="visibleBuiltinCards"
      :tab-count="tabCount"
      :on-card-action="onCardAction"
      :on-npm-search="onNpmSearch"
    />
  </div>
</template>

<style scoped>
/* 整页只负责排布，卡片与工具栏样式在各自子组件。 */
.pmp {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
</style>
