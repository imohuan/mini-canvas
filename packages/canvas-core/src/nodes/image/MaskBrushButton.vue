<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import type { MaskConfig } from '../../types/CanvasNodeData'
import type { Node } from '@vue-flow/core'

// ==================== Find the masking node ====================
const { getNodes, updateNode } = useVueFlow()

const maskingNode = computed(() => {
  return (getNodes.value as Node[]).find((n: Node) =>
    n.data?._overlay?._maskMode === true
  ) || null
})

const maskConfig = computed<MaskConfig>(() => {
  const cfg = maskingNode.value?.data?._overlay?._maskConfig
  return cfg || { brushSize: 20, brushColor: '#ff0000', brushOpacity: 0.5, isErasing: false }
})

function updateMaskConfig(partial: Partial<MaskConfig>) {
  const node = maskingNode.value
  if (!node?.data?._overlay) return
  updateNode(node.id, {
    data: {
      ...node.data,
      _overlay: {
        ...node.data._overlay,
        _maskConfig: { ...maskConfig.value, ...partial },
      },
    },
  })
}

// ==================== Menu popover state ====================
const menuOpen = ref(false)
const menuBtnRef = ref<HTMLElement | null>(null)
const popoverStyle = ref<Record<string, string>>({})

function toggleMenu() {
  menuOpen.value = !menuOpen.value
  if (menuOpen.value) {
    nextTick(() => {
      const btn = menuBtnRef.value
      if (btn) {
        const rect = btn.getBoundingClientRect()
        popoverStyle.value = {
          position: 'fixed',
          top: `${rect.bottom + 6}px`,
          left: `${rect.left}px`,
        }
      }
    })
  }
}

// ==================== Slider handlers ====================
const localSize = ref(maskConfig.value.brushSize)
const localOpacity = ref(maskConfig.value.brushOpacity)

watch(() => maskConfig.value.brushSize, (v) => { localSize.value = v })
watch(() => maskConfig.value.brushOpacity, (v) => { localOpacity.value = v })

function onSizeInput(e: Event) {
  localSize.value = +(e.target as HTMLInputElement).value
}
function onSizeChange(_e: Event) {
  updateMaskConfig({ brushSize: localSize.value, isErasing: false })
}

function onOpacityInput(e: Event) {
  localOpacity.value = +(e.target as HTMLInputElement).value
}
function onOpacityChange(_e: Event) {
  updateMaskConfig({ brushOpacity: localOpacity.value, isErasing: false })
}

// ==================== Colors ====================
const BRUSH_COLORS = [
  { hex: '#ff0000', label: '红' },
  { hex: '#00cc00', label: '绿' },
  { hex: '#0066ff', label: '蓝' },
  { hex: '#ffcc00', label: '黄' },
  { hex: '#ffffff', label: '白' },
  { hex: '#000000', label: '黑' },
]

function selectColor(hex: string) {
  updateMaskConfig({ brushColor: hex, isErasing: false })
}

// ==================== Brush / Eraser toggle ====================
function activateBrush() {
  updateMaskConfig({ isErasing: false })
}
function activateEraser() {
  updateMaskConfig({ isErasing: true })
}
</script>

