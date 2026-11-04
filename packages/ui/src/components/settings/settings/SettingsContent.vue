<script setup lang="ts">
import type { Component, ComponentPublicInstance } from 'vue'
import type { SettingsPanelSource } from '@mini-canvas/canvas-render'
import ShadcnSettingsSection from '@mini-canvas/plugin-theme-default/components/settings/ShadcnSettingsSection.vue'
import type { ContentBlock, NavEntry, Section } from './settingsMenuModel'
import ScrollPane from './ScrollPane.vue'
import TierTierPreview from '@mini-canvas/plugin-theme-default/components/settings/TierTierPreview.vue'
import { tierSectionSpec } from '@mini-canvas/plugin-theme-default/components/settings/tierSection.js'

/** 主题工作台是两栏工作区，需要比普通设置页更宽的正文（仍是设置外壳内的同一页）。 */
const THEME_STUDIO_NAV = '主题工作台'

const props = defineProps<{
  settings: SettingsPanelSource
  fieldRenderer: Component
  activeEntry?: NavEntry
  sections: Section[]
  showTabs: boolean
  activeSection: string
  activeSectionIndex: number
  setScrollEl: (el: Element | ComponentPublicInstance | null) => void
  sectionBlocks: (section: Section) => ContentBlock[]
}>()

const emit = defineEmits<{
  (e: 'select-section', key: string): void
  (e: 'select-tab', key: string): void
}>()

/** 点击页签：只切内容；同一页里的长内容回到顶部 */
function selectTab(key: string): void {
  emit('select-tab', key)
}
</script>

<template>
  <!-- 右：一级标题 → 二级小标题 + 卡片 -->
  <div class="asp-panel">
    <header class="asp-panel-head">
      <h3 class="asp-panel-title">{{ activeEntry?.title || '设置' }}</h3>
      <p v-if="activeEntry?.leaves.length" class="asp-panel-meta">
        {{ activeEntry.leaves.length }} 个分组
      </p>
    </header>

    <!-- 顶部页签条：保留代码，默认关掉（showSectionTabs） -->
    <div
      v-if="showTabs"
      class="asp-tabbar"
      role="tablist"
      :aria-label="(activeEntry?.title || '设置') + '分类'"
    >
      <template v-for="section in sections" :key="section.key">
        <component
          :is="section.component"
          v-if="section.kind === 'tab' && section.component"
          :group="section.key"
          :active="activeSection === section.key"
          :on-select="selectTab"
          class="asp-tab-item"
          :data-tab="section.key"
        />
        <button
          v-else
          class="asp-tab-item"
          role="tab"
          :class="{ 'is-active': activeSection === section.key }"
          :aria-selected="activeSection === section.key"
          :data-tab="section.key"
          @click="selectTab(section.key)"
        >
          {{ section.label }}
        </button>
      </template>
    </div>

    <ScrollPane ref="setScrollEl" class="asp-body flex-1" direction="y" body-class="asp-body-inner">
      <!-- 插件自绘 nav 配置页（如设置页快捷键）：正文滚动容器由设置皮统一提供 -->
      <div v-if="activeEntry?.navPage && !activeEntry?.page" class="asp-page asp-nav-page">
        <component :is="activeEntry.navPage" :group="activeEntry.key" :settings="props.settings" />
      </div>

      <!-- 插件自绘整页：只换外层标题，内部内容仍归插件（业务逻辑不动） -->
      <div
        v-else-if="activeEntry?.page"
        class="asp-page"
        :class="{ 'is-wide': activeEntry.key === THEME_STUDIO_NAV || activeEntry.leaves.includes(THEME_STUDIO_NAV) }"
      >
        <component :is="activeEntry.page" :group="activeEntry.key" :settings="props.settings" />
      </div>

      <div v-else-if="!sections.length" class="asp-empty">暂无设置项</div>

      <!-- 卡片模式：所有二级小节依次排开，每节一张卡片 -->
      <template v-else-if="!showTabs">
        <section
          v-for="section in sections"
          :key="section.key"
          class="asp-section"
          :data-sec="section.key"
        >
          <div
            v-if="section.page"
            class="asp-section-page"
            :class="{ 'is-wide': section.groups.includes(THEME_STUDIO_NAV) }"
          >
            <component :is="section.page" :group="section.groups[0]" :settings="props.settings" />
          </div>
          <ShadcnSettingsSection v-else :title="section.label">
            <TierTierPreview
              v-if="tierSectionSpec(section.key)"
              :section-id="section.key"
              :group="section.groups[0]"
              :settings="props.settings"
            />
            <template
              v-for="block in sectionBlocks(section)"
              :key="block.kind === 'field' ? 'f-' + block.group + '-' + block.key : 's-' + block.occ.id"
            >
              <component
                :is="fieldRenderer"
                v-if="block.kind === 'field'"
                :group="block.group"
                :field-key="block.key"
                :settings="props.settings"
              />
              <component
                v-else
                :is="block.occ.component"
                :group="block.group"
                :settings="props.settings"
              />
            </template>
            <p v-if="!sectionBlocks(section).length" class="asp-empty-line">这个分组还没有可配置项</p>
          </ShadcnSettingsSection>
        </section>
      </template>

      <!-- 页签模式：只显示当前段，保留原有切换能力 -->
      <template v-else>
        <section
          v-for="(section, index) in sections"
          v-show="index === activeSectionIndex"
          :key="section.key"
          class="asp-section"
          :data-sec="section.key"
        >
          <div
            v-if="section.page"
            class="asp-section-page"
            :class="{ 'is-wide': section.groups.includes(THEME_STUDIO_NAV) }"
          >
            <component :is="section.page" :group="section.groups[0]" :settings="props.settings" />
          </div>
          <ShadcnSettingsSection v-else :title="section.label">
            <TierTierPreview
              v-if="tierSectionSpec(section.key)"
              :section-id="section.key"
              :group="section.groups[0]"
              :settings="props.settings"
            />
            <template
              v-for="block in sectionBlocks(section)"
              :key="block.kind === 'field' ? 'f-' + block.group + '-' + block.key : 's-' + block.occ.id"
            >
              <component
                :is="fieldRenderer"
                v-if="block.kind === 'field'"
                :group="block.group"
                :field-key="block.key"
                :settings="props.settings"
              />
              <component
                v-else
                :is="block.occ.component"
                :group="block.group"
                :settings="props.settings"
              />
            </template>
            <p v-if="!sectionBlocks(section).length" class="asp-empty-line">这个分组还没有可配置项</p>
          </ShadcnSettingsSection>
        </section>
      </template>
    </ScrollPane>
  </div>
