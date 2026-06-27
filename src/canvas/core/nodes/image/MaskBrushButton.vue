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

// ==================== Popover state ====================
const open = ref(false)
const btnRef = ref<HTMLElement | null>(null)
const popoverStyle = ref<Record<string, string>>({})

function toggle() {
  open.value = !open.value
  if (open.value) {
    nextTick(() => {
      const btn = btnRef.value
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
// Update locally for immediate feedback, sync on change
const localSize = ref(maskConfig.value.brushSize)
const localOpacity = ref(maskConfig.value.brushOpacity)

// Sync local from config when config changes externally
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

function toggleEraser() {
  updateMaskConfig({ isErasing: !maskConfig.value.isErasing })
}
</script>

<template>
  <div class="bb-wrapper" v-if="maskingNode">
    <button ref="btnRef" class="bb-btn" type="button" @click.stop="toggle">
      <span class="bb-dot" :style="{ backgroundColor: maskConfig.brushColor }" />
      <span class="bb-label">{{ maskConfig.brushSize }}px</span>
    </button>

    <Teleport to="body">
      <div v-if="open" class="bb-popover-backdrop" @click="open = false" />
      <div v-if="open" class="bb-popover" :style="popoverStyle" @click.stop>
        <!-- Size slider -->
        <div class="bb-row">
          <span class="bb-row-label">大小</span>
          <input
            type="range" class="bb-slider"
            :value="localSize" :min="2" :max="120" :step="1"
            @input="onSizeInput" @change="onSizeChange"
          />
          <span class="bb-row-value">{{ localSize }}px</span>
        </div>
        <!-- Opacity slider -->
        <div class="bb-row">
          <span class="bb-row-label">不透明</span>
          <input
            type="range" class="bb-slider"
            :value="localOpacity" :min="0.05" :max="1" :step="0.05"
            @input="onOpacityInput" @change="onOpacityChange"
          />
          <span class="bb-row-value">{{ Math.round(localOpacity * 100) }}%</span>
        </div>
        <!-- Colors -->
        <div class="bb-row">
          <span class="bb-row-label">颜色</span>
          <div class="bb-colors">
            <button
              v-for="c in BRUSH_COLORS" :key="c.hex"
              class="bb-color-dot"
              :class="{ '-active': maskConfig.brushColor === c.hex && !maskConfig.isErasing }"
              :style="{ backgroundColor: c.hex }"
              :title="c.label"
              @click="selectColor(c.hex)"
            />
          </div>
        </div>
        <!-- Eraser -->
        <div class="bb-row">
          <button class="bb-eraser" :class="{ '-active': maskConfig.isErasing }" @click="toggleEraser">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 20H7L3 16c-.8-.8-.8-2 0-2.8L14 2.2c.8-.8 2-.8 2.8 0L20 5.2"/>
              <line x1="18" y1="12.8" x2="12" y2="18.8"/>
            </svg>
            <span>橡皮擦</span>
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.bb-wrapper { display: inline-flex; }
.bb-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 8px; border: 0; border-radius: 6px;
  background: transparent; color: var(--canvas-node-text, #374151);
  font-size: 12px; line-height: 1; white-space: nowrap; cursor: pointer;
  transition: background-color 140ms ease;
}
.bb-btn:hover { background: var(--canvas-node-panel-surface-hover, rgba(0,0,0,0.06)); }
.bb-dot {
  width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0;
  border: 1px solid rgba(0,0,0,0.15);
}
.bb-label { font-size: 11px; }

/* Popover — white theme, matching toolbar */
.bb-popover-backdrop { position: fixed; inset: 0; z-index: 99998; }
.bb-popover {
  z-index: 99999; min-width: 180px;
  padding: 8px 10px; display: flex; flex-direction: column; gap: 6px;
  background: rgba(255,255,255,0.95); backdrop-filter: blur(12px);
  border: 1px solid rgba(0,0,0,0.08); border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12);
}
.bb-row { display: flex; align-items: center; gap: 6px; }
.bb-row-label { color: #6b7280; font-size: 11px; min-width: 32px; }
.bb-row-value { color: #374151; font-size: 11px; min-width: 36px; text-align: right; }
.bb-slider {
  flex: 1; height: 4px;
  -webkit-appearance: none; appearance: none;
  background: #d1d5db; border-radius: 2px; outline: none; cursor: pointer;
}
.bb-slider::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 12px; height: 12px; border-radius: 50%;
  background: #374151; cursor: pointer;
}
.bb-colors { display: flex; gap: 4px; }
.bb-color-dot {
  width: 18px; height: 18px; border-radius: 50%;
  border: 2px solid transparent; cursor: pointer; padding: 0; outline: none;
  box-shadow: 0 0 0 1px rgba(0,0,0,0.1);
}
.bb-color-dot.-active {
  border-color: #374151;
  box-shadow: 0 0 0 2px rgba(55,65,81,0.3);
}
.bb-eraser {
  display: flex; align-items: center; gap: 4px;
  padding: 3px 8px; border: 1px solid #d1d5db; border-radius: 6px;
  background: transparent; color: #6b7280; font-size: 12px; cursor: pointer;
}
.bb-eraser:hover { border-color: #9ca3af; color: #374151; }
.bb-eraser.-active {
  background: rgba(0,0,0,0.05); border-color: #374151; color: #374151;
}
</style>
