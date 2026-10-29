<script setup lang="ts">
// 根节点是 Teleport：插槽宿主（SlotHost）下发的 class/data-slot-* 继承不了，
// 不关掉属性继承 Vue 每次渲染都会警告一次。我们本来就不用那些属性。
defineOptions({ inheritAttrs: false })
/**
 * NodeModeBottomBarOverlay —— 「功能模式」底栏的**画布级浮层渲染器**（主题件）。
 *
 * 与 bottom-bar 的 NodeBottomBarOverlay 分工（2026-10-29 重构后）：
 * - 本件只在**有模式接管**时渲染该模式的 bottomBar（Teleport 到 body、贴卡片正下方）；
 * - 没有模式接管时**什么都不渲染** —— 那时是 bottom-bar 的天下（它自己的 overlay 宿主
 *   照常摆出默认生成 UI）。两根浮层不会同时出现：进入模式时本件顶上、默认底栏让位；
 *   退出后相反。
 *
 * 为什么需要单独的浮层宿主：与 NodeBottomBarOverlay 同一套实测结论（文件头写得很全）——
 * 节点内 DOM 出不了层叠上下文、Teleport 到 body 才能压过外壳工具栏、拖动要 rAF 量卡片矩形。
 * 模式底栏同样贴着卡片下方，位置逻辑完全一致，所以本件复制其定位结构（内容换成模式组件）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useCanvasRender, useToolbarOffsets, RenderEvents } from '@mini-canvas/canvas-render'
import type { Component } from 'vue'
import type { DocService } from '@mini-canvas/canvas-data'
import { NodeToolbarService } from './nodeToolbarService'
// 压制条件与 bottom-bar 的 NodeBottomBarOverlay 是**同一套显隐规则**（框选/多选/拖拽/抓手）。
// 这里内联同一份判定（字段与 bottomBarOverlay.resolveBottomBarSuppressed 一一对应）——
// 本主题件与 bottom-bar 互不依赖（插件之间不互相 import 是硬规则），规则文本注释互指。
function resolveModeBarSuppressed(input: {
  selecting: boolean
  selectedCount: number
  selectedId: string | null
  resizingId: string | null
  nodeDragging: boolean
  handTool: boolean
}): boolean {
  return (
    input.selecting ||
    input.selectedCount > 1 ||
    input.resizingId === input.selectedId ||
    input.nodeDragging ||
    input.handTool
  )
}

/**
 * props 里**没有 id/data**：overlay 槽的宿主（SlotHost）不透传节点信息 ——
 * 它只是把"这个槽有哪些条目"渲染出来（NodeBottomBarOverlay 同款：自己读 selection）。
 * 节点 id 从 selection 单源读：恰好单选的那个节点就是浮层要贴的节点。
 */
const { ctx, flow, interaction } = useCanvasRender()
const selectedId = ref<string | null>(null)
const selectedCount = ref(0)
function syncSelection(): void {
  const sel = ctx.tryGet('selection')
  const ids = sel ? [...sel.ids] : []
  selectedCount.value = ids.length
  selectedId.value = ids.length === 1 ? ids[0] : null
}
syncSelection()
const offSel = ctx.tryGet<{ onChange(cb: () => void): () => void } | undefined>('selection')?.onChange(syncSelection)
onBeforeUnmount(() => offSel?.())

const nodeId = computed(() => selectedId.value ?? '')
/** 选中节点的 data（模式底栏收 { id, data } props；与 bottom-bar 的宿主同源读法） */
const nodeData = ref<Record<string, unknown>>({})
function syncNode(): void {
  const id = selectedId.value
  if (!id) { nodeData.value = {}; return }
  const node = ctx.tryGet<{ getNode?(id: string): { data?: Record<string, unknown> } | undefined }>('doc')?.getNode?.(id)
  nodeData.value = (node?.data ?? {}) as Record<string, unknown>
}
const docSub = ctx.tryGet<{ subscribe(cb: (change: unknown) => void): () => void } | undefined>('doc')?.subscribe(() => syncNode())
onBeforeUnmount(() => docSub?.())
const viewport = flow.viewport
const offsets = useToolbarOffsets()