<template>
  <div class="mb-wrapper" v-if="maskingNode">
    <!-- Menu dropdown button -->
    <button
      ref="menuBtnRef"
      class="mb-btn"
      :class="{ '-menu-open': menuOpen }"
      type="button"
      @click.stop="toggleMenu"
      title="画笔配置"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <line x1="4" y1="21" x2="4" y2="14" />
        <line x1="4" y1="10" x2="4" y2="3" />
        <line x1="12" y1="21" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12" y2="3" />
        <line x1="20" y1="21" x2="20" y2="16" />
        <line x1="20" y1="12" x2="20" y2="3" />
        <circle cx="4" cy="12" r="2" />
        <circle cx="12" cy="10" r="2" />
        <circle cx="20" cy="14" r="2" />
      </svg>
    </button>

    <!-- Brush button -->
    <button
      class="mb-btn"
      :class="{ '-active': !maskConfig.isErasing }"
      type="button"
      @click.stop="activateBrush"
      title="画笔"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 19l-2 3H5l-3-3" />
        <path d="M14.5 2.5c.8-.8 2-.8 2.8 0l3.2 3.2c.8.8.8 2 0 2.8L9 20H4v-5L14.5 2.5z" />
      </svg>
    </button>

    <!-- Eraser button -->
    <button
      class="mb-btn"
      :class="{ '-active': maskConfig.isErasing }"
      type="button"
      @click.stop="activateEraser"
      title="橡皮擦"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M20 20H7L3 16c-.8-.8-.8-2 0-2.8L14 2.2c.8-.8 2-.8 2.8 0L20 5.2" />
        <line x1="18" y1="12.8" x2="12" y2="18.8" />
      </svg>
    </button>

    <!-- Popover: size / opacity / color (NO eraser) -->
    <Teleport to="body">
      <div v-if="menuOpen" class="mb-backdrop" @click="menuOpen = false" />
      <div v-if="menuOpen" class="mb-popover" :style="popoverStyle" @click.stop>
        <div class="mb-row">
          <span class="mb-row-label">大小</span>
          <input
            type="range" class="mb-slider"
            :value="localSize" :min="2" :max="120" :step="1"
            @input="onSizeInput" @change="onSizeChange"
          />
          <span class="mb-row-value">{{ localSize }}px</span>
        </div>
        <div class="mb-row">
          <span class="mb-row-label">不透明</span>
          <input
            type="range" class="mb-slider"
            :value="localOpacity" :min="0.05" :max="1" :step="0.05"
            @input="onOpacityInput" @change="onOpacityChange"
          />
          <span class="mb-row-value">{{ Math.round(localOpacity * 100) }}%</span>
        </div>
        <div class="mb-row">
          <span class="mb-row-label">颜色</span>
          <div class="mb-colors">
            <button
              v-for="c in BRUSH_COLORS" :key="c.hex"
              class="mb-color-dot"
              :class="{ '-active': maskConfig.brushColor === c.hex && !maskConfig.isErasing }"
              :style="{ backgroundColor: c.hex }"
              :title="c.label"
              @click="selectColor(c.hex)"
            />
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.mb-wrapper { display: inline-flex; align-items: center; gap: 2px; }

.mb-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 0;
  border: 0; border-radius: 6px;
  background: transparent; color: var(--canvas-node-text, #374151);
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease;
}
.mb-btn:hover {
  background: var(--canvas-node-panel-surface-hover, rgba(0,0,0,0.06));
  color: var(--canvas-node-text-strong, #111827);
}
.mb-btn.-active {
  background: var(--canvas-node-panel-surface-active, rgba(59,130,246,0.12));
  color: #2563eb;
}
.mb-btn.-menu-open {
  background: var(--canvas-node-panel-surface-active, rgba(0,0,0,0.06));
  color: var(--canvas-node-text-strong, #111827);
}

/* Popover */
.mb-backdrop { position: fixed; inset: 0; z-index: 99998; }
.mb-popover {
  z-index: 99999; min-width: 180px;
  padding: 8px 10px; display: flex; flex-direction: column; gap: 6px;
  background: rgba(255,255,255,0.95); backdrop-filter: blur(12px);
  border: 1px solid rgba(0,0,0,0.08); border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12);
}
.mb-row { display: flex; align-items: center; gap: 6px; }
.mb-row-label { color: #6b7280; font-size: 11px; min-width: 32px; }
.mb-row-value { color: #374151; font-size: 11px; min-width: 36px; text-align: right; }
.mb-slider {
  flex: 1; height: 4px;
  -webkit-appearance: none; appearance: none;
  background: #d1d5db; border-radius: 2px; outline: none; cursor: pointer;
}
.mb-slider::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 12px; height: 12px; border-radius: 50%;
  background: #374151; cursor: pointer;
}
.mb-colors { display: flex; gap: 4px; }
.mb-color-dot {
  width: 18px; height: 18px; border-radius: 50%;
  border: 2px solid transparent; cursor: pointer; padding: 0; outline: none;
  box-shadow: 0 0 0 1px rgba(0,0,0,0.1);
}
.mb-color-dot.-active {
  border-color: #374151;
  box-shadow: 0 0 0 2px rgba(55,65,81,0.3);
}
</style>
