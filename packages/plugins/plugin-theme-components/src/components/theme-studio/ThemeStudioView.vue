<script setup lang="ts">
/**
 * ThemeStudioView —— ThemeStudio 的模板、scoped 样式与模块装配。
 *
 * 结构：主题模板 → 颜色配方 → 右侧实时画布。
 * - 色签由各插件已声明的 `type: 'color'` 字段生成，插件没装就不出现；
 * - 每格直接读写真实 settings，亮/暗各一份值；
 * - 预览不在这里画：插件各自往 `theme-preview` 槽注册一个同步 paint 函数
 *   （theme-default 画节点与连线，多选 / 参考线 / 切割各画自己的那层）。
 *   这里只负责提供画板、执行绘制循环与自动取景。
 */
import { onMounted } from 'vue'
import type { SettingsPanelSource } from '@mini-canvas/canvas-render'
import { ColorField } from '../ui'
import { BookmarkPlus, Check, Copy, Moon, Palette, Plus, RotateCcw, SlidersHorizontal, Sun, X } from 'lucide-vue-next'
import { isPresetTheme } from './storage'
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
const {
  persist,
  selectTheme,
  selectCustom,
  duplicateTheme,
  removeTheme,
  resetTheme,
  setValue,
  syncActiveFromSettings,
  activeIsPreset,
  isCustom,
} = themesApi
const { hasCanvasContext, previewBox, stageEl, fittedStageStyle } = preview
const { copyCss } = exportApi
const { groupIcon, groupHint, tokenIcon, tokenInk, shortLabel, targetHint } = display

/**
 * 进页面先拿真实 settings 反推模板：用户上次手动改过色（或别的入口改过），
 * 这里应该直接显示「自定义」，而不是沿用存档里的模板名。
 */
onMounted(syncActiveFromSettings)
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
        <!--
          「自定义」：改了任一颜色、跟所有模板都不一致时自动选中。
          它不是一套存下来的配色，就是"当前 settings 里的这些值"。
        -->
        <button
          type="button"
          class="studio-template studio-template-custom"
          :class="{ 'is-active': isCustom }"
          role="listitem"
          :aria-pressed="isCustom"
          title="当前配色与所有模板都不一样"
          @click="selectCustom"
        >
          <span class="studio-template-art studio-template-art-custom" aria-hidden="true">
            <span class="studio-template-custom-icon"><SlidersHorizontal /></span>
            <span class="studio-template-half is-light">
              <i class="studio-template-node is-a" :style="{ background: previewSwatches[0] || 'currentColor' }"></i>
              <i class="studio-template-node is-b" :style="{ background: previewSwatches[1] || 'currentColor' }"></i>
            </span>
            <span class="studio-template-half is-dark">
              <i class="studio-template-node is-a" :style="{ background: previewSwatches[0] || 'currentColor' }"></i>
              <i class="studio-template-node is-b" :style="{ background: previewSwatches[1] || 'currentColor' }"></i>
            </span>
            <span v-if="isCustom" class="studio-template-check"><Check /></span>
          </span>
          <span class="studio-template-name">自定义</span>
        </button>
        <div v-for="theme in themes" :key="theme.id" class="studio-template-cell" role="listitem">
          <button
            type="button"
            class="studio-template"
            :class="{ 'is-active': theme.id === activeId }"
            :aria-pressed="theme.id === activeId"
            :title="isPresetTheme(theme) ? theme.name + '（内置，只读）' : theme.name"
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
          <!-- 只有用户自建模板可以删除；预设只读 -->
          <button
            v-if="!isPresetTheme(theme)"
            type="button"
            class="studio-template-remove"
            :aria-label="'删除模板 ' + theme.name"
            :title="'删除「' + theme.name + '」'"
            @click.stop="removeTheme(theme)"
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <button type="button" class="studio-template studio-template-new" role="listitem" @click="duplicateTheme">
          <span class="studio-template-plus"><Plus aria-hidden="true" /></span>
          <span class="studio-template-name">新建模板</span>
        </button>
      </div>
    </section>

    <div class="studio-grid">
      <aside class="studio-preview" aria-label="主题实时预览">
        <div class="studio-preview-head">
          <div>
            <span class="studio-live-dot" aria-hidden="true"></span>
            <strong>实时预览</strong>
            <small>跟着调色实时变化</small>
          </div>
          <div class="studio-head-actions">
            <button type="button" class="studio-reset" title="恢复当前模板的默认色" @click="resetTheme">
              <RotateCcw aria-hidden="true" />还原
            </button>
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
        </div>

        <!-- 色签条：贴在画板顶部，改一处立刻能在下面的画板上看见 -->
        <div class="studio-swatches" role="group" aria-label="主题颜色">
          <div v-if="!groups.length" class="studio-swatches-empty">
            当前没有可编辑的主题颜色。安装默认主题后，这里会出现颜色。
          </div>
          <template v-for="group in groups" :key="group.group">
            <span class="studio-swatch-group" :title="groupHint(group.group)">
              <component :is="groupIcon(group.group)" aria-hidden="true" />
              {{ group.group }}
            </span>
            <div v-for="entry in group.items" :key="entry.id" class="studio-swatch" :style="{ '--token-ink': tokenInk(entry) }">
              <div
                class="studio-token-picker"
                :title="entry.label + ' · ' + targetHint(entry) + ' · ' + valueOf(entry)"
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
            </div>
          </template>
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
          <!-- 画板：内容由各插件的 paint 函数按 order 依次画进来；这里只给统一坐标与自动取景。 -->
          <div ref="stageEl" class="studio-stage" :style="fittedStageStyle" />
          <p v-if="!hasCanvasContext" class="studio-preview-empty">
            没有预览图层。装上默认主题后，这里会出现节点与连线。
          </p>
        </div>

        <div class="studio-preview-meta">
          <span><i aria-hidden="true"></i>颜色已经应用</span>
          <span>{{ entries.length }} 个颜色 · 点上方色签改色</span>
        </div>

        <div class="studio-current">
          <span class="studio-current-icon"><Palette aria-hidden="true" /></span>
          <span class="studio-current-copy">
            <strong>{{ isCustom ? '自定义' : activeTheme?.name || '自定义' }}</strong>
            <small>
              {{ isCustom ? '当前配色与模板都不同' : activeIsPreset ? '内置模板' : '自定义模板' }} ·
              {{ mode === 'light' ? '亮色' : '暗色' }}
            </small>
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


