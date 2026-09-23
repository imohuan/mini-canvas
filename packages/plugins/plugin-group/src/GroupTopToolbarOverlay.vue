<script setup lang="ts">
/**
 * GroupTopToolbarOverlay —— 分组上控制栏的**浮层宿主**：把工具栏画到节点之外的高层。
 *
 * 为什么需要它（本轮真正修的 bug，浏览器实测复现过）：
 * 分组卡片的"垫底"是靠给**分组节点**写 z-index:-3 实现的（canvasHostCore.nodesFromStore）。
 * 而 z-index 一旦不是 auto，就在该节点上**创建层叠上下文** —— 于是写在节点内部、
 * 原本 z-index:30 的 .v2-slot 被整个关进 -3 里，数字再大也**越不过兄弟节点**。
 * 表现：普通节点压住分组工具栏时，工具栏在最底下（用户报的"被节点遮挡"）。
 *
 * 实测过但**不成立**的改法（都试过，别重走）：
 * - 分组节点 z 改 auto / 卡片改 z=-1：`transform` 同样创建层叠上下文，工具栏仍出不去；
 * - 工具栏 z 提到 1001：只改数字，仍在同一上下文内，无效。
 *
 * 唯一成立：**让工具栏离开该节点的层叠上下文** —— 挂到画布 overlay 槽
 * （.csurface-overlay，z-index:20，是整棵 VueFlow 的兄弟且压在其上）。
 * 这正是多选插件 SelectionFrame 已在用的成熟路径。
 *
 * 分工：本文件只管"摆到分组卡片正上方"（纯定位）；
 * 按钮内容仍是 GroupTopToolbar（与挂在节点里时**同一份组件**，观感与行为完全一致）。
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { useCanvasRender, resolveNodeSlotStyle, useToolbarOffsets, RenderEvents } from '@mini-canvas/canvas-render'
import type { NodeLayoutService } from '@mini-canvas/canvas-render'
import type { DocService } from '@mini-canvas/canvas-data'
import GroupTopToolbar from './GroupTopToolbar.vue'

// 常量从 groupEngine 取（纯逻辑、零依赖）。不能从 groupPlugin 取：那会成环（见该常量处的说明）。
import { GROUP_NODE_TYPE } from './groupEngine'

const { ctx, viewport } = useCanvasRender()

/** 唯一被单独选中的节点 id（恰好选一个才谈得上显示某一条工具栏）；订阅选中单源，不存影子状态 */
const selectedId = ref<string | null>(null)
const syncSelection = (): void => {
  const sel = ctx.get<{ ids: ReadonlySet<string> } | undefined>('selection')
  const ids = sel ? [...sel.ids] : []
  selectedId.value = ids.length === 1 ? ids[0] : null
}
syncSelection()
const offSel = ctx.get<{ onChange(cb: () => void): () => void } | undefined>('selection')?.onChange(syncSelection)
onBeforeUnmount(() => offSel?.())

/** 选中项是不是本浮层负责的类型（别的类型不归它管） */
const groupNode = computed(() => {
  const id = selectedId.value
  if (!id) return null
  const node = ctx.get<DocService | undefined>('doc')?.getNode(id)
  return node && node.type === GROUP_NODE_TYPE ? node : null
})

/**
 * 分组卡片的绝对矩形（flow 坐标 + 实测尺寸）；平移/缩放时重算。
 *
 * **拖动时不走这里**（见下方 dragFollow 的说明）——数据层位置要松手才落盘，
 * 拖动中读这里会停在原地，工具栏就会"跟视图不跟节点"（用户实测报的就是这个）。
 */
const storeRect = computed(() => {
  void viewport.value // 依赖视口：pan/zoom 时重算（拖动中 nodeLayout 实测值会更新）
  const id = groupNode.value?.id
  if (!id) return null
  return ctx.get<NodeLayoutService | undefined>('nodeLayout')?.getNodeRect(id) ?? null
})

