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
 * 层级约束（用户截图 2026-11-02）：分镜组的类型声明必须是 transparent: true。
 * 壳对普通类型给 z=node，比它在 VueFlow 里的子图（父 z + 1）**高**；一旦容器是实底卡片，
 * 子图就被整片盖住。声明 transparent 后壳把容器降到底板层（groupBase，低于连线），
 * 本组件自己铺白底 —— 空槽、图片、从外面接进来的连线才能同时看得见。
 *
 * 图片的显示/比例/居中由子节点自己负责（image 节点照常渲染）；
 * 本组件刻意 pointer-events: none —— 底板不吃事件，否则会把子节点的拖拽和点击全挡住。
 */
import { useCanvasRender } from '@plume-canvas/canvas-render'
import { computed, ref, watch } from 'vue'
import { readStoryboard, readStoryboardLayout, slotRects } from './storyboard'
import { storyboardHover } from './storyboardDrag'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()
const { ctx } = useCanvasRender()

const board = computed(() => readStoryboard(props.data))
/** 拖动悬停：本组某个槽获胜时高亮（用户口径：获胜交互类似 hover） */
const hoverState = storyboardHover()
const hoverSlot = ref(-1)
/** 拖的是非图片、且与本组交叉：只把背景标成“拒绝”，不高亮任何槽位 */
const invalidDrop = ref(false)
watch(
  () => [hoverState.boardId, hoverState.slotIndex, hoverState.invalid] as const,
  ([bid, idx, invalid]) => {
    const mine = bid === props.id
    invalidDrop.value = mine && invalid
    // 类型不合法时不做“下一步”的插槽高亮（用户口径 2026-11-02）。
    hoverSlot.value = mine && !invalid ? idx : -1
  },
  { immediate: true },
)

/** 卡片实测尺寸（拿不到就按节点注册的默认 480×360 兜底） */
const boardSize = computed(() => {
  const layout = ctx.tryGet<{ getNodeRect(id: string): { w: number; h: number } | null | undefined } | undefined>('view')
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
  <div v-if="board" class="sb-root" :class="{ 'is-invalid': invalidDrop }" data-testid="storyboard-grid">
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
   * 容器实底（用户口径 2026-10-31）：分镜组不是透明节点。
   *
   * 类型声明 transparent 只是让壳不铺卡片色、并把 z 降到 groupBase（低于连线），
   * 否则实底卡片（z=node）会盖住所有连线 —— 用户截图里"节点都在、线全没了"就是它。
   * 这一层画在 groupBase：连线在它上面（能看见），子图在子节点层（更上面，不被遮）。
   */
  background: var(--canvas-node-panel-surface, var(--ui-panel, #ffffff));
}

/*
 * 拒收态（用户口径 2026-11-02）：拖的节点类型不对、但已经压到本组。
 * 只把整块背景换成淡淡的危险色，告诉用户“这里会拒绝”，
 * 不点亮任何槽位 —— 类型检查没过，就不进入下一步的插槽高亮。
 */
.sb-root.is-invalid {
  background: color-mix(in srgb, var(--ui-danger, #ef4444) 10%, var(--canvas-node-panel-surface, var(--ui-panel, #ffffff)));
  box-shadow: inset 0 0 0 2px var(--ui-danger, #ef4444);
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
