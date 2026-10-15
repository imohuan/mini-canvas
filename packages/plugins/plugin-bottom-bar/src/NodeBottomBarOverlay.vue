<script setup lang="ts">
/**
 * 根节点是 Teleport：插槽宿主（SlotHost）下发的 class/data-slot-* 继承不了，
 * 不关掉属性继承 Vue 每次渲染都会警告一次（实测刷屏）。我们本来就不用那些属性。
 */
defineOptions({ inheritAttrs: false })
/**
 * NodeBottomBarOverlay —— 底栏的**画布级浮层宿主**（注册在 overlay 槽）。
 *
 * 为什么要有它（2026-09-29 Chrome 实测，用户报的「输入框点不进去」）：
 * 底栏原先住在节点内部的 `.v2-slot--bottom`。而 `.vue-flow__node` 带 transform（VueFlow 定位用）
 * **必然创建层叠上下文** —— 节点内的任何 z-index 都出不去。应用外壳的底部工具栏
 * `.shell-dock`（CanvasShell.vue，position:fixed; z-index:30）是画布的**兄弟**，
 * 于是它压在底栏输入区之上，把点击整段截走（实测：重叠段打字进不去，非重叠段正常）。
 *
 * 做法（与 plugin-group 的 GroupTopToolbarOverlay、plugin-multi-select 的 SelectionFrame 同路子）：
 * 底栏离开节点层叠上下文 —— 本组件注册在**画布 overlay 槽**，再把真实内容 **Teleport 到 body**
 * 并按**屏幕坐标**fixed 定位（Teleport 到 body 是本插件既有的成熟手法，见 @ 菜单的注释：
 * 反缩放祖先的 transform 会劫持 fixed 定位，挪出 transform 链才正确）。
 * Teleport 到 body 还顺带绕开 `.csurface-overlay` 的 `overflow:hidden` 裁剪
 * （节点贴近画布下缘时底栏不会被切）。
 *
 * 分工：本文件只管「显隐 + 摆到卡片正下方」；栏内内容仍是 NodeBottomBar（读 themeRegistry 的
 * winner），与挂在节点里时**同一份组件**，观感与行为完全一致。所以它自己仍会按单选/有动作判空。
 *
 * 壳的压制条件在这里补齐（挂到画布层后读不到 BaseNode 的局部状态，只能读共享信号）。
 * **逐条对齐 BaseNode 的下插槽**：`v-if="bottomSlots.length > 0 && !hideSlotBars"`，
 * 而 hideSlotBars = 框选中（isSelecting）| 多选（selectedCount>1）| 该节点 resize 中 | **画布上有节点在拖**。
 * 判定收在 `bottomBarOverlay.ts` 的纯函数里（可单测；拖动那条是用户带截图报的"拖拽时底栏还在"）。
 * 注意**不含低缩放** —— 壳只有 out:left/right 才看 lowDetail，下插槽不看（对齐它，别多加）。
 * 拖动跟随：拖动中位置要松手才落盘，改用**实时读卡片 DOM 的 getBoundingClientRect**（VueFlow
 * 拖动时逐帧改节点元素的 transform，DOM 矩形实时反映），所以不需要另外做位移增量。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useCanvasRender, useToolbarOffsets, RenderEvents } from '@mini-canvas/canvas-render'
import type { DocService } from '@mini-canvas/canvas-data'
import BottomBarHost from './BottomBarHost.vue'
import { resolveBottomBarSuppressed } from './bottomBarOverlay'

const { ctx, flow, interaction } = useCanvasRender()
const viewport = flow.viewport
const offsets = useToolbarOffsets()

/** 唯一被单独选中的节点 id（恰好一个才谈得上「某节点的底栏」） */
const selectedId = ref<string | null>(null)
const selectedCount = ref(0)

function syncSelection(): void {
  const sel = ctx.tryGet('selection')
  const ids = sel ? [...sel.ids] : []
  selectedCount.value = ids.length
  selectedId.value = ids.length === 1 ? ids[0] : null
}