// 主题自己的服务（同包）。ctx.tryGet 走"按名解析"，服务的 reactive 会话能被 computed 追踪。
const svc = ctx.tryGet<NodeToolbarService | undefined>('nodeToolbar')
if (!svc) console.warn('[node-mode] nodeToolbar 服务不存在（theme-default 未装？）')

const mode = computed(() => svc?.modeOf(nodeId.value))
const ModeBottom = computed(() => (mode.value?.bottomBar as Component | undefined) ?? null)

/** 会话变化时强制重渲染（服务内部 reactive 已可追踪，这里只是保险 + 与 overlay 同语义） */
const tick = ref(0)
void tick

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
  onBeforeUnmount(() => off.dispose())
}
const handTool = computed(() => nodesDraggable.value === false)

const suppressed = computed(() =>
  resolveModeBarSuppressed({
    selecting: interaction?.isSelecting?.value === true,
    selectedCount: selectedCount.value,
    selectedId: selectedId.value,
    resizingId: interaction?.nodeResizeId?.value ?? null,
    nodeDragging: interaction?.isNodeDragging?.value === true,
    handTool: handTool.value,
  }),
)

// —— 卡片屏幕矩形：与 NodeBottomBarOverlay 同一套 rAF 量法 ——
const rect = ref<{ x: number; y: number; w: number; h: number } | null>(null)
function commit(next: { x: number; y: number; w: number; h: number } | null): void {
  const cur = rect.value
  if (cur === next) return
  if (cur && next && cur.x === next.x && cur.y === next.y && cur.w === next.w && cur.h === next.h) return
  rect.value = next
}
function measure(): void {
  // 画布还没就绪（VueFlow 未挂载）时保持 null —— visible 链会自然判 false，也不再刷警告
  if (typeof flow.domReady === 'function' && !flow.domReady()) { commit(null); return }
  const nodeEl = flow.queryNodeEl(nodeId.value)
  const cardEl = (nodeEl?.querySelector('.v2-card') as HTMLElement | null) ?? nodeEl
  if (!cardEl) {
    commit(null)
    return
  }
  const b = cardEl.getBoundingClientRect()
  commit(b.width > 0 && b.height > 0 ? { x: b.left, y: b.top, w: b.width, h: b.height } : null)
}
watch([viewport, nodeId], measure, { deep: false })
const dragOffs = [
  ctx.on(RenderEvents.NodeDragStart, measure),
  ctx.on(RenderEvents.NodeDrag, measure),
  ctx.on(RenderEvents.NodeDragEnd, measure),
]
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
  for (const d of dragOffs) d.dispose()
})

const wrapStyle = computed<Record<string, string> | null>(() => {
  const r = rect.value
  if (!r) return null
  const zoom = viewport.value.zoom || 1
  const top = r.y + r.h + offsets.value.bottom * zoom
  const left = r.x + r.w / 2
  return {
    position: 'fixed',
    left: left + 'px',
    top: top + 'px',
    transform: 'translateX(-50%)',
  }
})

/** 只在"这个节点在模式里 + 有 bottomBar + 未被压制"时渲染 */
const visible = computed(() => !!mode.value && !!ModeBottom.value && !suppressed.value)
</script>

<template>
  <Teleport to="body">
    <div v-if="visible && wrapStyle" class="nm-overlay nodrag nopan" :style="wrapStyle" data-testid="node-mode-bottom-bar-overlay">
      <component :is="ModeBottom" :key="nodeId" :id="nodeId" :data="nodeData" />
    </div>
  </Teleport>
</template>

<style scoped>
/* 与 NodeBottomBarOverlay 的 .nb-overlay 同层级（60）：模式接管时两根浮层互斥，不会重叠 */
.nm-overlay {
  z-index: 60;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  pointer-events: auto;
}
</style>
