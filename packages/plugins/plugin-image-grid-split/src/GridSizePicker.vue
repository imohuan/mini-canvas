<script setup lang="ts">
/**
 * GridSizePicker —— 自定义行列选择面板（下拉里的二级内容）。
 *
 * 用户口径：鼠标滑过网格时哪块亮哪块，行列跟随鼠标；顶部显示当前行列；
 * 点「确定」进入切分。滑出网格保持最后一次的行列（不闪空）。
 */
import { computed, ref } from 'vue'
import { cellIndexAt } from './gridSplit'

const props = withDefaults(
  defineProps<{
    /** 初始行列（打开时回显上次的选择） */
    initialRows?: number
    initialCols?: number
  }>(),
  { initialRows: 3, initialCols: 3 },
)

const emit = defineEmits<{
  (e: 'confirm', rows: number, cols: number): void
}>()

/** 网格最大 8×8（与 gridSplit.MAX_ROWS/COLS 同口径；这里写死渲染上限） */
const PREVIEW = 8

const rows = ref(props.initialRows)
const cols = ref(props.initialCols)

const cells = computed(() => {
  const out: Array<{ index: number; left: number; top: number; width: number; height: number; on: boolean }> = []
  for (let r = 0; r < PREVIEW; r++) {
    for (let c = 0; c < PREVIEW; c++) {
      out.push({
        index: r * PREVIEW + c,
        left: c * (100 / PREVIEW),
        top: r * (100 / PREVIEW),
        width: 100 / PREVIEW,
        height: 100 / PREVIEW,
        on: r < rows.value && c < cols.value,
      })
    }
  }
  return out
})

function onMove(ev: MouseEvent): void {
  const el = ev.currentTarget as HTMLElement | null
  if (!el) return
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  const idx = cellIndexAt(PREVIEW, PREVIEW, (ev.clientX - rect.left) / rect.width, (ev.clientY - rect.top) / rect.height)
  if (idx < 0) return
  rows.value = Math.floor(idx / PREVIEW) + 1
  cols.value = (idx % PREVIEW) + 1
}

/** 点一下网格只"定住"当前行列（与悬停同值），真正的进入靠下方「确定」按钮 */
function onPick(ev: MouseEvent): void {
  onMove(ev)
}

function confirm(): void {
  emit('confirm', rows.value, cols.value)
}
</script>

<template>
  <div class="gsp-picker" data-testid="grid-size-picker">
    <div class="gsp-picker-head">
      <span class="gsp-picker-dim">{{ rows }} 行 × {{ cols }} 列</span>
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
    <button type="button" class="gsp-picker-confirm" @click.stop="confirm">确定</button>
  </div>
</template>

<style scoped>
.gsp-picker { display: flex; flex-direction: column; gap: 8px; padding: 4px; width: 180px; }
.gsp-picker-head { display: flex; align-items: center; }
.gsp-picker-dim { font-size: var(--text-base, 13px); font-weight: 600; color: var(--ui-ink, #18202b); }
.gsp-picker-grid {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  background: var(--ui-hover-soft, rgb(0 0 0 / 0.035));
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: var(--radius-badge, 6px);
  overflow: hidden;
  cursor: pointer;
}
.gsp-picker-cell {
  position: absolute;
  box-sizing: border-box;
  border: 1px solid var(--ui-line, #e2e5ea);
  background: transparent;
  transition: background-color 0.1s ease;
}
.gsp-picker-cell.is-on {
  background: color-mix(in srgb, var(--ui-accent, #0891b2) 20%, transparent);
  border-color: var(--ui-accent, #0891b2);
}
.gsp-picker-confirm {
  padding: 6px 0;
  border: 0;
  border-radius: var(--radius-badge, 6px);
  background: var(--ui-primary-bg, #1f2937);
  color: var(--ui-primary-ink, #fff);
  font-size: var(--text-base, 13px);
  cursor: pointer;
}
.gsp-picker-confirm:hover { background: var(--ui-primary-bg-hover, #111827); }
</style>
