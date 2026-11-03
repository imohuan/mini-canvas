<script setup lang="ts">
/**
 * ThemeStudioView —— ThemeStudio 的模板、scoped 样式与模块装配。
 *
 * 结构：主题模板 → 颜色配方 → 右侧实时画布。
 * - 色签由各插件已声明的 `type: 'color'` 字段生成，插件没装就不出现；
 * - 每格直接读写真实 settings，亮/暗各一份值；
 * - 预览不在这里画：插件各自往 `theme-preview` 槽注册图层（theme-default 画节点与连线，
 *   多选 / 参考线 / 切割各画自己的那层）。这里只负责提供画板、模式与自动取景。
 */
import type { SettingsPanelSource } from '@mini-canvas/canvas-render'
import { ColorField } from '@mini-canvas/plugin-theme-default'
import { SlotHost, THEME_PREVIEW_SLOT } from '@mini-canvas/canvas-render'
import { BookmarkPlus, Check, Copy, Moon, Palette, Plus, RotateCcw, Sun } from 'lucide-vue-next'
import { useThemeStudioState } from './state'
import { useThemeStudioColors } from './colors'
import { useThemeStudioThemes } from './themes'
import { useThemeStudioPreview } from './preview'
import { useThemeStudioExport } from './export'
import { useThemeStudioDisplay } from './display'

const props = defineProps<{
  settingsSource: SettingsPanelSource
}>()

const state = useThemeStudioState(props.settingsSource)
const colors = useThemeStudioColors(state)
const themesApi = useThemeStudioThemes(state, { keyOf: colors.keyOf, isHex: colors.isHex })
const preview = useThemeStudioPreview(state)
const exportApi = useThemeStudioExport(state, { colorForBase: colors.colorForBase, showToast: themesApi.showToast })
const display = useThemeStudioDisplay(state, { valueOf: colors.valueOf, inkFor: colors.inkFor })

const { MODES, themes, activeId, mode, toast, entries, activeTheme, groups } = state
const { valueOf, themeVisualStyle, previewColors, previewSwatches } = colors
const { persist, selectTheme, duplicateTheme, resetTheme, setValue, activeIsPreset } = themesApi
const { hasCanvasContext, previewBox, fittedStageStyle } = preview
const { copyCss } = exportApi
const { groupIcon, groupHint, tokenIcon, tokenInk, shortLabel, targetHint } = display
</script>

