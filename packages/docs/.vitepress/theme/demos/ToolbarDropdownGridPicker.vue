<script setup lang="ts">
/**
 * 文档演示用的极简宫格选择器：只选行列，不碰画布业务。
 *
 * 交互与真实插件一致：鼠标滑过预览行列，**点一下就确认**（没有确定按钮）。
 *
 * 为什么单独一个 .vue：`panel.render` 生成的节点带着子面板的 scope id，
 * 演示文件里的 scoped 样式管不到它们（格子会「看不见」）。写成组件就各管各的样式。
 */
import { computed, ref } from 'vue'
import type { ToolbarMenuPanelContext } from '@mini-canvas/plugin-theme-default'

const props = withDefaults(defineProps<{
  initialRows?: number
  initialCols?: number
  /** 子面板自动传进来的上下文（可选消费） */
  panel?: ToolbarMenuPanelContext | null
}>(), { initialRows: 3, initialCols: 3, panel: null })

const emit = defineEmits<{
  (e: 'confirm', rows: number, cols: number): void
}>()

const rows = ref(props.initialRows)
const cols = ref(props.initialCols)

const cells = computed(() => {
  const out: boolean[] = []
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) out.push(r < rows.value && c < cols.value)
  }
  return out
})

function onMove(ev: PointerEvent): void {
  const el = ev.currentTarget as HTMLElement | null
  if (!el) return
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  cols.value = Math.min(8, Math.max(1, Math.floor(((ev.clientX - rect.left) / rect.width) * 8) + 1))
  rows.value = Math.min(8, Math.max(1, Math.floor(((ev.clientY - rect.top) / rect.height) * 8) + 1))
}

/** 点一下网格 = 确认：发选择、收起下拉（点空白处不算） */
function onGridClick(ev: MouseEvent): void {
  const el = ev.currentTarget as HTMLElement | null
  if (!el) return
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  onMove(ev)
  emit('confirm', rows.value, cols.value)
  // 组件写法拿关闭能力：子面板会把上下文作为 panel prop 传进来
  props.panel?.close()
}
</script>

<template>
  <div class="tdg-picker">
    <div class="tdg-head">{{ rows }} 行 × {{ cols }} 列</div>
    <div class="tdg-grid" @pointermove="onMove" @click="onGridClick">
      <span v-for="(on, i) in cells" :key="i" class="tdg-cell" :class="{ 'is-on': on }" />
    </div>
  </div>
</template>

<style scoped>
.tdg-picker { display: flex; flex-direction: column; gap: 8px; }
.tdg-head { font-size: var(--text-label, 12px); font-weight: 700; color: var(--text-strong, #111827); }
.tdg-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 2px; aspect-ratio: 1; cursor: pointer; }
.tdg-cell { border: 1px solid var(--line-hair, rgb(0 0 0 / 0.08)); border-radius: 3px; background: var(--fill-quiet, rgb(0 0 0 / 0.03)); }
.tdg-cell.is-on { background: rgb(8 145 178 / 0.2); border-color: #0891b2; }
</style>
