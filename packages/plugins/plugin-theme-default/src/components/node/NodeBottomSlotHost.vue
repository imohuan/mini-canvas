<script setup lang="ts">
/**
 * NodeBottomSlotHost —— 节点**下**状态栏的槽位宿主（主题件，注册在画布 overlay 槽）。
 *
 * 职责只有两件：**摆位置**（贴卡片下缘 + 居中 + 跟随拖动/缩放）和**判显隐**（恰好单选 + 壳的压制条件）。
 * 内容交给 nodeToolbar 服务的解析结果 —— 默认底栏、裁剪面板、任何功能面板都从这**同一个**宿主出来，
 * 所以任何时刻下栏只有一个，不会出现两套叠在一起。
 *
 * 为什么不像上栏那样直接挂 out:bottom 锚点：锚点住在画布层的 `overflow:hidden` 容器里
 * （CanvasSurface 的 .csurface-node-toolbar-layer），卡片贴近视口下缘时下栏会被裁掉。
 * 实测结论（2026-09-29 起沿用）：Teleport 到 body + 屏幕坐标 fixed 才能完整显示。
 * 于是「上栏走锚点、下栏走画布级宿主」是**有意的不对称**，两边各自只有一个入口。
 */
defineOptions({ inheritAttrs: false })
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Component } from 'vue'
import { useCanvasRender, useToolbarOffsets, RenderEvents } from '@mini-canvas/canvas-render'
import type { DocService } from '@mini-canvas/canvas-data'
import { NodeToolbarService } from './nodeToolbarService'
import { resolveBottomSlotSuppressed } from './nodeBottomSlot'

const { ctx, flow, interaction } = useCanvasRender()
const viewport = flow.viewport
const offsets = useToolbarOffsets()

const selectedId = ref<string | null>(null)
const selectedCount = ref(0)
const nodeType = ref<string | undefined>(undefined)
const nodeData = ref<Record<string, unknown>>({})

function syncNode(): void {
  const id = selectedId.value
  if (!id) {
    nodeType.value = undefined
    nodeData.value = {}
    return
  }
  const node = ctx.tryGet<DocService>('doc')?.getNode(id)
  nodeType.value = node?.type
  nodeData.value = (node?.data ?? {}) as Record<string, unknown>
}

function syncSelection(): void {
  const sel = ctx.tryGet('selection')
  const ids = sel ? [...sel.ids] : []
  selectedCount.value = ids.length
  selectedId.value = ids.length === 1 ? ids[0] : null
}

syncSelection()
syncNode()

const offs: Array<{ dispose(): void }> = []
const sel = ctx.tryGet<{ onChange(cb: () => void): () => void }>('selection')
if (sel && typeof sel.onChange === 'function') {
  const f = sel.onChange(() => {
    syncSelection()
    syncNode()
  })
  offs.push({ dispose: f })
}
const docSub = ctx
  .tryGet<{ subscribe(cb: (change: unknown) => void): () => void }>('doc')
  ?.subscribe(() => syncNode())
if (docSub) offs.push({ dispose: docSub })

/** 抓手工具 = nodesDraggable=false（与 BaseNode 同源同键） */
const nodesDraggable = ref(true)
const settingsSvc = ctx.tryGet<{
  get(key: string): unknown
  onChange(cb: (key: string, value: unknown) => void): { dispose(): void }
}>('settings')
if (settingsSvc && typeof settingsSvc.get === 'function') {
  nodesDraggable.value = settingsSvc.get('nodesDraggable') !== false
  const off = settingsSvc.onChange((key, value) => {
    if (key === 'nodesDraggable') nodesDraggable.value = value !== false
  })
  offs.push({ dispose: () => off.dispose() })
}
const handTool = computed(() => nodesDraggable.value === false)