<template>
  <div class="studio-root">
    <header class="studio-intro">
      <div class="studio-intro-copy">
        <p class="studio-eyebrow">外观 · 主题配色</p>
        <h2>颜色配方</h2>
        <p>挑一套模板，再点色签单独调。上方画布会立刻跟着变。</p>
      </div>
      <span class="studio-saved"><Check aria-hidden="true" />自动保存</span>
    </header>

    <section class="studio-template-section" aria-label="主题模板">
      <div class="studio-section-head">
        <div>
          <h3>主题模板</h3>
          <p>整套亮色与暗色一起换。</p>
        </div>
        <button type="button" class="studio-add" @click="duplicateTheme"><Plus aria-hidden="true" />新建</button>
      </div>
      <div class="studio-template-row" role="list">
        <button
          v-for="theme in themes"
          :key="theme.id"
          type="button"
          class="studio-template"
          :class="{ 'is-active': theme.id === activeId }"
          role="listitem"
          :aria-pressed="theme.id === activeId"
          @click="selectTheme(theme)"
        >
          <span class="studio-template-art" :style="themeVisualStyle(theme)" aria-hidden="true">
            <span class="studio-template-half is-light">
              <i class="studio-template-node is-a"></i>
              <i class="studio-template-node is-b"></i>
            </span>
            <span class="studio-template-half is-dark">
              <i class="studio-template-node is-a"></i>
              <i class="studio-template-node is-b"></i>
            </span>
            <span v-if="theme.id === activeId" class="studio-template-check"><Check /></span>
          </span>
          <span class="studio-template-name">{{ theme.name }}</span>
        </button>
        <button type="button" class="studio-template studio-template-new" role="listitem" @click="duplicateTheme">
          <span class="studio-template-plus"><Plus aria-hidden="true" /></span>
          <span class="studio-template-name">新建模板</span>
        </button>
      </div>
    </section>

    <div class="studio-grid">
      <section class="studio-colors" aria-label="全部颜色">
        <div class="studio-section-head">
          <div>
            <h3>全部颜色 <span>{{ entries.length }}</span></h3>
            <p>插件装了就出现，没装就没有这一格。</p>
          </div>
          <div class="studio-head-actions">
            <button type="button" class="studio-reset" title="恢复当前模板的默认色" @click="resetTheme">
              <RotateCcw aria-hidden="true" />还原
            </button>
            <div class="studio-mode" role="group" aria-label="编辑亮色或暗色">
              <button
                v-for="item in MODES"
                :key="item"
                type="button"
                :class="{ 'is-active': mode === item }"
                :aria-pressed="mode === item"
                @click="mode = item; persist()"
              >
                <Sun v-if="item === 'light'" aria-hidden="true" />
                <Moon v-else aria-hidden="true" />
                {{ item === 'light' ? '亮色' : '暗色' }}
              </button>
            </div>
          </div>
        </div>

        <div class="studio-color-card">
          <div v-if="!groups.length" class="studio-empty">
            当前没有可编辑的主题颜色。安装默认主题后，这里会出现颜色。
          </div>
          <section v-for="group in groups" :key="group.group" class="studio-group">
            <div class="studio-group-label">
              <span class="studio-group-icon"><component :is="groupIcon(group.group)" aria-hidden="true" /></span>
              <span><strong>{{ group.group }}</strong><small>{{ groupHint(group.group) }}</small></span>
            </div>
            <div class="studio-token-grid">
              <div v-for="entry in group.items" :key="entry.id" class="studio-token">
                <div
                  class="studio-token-picker"
                  :style="{ '--token-ink': tokenInk(entry) }"
                  :title="entry.label + ' · ' + entry.pluginLabel + ' · ' + targetHint(entry)"
                >
                  <ColorField
                    :model-value="valueOf(entry)"
                    :clearable="entry.optional"
                    :aria-label="'选择' + entry.label"
                    @update:model-value="setValue(entry, $event)"
                  />
                  <span class="studio-token-glyph" aria-hidden="true">
                    <component :is="tokenIcon(entry)" />
                  </span>
                </div>
                <strong>{{ shortLabel(entry) }}</strong>
                <small>{{ targetHint(entry) }}</small>
              </div>
            </div>
          </section>
          <p class="studio-color-foot">
            点色签改色；新增插件只要声明 <code>type: 'color'</code>，这里会自动多出一格。
          </p>
        </div>
      </section>

      <aside class="studio-preview" aria-label="主题实时预览">
        <div class="studio-preview-head">
          <div>
            <span class="studio-live-dot" aria-hidden="true"></span>
            <strong>实时预览</strong>
            <small>跟着调色实时变化</small>
          </div>
          <div class="studio-mode is-compact" role="group" aria-label="预览亮色或暗色">
            <button
              v-for="item in MODES"
              :key="item"
              type="button"
              :title="item === 'light' ? '看亮色样张' : '看暗色样张'"
              :aria-label="item === 'light' ? '亮色样张' : '暗色样张'"
              :class="{ 'is-active': mode === item }"
              :aria-pressed="mode === item"
              @click="mode = item; persist()"
            >
              <Sun v-if="item === 'light'" />
              <Moon v-else />
            </button>
          </div>
        </div>

        <div
          ref="previewBox"
          class="studio-preview-canvas"
          :class="mode === 'dark' ? 'is-dark' : 'is-light'"
          :style="previewColors"
          inert
          aria-hidden="true"
        >
          <div class="studio-preview-glint" aria-hidden="true"></div>
          <!-- 画板：所有内容都由插件图层自己画；这里只给统一坐标与自动取景。 -->
          <div class="studio-stage" :style="fittedStageStyle">
            <SlotHost v-if="hasCanvasContext" :slot="THEME_PREVIEW_SLOT" />
          </div>
          <p v-if="!hasCanvasContext" class="studio-preview-empty">
            没有预览图层。装上默认主题后，这里会出现节点与连线。
          </p>
        </div>

        <div class="studio-preview-meta">
          <span><i aria-hidden="true"></i>颜色已经应用</span>
          <span>{{ entries.length }} 个颜色</span>
        </div>

        <div class="studio-current">
          <span class="studio-current-icon"><Palette aria-hidden="true" /></span>
          <span class="studio-current-copy">
            <strong>{{ activeTheme?.name || '自定义' }}</strong>
            <small>{{ activeIsPreset ? '内置模板' : '自定义模板' }} · {{ mode === 'light' ? '亮色' : '暗色' }}</small>
          </span>
          <span class="studio-current-dots" aria-hidden="true">
            <i v-for="(color, index) in previewSwatches" :key="index" :style="{ background: color }"></i>
          </span>
        </div>

        <div class="studio-preview-actions">
          <button type="button" @click="duplicateTheme"><BookmarkPlus aria-hidden="true" />另存为模板</button>
          <button type="button" @click="copyCss"><Copy aria-hidden="true" />复制 CSS</button>
        </div>
        <p class="studio-preview-note">亮暗切换只改这张样张，不会改整个应用。</p>
      </aside>
    </div>

    <div class="studio-toast" :class="{ 'is-show': toast }">{{ toast }}</div>
  </div>