/**
 * 拖动帧跟随：拖动中按"位移增量"平移矩形（与 multi-select 的框跟随同一套数学）。
 *
 * 为什么不能只等 nodeLayout：VueFlow 拖动逐帧只改**视觉层**，位置要松手才落盘 ——
 * 只读 storeRect 的话整个拖动过程工具栏定在原地，松手才"跳"过去。拖动开始时记
 * "矩形快照 + 被抓节点起始位置"，之后每帧用同一节点的位移增量平移快照 ——
 * 工具栏与节点走同一个 delta，偏移恒定不漂。
 */
const dragAnchor = ref<null | { rect: { x: number; y: number; w: number; h: number }; start: { x: number; y: number }; nodeId: string }>(null)
const dragRect = ref<null | { x: number; y: number; w: number; h: number }>(null)
const dragOff = [
  ctx.on(RenderEvents.NodeDragStart, (p: { nodeId: string; position: { x: number; y: number } }) => {
    const r = storeRect.value
    if (!r || p.nodeId !== groupNode.value?.id) return
    dragAnchor.value = { rect: { ...r }, start: { x: p.position.x, y: p.position.y }, nodeId: p.nodeId }
  }),
  ctx.on(RenderEvents.NodeDrag, (p: { nodeId: string; position: { x: number; y: number } }) => {
    const a = dragAnchor.value
    if (!a || p.nodeId !== a.nodeId) return
    dragRect.value = {
      x: a.rect.x + (p.position.x - a.start.x),
      y: a.rect.y + (p.position.y - a.start.y),
      w: a.rect.w,
      h: a.rect.h,
    }
  }),
]
const disposers: Array<{ dispose(): void }> = []
const dragEnd = ctx.on(RenderEvents.NodeDragEnd, () => {
  dragAnchor.value = null
  dragRect.value = null
})
dragOff.push(dragEnd)
for (const d of dragOff) disposers.push(d)
onBeforeUnmount(() => { for (const d of disposers) d.dispose() })

/** 实际用的矩形：拖动中用跟随值，静止时用 store 值（松手落盘后两者自然一致） */
const rect = computed(() => dragRect.value ?? storeRect.value)

/** 贴边距离读**同一份**「布局/控制栏」配置（节点控制栏也读它）→ 两个宿主间距天然一致 */
const offsets = useToolbarOffsets()

/** 外层跟随视口变换（translate+scale）→ 内部坐标即 flow 坐标（与 SelectionFrame 同法） */
const wrapperStyle = computed(() => {
  const vp = viewport.value
  return { transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`, transformOrigin: '0 0' }
})

/** 定位盒：与卡片**同位置同尺寸**，于是能直接用节点那套 resolveNodeSlotStyle */
const anchorStyle = computed(() => {
  const r = rect.value
  if (!r) return null
  return { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` }
})

/** 工具栏本体：与节点内控制栏**同一个**定位函数（贴边 + 居中 + 反缩放） */
const innerStyle = computed(() =>
  resolveNodeSlotStyle({ side: 'top', offset: offsets.value.top, zoom: viewport.value.zoom || 1 }),
)
</script>

<template>
  <div v-if="rect" class="group-top-toolbar-overlay" :style="wrapperStyle">
    <div class="group-top-toolbar-overlay__anchor" :style="anchorStyle">
      <div class="group-top-toolbar-overlay__slot" :style="innerStyle">
        <!-- 与挂在节点里时**同一份**组件：按钮、色板、显隐门全复用，不重复实现 -->
        <GroupTopToolbar v-if="groupNode" :id="groupNode.id" :data="groupNode.data" />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 外层零尺寸：只是坐标原点，不挡画布交互（真实可点区域在下面的 slot 上） */
.group-top-toolbar-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  overflow: visible;
  pointer-events: none;
}
/* 定位盒：与卡片重合，纯定位锚，不接事件 */
.group-top-toolbar-overlay__anchor {
  position: absolute;
  pointer-events: none;
}
/* 工具栏落点：定位由 resolveNodeSlotStyle 注入 inline style；这里只恢复可点 + 排版 */
.group-top-toolbar-overlay__slot {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  pointer-events: auto;
}
</style>