const suppressed = computed(() =>
  resolveBottomSlotSuppressed({
    selecting: interaction?.isSelecting?.value === true,
    selectedCount: selectedCount.value,
    selectedId: selectedId.value,
    resizingId: interaction?.nodeResizeId?.value ?? null,
    nodeDragging: interaction?.isNodeDragging?.value === true,
    handTool: handTool.value,
  }),
)

// —— 卡片屏幕矩形：实时量卡片 DOM（拖动中逐帧反映，无需位移增量） ——
const rect = ref<{ x: number; y: number; w: number; h: number } | null>(null)
/** 只在数值真变了才写 ref —— rAF 每帧调用，不能每帧都造新对象触发重渲染 */
function commit(next: { x: number; y: number; w: number; h: number } | null): void {
  const cur = rect.value
  if (cur === next) return
  if (cur && next && cur.x === next.x && cur.y === next.y && cur.w === next.w && cur.h === next.h) return
  rect.value = next
}
function measure(): void {
  const id = selectedId.value
  if (!id) {
    commit(null)
    return
  }
  const nodeEl = flow.queryNodeEl(id)
  const cardEl = (nodeEl?.querySelector('.v2-card') as HTMLElement | null) ?? nodeEl
  if (!cardEl) {
    commit(null)
    return
  }
  const b = cardEl.getBoundingClientRect()
  commit(b.width > 0 && b.height > 0 ? { x: b.left, y: b.top, w: b.width, h: b.height } : null)
}

watch([viewport, selectedId, nodeData], measure, { deep: false })
offs.push(
  ctx.on(RenderEvents.NodeDragStart, measure),
  ctx.on(RenderEvents.NodeDrag, measure),
  ctx.on(RenderEvents.NodeDragEnd, measure),
)

let rafId = 0
function loop(): void {
  measure()
  rafId = requestAnimationFrame(loop)
}
onMounted(() => {
  window.addEventListener('resize', measure)
  measure()
  rafId = requestAnimationFrame(loop)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', measure)
  if (rafId) cancelAnimationFrame(rafId)
  for (const d of offs) d.dispose()
})

const wrapStyle = computed<Record<string, string> | null>(() => {
  const r = rect.value
  if (!r) return null
  const zoom = viewport.value.zoom || 1
  return {
    position: 'fixed',
    left: r.x + r.w / 2 + 'px',
    top: r.y + r.h + offsets.value.bottom * zoom + 'px',
    transform: 'translateX(-50%)',
  }
})

const svc = ctx.tryGet<NodeToolbarService | undefined>('nodeToolbar')
/** 解析下栏内容：组件 / 不显示 / 没注册 */
const bar = computed(() =>
  svc ? svc.resolveBar(selectedId.value ?? '', 'bottom', nodeType.value) : ({ kind: 'inherit' } as const),
)
const BarComponent = computed(() => (bar.value.kind === 'component' ? (bar.value.component as Component) : null))

/** 显示条件：单选 + 量到矩形 + 未被压制 + 这一格确实有内容 */
const visible = computed(
  () => !!selectedId.value && !!rect.value && !suppressed.value && bar.value.kind === 'component',
)
</script>

<template>
  <Teleport to="body">
    <div v-if="visible && wrapStyle" class="nbs-host nodrag nopan" :style="wrapStyle" data-testid="node-bottom-bar-overlay">
      <!-- :key 必须给：同一实例会在不同节点间复用；不给 key，Vue 会复用同一个内容组件、
           只换 id prop —— 而它只在 setup 时读一次节点类型，换节点后内容就错位了（历史实测）。 -->
      <component :is="BarComponent" v-if="BarComponent" :key="selectedId" :id="selectedId" :data="nodeData" />
    </div>
  </Teleport>
</template>

<style scoped>
/* 浮层本体：fixed 定位于 body，压过外壳底部工具栏（.shell-dock z-index:30）。
   这里给 60——高于外壳 chrome、低于模态/菜单（100000），所以栏内的下拉浮层仍能盖住本栏。 */
.nbs-host {
  z-index: 60;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  pointer-events: auto;
}
</style>