</template>

<style scoped>
.studio-root {
  --studio-gap: 18px;
  container-type: inline-size;
  color: var(--ui-ink, #18202b);
  font-family: system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif;
}

.studio-intro {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 0 0 12px;
}

.studio-eyebrow {
  margin: 0 0 2px;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.studio-intro h2 {
  margin: 0;
  color: var(--ui-ink, #18202b);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.35;
}

.studio-intro-copy > p:last-child {
  margin: 3px 0 0;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 12px;
  line-height: 1.5;
}

.studio-saved {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--ui-accent-soft, rgb(8 145 178 / 0.10));
  color: var(--ui-accent, #0e7490);
  font-size: 10px;
  font-weight: 700;
}

.studio-saved svg {
  width: 12px;
  height: 12px;
}

.studio-template-section {
  padding: 12px 0 14px;
  border-top: 1px solid var(--ui-line-soft, #eef0f4);
}

.studio-section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.studio-section-head h3 {
  margin: 0;
  color: var(--ui-ink, #18202b);
  font-size: 12px;
  font-weight: 700;
}

.studio-section-head h3 span {
  margin-left: 4px;
  color: var(--ui-ink-mute, #8c95a3);
  font-weight: 600;
}

.studio-section-head p {
  margin: 2px 0 0;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 11px;
  line-height: 1.4;
}

.studio-add {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 9px;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: var(--radius-control, 8px);
  background: var(--ui-panel, #fff);
  color: var(--ui-accent, #0e7490);
  font: inherit;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.studio-add:hover {
  background: var(--ui-accent-soft, rgb(8 145 178 / 0.10));
  border-color: var(--ui-accent-line, rgb(8 145 178 / 0.28));
}

.studio-add svg {
  width: 13px;
  height: 13px;
}

.studio-template-row {
  display: flex;
  gap: 8px;
  padding: 1px 1px 3px;
  overflow-x: auto;
  scrollbar-width: thin;
}

.studio-template {
  display: flex;
  flex: 0 0 92px;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 5px;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: var(--radius-open, 12px);
  background: var(--ui-panel, #fff);
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color var(--dur-hover, 0.18s) ease, box-shadow var(--dur-hover, 0.18s) ease, transform var(--dur-hover, 0.18s) ease;
}

.studio-template:hover {
  border-color: var(--ui-accent-line, rgb(8 145 178 / 0.28));
  transform: translateY(-1px);
  box-shadow: var(--ui-shadow-sm, 0 1px 4px rgb(15 23 42 / 0.12));
}

.studio-template.is-active {
  border-color: var(--ui-accent, #0891b2);
  box-shadow: 0 0 0 1px var(--ui-accent, #0891b2);
}

.studio-template-art {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr;
  height: 44px;
  overflow: hidden;
  border-radius: 7px;
  background: var(--ui-panel-soft, #fff);
}

.studio-template-half {
  position: relative;
  overflow: hidden;
}

.studio-template-half.is-light {
  background: var(--ui-panel, #fff);
}

.studio-template-half.is-dark {
  background: var(--ui-ink, #18202b);
}

.studio-template-node {
  position: absolute;
  display: block;
  border-radius: 3px;
  background: var(--tpl-accent);
}

.studio-template-node.is-a {
  top: 10px;
  left: 7px;
  width: 22px;
  height: 12px;
  opacity: 0.85;
}

.studio-template-node.is-b {
  right: 6px;
  bottom: 8px;
  width: 18px;
  height: 9px;
  background: var(--tpl-flow);
  opacity: 0.8;
}

.studio-template-check {
  position: absolute;
  top: 3px;
  right: 3px;
  display: grid;
  place-items: center;
  width: 14px;
  height: 14px;
  border-radius: 99px;
  background: var(--ui-accent, #0891b2);
  color: var(--ui-on-accent, #fff);
}

.studio-template-check svg {
  width: 9px;
  height: 9px;
  stroke-width: 3;
}

.studio-template-name {
  overflow: hidden;
  padding: 0 1px;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-template-new {
  border-style: dashed;
  background: transparent;
}

.studio-template-plus {
  display: grid;
  place-items: center;
  height: 46px;
  border-radius: 7px;
  background: var(--ui-hover-soft, rgb(0 0 0 / 0.035));
  color: var(--ui-ink-mute, #8c95a3);
}

.studio-template-plus svg {
  width: 16px;
  height: 16px;
}

.studio-grid {
  display: flex;
  flex-direction: column;
  gap: var(--studio-gap);
}

.studio-colors {
  min-width: 0;
}

.studio-head-actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
}

.studio-reset {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 24px;
  padding: 0 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ui-ink-mute, #8c95a3);
  font: inherit;
  font-size: 10px;
  font-weight: 650;
  cursor: pointer;
}

.studio-reset:hover {
  background: var(--ui-hover-soft, rgb(0 0 0 / 0.035));
  color: var(--ui-ink, #18202b);
}

.studio-reset svg {
  width: 11px;
  height: 11px;
}

.studio-mode {
  display: flex;
  flex: none;
  padding: 2px;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: var(--radius-control, 8px);
  background: var(--ui-panel-soft, #fff);
}

.studio-mode button {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 24px;
  padding: 0 7px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ui-ink-mute, #8c95a3);
  font: inherit;
  font-size: 10px;
  font-weight: 650;
  cursor: pointer;
}

.studio-mode button svg {
  width: 11px;
  height: 11px;
}

.studio-mode button.is-active {
  background: var(--ui-panel, #fff);
  color: var(--ui-ink, #18202b);
  box-shadow: var(--ui-shadow-sm, 0 1px 4px rgb(15 23 42 / 0.12));
}

.studio-mode.is-compact button {
  width: 25px;
  padding: 0;
  justify-content: center;
}

.studio-color-card {
  position: relative;
  padding: 0 12px;
  overflow: visible;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: var(--radius-panel, 16px);
  background: var(--ui-panel, #fff);
  box-shadow: var(--ui-shadow-e1, 0 2px 10px rgb(0 0 0 / 0.04));
}

/* 色块：40 × 40 的正方形；名字 / 用途在下方，不再拉成长条 */
.studio-token-picker {
  width: 40px;
  height: 40px;
  border-radius: 9px;
}

.studio-group {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  padding: 12px 0;
}

.studio-group + .studio-group {
  border-top: 1px solid var(--ui-line-soft, #eef0f4);
}

.studio-group-label {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.studio-group-icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  background: var(--ui-hover-soft, rgb(0 0 0 / 0.035));
  color: var(--ui-ink-dim, #6b7280);
}

.studio-group-icon svg {
  width: 13px;
  height: 13px;
}

.studio-group-label strong {
  display: block;
  font-size: 11px;
  font-weight: 700;
}

.studio-group-label small {
  display: block;
  margin-top: 1px;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 9px;
  line-height: 1.2;
  white-space: nowrap;
}

.studio-token-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 10px;
  min-width: 0;
}

.studio-token {
  display: flex;
  width: 64px;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.studio-token-picker {
  position: relative;
  transition: box-shadow var(--dur-hover, 0.18s) ease;
}

.studio-token-picker:focus-within {
  box-shadow: 0 0 0 3px var(--ui-accent-soft, rgb(8 145 178 / 0.12));
}

.studio-token-picker :deep(.cf-wrap) {
  display: flex;
  width: 100%;
}

.studio-token-picker :deep(.cf-trigger) {
  display: flex;
  align-items: center;
  width: 40px;
  height: 40px;
  min-height: 0;
  padding: 0;
  border: 0;
  border-radius: 9px;
  background: transparent;
  box-shadow: none;
}

.studio-token-picker :deep(.cf-trigger:hover),
.studio-token-picker :deep(.cf-trigger.is-open),
.studio-token-picker :deep(.cf-trigger:focus-visible) {
  border: 0;
  background: transparent;
  box-shadow: none;
  outline: none;
}

.studio-token-picker :deep(.cf-swatch) {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  border-radius: 9px;
  box-shadow: inset 0 0 0 1px var(--ui-line, #e2e5ea);
}

.studio-token-picker :deep(.cf-swatch-color) {
  border-radius: 8px;
}

.studio-token-picker :deep(.cf-value),
.studio-token-picker :deep(.cf-alpha),
.studio-token-picker :deep(.cf-clear-btn) {
  display: none;
}

.studio-token-glyph {
  position: absolute;
  top: 50%;
  left: 50%;
  display: grid;
  place-items: center;
  color: var(--token-ink, #fff);
  opacity: 0.92;
  pointer-events: none;
  transform: translate(-50%, -50%);
}

.studio-token-glyph svg {
  width: 16px;
  height: 16px;
  stroke-width: 2.1;
}

.studio-token > strong {
  overflow: hidden;
  font-size: 10px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-token > small {
  overflow: hidden;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 9px;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-color-foot {
  margin: 0 -12px;
  padding: 8px 12px;
  border-top: 1px solid var(--ui-line-soft, #eef0f4);
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 10px;
  line-height: 1.5;
}

.studio-color-foot code {
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--ui-code-bg, rgb(0 0 0 / 0.05));
  font-family: ui-monospace, monospace;
}

.studio-empty {
  padding: 22px 8px;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 11px;
  text-align: center;
}

.studio-preview {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: var(--radius-panel, 16px);
  background: var(--ui-panel, #fff);
  box-shadow: var(--ui-shadow-e1, 0 2px 10px rgb(0 0 0 / 0.04));
  /* 实时预览是主角：整行一张卡片，颜色清单排在它下面 */
  order: -1;
}

.studio-preview-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.studio-preview-head > div:first-child {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 1px 5px;
}

.studio-preview-head strong {
  font-size: 12px;
  font-weight: 700;
}

.studio-preview-head small {
  grid-column: 2;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 10px;
}

.studio-live-dot {
  width: 6px;
  height: 6px;
  border-radius: 99px;
  background: var(--ui-accent, #0891b2);
  box-shadow: 0 0 0 3px var(--ui-accent-soft, rgb(8 145 178 / 0.12));
}

.studio-preview-canvas {
  position: relative;
  height: 440px;
  overflow: hidden;
  border: 1px solid var(--pv-line);
  border-radius: var(--radius-open, 12px);
  background-color: var(--pv-canvas);
  background-image: radial-gradient(var(--pv-dot) 0.7px, transparent 0.7px);
  background-size: 12px 12px;
  color: var(--pv-text);
}

.studio-preview-canvas.is-light {
  /* 不跟整站主题走：`html.dark` 时 --ui-canvas-bg 也是深色，亮色样张必须自己给值 */
  --pv-canvas: #f5f6f8;
  --pv-surface: #ffffff;
  --pv-surface-soft: #ffffff;
  --pv-line: #e2e5ea;
  --pv-dot: #dfe3e8;
  --pv-text: #18202b;
  --pv-text-dim: #6b7280;
  --pv-text-mute: #8c95a3;
  /* 预览容器自己带一套完整变量：亮暗切换只影响这张画，不跟整站主题打架 */
  --ui-panel: #ffffff;
  --ui-panel-soft: #ffffff;
  --ui-line: #e2e5ea;
  --ui-line-soft: #eef0f4;
  --ui-ink: #18202b;
  --ui-ink-dim: #6b7280;
  --ui-ink-mute: #8c95a3;
  --ui-hover-soft: rgb(0 0 0 / 0.035);
  --ui-shadow-sm: 0 1px 4px rgb(15 23 42 / 0.12);
  --canvas-node-surface: #f9fafb;
  --canvas-node-panel-surface: #ffffff;
  --canvas-node-border: #e5e7eb;
  --canvas-node-border-subtle: #e5e7eb;
  --canvas-node-text-body: #374151;
  --canvas-node-text-strong: #111827;
  --canvas-node-text-muted: #64748b;
  --canvas-node-text-faint: #9ca3af;
  --canvas-node-shadow-soft: rgb(17 24 39 / 0.12);
}

.studio-preview-canvas.is-dark {
  --pv-canvas: #171717;
  --pv-surface: #252525;
  --pv-surface-soft: #1e1e1e;
  --pv-line: #3a3a3a;
  --pv-dot: #2c2c2c;
  --pv-text: #f2f2f2;
  --pv-text-dim: #c4c4c4;
  --pv-text-mute: #9a9a9a;
  --ui-panel: #252525;
  --ui-panel-soft: #1e1e1e;
  --ui-line: #3a3a3a;
  --ui-line-soft: #2a2a2a;
  --ui-ink: #f2f2f2;
  --ui-ink-dim: #c4c4c4;
  --ui-ink-mute: #9a9a9a;
  --ui-hover-soft: rgb(255 255 255 / 0.05);
  --ui-shadow-sm: 0 1px 4px rgb(0 0 0 / 0.5);
  --canvas-node-surface: #252525;
  --canvas-node-panel-surface: #2c2c2c;
  --canvas-node-border: #3a3a3a;
  --canvas-node-border-subtle: #3a3a3a;
  --canvas-node-text-body: #d4d4d4;
  --canvas-node-text-strong: #f2f2f2;
  --canvas-node-text-muted: #9c9c9c;
  --canvas-node-text-faint: #7a7a7a;
  --canvas-node-shadow-soft: rgb(0 0 0 / 0.4);
}

/* 画布卡片的一层极淡光晕：让预览看起来像一块正在被讲述的画布，而不是白底表格。 */
.studio-preview-glint {
  position: absolute;
  top: -40%;
  right: -20%;
  width: 80%;
  height: 90%;
  background: radial-gradient(circle, color-mix(in srgb, var(--ui-accent) 15%, transparent) 0%, transparent 68%);
  pointer-events: none;
}

.studio-stage {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
  overflow: visible;
}

.studio-preview-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  margin: 0;
  padding: 16px;
  color: var(--pv-text-mute);
  font-size: 11px;
  text-align: center;
}

.studio-preview-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 2px;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 9px;
}

.studio-preview-meta span:first-child {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.studio-preview-meta i {
  width: 4px;
  height: 4px;
  border-radius: 99px;
  background: var(--ui-accent, #0891b2);
}

.studio-current {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px;
  border: 1px solid var(--ui-line-soft, #eef0f4);
  border-radius: var(--radius-row, 10px);
  background: var(--ui-panel-soft, #fff);
}

.studio-current-icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  background: var(--ui-accent-soft, rgb(8 145 178 / 0.10));
  color: var(--ui-accent, #0e7490);
}

.studio-current-icon svg {
  width: 13px;
  height: 13px;
}

.studio-current-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
}

.studio-current-copy strong {
  overflow: hidden;
  font-size: 11px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-current-copy small {
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 9px;
}

.studio-current-dots {
  display: flex;
  flex: none;
  align-items: center;
  gap: 2px;
  margin-left: auto;
}

.studio-current-dots i {
  width: 7px;
  height: 7px;
  border-radius: 99px;
}

.studio-preview-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px;
}

.studio-preview-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  height: 28px;
  padding: 0 5px;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: var(--radius-control, 8px);
  background: var(--ui-panel, #fff);
  color: var(--ui-ink-dim, #6b7280);
  font: inherit;
  font-size: 10px;
  font-weight: 650;
  cursor: pointer;
}

.studio-preview-actions button:hover {
  background: var(--ui-hover-soft, rgb(0 0 0 / 0.035));
  color: var(--ui-ink, #18202b);
}

.studio-preview-actions svg {
  width: 11px;
  height: 11px;
}

.studio-preview-note {
  margin: 0;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 9px;
  line-height: 1.4;
  text-align: center;
}

.studio-toast {
  position: fixed;
  bottom: 22px;
  left: 50%;
  z-index: 50;
  padding: 7px 12px;
  border-radius: 7px;
  background: var(--ui-ink, #18202b);
  color: var(--ui-panel, #fff);
  font-size: 10px;
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, 6px);
  transition: opacity var(--dur-hover, 0.18s) ease, transform var(--dur-hover, 0.18s) ease;
}

.studio-toast.is-show {
  opacity: 1;
  transform: translate(-50%, 0);
}

@container (max-width: 700px) {
  .studio-preview-canvas {
    height: 300px;
  }
}

@container (max-width: 560px) {
  .studio-intro {
    flex-direction: column;
  }

  .studio-group {
    grid-template-columns: 1fr;
    gap: 6px;
  }

}

@media (prefers-reduced-motion: reduce) {
  .studio-template,
  .studio-toast {
    transition: none;
  }
}
</style>