</template>

<style scoped>
.asp-panel {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
}

.asp-panel-head {
  display: flex;
  flex: none;
  align-items: baseline;
  gap: 8px;
  padding: 2px 22px 12px;
}

.asp-panel-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.35;
  color: var(--ui-ink, #18202b);
  text-align: left;
}

.asp-panel-meta {
  margin: 0;
  font-size: 11px;
  color: var(--ui-ink-mute, #8c95a3);
}

.asp-tabbar {
  display: flex;
  flex: none;
  align-items: center;
  gap: 2px;
  padding: 0 18px;
  overflow-x: auto;
  border-bottom: 1px solid var(--ui-line-soft, #eef0f4);
  scrollbar-width: none;
}

.asp-tabbar::-webkit-scrollbar {
  display: none;
}

.asp-tab-item {
  position: relative;
  display: inline-flex;
  align-items: center;
  height: 34px;
  padding: 0 10px;
  border: 0;
  background: transparent;
  color: var(--ui-ink-dim, #6b7280);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: color var(--dur-hover, 0.18s) ease;
}

.asp-tab-item:hover {
  color: var(--ui-ink, #18202b);
}

.asp-tab-item.is-active {
  color: var(--ui-accent, #0891b2);
}

.asp-tab-item.is-active::after {
  content: '';
  position: absolute;
  right: 8px;
  bottom: 0;
  left: 8px;
  height: 2px;
  border-radius: 2px;
  background: var(--ui-accent, #0891b2);
}

.asp-body {
  flex: 1;
  min-height: 0;
  /* ScrollPane 根节点仍是正文弹性容器：卡片组居中语义保留（契约测试盯着这条） */
  display: flex;
  flex-direction: column;
}

/* 滚动内容层：padding 从滚动容器挪进来（容器只管滚动，问题 17）；
   宽版整页的 margin-right: -22px 仍然以这层的 22px 内边距为基准 */
.asp-body :deep([data-settings-scroll-body]) {
  padding: 0 22px 24px;
}

.asp-section {
  width: 100%;
  max-width: 760px;
  margin-inline: auto;
  margin-bottom: 18px;
}

.asp-page {
  width: 100%;
  max-width: 760px;
  margin-inline: auto;
  padding: 4px 0 8px;
}

/* pageGroup 归到二级节的自绘整页（如主题工作台）：与一级整页同一套宽版规则 */
.asp-section-page {
  width: 100%;
  max-width: 760px;
  margin-inline: auto;
  padding: 4px 0 8px;
}

.asp-section-page.is-wide {
  max-width: none;
  margin-inline: 0;
  margin-right: -22px;
}

/* 自绘整页（如主题工作台）用两栏工作区：太窄会把预览挤成一条，正文也放不下四列颜色。
   贴齐正文左缘、不压掉 22px 阅读留白。 */
.asp-page.is-wide {
  max-width: none;
  margin-inline: 0;
  margin-right: -22px;
}

.asp-empty {
  padding: 36px 0;
  text-align: center;
  font-size: 12px;
  color: var(--ui-ink-mute, #8c95a3);
}

.asp-empty-line {
  margin: 0;
  padding: 12px 0;
  font-size: 12px;
  color: var(--ui-ink-mute, #8c95a3);
}

@media (prefers-reduced-motion: reduce) {
  .asp-tab-item {
    transition: none;
  }
}
</style>
