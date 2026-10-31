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
import { useCanvasRender } from '@mini-canvas/canvas-render'
import { computed, ref, watch } from 'vue'
import { readStoryboard, readStoryboardLayout, slotRects } from './storyboard'
import { storyboardHover } from './storyboardDrag'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()
const { ctx } = useCanvasRender()

const board = computed(() => readStoryboard(props.data))
/** 拖动悬停：本组某个槽获胜时高亮（用户口径：获胜交互类似 hover） */
const hoverState = storyboardHover()
const hoverSlot = ref(-1)
watch(
  () => [hoverState.boardId, hoverState.slotIndex] as const,
  ([bid, idx]) => {
    hoverSlot.value = bid === props.id ? idx : -1
  },
  { immediate: true },
)

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
  const layout = readStoryboardLayout(ctx)
  return slotRects(w, h, b.rows, b.cols, layout).map((r) => ({
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
      :class="{ 'is-occupied': cell.occupied, 'is-hover': hoverSlot === cell.index }"
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
  /**
   * 容器实底（用户口径 2026-10-31）：分镜组不再是透明节点。
   *
   * 之前 transparent:true 让卡片表面透明，亮色主题下空槽直接透出画布点阵，
   * 看着像没加载完。这里铺一层跟随主题的面板色（亮色白、暗色深灰），
   * 子节点（图片）照常画在它上面 —— 视觉上和分组一样是"有底的容器"。
   */
  background: var(--ui-panel, #ffffff);
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

/* 拖动悬停：获胜槽位高亮（青描边 + 淡青底），与勾选层同一套强调色 */
.sb-slot.is-hover {
  border: 2px solid var(--ui-accent, #0891b2);
  border-radius: var(--radius-badge, 6px);
  background: color-mix(in srgb, var(--ui-accent, #0891b2) 16%, transparent);
}

.sb-plus {
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 20px;
  line-height: 1;
  user-select: none;
}
</style>
