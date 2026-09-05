<script setup lang="ts">
// SlotHost —— 渲染层"通用 UI 槽宿主"：给定槽名，把该槽里所有 occupant(插件 ctx.slots.register 塞的)按 order 渲染出来。
//
// 解决的重复：以前"渲染一个槽"(如 overlay)要在宿主组件里手抄一套——读 ctx.slots.occupants(slot) →
// 维护响应式列表 → 订阅插件热装/热卸重读 → 组件 markRaw → 逐个 <component :is> 渲染。CanvasSurface 里 overlay
// 就是这套的硬编码实例。抽成 SlotHost 后，渲染任意槽只要一行：
//   <SlotHost slot="overlay" />        （插件侧照旧 ctx.slots.register('overlay', {component, order})）
//   <SlotHost slot="toolbar" />        （想加新槽，宿主多写一行就多一个可扩展区）
//
// 职责边界（只管"读一个槽并按序渲染 occupants"）：
// - 不做定位/pointer-events/容器样式——那是具体槽(如 overlay 盖满画布那层)的布局职责，由使用方套 CSS。
// - 只在 CanvasHost 渲染子树内用（经 useCanvasRender 拿 ctx）；组件树外会抛清晰错误。
import { markRaw, onBeforeUnmount, ref, watch } from 'vue'
import { useCanvasRender } from '../contracts/renderContext'

const props = defineProps<{
  /** 要渲染的槽名（插件经 ctx.slots.register(同名, ...) 往里填） */
  slot: string
  /** 可选：给每个 occupant 根元素额外加的 class（如 overlay 的 pointer-events 命中规则） */
  itemClass?: string
}>()

const { ctx } = useCanvasRender()

// —— occupant 列表：读内核槽 + markRaw，插件装卸时整体替换以触发 Vue 更新 ——
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const list = ref<Array<{ id: string; order: number; component: any }>>([])

function reload(): void {
  list.value = ctx.slots
    .occupants(props.slot)
    .map((e) => ({ id: e.id, order: e.order, component: markRaw(e.component as object) }))
}

reload() // 初始读一次

// 插件热装/热卸会改变某槽的 occupant 集合 → 订阅内核事件重读（与宿主热重装同事件源）。
const disposers: Array<{ dispose(): void }> = []
disposers.push(
  ctx.on('ctx:plugin-installed', reload),
  ctx.on('ctx:plugin-uninstalled', reload),
)
onBeforeUnmount(() => {
  for (const d of disposers) d.dispose()
})

// props.slot 变更时重读（保守处理：监听并刷新）
watch(() => props.slot, reload)
</script>

<template>
  <!-- 根不包额外容器：由使用方套具体槽(如 overlay 那层)的布局 CSS。occupants 按内核 order 逐个渲染。 -->
  <component
    v-for="oc in list"
    :key="oc.id"
    :is="oc.component"
    :class="itemClass"
    :data-slot-order="oc.order"
    :data-slot-id="oc.id"
  />
</template>
