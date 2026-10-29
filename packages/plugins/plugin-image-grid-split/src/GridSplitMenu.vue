<script setup lang="ts">
/**
 * GridSplitMenu —— 图片节点上控制栏里的“宫格切分”入口。
 *
 * 位置由 BaseNode 的上插槽定位层负责；本组件只画一个触发器 + 下拉面板。
 * 预设直接切分；“自定义”打开二级面板，悬停选择行列后点确定。
 *
 * 依赖边界：
 * - 设计系统件按名取（按钮 / 下拉），换主题不改代码；
 * - 图片地址解析只读 ImageContent 已有的同一口径（resourceId → resolve），不写回 data；
 * - 不 import @mini-canvas/ui 或主题包。
 */
import { computed, ref } from 'vue'
import { useCanvasRender, useSoleNodeSelected, useUiComponent } from '@mini-canvas/canvas-render'
import GridSizePicker from './GridSizePicker.vue'
import { GRID_PRESETS, presetGridSize, type GridSize } from './gridLogic'
import { readImageSourceFields } from '@mini-canvas/plugin-node-image/imageRefs'
import { openGridSession } from './session'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()
const { ctx } = useCanvasRender()
const selected = useSoleNodeSelected(props.id)
const ThemedButton = useUiComponent('button')
const ThemedDropdown = useUiComponent('dropdown')

const open = ref(false)
const customOpen = ref(false)
const customSize = ref<GridSize>({ rows: 3, cols: 3 })
const busy = ref(false)

const hasImage = computed(() => {
  const { resourceId, legacyUrl } = readImageSourceFields(props.data)
  return resourceId !== '' || legacyUrl !== ''
})

const ICON_GRID =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>'

async function sourceUrlOf(): Promise<{ url: string; width: number; height: number } | null> {
  const { resourceId, legacyUrl } = readImageSourceFields(props.data)
  const resources = ctx.tryGet<{ resolve(ref: string): Promise<string | undefined> } | undefined>('resources')
  let url = legacyUrl
  if (resourceId) {
    try {
      url = (await resources?.resolve(resourceId)) || legacyUrl
    } catch {
      url = legacyUrl
    }
  }
  if (!url) {
    notify('这张图没有地址，无法切分')
    return null
  }
  let width = typeof props.data.imageWidth === 'number' ? props.data.imageWidth : 0
  let height = typeof props.data.imageHeight === 'number' ? props.data.imageHeight : 0
  if (width <= 0 || height <= 0) {
    const measured = await measure(url)
    if (!measured) {
      notify('读取不到图片尺寸，无法切分')
      return null
    }
    width = measured.width
    height = measured.height
  }
  return { url, width, height }
}

function measure(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') return resolve(null)
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => resolve(null)
    img.src = url
  })
}

function notify(message: string, level: 'error' | 'info' = 'error'): void {
  const tip = ctx.tryGet<{ show?: (text: string) => void } | undefined>('tip')
  if (tip?.show) tip.show(message)
  else if (typeof console !== 'undefined') console.warn('[image-grid-split] ' + message)
  void level
}

async function enter(size: GridSize): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    const src = await sourceUrlOf()
    if (!src) return
    openGridSession({
      nodeId: props.id,
      imageUrl: src.url,
      width: src.width,
      height: src.height,
      size,
    })
    open.value = false
    customOpen.value = false
  } finally {
    busy.value = false
  }
}

function pickPreset(count: number): void {
  const size = presetGridSize(count)
  if (size) void enter(size)
}

function confirmCustom(value: GridSize): void {
  void enter(value)
}
</script>

<template>
  <div v-if="selected && hasImage" class="igsm-root ntp-root nodrag nopan" data-testid="image-grid-split-entry">
    <component :is="ThemedDropdown || 'div'" v-model="open" placement="bottom-start" :offset="8"
      menu-width="228px" body-class="igsm-menu-body" :teleport="true">
      <template #trigger>
        <component :is="ThemedButton || 'button'" class="igsm-trigger" type="button" title="宫格切分"
          aria-label="宫格切分" aria-haspopup="menu" :aria-expanded="open" :icon="ICON_GRID" :disabled="busy">
          宫格切分
        </component>
      </template>
      <template #default="{ close }">
        <div class="igsm-list" role="menu" aria-label="宫格切分">
          <button v-for="p in GRID_PRESETS" :key="p.count" class="igsm-row" type="button" role="menuitem"
            :disabled="busy" @click="pickPreset(p.count); close()">{{ p.label }}</button>
          <div class="igsm-sep" role="separator" />
          <button class="igsm-row igsm-row--sub" type="button" role="menuitem" :aria-expanded="customOpen"
            :aria-controls="'igsm-custom-' + id" @click="customOpen = !customOpen">
            <span>自定义</span>
            <svg class="igsm-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18" /></svg>
          </button>
          <div v-if="customOpen" :id="'igsm-custom-' + id" class="igsm-custom" @click.stop>
            <GridSizePicker v-model="customSize" :max="5" @confirm="confirmCustom" />
          </div>
        </div>
      </template>
    </component>
  </div>
</template>

<style scoped>
/* 容器 `.ntp-root` 是全局控制栏样式；这里只排内容，位置由 BaseNode 上插槽给 */
.igsm-root { padding: 3px; }
.igsm-trigger { white-space: nowrap; }
.igsm-list { display: flex; flex-direction: column; gap: 2px; }
.igsm-row { display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 32px; padding: 0 10px; border: 0; border-radius: var(--radius-badge, 6px); background: transparent; color: var(--ui-ink, #18202b); font-size: var(--text-base, 13px); text-align: left; cursor: pointer; }
.igsm-row:hover:not(:disabled), .igsm-row:focus-visible:not(:disabled) { background: var(--ui-hover, rgb(0 0 0 / 0.06)); }
.igsm-row:disabled { opacity: 0.55; cursor: default; }
.igsm-row--sub { font-weight: 500; }
.igsm-chev { width: 12px; height: 12px; color: var(--ui-ink-mute, #8c95a3); }
.igsm-sep { height: 1px; margin: 4px 6px; background: var(--ui-line, #e2e5ea); }
.igsm-custom { padding: 6px 4px 2px; border-top: 1px solid var(--ui-line-soft, #eef0f4); }
@media (prefers-reduced-motion: reduce) { .igsm-row { transition: none; } }
</style>