/** 节点类型与 data（底栏要用；doc 变更时重读） */
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

/**
 * 壳的压制条件（挂到画布层后读不到 BaseNode 局部状态，改读共享信号；逐条对齐 hideSlotBars）。
 * 判定本体在 bottomBarOverlay.ts 的纯函数里（Node 可测）：框选 / 多选 / 本节点 resize / 画布在拖 / 抓手工具。
 */
/**
 * 画布是否处于抓手工具：读宿主级设置 `nodesDraggable`（抓手 = false）。
 * 与 BaseNode 的 isHandTool 同源、同一个键 —— 底栏挂画布层，BaseNode 那条压制管不到这里，
 * 只能自己读一遍。settings 非响应式，故用 ref + onChange 订阅窄更新。
 */
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
  resolveBottomBarSuppressed({
    selecting: interaction?.isSelecting?.value === true,
    selectedCount: selectedCount.value,
    selectedId: selectedId.value,
    resizingId: interaction?.nodeResizeId?.value ?? null,
    // 画布级：拖任意节点都收（用户要求；与 BaseNode 的 hideSlotBars 同一条规则）
    nodeDragging: interaction?.isNodeDragging?.value === true,
    // 抓手工具：节点上的操作栏都收了（BaseNode 的 hideSlotBars），底栏同理
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

// 静态变化（选中/数据/视口）即时重算一次；逐帧跟随交给下面的 rAF
watch([viewport, selectedId, nodeData], measure, { deep: false })
const dragOffs = [
  ctx.on(RenderEvents.NodeDragStart, measure),
  ctx.on(RenderEvents.NodeDrag, measure),
  ctx.on(RenderEvents.NodeDragEnd, measure),
]
offs.push(...dragOffs)

// 逐帧跟随：拖动只改节点元素的视觉 transform（位置松手才落盘），量 DOM 才贴得住；
// 统一交给 rAF 比逐个订阅拖动事件更不容易漏帧（程序化移动也能跟上）。
// commit() 带变更检测，静止时不产生任何重渲染。
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

/** 定位：屏幕坐标；底栏宽度取自然像素（不随画布缩放，与节点内插槽的反缩放同效果） */
const wrapStyle = computed<Record<string, string> | null>(() => {
  const r = rect.value
  if (!r) return null
  const zoom = viewport.value.zoom || 1
  // 与节点内 `top: calc(100% + offset)` 等价：卡片下缘 + offset（offset 在缩放空间里，屏上 = ×zoom）
  const top = r.y + r.h + offsets.value.bottom * zoom
  const left = r.x + r.w / 2
  return {
    position: 'fixed',
    left: left + 'px',
    top: top + 'px',
    transform: 'translateX(-50%)',
  }
})

/** 显示条件：单选 + 有类型 + 量到矩形 + 未被压制（NodeBottomBar 仍会自行按「有无动作」判空） */
const visible = computed(
  () => !!selectedId.value && !!nodeType.value && !!rect.value && !suppressed.value,
)

</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible && wrapStyle"
      class="nb-overlay nodrag nopan"
      :style="wrapStyle"
      data-testid="node-bottom-bar-overlay"
    >
      <!-- :key 必须给：同一个浮层实例会在不同节点间复用；不给 key，Vue 会复用同一个
           NodeBottomBar 实例、只换 id prop —— 而它只在 setup 时读一次节点类型，
           于是换节点后动作列表/输入区全部错位（实测：选中图片节点却按文本节点渲染，整栏空白）。 -->
      <BottomBarHost v-if="selectedId" :key="selectedId" :id="selectedId" :data="nodeData" />
    </div>
  </Teleport>
</template>

<style scoped>
/* 浮层本体：fixed 定位于 body，压过外壳底部工具栏（.shell-dock z-index:30）。
   这里给 60——高于外壳 chrome、低于模态/菜单（100000），所以栏内的下拉浮层仍能盖住本栏。 */
.nb-overlay {
  z-index: 60;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  pointer-events: auto;
}
</style>
