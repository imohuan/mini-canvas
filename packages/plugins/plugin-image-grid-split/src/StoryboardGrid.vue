<script setup lang="ts">
/**
 * StoryboardGrid —— storyboard 节点的 content 组件：**槽位底板**。
 *
 * 用户口径 2026-10-30（带参考图）：分镜组是一个独立容器节点，图片是画布上**真正的节点**，
 * 拖进来后吸附到某个槽位；槽位里只是"空位提示"，不再由本组件画图。
 *
 * 所以这里只做两件事：
 *  1. 画 N×N 个槽位底板（空槽显示 +，有节点的槽显示一层淡色占位 + 高亮边）；
 *  2. 拖动经过时高亮目标槽，给"要落到这里"的预览感。
 *
 * 图片的显示/比例/居中由子节点自己负责（image 节点照常渲染）；
 * 本组件刻意 pointer-events: none —— 底板不吃事件，否则会把子节点的拖拽和点击全挡住。
 */
import { computed } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import { readStoryboard, slotRects } from './storyboard'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()
const { ctx } = useCanvasRender()

const board = computed(() => readStoryboard(props.data))

/** 卡片实测尺寸（拿不到就按节点注册的默认 480×360 兜底） */
const boardSize = computed(() => {
  const layout = ctx.tryGet<{ getNodeRect(id: string): { w: number; h: number } | null | undefined } | undefined>('nodeLayout')
  const rect = layout?.getNodeRect(props.id)
  const w = rect?.w && rect.w > 0 ? rect.w : 480
  const h = rect?.h && rect.h > 0 ? rect.h : 360
  return { w, h }
})

/** 槽位矩形（px → 百分比，随卡片缩放自动跟） */
const cells = computed(() => {
  const b = board.value
  if (!b) return []
  const { w, h } = boardSize.value
  return slotRects(w, h, b.rows, b.cols).map((r) => ({
    index: r.index,
    left: (r.x / w) * 100,
    top: (r.y / h) * 100,
    width: (r.w / w) * 100,
    height: (r.h / h) * 100,
    occupied: Boolean(b.slots[r.index]),
  }))
})
</script>

<template>
  <div v-if="board" class="sb-root" data-testid="storyboard-grid">
    <div
      v-for="cell in cells"
      :key="cell.index"
      class="sb-slot"
      :class="{ 'is-occupied': cell.occupied }"
      :style="{ left: cell.left + '%', top: cell.top + '%', width: cell.width + '%', height: cell.height + '%' }"
      :data-slot-index="cell.index"
    >
      <span v-if="!cell.occupied" class="sb-plus" aria-hidden="true">+</span>
    </div>
  </div>
</template>

<style scoped>
/* 底板本身不吃指针事件：子节点（真图片节点）在它上面，事件必须由子节点接住 */
.sb-root {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  border-radius: var(--radius-panel, 16px);
}

/* 空槽：虚线框 + 居中加号，提示"可以往这里放图" */
.sb-slot {
  position: absolute;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--ui-line, #e2e5ea);
  border-radius: var(--radius-badge, 6px);
  background: var(--ui-hover-soft, rgb(0 0 0 / 0.035));
}

/* 有节点的槽：不画虚线框（图片节点自己会盖住），只留一层极淡的底 */
.sb-slot.is-occupied {
  border-color: transparent;
  background: transparent;
}

.sb-plus {
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 20px;
  line-height: 1;
  user-select: none;
}
</style>
