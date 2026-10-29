<script setup lang="ts">
/**
 * GridSizePicker —— 自定义行列的悬停选择器。
 *
 * 用户要求：二级菜单里鼠标滑到哪一格，左上角到这一格的区域就染色，
 * 顶部实时显示“4×3”；点“确定”选区进入全屏宫格工作台。
 *
 * 命中判定用 pointer 的格子下标（按 10×10 固定网格），拖动预览不改行列上限，
 * 上限与“宫格切分”预设一致（最多 5×5），超过 5 行的按钮保持可见但不可选。
 */
import { computed, ref, watch } from 'vue'
import { GRID_CUSTOM_MAX } from './gridLogic'

const props = withDefaults(
  defineProps<{
    modelValue?: { rows: number; cols: number }
    /** 最多行列；宫格菜单显示 5×5，内部允许到 10 但这里限制 5 更符合截图 */
    max?: number
    /** 是否渲染“自定义”标题与确定按钮（工作台内的面板不需要） */
    chrome?: boolean
  }>(),
  { modelValue: () => ({ rows: 3, cols: 3 }), max: 5, chrome: true },
)

const emit = defineEmits<{
  'update:modelValue': [value: { rows: number; cols: number }]
  confirm: [value: { rows: number; cols: number }]
}>()

const max = computed(() => Math.min(props.max, GRID_CUSTOM_MAX))
const hover = ref<{ rows: number; cols: number } | null>(null)
const current = computed(() => hover.value ?? props.modelValue)
const cells = computed(() => Array.from({ length: max.value * max.value }, (_, i) => ({
  rows: Math.floor(i / max.value) + 1,
  cols: (i % max.value) + 1,
})))

function onEnter(row: number, col: number): void {
  hover.value = { rows: row + 1, cols: col + 1 }
  emit('update:modelValue', hover.value)
}

function isLit(row: number, col: number): boolean {
  return row < current.value.rows && col < current.value.cols
}

function confirm(): void {
  const value = { ...current.value }
  emit('confirm', value)
}

// 外部换值（如另一处选择预设）时重置悬停预览，避免显示上一次的行列
watch(() => [props.modelValue.rows, props.modelValue.cols], () => { hover.value = null })
</script>

<template>
  <div class="igsp-root" data-testid="grid-size-picker">
    <div v-if="chrome" class="igsp-head">
      <span class="igsp-title">自定义宫格</span>
      <span class="igsp-size" aria-live="polite">{{ current.rows }}×{{ current.cols }}</span>
    </div>
    <div class="igsp-grid" :style="{ gridTemplateColumns: `repeat(${max}, 1fr)` }" role="grid"
      :aria-label="`宫格行列，最多 ${max} 行 ${max} 列`" @mouseleave="hover = null">
      <button v-for="(cell, i) in cells" :key="i" class="igsp-cell" type="button" role="gridcell"
        :class="{ 'is-lit': isLit(cell.rows - 1, cell.cols - 1), 'is-current': current.rows === cell.rows && current.cols === cell.cols }"
        :aria-label="`${cell.rows} 行 ${cell.cols} 列`" :aria-selected="current.rows === cell.rows && current.cols === cell.cols"
        @mouseenter="onEnter(cell.rows - 1, cell.cols - 1)" @focus="onEnter(cell.rows - 1, cell.cols - 1)"
        @click="onEnter(cell.rows - 1, cell.cols - 1)" />
    </div>
    <div v-if="chrome" class="igsp-foot">
      <span class="igsp-hint">滑动选择，点击确定</span>
      <button type="button" class="igsp-confirm" @click="confirm">确定</button>
    </div>
  </div>
</template>

<style scoped>
/* 颜色全走宿主 token（插件不得自造主题色）；尺寸对齐 docs/design/ui-style-guide.md 的 6/8/10/12 阶 */
.igsp-root { display: flex; flex-direction: column; gap: 8px; min-width: 172px; }
.igsp-head, .igsp-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.igsp-title { font-size: var(--text-label, 12px); font-weight: 700; color: var(--ui-ink, #18202b); }
.igsp-size { font-size: var(--text-xs, 10px); font-weight: 700; color: var(--ui-ink-dim, #6b7280); font-variant-numeric: tabular-nums; }
.igsp-grid { display: grid; gap: 3px; padding: 4px; border-radius: var(--radius-control, 8px); background: var(--fill-quiet, rgb(0 0 0 / 0.03)); }
.igsp-cell { width: 26px; height: 22px; padding: 0; border: 1px solid var(--ui-line, #e2e5ea); border-radius: 4px; background: var(--ui-panel-soft, #fff); color: inherit; cursor: pointer; transition: background-color 120ms ease, border-color 120ms ease; }
.igsp-cell:hover { border-color: var(--ui-accent, #0891b2); }
.igsp-cell.is-lit { background: color-mix(in srgb, var(--ui-accent, #0891b2) 55%, var(--ui-panel, #fff)); border-color: color-mix(in srgb, var(--ui-accent, #0891b2) 70%, var(--ui-line, #e2e5ea)); }
.igsp-cell.is-current { border-color: var(--ui-accent-hover, #0e7490); box-shadow: 0 0 0 1px var(--ui-accent-hover, #0e7490); }
.igsp-cell:focus-visible { outline: 2px solid var(--ntb-accent-ring, rgb(8 145 178 / 0.6)); outline-offset: 1px; }
.igsp-hint { font-size: var(--text-sm, 11px); color: var(--ui-ink-mute, #8c95a3); }
.igsp-confirm { height: 24px; padding: 0 10px; border: 0; border-radius: var(--radius-badge, 6px); background: var(--ui-primary-bg, #1f2937); color: var(--ui-primary-ink, #fff); font-size: var(--text-label, 12px); font-weight: 600; cursor: pointer; }
.igsp-confirm:hover { background: var(--ui-primary-bg-hover, #111827); }
.igsp-confirm:focus-visible { outline: 2px solid var(--ntb-accent-ring, rgb(8 145 178 / 0.6)); outline-offset: 1px; }
@media (prefers-reduced-motion: reduce) { .igsp-cell { transition: none; } }
</style>
