<script setup lang="ts">
/**
 * StoryboardGrid —— storyboard 节点的 content 组件（随本插件包发布）。
 *
 * 职责：画 rows×cols 槽位网格；每格显示图或"+"；格子间拖拽交换图片。
 * 空格显示"+"（视觉提示可放图）；有图格显示小图。写库经 doc.updateNode（进历史）。
 *
 * 拖拽语义（简化版）：按下有图格 → 移到另一格松开 → 两格交换（含空格）。
 * 不做跨节点拖拽（那是完整版分镜组的事，当前版本只在组内换）。
 */
import { computed, onBeforeUnmount, reactive, watch } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import { readStoryboard, swapSlots } from './storyboard'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()
const { ctx } = useCanvasRender()

const board = computed(() => readStoryboard(props.data))
/** 拖拽中的源格子索引（-1 = 没在拖） */
const dragFrom = ref(-1)
/** 悬停目标格子（-1 = 无） */
const hoverTarget = ref(-1)

interface CellView {
  index: number
  left: number
  top: number
  width: number
  height: number
  ref: string | null
}

const cells = computed<CellView[]>(() => {
  const b = board.value
  if (!b) return []
  const out: CellView[] = []
  for (let i = 0; i < b.rows * b.cols; i++) {
    const r = Math.floor(i / b.cols)
    const c = i % b.cols
    out.push({
      index: i,
      left: c * (100 / b.cols),
      top: r * (100 / b.rows),
      width: 100 / b.cols,
      height: 100 / b.rows,
      ref: b.slots[i] ?? null,
    })
  }
  return out
})

function cellFromEvent(ev: PointerEvent | MouseEvent): number {
  const el = ev.currentTarget as HTMLElement | null
  if (!el) return -1
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return -1
  const b = board.value
  if (!b) return -1
  const nx = (ev.clientX - rect.left) / rect.width
  const ny = (ev.clientY - rect.top) / rect.height
  if (nx < 0 || nx >= 1 || ny < 0 || ny >= 1) return -1
  const c = Math.min(b.cols - 1, Math.floor(nx * b.cols))
  const r = Math.min(b.rows - 1, Math.floor(ny * b.rows))
  return r * b.cols + c
}

function onCellPointerDown(index: number): void {
  if (board.value?.slots[index]) dragFrom.value = index
}

function onCellPointerEnter(index: number): void {
  if (dragFrom.value >= 0) hoverTarget.value = index
}

function onCellPointerUp(index: number): void {
  const from = dragFrom.value
  dragFrom.value = -1
  hoverTarget.value = -1
  if (from < 0 || from === index) return
  const b = board.value
  if (!b) return
  const nextSlots = swapSlots(b, from, index)
  if (nextSlots === b.slots) return
  // data 合并写：只写 slots（进历史；与裁剪同一条 updateNodeData 路）
  const doc = ctx.tryGet<{ updateNodeData?(id: string, data: Record<string, unknown>): void }>('doc')
  doc?.updateNodeData?.(props.id, { slots: nextSlots })
}

/** 资源服务里本组件用到的最小形状（与 ImageContent 的 resolveImageSrc 同一条路） */
interface ResourcePortLike {
  resolve(ref: string): Promise<string | undefined>
}

/** 槽位引用 → 可显示地址（解析完成后替换；resolve 不可用时回落引用本身） */
const resolvedUrls = reactive(new Map<string, string>())
/** 作废标记：快速换槽位时，先发的 resolve 不许覆盖后发的 */
let resolveToken = 0

async function refreshResolvedUrls(): Promise<void> {
  const token = ++resolveToken
  const slots = board.value?.slots ?? []
  const current = new Set(slots.filter((s): s is string => Boolean(s)))
  // 槽位里已不存在的旧解析结果顺手清掉（换图/换格后 Map 不无限增长）
  for (const key of resolvedUrls.keys()) if (!current.has(key)) resolvedUrls.delete(key)
  const resources = ctx.tryGet<ResourcePortLike | undefined>('resources')
  for (const ref of current) {
    if (resolvedUrls.has(ref)) continue
    let url = ref
    if (resources && typeof resources.resolve === 'function') {
      try {
        url = (await resources.resolve(ref)) || ref
      } catch {
        url = ref // 解析失败按“取不到”处理：先显示引用兜底，不渲染失败
      }
    }
    if (token !== resolveToken) return
    resolvedUrls.set(ref, url)
  }
}

watch(
  () => board.value?.slots,
  () => {
    void refreshResolvedUrls()
  },
  { immediate: true, deep: true },
)
onBeforeUnmount(() => {
  resolveToken++
})

/** 每格显示地址：优先 resolve 出来的可显示地址；解析没回来时回落引用本身（与旧渲染一致） */
function slotSrc(ref: string | null): string {
  if (!ref) return ''
  return resolvedUrls.get(ref) ?? ref
}
</script>

<template>
  <div
    v-if="board"
    class="sb-root nodrag nopan"
    data-testid="storyboard-grid"
    nodrag=""
    nopan=""
    @pointerup="onCellPointerUp(cellFromEvent($event))"
  >
    <div
      v-for="cell in cells"
      :key="cell.index"
      class="sb-cell"
      :class="{ 'is-target': dragFrom >= 0 && hoverTarget === cell.index }"
      :style="{ left: cell.left + '%', top: cell.top + '%', width: cell.width + '%', height: cell.height + '%' }"
      @pointerdown="onCellPointerDown(cell.index)"
      @pointerenter="onCellPointerEnter(cell.index)"
    >
      <img v-if="cell.ref" class="sb-img" :src="slotSrc(cell.ref)" alt="" draggable="false" />
      <span v-else class="sb-plus" aria-hidden="true">+</span>
    </div>
  </div>
</template>

<style scoped>
.sb-root {
  position: relative;
  width: 100%;
  height: 100%;
  background: var(--ui-panel-soft, #fff);
  overflow: hidden;
}
.sb-cell {
  position: absolute;
  box-sizing: border-box;
  border: 1px solid var(--ui-line, #e2e5ea);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  cursor: grab;
  transition: border-color 0.12s ease;
}
.sb-cell.is-target {
  border-color: var(--ui-accent, #0891b2);
  background: color-mix(in srgb, var(--ui-accent, #0891b2) 10%, transparent);
}
.sb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
  user-select: none;
}
.sb-plus {
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 22px;
  pointer-events: none;
}
</style>
