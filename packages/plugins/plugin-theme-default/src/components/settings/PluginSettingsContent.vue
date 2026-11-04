<script setup lang="ts">
/**
 * PluginSettingsContent —— 默认主题的设置内容区（左分类导航 + 右侧卡片小节）。
 *
 * 只画外壳里面那一格：遮罩、标题栏、✕、Esc、浮动窗都在渲染层 SettingsShell 里。
 *
 * 布局（用户口径 2026-11-01）：
 * - 左：第 0 级分类（菜单注册；默认 个人 / 外观 / 集成 / 画布 / 开发）+ 一级图标菜单，
 *   外观统一由 ShadcnSettingsNav 画。
 * - 右：一级标题 → 二级小标题 + 卡片（卡片内每行一条分割线）。
 * - 顶部页签条保留代码，默认隐藏；显式传 show-section-tabs 才出现。
 *
 * 三套插槽都保留：
 * - settings.nav：插件一级导航项，按 id 或 meta.title 命中默认项时顶替，否则追加。
 *   插件只提供数据（title / category / icon / page），不再自绘导航外观。
 * - settings.tab：二级页签，只对当前一级生效。
 * - settingsGroup/<完整分组 key>：整组正文，支持 prepend / append / replace。
 *
 * 关闭通道与滚动锁都不变：关闭仍由外壳广播 settings:ui-close；程序化滚动时锁住高亮。
 *
 * 本文件只做装配；菜单推导在 settings/settingsMenuModel.ts，导航状态与滚动锁在
 * settings/useSettingsNavigation.ts，左右两块视图在 settings/SettingsNav.vue 与
 * settings/SettingsContent.vue。
 */
import { markRaw, provide } from 'vue'
import TierTierPreview from './TierTierPreview.vue'
import { SETTINGS_TIER_PREVIEW, SETTINGS_TIER_SPEC, tierSectionSpec } from './tierSection'
import type { SettingsPanelSource } from '@mini-canvas/canvas-render'
import { SETTINGS_FIELD_RENDERER } from '@mini-canvas/canvas-render'
import SettingsSchemaField from './SettingsSchemaField.vue'
import SettingsNav from './settings/SettingsNav.vue'
import SettingsContent from './settings/SettingsContent.vue'
import { useSettingsNavigation } from './settings/useSettingsNavigation'

const props = withDefaults(
  defineProps<{
    settings: SettingsPanelSource
    /** 顶部二级页签条：默认关掉；需要按页签切换的宿主可以显式打开 */
    showSectionTabs?: boolean
  }>(),
  { showSectionTabs: false },
)

// 插件自绘的 settingsGroup 页也拿得到标准字段控件
provide(SETTINGS_FIELD_RENDERER, markRaw(SettingsSchemaField))
provide(SETTINGS_TIER_PREVIEW, markRaw(TierTierPreview))
provide(SETTINGS_TIER_SPEC, tierSectionSpec)

const {
  navItems,
  activeNav,
  activeEntry,
  selectNav,
  sections,
  activeSection,
  activeSectionIndex,
  showTabs,
  selectSection,
  setScrollEl,
  sectionBlocks,
  isWideSection,
} = useSettingsNavigation({
  settings: () => props.settings,
  showSectionTabs: () => props.showSectionTabs,
})
</script>

<template>
  <div class="psd-content-root">
    <SettingsNav :items="navItems" :active="activeNav" @select="selectNav" />
    <SettingsContent
      :settings="props.settings"
      :field-renderer="SettingsSchemaField"
      :active-entry="activeEntry"
      :sections="sections"
      :show-tabs="showTabs"
      :active-section="activeSection"
      :active-section-index="activeSectionIndex"
      :set-scroll-el="setScrollEl"
      :section-blocks="sectionBlocks"
      :is-wide-section="isWideSection"
      @select-section="selectSection"
    />
  </div>
</template>

<style scoped>
/* 中间层：左导航 + 右设置项。窗口级样式（遮罩/标题栏/关闭）在外壳里。 */
.psd-content-root {
  flex: 1;
  display: flex;
  min-height: 0;
  min-width: 0;
  gap: 0;
}
</style>
