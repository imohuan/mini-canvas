<script setup lang="ts">
/**
 * GridSizePicker —— 自定义行列选择面板（下拉里的二级内容）。
 *
 * 用户口径 2026-10-31：不要「确定」按钮，直接点网格就算确认。
 * 鼠标滑过网格时哪块亮哪块，行列跟随鼠标；点一下立即进入切分。
 * 滑出网格保持最后一次的行列（不闪空）。
 */
import { computed, ref } from 'vue'
import { pickerRowsColsAt } from './gridSplit'

const props = withDefaults(
  defineProps<{
    /** 初始行列（打开时回显上次的选择） */
    initialRows?: number
    initialCols?: number
    /** 子面板自动传入的上下文：点完网格后用它收起整个下拉 */
    panel?: { close?: () => void } | null
  }>(),
  { initialRows: 3, initialCols: 3, panel: null },
)

const emit = defineEmits<{
  (e: 'confirm', rows: number, cols: number): void
}>()

/** 网格最大 8×8（与 gridSplit.MAX_ROWS/COLS 同口径） */
const PREVIEW = 8

/**
 * 每格四周留出的空隙（占整个网格宽度的百分比）。
 * 用户口径 2026-10-31（参考图 2）：格子要一块一块分开，不能连成一片。
 * 8×8 下约 2.7px 的缝，面板变宽时按比例跟着变。
 */
const GAP = 0.8

const rows = ref(props.initialRows)
const cols = ref(props.initialCols)

const cells = computed(() => {
  const out: Array<{ index: number; left: number; top: number; width: number; height: number; on: boolean }> = []
  for (let r = 0; r < PREVIEW; r++) {
    for (let c = 0; c < PREVIEW; c++) {
      out.push({
        index: r * PREVIEW + c,
        left: c * (100 / PREVIEW) + GAP,
        top: r * (100 / PREVIEW) + GAP,
        width: 100 / PREVIEW - GAP * 2,
        height: 100 / PREVIEW - GAP * 2,
        on: r < rows.value && c < cols.value,
      })
    }
  }
  return out
})

/** 鼠标位置 → 行列（超出网格返回 null） */
function hitAt(ev: MouseEvent): { rows: number; cols: number } | null {
  const el = ev.currentTarget as HTMLElement | null
  if (!el) return null
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  return pickerRowsColsAt((ev.clientX - rect.left) / rect.width, (ev.clientY - rect.top) / rect.height, PREVIEW)
}

function onMove(ev: MouseEvent): void {
  const hit = hitAt(ev)
  if (!hit) return
  rows.value = hit.rows
  cols.value = hit.cols
}

/** 点一下网格 = 确认：按点击位置定行列，立即进入切分并收起下拉 */
function onPick(ev: MouseEvent): void {
  const hit = hitAt(ev)
  if (!hit) return
  rows.value = hit.rows
  cols.value = hit.cols
  emit('confirm', hit.rows, hit.cols)
  props.panel?.close?.()
}
</script>

<template>
  <div class="gsp-picker" data-testid="grid-size-picker">
    <div class="gsp-picker-head">
      <span class="gsp-picker-dim">{{ rows }} 行 × {{ cols }} 列</span>
      <span class="gsp-picker-tip">点格子即切分</span>
    </div>
    <div
      class="gsp-picker-grid"
      @pointermove="onMove"
      @click="onPick"
    >
      <div
        v-for="cell in cells"
        :key="cell.index"
        class="gsp-picker-cell"
        :class="{ 'is-on': cell.on }"
        :style="{ left: cell.left + '%', top: cell.top + '%', width: cell.width + '%', height: cell.height + '%' }"
      />
    </div>
  </div>
</template>

<style scoped>
.gsp-picker { display: flex; flex-direction: column; gap: 8px; padding: 4px; width: 180px; }
.gsp-picker-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.gsp-picker-dim { font-size: var(--text-base, 13px); font-weight: 600; color: var(--ui-ink, #18202b); }
.gsp-picker-tip { font-size: var(--text-xs, 11px); color: var(--ui-ink-mute, #8c95a3); white-space: nowrap; }
.gsp-picker-grid {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  background: var(--ui-hover-soft, rgb(0 0 0 / 0.035));
  border-radius: var(--radius-badge, 6px);
  padding: 1px;
  box-sizing: border-box;
  cursor: pointer;
}
.gsp-picker-cell {
  position: absolute;
  box-sizing: border-box;
  /* 未选中的格子也有自己的底色与圆角：缝里露出网格底色，才看得出一块一块 */
  border-radius: 4px;
  background: color-mix(in srgb, var(--ui-ink, #18202b) 7%, transparent);
  transition: background-color 0.1s ease, border-color 0.1s ease;
}
.gsp-picker-cell.is-on {
  background: color-mix(in srgb, var(--ui-accent, #0891b2) 20%, transparent);
  box-shadow: inset 0 0 0 1px var(--ui-accent, #0891b2);
}
</style>
