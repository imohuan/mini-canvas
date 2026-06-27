<script setup lang="ts">
import type { NodeProps } from '@vue-flow/core'
import { computed, ref, watch } from 'vue'
import { ProseMirrorEditor } from 'prosemirror-editor-bundle'
import { AxSelect, AxButton } from '../../components/Ui'
import type { SelectOption } from '../../components/Ui'

const props = defineProps<NodeProps>()

const emit = defineEmits<{
  (e: 'action', action: string, value?: string): void
}>()

// ── 下拉选项 ──

const STYLE_OPTIONS: SelectOption[] = [
  { label: '美式复古好莱坞', value: 'hollywood-retro' },
  { label: '赛博朋克', value: 'cyberpunk' },
  { label: '水墨画风', value: 'ink-wash' },
  { label: '3D 渲染', value: '3d-render' },
  { label: '日系动漫', value: 'anime' },
  { label: '油画质感', value: 'oil-painting' },
]

const MODEL_OPTIONS: SelectOption[] = [
  { label: '小云雀 AnyCook', value: 'anycook' },
  { label: 'Stable Diffusion XL', value: 'sdxl' },
  { label: 'Midjourney v6', value: 'mj6' },
  { label: 'DALL·E 3', value: 'dalle3' },
  { label: 'Flux.1 Pro', value: 'flux-pro' },
]

const SIZE_OPTIONS: SelectOption[] = [
  { label: '9:16 · 3K', value: '9:16-3k' },
  { label: '16:9 · 4K', value: '16:9-4k' },
  { label: '1:1 · 2K', value: '1:1-2k' },
  { label: '4:3 · 2K', value: '4:3-2k' },
  { label: '3:2 · 3K', value: '3:2-3k' },
  { label: '21:9 · 5K', value: '21:9-5k' },
]

// ── 状态 ──

const promptText = ref('')
const selectedStyle = ref(STYLE_OPTIONS[0].value)
const selectedModel = ref(MODEL_OPTIONS[0].value)
const selectedSize = ref(SIZE_OPTIONS[0].value)

const hasOverlay = computed(() => !!props.data?._overlay)

const imageData = computed(() => ({
  width: (props.data?.imageWidth as number) || 0,
  height: (props.data?.imageHeight as number) || 0,
  name: (props.data?.imageName as string) || 'image',
}))

// ── 事件 ──

function onInput() {
  emit('action', 'input', promptText.value)
}

function onAdd() {
  emit('action', 'add')
}

function onSettings() {
  emit('action', 'settings')
}

function onMore() {
  emit('action', 'more')
}

function onAi() {
  emit('action', 'ai', promptText.value)
}

// 下拉选择变化 → 通知父组件
watch(selectedStyle, (val) => emit('action', 'style', val as string))
watch(selectedModel, (val) => emit('action', 'model', val as string))
watch(selectedSize, (val) => emit('action', 'length', val as string))
</script>

<template>
  <div v-if="!hasOverlay" class="image-bottom-panel">
    <!-- 输入区域 — ProseMirrorEditor -->
    <div class="input-area">
      <div class="editor-wrapper">
        <ProseMirrorEditor
          v-model="promptText"
          placeholder="描述你想要生成的画面内容，@引用素材"
          @update:model-value="onInput"
        />
      </div>
      <button class="expand-btn" @click="onMore">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 3 21 3 21 9" />
          <polyline points="9 21 3 21 3 15" />
          <line x1="21" y1="3" x2="14" y2="10" />
          <line x1="3" y1="21" x2="10" y2="14" />
        </svg>
      </button>
    </div>

    <!-- 底部工具栏 -->
    <div class="toolbar-row">
      <!-- 左侧 -->
      <div class="toolbar-left">
        <AxButton
          variant="ghost"
          size="icon"
          icon="add"
          title="添加"
          @click="onAdd"
        />

        <AxButton
          variant="ghost"
          size="icon"
          icon="settings"
          title="设置"
          @click="onSettings"
        />

        <div class="toolbar-divider" />

        <AxSelect
          v-model="selectedStyle"
          :options="STYLE_OPTIONS"
          size="sm"
          placeholder="选择风格"
          trigger-width="110px"
        />

        <AxSelect
          v-model="selectedModel"
          :options="MODEL_OPTIONS"
          size="sm"
          placeholder="选择模型"
          trigger-width="130px"
        />

        <AxSelect
          v-model="selectedSize"
          :options="SIZE_OPTIONS"
          size="sm"
          placeholder="选择尺寸"
          trigger-width="95px"
        />
      </div>

      <!-- 右侧 -->
      <div class="toolbar-right">
        <AxButton
          variant="ghost"
          size="icon"
          icon="add_circle"
          title="更多"
          @click="onMore"
        />

        <button class="btn-ai" @click="onAi">
          <svg class="ai-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
          <span class="ai-badge">1</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.image-bottom-panel {
  width: 650px;
  background: rgba(245, 245, 245, 0.98);
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
  backdrop-filter: blur(12px);
  overflow: visible;
}

/* ── 输入区域 ── */

.input-area {
  position: relative;
  padding: 10px 14px 4px;
}

.editor-wrapper {
  width: 100%;
  padding-right: 24px;
}

/* 覆盖 ProseMirror 默认高度 */
.editor-wrapper :deep(.prose-mirror-editor > div:first-child) {
  min-height: 48px !important;
}

.editor-wrapper :deep(.ProseMirror) {
  min-height: 48px !important;
  font-size: 14px;
  line-height: 1.6;
  color: #1a1a1a;
  outline: none !important;
}

.editor-wrapper :deep(.ProseMirror p.is-editor-empty:first-child::before) {
  color: #9ca3af;
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
}

.editor-wrapper :deep(.prose-mirror-editor) {
  width: 100%;
}

.expand-btn {
  position: absolute;
  right: 12px;
  top: 10px;
  width: 20px;
  height: 20px;
  padding: 2px;
  border: none;
  background: transparent;
  color: #9ca3af;
  cursor: pointer;
  opacity: 0.6;
  transition: opacity 0.15s;
}

.expand-btn:hover {
  opacity: 1;
}

.expand-btn svg {
  width: 16px;
  height: 16px;
}

/* ── 工具栏 ── */

.toolbar-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px 10px;
  gap: 6px;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.toolbar-divider {
  width: 1px;
  height: 18px;
  background: rgba(0, 0, 0, 0.08);
  margin: 0 2px;
  flex-shrink: 0;
}

/* ── AxSelect 样式微调 ── */

.toolbar-left :deep(.ax-select-trigger) {
  flex-shrink: 0;
}

/* ── AI 按钮 ── */

.btn-ai {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px 6px 8px;
  border: none;
  border-radius: 14px;
  background: rgba(124, 58, 237, 0.08);
  color: #7c3aed;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
  flex-shrink: 0;
}

.btn-ai:hover {
  background: rgba(124, 58, 237, 0.15);
}

.ai-icon {
  width: 14px;
  height: 14px;
}

.ai-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  background: #7c3aed;
  color: white;
  font-size: 10px;
  font-weight: 600;
  border-radius: 8px;
}
</style>
