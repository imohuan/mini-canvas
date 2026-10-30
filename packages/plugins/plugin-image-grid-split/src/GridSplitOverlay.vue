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
import { readStoryboardLayout, slotIndexAt, slotRects } from './storyboard'
import { setHoverCell, splitState, toggleCell } from './splitSession'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()
const { ctx } = useCanvasRender()

const state = computed(() => splitState(props.id))
const cells = computed(() => {
  const s = state.value
  if (!s) return []
  // 格子几何 = 分镜组同一套 slotRects（圆角卡片 + 间隔），按节点实测尺寸转百分比
  const rect = ctx.tryGet<{ getNodeRect(id: string): { w: number; h: number } | null | undefined } | undefined>('nodeLayout')?.getNodeRect(props.id)
  const boardW = rect?.w && rect.w > 0 ? rect.w : 480
  const boardH = rect?.h && rect.h > 0 ? rect.h : 360
  const layout = readStoryboardLayout(ctx)
  const rects = slotRects(boardW, boardH, s.rows, s.cols, { ...layout, topPadding: 0, padding: 4, rowGap: 3, colGap: 3 })
  const out: Array<{ index: number; left: number; top: number; width: number; height: number; on: boolean }> = []
  for (const r of rects) {
    out.push({
      index: r.index,
      left: (r.x / boardW) * 100,
      top: (r.y / boardH) * 100,
      width: (r.w / boardW) * 100,
      height: (r.h / boardH) * 100,
      on: s.selected.has(r.index),
    })
  }
  return out
})

/** 鼠标 → 归一化坐标（相对卡片内容区 0~1）→ 格子索引 */
function cellFromEvent(ev: PointerEvent | MouseEvent): number {
  const el = ev.currentTarget as HTMLElement | null
  if (!el) return -1
  const r = el.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return -1
  const s = state.value
  if (!s) return -1
  const layout = readStoryboardLayout(ctx)
  const rects = slotRects(r.width, r.height, s.rows, s.cols, { ...layout, topPadding: 0, padding: 4, rowGap: 3, colGap: 3 })
  return slotIndexAt(rects, ev.clientX - r.left, ev.clientY - r.top)
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
    >
      <span v-if="state.hover === cell.index" class="gso-hint">
        {{ cell.on ? '取消选择' : '选择' }}
      </span>
    </div>
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
/* 未选中格：独立圆角卡片（参考图 1 左侧）：浅灰底 + 细边，之间有间隔 */
.gso-cell {
  position: absolute;
  box-sizing: border-box;
  border: 1px solid color-mix(in srgb, var(--ui-overlay-solid, #fff) 62%, transparent);
  border-radius: var(--radius-badge, 6px);
  background: color-mix(in srgb, var(--ui-overlay-solid, #fff) 14%, transparent);
  transition: background-color 0.12s ease, border-color 0.12s ease;
}
/* 勾选角标（参考图 1：左上角小方框 + √） */
.gso-cell::before {
  content: '';
  position: absolute;
  top: 6px;
  left: 6px;
  width: 18px;
  height: 18px;
  border-radius: var(--radius-badge, 6px);
  background: color-mix(in srgb, var(--ui-overlay-solid, #fff) 82%, transparent);
  border: 1px solid var(--ui-line, #e2e5ea);
  box-sizing: border-box;
}
.gso-cell::after {
  content: '';
  position: absolute;
  top: 11px;
  left: 11px;
  width: 8px;
  height: 5px;
  border-left: 2px solid var(--ui-accent, #0891b2);
  border-bottom: 2px solid var(--ui-accent, #0891b2);
  transform: rotate(-45deg) scale(0.6);
  opacity: 0;
  transition: opacity 0.1s ease, transform 0.1s ease;
}
.gso-cell.is-on::after {
  opacity: 1;
  transform: rotate(-45deg) scale(1);
}
/* 悬停：淡青底 */
.gso-cell.is-hover {
  background: color-mix(in srgb, var(--ui-accent, #0891b2) 22%, transparent);
  border-color: var(--ui-accent, #0891b2);
}
/* 选中：整格淡青 + 青描边（比未选中格更明显） */
.gso-cell.is-on {
  border-color: var(--ui-accent, #0891b2);
  background: color-mix(in srgb, var(--ui-accent, #0891b2) 14%, transparent);
}
.gso-cell.is-on.is-hover {
  background: color-mix(in srgb, var(--ui-accent, #0891b2) 30%, transparent);
}
/* 悬停提示（用户口径 2026-10-30：格子中央显示"选择 / 取消选择"胶囊）：
   真实子元素（::after 已被勾选角标占用）：只在悬停格渲染（Vue 侧 state.hover 判断）。 */
/* 胶囊本体（居中、小字、深底白字） */
.gso-hint {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  padding: 3px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-overlay-solid, #111827) 82%, transparent);
  color: var(--ui-overlay-ink, #fff);
  font-size: var(--text-xs, 12px);
  line-height: 1.4;
  white-space: nowrap;
  pointer-events: none;
  z-index: 1;
}
</style>
