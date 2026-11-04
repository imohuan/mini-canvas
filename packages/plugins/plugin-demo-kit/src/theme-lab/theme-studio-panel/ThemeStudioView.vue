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
import { ColorField } from '@mini-canvas/plugin-theme-components'
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

<style scoped src="./theme-studio.css"></style>


