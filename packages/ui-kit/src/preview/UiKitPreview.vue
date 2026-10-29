<script setup lang="ts">
/**
 * UiKitPreview —— ui-kit 组件展示页。
 *
 * 两种启动：packages/ui-kit 的 Vite 服务（本页单独打开）和主应用的 #/ui-kit。
 * 布局：左栏组件列表 / 中间预览 + 文档 / 右侧配置与预设。
 * 展示壳与组件源码同包但分目录：src/components 是发布用组件，
 * src/preview 是只给本地演示用的页面，不进入 src/index.ts 的公开出口。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import Button from '../components/Button.vue'
import SplitPane from '../components/SplitPane.vue'
import UiKitDocView from './UiKitDocView.vue'
import { highlightCode } from './highlight'
import { buttonDocs, splitPaneDocs } from './docs'
import {
  ArrowUpRight,
  Check,
  ChevronLeft,
  Code2,
  Component,
  Copy,
  Eye,
  MoveDiagonal2,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from 'lucide-vue-next'
import {
  BUTTON_PRESETS,
  DEFAULT_BUTTON_STATE,
  SIZE_LABELS,
  VARIANT_LABELS,
  buildButtonSnippet,
  buildStateSummary,
  type ButtonPlaygroundState,
} from './buttonCatalog'
import {
  DEFAULT_SPLIT_PANE_STATE,
  SPLIT_PANE_PRESETS,
  buildSplitPaneSnippet,
  splitPaneSummary,
  type SplitPaneDirection,
  type SplitPanePlaygroundState,
} from './splitPaneCatalog'
import './preview.css'

type PreviewTab = 'preview' | 'code'
type ActiveComponent = 'button' | 'split-pane'

withDefaults(defineProps<{ showHome?: boolean }>(), { showHome: false })
const emit = defineEmits<{ home: [] }>()
const activeId = ref<ActiveComponent>('button')
const previewTab = ref<PreviewTab>('preview')
const state = ref<ButtonPlaygroundState>({ ...DEFAULT_BUTTON_STATE })
const splitState = ref<SplitPanePlaygroundState>({ ...DEFAULT_SPLIT_PANE_STATE })
const copied = ref(false)
const notice = ref('')
const previewStageRef = ref<HTMLElement | null>(null)
const previewFrameRef = ref<HTMLElement | null>(null)
const previewSize = ref<{ width: number; height: number } | null>(null)
const previewResizing = ref(false)
const PREVIEW_MIN_WIDTH = 280
const PREVIEW_MIN_HEIGHT = 200
let resizeStart = { x: 0, y: 0, width: 0, height: 0 }

const components = [
  { id: 'button' as const, name: 'Button', label: '按钮', description: '触发一个动作' },
  { id: 'split-pane' as const, name: 'SplitPane', label: '分割面板', description: '拖动两栏的大小' },
]

const snippet = computed(() => buildButtonSnippet(state.value))
const snippetHtml = ref('')
const summary = computed(() => buildStateSummary(state.value))
const docs = computed(() => activeId.value === 'split-pane' ? splitPaneDocs : buttonDocs)
const splitSnippet = computed(() => buildSplitPaneSnippet(splitState.value))
const splitSummary = computed(() => splitPaneSummary(splitState.value))

function escapeCode(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

async function highlightSnippet(source: string): Promise<string> {
  try {
    return await highlightCode(source, 'vue')
  } catch {
    return '<pre class="shiki"><code>' + escapeCode(source) + '</code></pre>'
  }
}

watch(snippet, async (value) => {
  snippetHtml.value = '<pre class="shiki"><code>' + escapeCode(value) + '</code></pre>'
  if (previewTab.value !== 'code') return
  snippetHtml.value = await highlightSnippet(value)
})

watch(previewTab, async (tab) => {
  if (tab !== 'code') return
  snippetHtml.value = await highlightSnippet(snippet.value)
})
const previewFrameStyle = computed<Record<string, string>>(() => {
  const size = previewSize.value
  const style: Record<string, string> = {}
  if (size) {
    style.width = size.width + 'px'
    style.height = size.height + 'px'
  }
  return style
})

function previewBounds(): { maxWidth: number; maxHeight: number } {
  const stage = previewStageRef.value
  return {
    maxWidth: Math.max(PREVIEW_MIN_WIDTH, stage?.clientWidth ?? PREVIEW_MIN_WIDTH),
    maxHeight: Math.max(PREVIEW_MIN_HEIGHT, stage?.clientHeight ?? PREVIEW_MIN_HEIGHT),
  }
}

function clampPreviewWidth(width: number, maxWidth: number): number {
  return Math.min(Math.max(Math.round(width), PREVIEW_MIN_WIDTH), maxWidth)
}

function clampPreviewHeight(height: number, maxHeight: number): number {
  return Math.min(Math.max(Math.round(height), PREVIEW_MIN_HEIGHT), maxHeight)
}

function beginPreviewResize(event: PointerEvent): void {
  if (event.button !== 0 && event.pointerType === 'mouse') return
  const frame = previewFrameRef.value
  if (!frame) return
  const rect = frame.getBoundingClientRect()
  const bounds = previewBounds()
  const width = clampPreviewWidth(rect.width, bounds.maxWidth)
  const height = clampPreviewHeight(rect.height, bounds.maxHeight)
  previewSize.value = { width, height }
  resizeStart = { x: event.clientX, y: event.clientY, width, height }
  previewResizing.value = true
  window.addEventListener('pointermove', onPreviewResizeMove)
  window.addEventListener('pointerup', endPreviewResize)
  window.addEventListener('pointercancel', endPreviewResize)
  document.body.style.cursor = 'nwse-resize'
  document.body.style.userSelect = 'none'
  event.preventDefault()
}

function onPreviewResizeMove(event: PointerEvent): void {
  if (!previewResizing.value) return
  const bounds = previewBounds()
  previewSize.value = {
    width: clampPreviewWidth(resizeStart.width + event.clientX - resizeStart.x, bounds.maxWidth),
    height: clampPreviewHeight(resizeStart.height + event.clientY - resizeStart.y, bounds.maxHeight),
  }
}

function endPreviewResize(): void {
  if (!previewResizing.value) return
  previewResizing.value = false
  window.removeEventListener('pointermove', onPreviewResizeMove)
  window.removeEventListener('pointerup', endPreviewResize)
  window.removeEventListener('pointercancel', endPreviewResize)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

function resetPreviewSize(): void {
  endPreviewResize()
  previewSize.value = null
}

function onPreviewResizeKeydown(event: KeyboardEvent): void {
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home']
  if (!keys.includes(event.key)) return
  event.preventDefault()
  if (event.key === 'Home') {
    resetPreviewSize()
    return
  }
  const frame = previewFrameRef.value
  if (!frame) return
  const bounds = previewBounds()
  const current = previewSize.value ?? {
    width: clampPreviewWidth(frame.getBoundingClientRect().width, bounds.maxWidth),
    height: clampPreviewHeight(frame.getBoundingClientRect().height, bounds.maxHeight),
  }
  const step = event.shiftKey ? 32 : 8
  previewSize.value = {
    width: clampPreviewWidth(
      current.width + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
      bounds.maxWidth,
    ),
    height: clampPreviewHeight(
      current.height + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0),
      bounds.maxHeight,
    ),
  }
}

onBeforeUnmount(endPreviewResize)

function reset(): void {
  state.value = { ...DEFAULT_BUTTON_STATE }
  notice.value = '配置已恢复为默认值'
}

function applyPreset(patch: Partial<ButtonPlaygroundState>): void {
  state.value = { ...DEFAULT_BUTTON_STATE, ...patch }
  notice.value = '已套用预设'
}

function selectVariant(variant: ButtonPlaygroundState['variant']): void {
  state.value = { ...state.value, variant, loading: false }
}

function selectSize(size: ButtonPlaygroundState['size']): void {
  state.value = { ...state.value, size }
}

function selectSplitDirection(direction: SplitPaneDirection): void {
  splitState.value = { ...splitState.value, direction }
}

function applySplitPreset(patch: Partial<SplitPanePlaygroundState>): void {
  splitState.value = { ...DEFAULT_SPLIT_PANE_STATE, ...patch }
  notice.value = '已套用预设'
}

async function copySplitSnippet(): Promise<void> {
  try {
    await navigator.clipboard.writeText(splitSnippet.value)
    copied.value = true
    notice.value = '代码已复制'
    window.setTimeout(() => { copied.value = false }, 1600)
  } catch {
    notice.value = '复制失败，请手动选中代码'
  }
}

function toggle(key: 'block' | 'disabled' | 'loading' | 'showIcon' | 'iconOnly'): void {
  state.value = { ...state.value, [key]: !state.value[key] }
}

function toggleIconOnly(): void {
  state.value = { ...state.value, iconOnly: !state.value.iconOnly, showIcon: true }
}

function demoClick(): void {
  notice.value = '按钮被点击了'
}

async function copySnippet(): Promise<void> {
  try {
    await navigator.clipboard.writeText(snippet.value)
    copied.value = true
    notice.value = '代码已复制'
    window.setTimeout(() => { copied.value = false }, 1600)
  } catch {
    notice.value = '复制失败，请手动选中代码'
  }
}
</script>

<template>
  <div class="ui-kit-page">
    <SplitPane class="uk-body" :initial="0.145" :min-left="190" :min-right="600" :snap="48">
      <template #left>
          <aside class="uk-sidebar">
        <div class="uk-sidebar-heading">
          <span class="uk-eyebrow">组件列表</span>
          <span class="uk-count">{{ components.length }}</span>
        </div>
        <nav class="uk-component-list" aria-label="组件列表">
          <button
            v-for="item in components"
            :key="item.id"
            type="button"
            class="uk-component-item"
            :class="{ 'is-active': activeId === item.id }"
            @click="activeId = item.id"
          >
            <span class="uk-component-icon"><Component :size="16" /></span>
            <span class="uk-component-copy">
              <strong>{{ item.name }}</strong>
              <span>{{ item.description }}</span>
            </span>
            <ArrowUpRight :size="14" class="uk-component-arrow" />
          </button>
        </nav>
        <div class="uk-sidebar-note">
          <Sparkles :size="15" />
          <p>新组件会出现在这里。先从 Button 开始，慢慢长成一套完整的设计系统。</p>
        </div>
        <div class="uk-sidebar-footer">
          <span>@mini-canvas/ui-kit</span>
          <span>v0.0.0</span>
        </div>
      </aside>
      </template>

      <template #right>
      <SplitPane class="uk-workspace" :initial="0.66" :min-left="280" :min-right="240" :snap="42">
        <template #left>
      <main class="uk-main">
        <SplitPane class="uk-center" direction="vertical" :initial="0.62" :min-left="210" :min-right="140" :snap="38">
          <template #left>
        <section class="uk-preview-panel">
          <div class="uk-panel-head">
            <div class="uk-panel-title">
              <button
                v-if="showHome"
                type="button"
                class="uk-home-link"
                title="返回首页"
                aria-label="返回首页"
                @click="emit('home')"
              ><ChevronLeft :size="16" /></button>
              <span class="uk-panel-title__text">{{ activeId === 'button' ? 'Button / 按钮' : 'SplitPane / 分割面板' }}</span>
            </div>
            <div v-if="activeId === 'button'" class="uk-tabs" role="tablist" aria-label="展示方式">
              <button
                type="button"
                role="tab"
                :aria-selected="previewTab === 'preview'"
                class="uk-tab"
                :class="{ 'is-active': previewTab === 'preview' }"
                @click="previewTab = 'preview'"
              ><Eye :size="14" /> 预览</button>
              <button
                type="button"
                role="tab"
                :aria-selected="previewTab === 'code'"
                class="uk-tab"
                :class="{ 'is-active': previewTab === 'code' }"
                @click="previewTab = 'code'"
              ><Code2 :size="14" /> 代码</button>
            </div>
          </div>

          <div class="uk-preview-body">
            <div
              v-if="activeId === 'button'"
              ref="previewStageRef"
              class="uk-preview-stage"
            >
            <div ref="previewFrameRef" class="uk-preview-canvas" :style="previewFrameStyle">
              <template v-if="previewTab === 'preview'">
                <div class="uk-canvas-grid" aria-hidden="true"></div>
                <div class="uk-demo-button" :class="{ 'is-block': state.block }">
                  <Button
                    :variant="state.variant"
                    :size="state.size"
                    :block="state.block"
                    :disabled="state.disabled"
                    :loading="state.loading"
                    :aria-label="state.iconOnly ? state.label || '按钮' : undefined"
                    @click="demoClick"
                  >
                    <template v-if="state.showIcon || state.iconOnly" #icon>
                      <Sparkles v-if="state.variant !== 'danger'" :size="16" />
                      <Trash2 v-else :size="16" />
                    </template>
                    <template v-if="!state.iconOnly">{{ state.label || '按钮' }}</template>
                  </Button>
                </div>
                <p class="uk-canvas-caption">{{ summary }}</p>
              </template>
              <div v-else class="uk-code-view">
                <div class="uk-code-tools">
                  <span class="uk-code-lang">Vue</span>
                  <button type="button" class="uk-code-copy" title="复制代码" aria-label="复制代码" @click="copySnippet">
                    <Check v-if="copied" :size="13" />
                    <Copy v-else :size="13" />
                    <span>{{ copied ? '已复制' : '复制' }}</span>
                  </button>
                </div>
                <div class="uk-code-html" v-html="snippetHtml"></div>
              </div>
              <div
                v-if="previewTab === 'preview'"
                class="uk-resize-handle"
                :class="{ 'is-dragging': previewResizing }"
                role="separator"
                aria-label="拖动调整预览尺寸，双击恢复自适应"
                :aria-valuetext="previewSize ? previewSize.width + ' × ' + previewSize.height + ' 像素' : '自适应'"
                tabindex="0"
                title="拖动调整预览尺寸，双击恢复自适应"
                @pointerdown="beginPreviewResize"
                @keydown="onPreviewResizeKeydown"
                @dblclick="resetPreviewSize"
              ><MoveDiagonal2 :size="14" /></div>
            </div>
            </div>
            <div v-else class="uk-preview-stage">
            <div ref="previewFrameRef" class="uk-preview-canvas uk-preview-canvas--split" :style="previewFrameStyle">
              <SplitPane
                class="uk-split-demo"
                :direction="splitState.direction"
                :initial="splitState.initial"
                :min-left="splitState.minLeft"
                :min-right="splitState.minRight"
                :snap="splitState.snap"
              >
                <template #left>
                  <div class="uk-split-demo-pane">左边内容</div>
                </template>
                <template #right>
                  <div class="uk-split-demo-pane is-right">右边内容</div>
                </template>
              </SplitPane>
              <p class="uk-canvas-caption">{{ splitSummary }}</p>
              <div
                class="uk-resize-handle"
                :class="{ 'is-dragging': previewResizing }"
                role="separator"
                aria-label="拖动调整预览尺寸，双击恢复自适应"
                :aria-valuetext="previewSize ? previewSize.width + ' × ' + previewSize.height + ' 像素' : '自适应'"
                tabindex="0"
                title="拖动调整预览尺寸，双击恢复自适应"
                @pointerdown="beginPreviewResize"
                @keydown="onPreviewResizeKeydown"
                @dblclick="resetPreviewSize"
              ><MoveDiagonal2 :size="15" /></div>
            </div>
            </div>
          </div>
        </section>
          </template>

          <template #right>
        <section class="uk-doc-panel">
          <div class="uk-doc-heading">
            <div>
              <span class="uk-eyebrow">文档介绍</span>
              <h2>什么时候用它</h2>
            </div>
            <Button v-if="activeId === 'button'" variant="ghost" size="sm" @click="reset">
              <template #icon><RotateCcw :size="14" /></template>
              恢复默认
            </Button>
          </div>
          <UiKitDocView :key="activeId" :source="docs.markdown" :examples="docs.examples" :code-html="docs.codeHtml" />
        </section>
          </template>
        </SplitPane>
      </main>
        </template>

        <template #right>
      <aside v-if="activeId === 'button'" class="uk-config">
        <div class="uk-config-head">
          <div>
            <span class="uk-eyebrow">组件配置</span>
            <h2>调一调看看</h2>
          </div>
          <span class="uk-config-icon"><SlidersHorizontal :size="16" /></span>
        </div>

        <div class="uk-field">
          <label for="uk-button-label">按钮文字</label>
          <input id="uk-button-label" v-model="state.label" maxlength="24" placeholder="例如：保存草稿" />
        </div>

        <fieldset class="uk-fieldset">
          <legend>外观</legend>
          <div class="uk-segment">
            <button
              v-for="variant in (['primary', 'secondary', 'ghost', 'danger'] as const)"
              :key="variant"
              type="button"
              :class="{ 'is-active': state.variant === variant }"
              @click="selectVariant(variant)"
            >{{ VARIANT_LABELS[variant] }}</button>
          </div>
        </fieldset>

        <fieldset class="uk-fieldset">
          <legend>尺寸</legend>
          <div class="uk-segment">
            <button
              v-for="size in (['sm', 'md', 'lg'] as const)"
              :key="size"
              type="button"
              :class="{ 'is-active': state.size === size }"
              @click="selectSize(size)"
            >{{ SIZE_LABELS[size] }}</button>
          </div>
        </fieldset>

        <div class="uk-switch-list">
          <label class="uk-switch">
            <span>显示图标</span>
            <input type="checkbox" :checked="state.showIcon" @change="toggle('showIcon')" />
            <i aria-hidden="true"></i>
          </label>
          <label class="uk-switch">
            <span>只显示图标</span>
            <input type="checkbox" :checked="state.iconOnly" @change="toggleIconOnly" />
            <i aria-hidden="true"></i>
          </label>
          <label class="uk-switch">
            <span>占满宽度</span>
            <input type="checkbox" :checked="state.block" @change="toggle('block')" />
            <i aria-hidden="true"></i>
          </label>
          <label class="uk-switch">
            <span>禁用</span>
            <input type="checkbox" :checked="state.disabled" @change="toggle('disabled')" />
            <i aria-hidden="true"></i>
          </label>
          <label class="uk-switch">
            <span>加载中</span>
            <input type="checkbox" :checked="state.loading" @change="toggle('loading')" />
            <i aria-hidden="true"></i>
          </label>
        </div>

        <div class="uk-presets">
          <div class="uk-presets-head">
            <span class="uk-eyebrow">配置好的预设</span>
            <span>一键套用</span>
          </div>
          <button
            v-for="preset in BUTTON_PRESETS"
            :key="preset.id"
            type="button"
            class="uk-preset"
            @click="applyPreset(preset.patch)"
          >
            <span class="uk-preset-swatch" :class="'is-' + preset.patch.variant"></span>
            <span>
              <strong>{{ preset.name }}</strong>
              <small>{{ preset.description }}</small>
            </span>
            <Plus :size="14" />
          </button>
        </div>

        <p v-if="notice" class="uk-notice" role="status">{{ notice }}</p>
      </aside>
      <aside v-else class="uk-config uk-config--split">
        <div class="uk-config-head">
          <div>
            <span class="uk-eyebrow">组件配置</span>
            <h2>调一调看看</h2>
          </div>
          <span class="uk-config-icon"><SlidersHorizontal :size="16" /></span>
        </div>

        <fieldset class="uk-fieldset">
          <legend>方向</legend>
          <div class="uk-segment is-two">
            <button type="button" :class="{ 'is-active': splitState.direction === 'horizontal' }" @click="selectSplitDirection('horizontal')">左右</button>
            <button type="button" :class="{ 'is-active': splitState.direction === 'vertical' }" @click="selectSplitDirection('vertical')">上下</button>
          </div>
        </fieldset>

        <label class="uk-range">
          <span>初始比例 <b>{{ Math.round(splitState.initial * 100) }}%</b></span>
          <input v-model.number="splitState.initial" type="range" min="0.15" max="0.85" step="0.05" />
        </label>
        <label class="uk-range">
          <span>左/上最小宽度 <b>{{ splitState.minLeft }}px</b></span>
          <input v-model.number="splitState.minLeft" type="range" min="40" max="320" step="10" />
        </label>
        <label class="uk-range">
          <span>右/下最小宽度 <b>{{ splitState.minRight }}px</b></span>
          <input v-model.number="splitState.minRight" type="range" min="40" max="320" step="10" />
        </label>
        <label class="uk-range">
          <span>吸边距离 <b>{{ splitState.snap }}px</b></span>
          <input v-model.number="splitState.snap" type="range" min="20" max="100" step="4" />
        </label>

        <div class="uk-split-actions">
          <Button variant="ghost" size="sm" @click="applySplitPreset(DEFAULT_SPLIT_PANE_STATE)">恢复默认</Button>
          <Button variant="ghost" size="sm" @click="copySplitSnippet">
            <template #icon><Copy :size="14" /></template>
            {{ copied ? '已复制' : '复制代码' }}
          </Button>
        </div>

        <div class="uk-presets">
          <div class="uk-presets-head">
            <span class="uk-eyebrow">配置好的预设</span>
            <span>一键套用</span>
          </div>
          <button
            v-for="preset in SPLIT_PANE_PRESETS"
            :key="preset.id"
            type="button"
            class="uk-preset"
            @click="applySplitPreset(preset.patch)"
          >
            <span class="uk-preset-swatch is-split"></span>
            <span>
              <strong>{{ preset.name }}</strong>
              <small>{{ preset.description }}</small>
            </span>
            <Plus :size="14" />
          </button>
        </div>

        <p v-if="notice" class="uk-notice" role="status">{{ notice }}</p>
      </aside>
        </template>
      </SplitPane>
      </template>
    </SplitPane>
  </div>
</template>

<style scoped>
.ui-kit-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: var(--ui-canvas-bg, #f5f6f8);
  color: var(--ui-ink, #18202b);
  font-family: inherit;
}

.ui-kit-page :deep(.mck-split__divider) {
  background: transparent;
}

.uk-body {
  flex: 1;
  height: 100%;
  min-height: 0;
  min-width: 0;
  width: 100%;
}

.uk-workspace,
.uk-center {
  height: 100%;
  min-height: 0;
  min-width: 0;
  background: var(--ui-canvas-bg, #f5f6f8);
}

.uk-sidebar {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 18px 12px 12px;
  border-right: 1px solid var(--ui-line, #e2e5ea);
  background: var(--ui-panel-soft, #fff);
}

.uk-sidebar-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 10px;
}

.uk-eyebrow {
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.uk-count {
  min-width: 18px;
  padding: 1px 5px;
  border-radius: 999px;
  background: var(--ui-chip, rgb(0 0 0 / 0.07));
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 10px;
  font-weight: 700;
  text-align: center;
}

.uk-component-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.uk-component-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 52px;
  padding: 8px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--ui-ink, #18202b);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 150ms ease, border-color 150ms ease;
}

.uk-component-item:hover {
  background: var(--ui-hover, rgb(0 0 0 / 0.06));
}

.uk-component-item.is-active {
  border-color: color-mix(in srgb, var(--ui-accent, #0891b2) 20%, transparent);
  background: color-mix(in srgb, var(--ui-accent, #0891b2) 10%, transparent);
}

.uk-component-icon {
  display: grid;
  flex: none;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 8px;
  background: var(--ui-chip, rgb(0 0 0 / 0.07));
  color: var(--ui-ink-dim, #6b7280);
}

.uk-component-item.is-active .uk-component-icon {
  background: color-mix(in srgb, var(--ui-accent, #0891b2) 14%, transparent);
  color: var(--ui-accent-hover, #0e7490);
}

.uk-component-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.uk-component-copy strong {
  font-size: 12px;
  font-weight: 700;
}

.uk-component-copy span {
  overflow: hidden;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.uk-component-arrow {
  flex: none;
  color: var(--ui-ink-mute, #8c95a3);
  opacity: 0;
  transition: opacity 150ms ease;
}

.uk-component-item.is-active .uk-component-arrow,
.uk-component-item:hover .uk-component-arrow {
  opacity: 1;
}

.uk-sidebar-note {
  display: flex;
  gap: 8px;
  margin-top: 20px;
  padding: 10px;
  border-radius: 10px;
  background: var(--ui-hover-soft, rgb(0 0 0 / 0.035));
  color: var(--ui-ink-mute, #8c95a3);
}

.uk-sidebar-note svg {
  flex: none;
  margin-top: 1px;
  color: var(--ui-accent, #0891b2);
}

.uk-sidebar-note p {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
}

.uk-sidebar-footer {
  display: flex;
  justify-content: space-between;
  margin-top: auto;
  padding: 10px 8px 0;
  border-top: 1px solid var(--ui-line-soft, #eef0f4);
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 10px;
}

.uk-main {
  display: flex;
  height: 100%;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
}

.uk-main > * {
  min-height: 0;
}

.uk-preview-panel {
  display: flex;
  height: 100%;
  flex: 1;
  min-height: 0;
  flex-direction: column;
}

.uk-panel-head {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 20px 10px;
}

.uk-panel-title {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.uk-panel-title__text {
  overflow: hidden;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.uk-home-link {
  display: grid;
  flex: none;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: 8px;
  background: transparent;
  color: var(--ui-ink-dim, #6b7280);
  cursor: pointer;
}

.uk-home-link:hover {
  background: var(--ui-hover, rgb(0 0 0 / 0.06));
  color: var(--ui-ink, #18202b);
}

.uk-tabs {
  display: flex;
  flex: none;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: 10px;
  background: var(--ui-hover-soft, rgb(0 0 0 / 0.035));
}

.uk-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--ui-ink-dim, #6b7280);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background-color 150ms ease, color 150ms ease;
}

.uk-tab.is-active {
  background: var(--ui-panel, #fff);
  color: var(--ui-ink, #18202b);
  box-shadow: 0 1px 4px rgb(0 0 0 / 0.06);
}

.uk-preview-body {
  display: flex;
  flex: 1;
  min-height: 0;
  padding: 0 20px 16px;
}

.uk-preview-stage {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  align-items: center;
  justify-content: center;
  padding: 4px;
}

.uk-preview-canvas {
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  flex: none;
  min-height: 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: 16px;
  background: var(--ui-panel, #fff);
}

.uk-resize-handle {
  position: absolute;
  right: 2px;
  bottom: 2px;
  z-index: 2;
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-top-left-radius: 8px;
  border-bottom-right-radius: 12px;
  background: var(--ui-hover-soft, rgb(0 0 0 / 0.04));
  color: var(--ui-ink-dim, #6b7280);
  cursor: nwse-resize;
  touch-action: none;
  transition: color 150ms ease, background-color 150ms ease;
}

.uk-resize-handle:hover,
.uk-resize-handle.is-dragging {
  background: color-mix(in srgb, var(--ui-accent, #0891b2) 14%, transparent);
  color: var(--ui-accent, #0891b2);
}

@media (prefers-reduced-motion: reduce) {
  .uk-resize-handle {
    transition: none;
  }
}

.uk-preview-canvas--split {
  justify-content: stretch;
  gap: 12px;
  padding: 18px;
}

.uk-split-demo {
  height: 100%;
  min-height: 0;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: 10px;
  background: var(--ui-panel-soft, #fff);
}

.uk-split-demo-pane {
  display: grid;
  height: 100%;
  place-items: center;
  background: var(--ui-hover-soft, rgb(0 0 0 / 0.035));
  color: var(--ui-ink-dim, #6b7280);
  font-size: 12px;
}

.uk-split-demo-pane.is-right {
  background: transparent;
}

.uk-canvas-grid {
  position: absolute;
  inset: 0;
  background-image: radial-gradient(circle, var(--ui-line, rgb(0 0 0 / 0.1)) 1px, transparent 1px);
  background-size: 18px 18px;
  opacity: 0.55;
  mask-image: linear-gradient(to bottom, rgb(0 0 0 / 0.55), transparent 80%);
}

.uk-demo-button {
  position: relative;
  z-index: 1;
  display: flex;
  justify-content: center;
  width: min(360px, 78%);
}

.uk-demo-button.is-block {
  width: min(420px, 88%);
}

.uk-canvas-caption {
  position: relative;
  z-index: 1;
  margin: 18px 0 0;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 11px;
  letter-spacing: 0.04em;
}

.uk-code-view {
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  overflow: hidden;
  border-radius: 16px;
}

.uk-code-tools {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 6px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 150ms ease;
}

.uk-code-view:hover .uk-code-tools,
.uk-code-view:focus-within .uk-code-tools {
  opacity: 1;
  pointer-events: auto;
}

.uk-code-lang {
  padding: 2px 7px;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: 6px;
  background: var(--ui-panel, #fff);
  color: var(--ui-ink-mute, #8c95a3);
  font-family: var(--mck-font-mono);
  font-size: 10px;
  font-weight: 600;
  line-height: 18px;
}

.uk-code-copy {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 7px;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: 6px;
  background: var(--ui-panel, #fff);
  color: var(--ui-ink-dim, #6b7280);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.uk-code-html {
  flex: 1;
  overflow: auto;
  padding: 14px 16px;
}

.uk-code-html :deep(.shiki) {
  margin: 0;
  background: transparent !important;
  font-family: var(--mck-font-mono);
  font-size: 12px;
  line-height: 1.7;
}

@media (prefers-reduced-motion: reduce) {
  .uk-code-tools {
    transition: none;
  }
}

.uk-doc-panel {
  flex: 1;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  padding: 22px 28px 26px;
  border-top: 1px solid var(--ui-line, #e2e5ea);
  background: var(--ui-panel-soft, #fff);
}

.uk-doc-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.uk-doc-heading h2,
.uk-config-head h2 {
  margin: 5px 0 0;
  font-size: 17px;
  font-weight: 700;
}

.uk-doc-content {
  max-width: 760px;
  margin-top: 14px;
}

.uk-doc-content > p {
  margin: 0;
  color: var(--ui-ink-dim, #6b7280);
  font-size: 13px;
  line-height: 1.8;
}

.uk-note-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: 14px;
}

.uk-note {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  border: 1px solid var(--ui-line-soft, #eef0f4);
  border-radius: 10px;
  background: var(--ui-panel, #fff);
}

.uk-note strong {
  font-size: 12px;
  font-weight: 700;
}

.uk-note span {
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 11px;
  line-height: 1.65;
}

.uk-doc-table {
  margin-top: 14px;
  overflow: hidden;
  border: 1px solid var(--ui-line-soft, #eef0f4);
  border-radius: 10px;
}

.uk-doc-row {
  display: flex;
  gap: 16px;
  padding: 9px 12px;
  background: var(--ui-panel, #fff);
}

.uk-doc-row + .uk-doc-row {
  border-top: 1px solid var(--ui-line-soft, #eef0f4);
}

.uk-doc-row code {
  min-width: 64px;
  color: var(--ui-accent-hover, #0e7490);
  font-family: var(--mck-font-mono);
  font-size: 11px;
}

.uk-doc-row span {
  color: var(--ui-ink-dim, #6b7280);
  font-size: 11px;
}

.uk-doc-foot {
  margin-top: 14px !important;
  color: var(--ui-ink-mute, #8c95a3) !important;
  font-size: 11px !important;
}

.uk-config {
  display: flex;
  flex-direction: column;
  gap: 18px;
  overflow-y: auto;
  padding: 22px 18px;
  background: var(--ui-panel, #fff);
}

.uk-config-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.uk-config-icon {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 8px;
  background: var(--ui-hover-soft, rgb(0 0 0 / 0.035));
  color: var(--ui-ink-mute, #8c95a3);
}

.uk-field,
.uk-fieldset {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  border: 0;
}

.uk-field label,
.uk-fieldset legend {
  padding: 0;
  color: var(--ui-ink-dim, #6b7280);
  font-size: 11px;
  font-weight: 700;
}

.uk-field input {
  box-sizing: border-box;
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: 8px;
  background: var(--ui-hover-soft, rgb(0 0 0 / 0.035));
  color: var(--ui-ink, #18202b);
  font: inherit;
  font-size: 12px;
}

.uk-field input:focus {
  border-color: color-mix(in srgb, var(--ui-accent, #0891b2) 50%, transparent);
  background: var(--ui-panel, #fff);
}

.uk-segment {
  display: grid;
  gap: 3px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  padding: 3px;
  border-radius: 8px;
  background: var(--ui-hover-soft, rgb(0 0 0 / 0.035));
}

.uk-segment.is-two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.uk-fieldset:last-of-type .uk-segment {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.uk-segment button {
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ui-ink-dim, #6b7280);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  transition: background-color 150ms ease, color 150ms ease;
}

.uk-segment button:hover {
  color: var(--ui-ink, #18202b);
}

.uk-segment button.is-active {
  background: var(--ui-panel, #fff);
  color: var(--ui-ink, #18202b);
  font-weight: 600;
  box-shadow: 0 1px 4px rgb(0 0 0 / 0.08);
}

.uk-switch-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 2px;
  border-top: 1px solid var(--ui-line-soft, #eef0f4);
}

.uk-switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 34px;
  color: var(--ui-ink-dim, #6b7280);
  font-size: 12px;
  cursor: pointer;
}

.uk-switch input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.uk-switch i {
  position: relative;
  flex: none;
  width: 30px;
  height: 18px;
  border-radius: 999px;
  background: var(--ui-chip, rgb(0 0 0 / 0.12));
  transition: background-color 150ms ease;
}

.uk-switch i::after {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 12px;
  height: 12px;
  border-radius: 999px;
  background: #fff;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.18);
  content: '';
  transition: transform 150ms ease;
}

.uk-switch input:checked + i {
  background: var(--ui-accent, #0891b2);
}

.uk-switch input:checked + i::after {
  transform: translateX(12px);
}

.uk-presets {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 14px;
  border-top: 1px solid var(--ui-line-soft, #eef0f4);
}

.uk-presets-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 2px;
}

.uk-presets-head > span:last-child {
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 10px;
}

.uk-preset {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 42px;
  padding: 6px 8px;
  border: 1px solid var(--ui-line-soft, #eef0f4);
  border-radius: 8px;
  background: var(--ui-panel, #fff);
  color: var(--ui-ink, #18202b);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 150ms ease, background-color 150ms ease;
}

.uk-preset:hover {
  border-color: color-mix(in srgb, var(--ui-accent, #0891b2) 30%, transparent);
  background: var(--ui-hover-soft, rgb(0 0 0 / 0.03));
}

.uk-preset-swatch {
  flex: none;
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: var(--ui-ink-mute, #8c95a3);
}

.uk-preset-swatch.is-primary { background: var(--ui-accent, #0891b2); }
.uk-preset-swatch.is-danger { background: var(--ui-danger, #ef4444); }
.uk-preset-swatch.is-ghost { border: 1px solid var(--ui-line, #d1d5db); background: transparent; }

.uk-preset span:nth-child(2) {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 1px;
}

.uk-preset strong {
  font-size: 11px;
  font-weight: 700;
}

.uk-preset small {
  overflow: hidden;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.uk-preset > svg {
  flex: none;
  color: var(--ui-ink-mute, #8c95a3);
}

.uk-notice {
  margin: auto 0 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--ui-accent, #0891b2) 10%, transparent);
  color: var(--ui-accent-hover, #0e7490);
  font-size: 11px;
}

.uk-range {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--ui-ink-dim, #6b7280);
  font-size: 11px;
}

.uk-range > span {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.uk-range b {
  color: var(--ui-ink, #18202b);
  font-weight: 700;
}

.uk-range input {
  width: 100%;
  accent-color: var(--ui-accent, #0891b2);
}

.uk-split-actions {
  display: flex;
  gap: 6px;
}

.uk-preset-swatch.is-split {
  background: linear-gradient(90deg, var(--ui-accent, #0891b2) 42%, var(--ui-line, #d1d5db) 42%, var(--ui-line, #d1d5db) 58%, var(--ui-ink-mute, #8c95a3) 58%);
}

@media (max-width: 1120px) {
  .uk-note-grid {
    grid-template-columns: 1fr;
  }
}
</style>
