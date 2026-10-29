<script setup lang="ts">
/**
 * StoryboardContent —— 分镜组节点的内容区。
 *
 * 视觉对齐用户截图 4：一张由固定槽位拼成的白底网格；空槽显示一个居中的“+”，
 * 有图的槽位显示图片缩略图；左上角显示“宫格分镜组（N 张）”标题。
 *
 * 数据：`slots` 数组（null = 空槽）；`resourceId` 只进 data，不写显示地址。
 * 图片地址在渲染时经 resources.resolve 现取（与 ImageContent 同一条口径）。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import type { DocService } from '@mini-canvas/canvas-data'
import { readStoryboardSlots, slotPosition, type StoryboardSlot } from './gridLogic'
import { geometryOf } from './storyboardOps'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()
const { ctx } = useCanvasRender()

const rows = computed(() => Math.max(1, Math.floor(typeof props.data.rows === 'number' ? props.data.rows : 3)))
const cols = computed(() => Math.max(1, Math.floor(typeof props.data.cols === 'number' ? props.data.cols : 3)))
const total = computed(() => rows.value * cols.value)
const slots = computed(() => readStoryboardSlots(props.data.slots, total.value))
const geo = computed(() => geometryOf(props.data))
const filledCount = computed(() => slots.value.filter(Boolean).length)

const gridStyle = computed(() => ({
  display: 'grid',
  gridTemplateColumns: `repeat(${cols.value}, ${geo.value.cellWidth}px)`,
  gridTemplateRows: `repeat(${rows.value}, ${geo.value.cellHeight}px)`,
  gap: `${geo.value.gap}px`,
  padding: `${geo.value.padding}px`,
}))

/** 槽位局部坐标（便于父组件拖动子图片；分镜组自身不动，子节点也要跟） */
function localOf(index: number): { x: number; y: number } {
  const c = Math.max(1, cols.value)
  const i = Math.max(0, Math.floor(index))
  const row = Math.floor(i / c)
  const col = i % c
  return {
    x: Math.round(geo.value.padding + col * (geo.value.cellWidth + geo.value.gap)),
    y: Math.round(geo.value.padding + row * (geo.value.cellHeight + geo.value.gap)),
  }
}

/** 资源解析结果缓存：避免每次重渲染都问资源服务；组件销毁时顺带清 */
const urlCache = ref(new Map<string, string>())
let resolveToken = 0
const pending = new Set<string>()

async function resolveUrl(resourceId: string): Promise<void> {
  if (!resourceId || pending.has(resourceId)) return
  const token = ++resolveToken
  pending.add(resourceId)
  try {
    const resources = ctx.tryGet<{ resolve(ref: string): Promise<string | undefined> } | undefined>('resources')
    const url = await resources?.resolve(resourceId)
    if (token !== resolveToken) return
    const next = new Map(urlCache.value)
    if (url) next.set(resourceId, url)
    urlCache.value = next
  } finally {
    pending.delete(resourceId)
  }
}

watch(() => slots.value.map((s) => s?.resourceId).filter(Boolean).join('|'), (ids) => {
  for (const id of ids.split('|').filter(Boolean)) void resolveUrl(id)
}, { immediate: true })

onBeforeUnmount(() => { resolveToken += 1 })

function urlOf(slot: StoryboardSlot | null): string {
  return slot?.resourceId ? (urlCache.value.get(slot.resourceId) ?? '') : ''
}

defineExpose({ slots, localOf })
</script>

<template>
  <div class="isb-root" data-testid="storyboard-content">
    <div class="isb-head">
      <span class="isb-title">宫格分镜组</span>
      <span class="isb-count">（{{ filledCount }} 张）</span>
    </div>
    <div class="isb-grid" :style="gridStyle" role="grid" :aria-label="`宫格分镜组 ${rows} 行 ${cols} 列`">
      <div v-for="(slot, i) in slots" :key="i" class="isb-cell" role="gridcell"
        :data-slot-index="i" :data-has-image="slot ? 'true' : 'false'">
        <img v-if="slot && urlOf(slot)" class="isb-img" :src="urlOf(slot)" :alt="slot.name || `槽位 ${i + 1}`" draggable="false" />
        <div v-else class="isb-empty" aria-hidden="true">+</div>
        <span class="isb-label" aria-hidden="true">{{ slotPosition(i, cols).row + 1 }}-{{ slotPosition(i, cols).col + 1 }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 分镜组自带浅底（与普通分组不同，用户明确要“另一种形式”）。
   颜色走 token；底色故意用 --ui-panel，让子图片贴边可见。 */
.isb-root { position: relative; width: 100%; height: 100%; box-sizing: border-box; overflow: hidden; background: var(--ui-panel, #fff); color: var(--ui-ink, #18202b); }
.isb-head { position: absolute; top: 4px; left: 12px; z-index: 2; display: flex; align-items: baseline; gap: 4px; pointer-events: none; }
.isb-title { font-size: var(--text-label, 12px); font-weight: 700; }
.isb-count { font-size: var(--text-sm, 11px); color: var(--ui-ink-mute, #8c95a3); }
.isb-grid { display: grid; box-sizing: border-box; }
.isb-cell { position: relative; display: flex; align-items: center; justify-content: center; border-radius: var(--radius-control, 8px); border: 1px solid var(--ui-line, #e2e5ea); background: var(--ui-panel-soft, #fff); overflow: hidden; }
.isb-cell[data-has-image='false']::after { content: ''; position: absolute; inset: 0; background: var(--fill-quiet, rgb(0 0 0 / 0.03)); }
.isb-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
.isb-empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--ui-ink-mute, #8c95a3); font-size: 18px; font-weight: 300; }
.isb-label { position: absolute; right: 6px; bottom: 4px; font-size: var(--text-xs, 10px); color: var(--ui-ink-mute, #8c95a3); opacity: 0; transition: opacity 120ms ease; }
.isb-cell:hover .isb-label { opacity: 1; }
@media (prefers-reduced-motion: reduce) { .isb-label { transition: none; } }
</style>
