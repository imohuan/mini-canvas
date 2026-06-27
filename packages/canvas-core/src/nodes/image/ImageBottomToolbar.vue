<script setup lang="ts">
import type { NodeProps } from '@vue-flow/core'
import { computed, ref } from 'vue'

const props = defineProps<NodeProps>()

const emit = defineEmits<{
  (e: 'action', action: string, value?: string): void
}>()

const inputValue = ref('')

// _overlay 存在时（裁剪/扩展模式）隐藏面板，避免干扰
const hasOverlay = computed(() => !!props.data?._overlay)

const imageData = computed(() => ({
  width: (props.data?.imageWidth as number) || 0,
  height: (props.data?.imageHeight as number) || 0,
  name: (props.data?.imageName as string) || 'image',
}))

function onInput() {
  emit('action', 'input', inputValue.value)
}

function onAdd() {
  emit('action', 'add')
}

function onSettings() {
  emit('action', 'settings')
}

function onStyle() {
  emit('action', 'style')
}

function onModel() {
  emit('action', 'model')
}

function onLength() {
  emit('action', 'length')
}

function onMore() {
  emit('action', 'more')
}

function onAi() {
  emit('action', 'ai', inputValue.value)
}
</script>

<template>
  <div v-if="!hasOverlay" class="image-bottom-panel">
    <!-- 输入框区域 -->
    <div class="input-area">
      <textarea
        v-model="inputValue"
        class="prompt-textarea"
        placeholder="描述你想要生成的画面内容，@引用素材"
        rows="6"
        @input="onInput"
      />
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
      <!-- 左侧工具按钮 -->
      <div class="toolbar-left">
        <button class="toolbar-btn btn-icon" @click="onAdd" title="添加">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>

        <button class="toolbar-btn btn-icon" @click="onSettings" title="设置">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>

        <div class="toolbar-divider" />

        <button class="toolbar-btn btn-pill" @click="onStyle">
          <span class="btn-label">美式复古好莱坞</span>
          <svg class="btn-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        <button class="toolbar-btn btn-pill" @click="onModel">
          <svg class="btn-icon-left" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
          <span class="btn-label">小云雀 AnyCook</span>
          <svg class="btn-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        <button class="toolbar-btn btn-pill" @click="onLength">
          <span class="btn-label">9:16 · 3K</span>
          <svg class="btn-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      <!-- 右侧工具按钮 -->
      <div class="toolbar-right">
        <button class="toolbar-btn btn-icon" @click="onMore" title="更多">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <line x1="8" y1="12" x2="16" y2="12" />
          </svg>
        </button>

        <button class="toolbar-btn btn-ai" @click="onAi">
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
  overflow: hidden;
}

.input-area {
  position: relative;
  padding: 12px 14px 8px;
}

.prompt-textarea {
  width: 100%;
  min-height: 60px;
  padding: 0 28px 0 0;
  border: none;
  background: transparent;
  color: #1a1a1a;
  font-size: 14px;
  line-height: 1.6;
  resize: none;
  outline: none;
}

.prompt-textarea::placeholder {
  color: #9ca3af;
}

.expand-btn {
  position: absolute;
  right: 12px;
  top: 12px;
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

.toolbar-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px 10px;
  gap: 8px;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.toolbar-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #4b5563;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
  flex-shrink: 0;
}

.toolbar-btn:hover {
  background: rgba(0, 0, 0, 0.04);
}

.btn-icon {
  padding: 6px;
  color: #6b7280;
}

.btn-icon svg {
  width: 18px;
  height: 18px;
}

.btn-pill {
  padding: 5px 8px 5px 10px;
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 16px;
  font-weight: 500;
}

.btn-pill:hover {
  background: rgba(255, 255, 255, 0.9);
}

.btn-label {
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.btn-icon-left {
  width: 14px;
  height: 14px;
  color: #6b7280;
}

.btn-arrow {
  width: 12px;
  height: 12px;
  opacity: 0.5;
  flex-shrink: 0;
}

.toolbar-divider {
  width: 1px;
  height: 18px;
  background: rgba(0, 0, 0, 0.08);
  margin: 0 2px;
}

.btn-ai {
  position: relative;
  padding: 6px 10px 6px 8px;
  color: #7c3aed;
  background: rgba(124, 58, 237, 0.08);
  border-radius: 14px;
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