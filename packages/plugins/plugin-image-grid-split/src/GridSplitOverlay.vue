<script setup lang="ts">
/**
 * GridSplitOverlay —— 切分模式的格子勾选覆盖层（叠在图片上的交互层）。
 *
 * 经 ctx.nodes.contribute('image', 'over:inset', …) 挂进图片节点的
 * over:inset 段（与裁剪/扩展浮层同一个分发容器 ImageOverlays），
 * 自身按「本节点是否在切分模式」显隐 —— 不动 image 插件任何文件。
 *
 * 交互（用户口径）：鼠标滑过哪格哪格高亮；点一下勾/取消该格；
 * 选中格画青色描边 + 微透明底，未选中格画细白线。事件不外漏（nodrag/nopan），
 * 避免拖格子把节点拖走。
 */
import { computed } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import { cellIndexAt } from './gridSplit'
import { setHoverCell, splitState, toggleCell } from './splitSession'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()
const { ctx } = useCanvasRender()

const state = computed(() => splitState(props.id))
const cells = computed(() => {
  const s = state.value
  if (!s) return []
  const w = 100 / s.cols
  const h = 100 / s.rows
  const out: Array<{ index: number; left: number; top: number; width: number; height: number; on: boolean }> = []
  for (let i = 0; i < s.rows * s.cols; i++) {
    const r = Math.floor(i / s.cols)
    const c = i % s.cols
    out.push({ index: i, left: c * w, top: r * h, width: w, height: h, on: s.selected.has(i) })
  }
  return out
})

/** 鼠标 → 归一化坐标（相对卡片内容区 0~1）→ 格子索引 */
function cellFromEvent(ev: PointerEvent | MouseEvent): number {
  const el = ev.currentTarget as HTMLElement | null
  if (!el) return -1
  const r = el.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return -1
  return cellIndexAt(state.value?.rows ?? 0, state.value?.cols ?? 0, (ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height)
}

function onMove(ev: MouseEvent): void {
  setHoverCell(props.id, cellFromEvent(ev))
}

function onLeave(): void {
  setHoverCell(props.id, -1)
}

function onClick(ev: MouseEvent): void {
  const idx = cellFromEvent(ev)
  if (idx >= 0) toggleCell(props.id, idx)
}
</script>

<template>
  <div
    v-if="state"
    class="gso-root nodrag nopan"
    data-testid="grid-split-overlay"
    @pointermove="onMove"
    @pointerleave="onLeave"
    @click="onClick"
  >
    <div
      v-for="cell in cells"
      :key="cell.index"
      class="gso-cell"
      :class="{ 'is-on': cell.on, 'is-hover': state.hover === cell.index }"
      :style="{ left: cell.left + '%', top: cell.top + '%', width: cell.width + '%', height: cell.height + '%' }"
    />
  </div>
</template>

<style scoped>
/* 铺满卡片内容区；事件收在这层，格子只读会话状态（不改 data、不进撤销栈） */
.gso-root {
  position: absolute;
  inset: 0;
  pointer-events: auto;
  overflow: hidden;
  cursor: pointer;
}
/* 未选中格：细白线分隔，不挡图 */
.gso-cell {
  position: absolute;
  box-sizing: border-box;
  border: 1px solid rgb(255 255 255 / 0.55);
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.12);
  transition: background-color 0.12s ease, border-color 0.12s ease;
}
/* 悬停：淡青底（跟随鼠标的行/列反馈） */
.gso-cell.is-hover {
  background: color-mix(in srgb, var(--ui-accent, #0891b2) 22%, transparent);
  border-color: var(--ui-accent, #0891b2);
}
/* 选中：青描边 + 微透明底 */
.gso-cell.is-on {
  border-color: var(--ui-accent, #0891b2);
  box-shadow: inset 0 0 0 1px var(--ui-accent, #0891b2);
  background: color-mix(in srgb, var(--ui-accent, #0891b2) 14%, transparent);
}
/* 悬停 + 选中叠上时加深一档，让"当前格"清楚 */
.gso-cell.is-on.is-hover {
  background: color-mix(in srgb, var(--ui-accent, #0891b2) 30%, transparent);
}
</style>
