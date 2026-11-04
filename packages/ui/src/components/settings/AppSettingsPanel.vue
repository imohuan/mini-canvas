<script setup lang="ts">
/**
 * AppSettingsPanel —— 成品应用的设置内容区（左分类导航 + 右侧卡片小节）。
 *
 * 只画 SettingsShell 里面那一格：遮罩、标题栏、关闭按钮、Esc、浮动窗都由外壳统一提供。
 * 关闭仍走外壳的 settings:ui-close 事件。
 *
 * 结构（用户口径 2026-11-01）：
 * - 左：第 0 级分类（菜单注册；默认 个人 / 外观 / 集成 / 画布 / 开发）+ 分类下的一级图标菜单。
 * - 右：一级标题 → 二级小标题 + 卡片（卡片内每行之间一条分割线）。
 * - 顶部页签条保留代码，但默认隐藏；宿主显式传 show-section-tabs 才出现。
 *
 * 兼容：
 * - settings.nav：插件导航项按 id / meta.title 命中默认一级项时顶替，否则追加。
 *   外观一律由本面板统一渲染；插件只给 meta.title / meta.category / meta.icon / meta.page。
 * - settings.tab：只对当前一级生效，可顶替或追加二级页签（仅页签模式显示）。
 * - settingsGroup/<完整 key>：内容插槽继续消费，prepend / append / replace 原样支持。
 *
 * 本文件只做装配；菜单推导在 settings/settingsMenuModel.ts，导航状态与滚动锁在
 * settings/useSettingsNavigation.ts，左右两块视图在 settings/SettingsNav.vue 与
 * settings/SettingsContent.vue。
 */
import { computed, markRaw, provide } from 'vue'
import type { Component } from 'vue'
import type { SettingsPanelSource } from '@mini-canvas/canvas-render'
import { SETTINGS_FIELD_RENDERER } from '@mini-canvas/canvas-render'
import DefaultSettingsSchemaField from '@mini-canvas/plugin-theme-default/components/settings/SettingsSchemaField.vue'
import { useUiComponentOutside } from '../../composables/ui'
import { createSettingsFieldBridge } from './settingsFieldBridge'
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

/** 字段控件按 ui 目录取；没登记时用默认皮的 */
const SettingsSchemaField = useUiComponentOutside('settingsField')
const FieldRenderer = computed(() => (SettingsSchemaField.value ?? DefaultSettingsSchemaField) as Component)

/**
 * 给子树一个稳定的桥组件：目录热替换时，已挂载的插件自绘页也能跟着换。
 * provide 的值不参与响应式解包，所以不能直接传 computed。
 */
const SettingsFieldBridge = createSettingsFieldBridge(
  () => SettingsSchemaField.value as Component | undefined,
  DefaultSettingsSchemaField,
)
provide(SETTINGS_FIELD_RENDERER, markRaw(SettingsFieldBridge))


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
  selectTab,
  setScrollEl,
  sectionBlocks,
} = useSettingsNavigation({
  settings: () => props.settings,
  showSectionTabs: () => props.showSectionTabs,
})
</script>

<template>
  <div class="asp-root">
    <SettingsNav :items="navItems" :active="activeNav" @select="selectNav" />
    <SettingsContent
      :settings="props.settings"
      :field-renderer="FieldRenderer"
      :active-entry="activeEntry"
      :sections="sections"
      :show-tabs="showTabs"
      :active-section="activeSection"
      :active-section-index="activeSectionIndex"
      :set-scroll-el="setScrollEl"
      :section-blocks="sectionBlocks"
      @select-section="selectSection"
      @select-tab="selectTab"
    />
  </div>
</template>

<style scoped>
/* 外框与标题栏由 SettingsShell 提供，这里只画左导航 + 右侧内容 */
.asp-root {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
}
</style>
