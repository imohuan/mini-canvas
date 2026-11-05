<script setup lang="ts">
// SlotHost —— 通用 UI 槽宿主：给定槽名，把该槽里的 occupant 按 order 渲染出来。
//
// 只依赖应用级上下文（ctx），所以项目页和画布页都能用。
// 不做定位 / pointer-events / 容器样式：那是具体槽的布局职责。
import { markRaw, onBeforeUnmount, ref, watch } from 'vue'
import { useCanvasContextOrRender } from './context'

const props = defineProps<{
  slot: string
  itemClass?: string
}>()

/**
 * 用**宽松**取件：外壳槽只有应用级上下文，画布内的 overlay 槽（CanvasSurface 里）
 * 只有渲染上下文。早先这里写死 useCanvasContext()，画布内取不到就抛错，
 * 于是 overlay occupant（对齐参考线浮层等）永远不渲染 —— 真机表现为
 * 「参考线插件没效果」（2026-11-05）。
 */
const { ctx } = useCanvasContextOrRender()

interface SlotOccupant {
  id: string
  order: number
  before?: string
  after?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: any
}
const list = ref<SlotOccupant[]>([])

function reload(): void {
  list.value = ctx.slots.occupants(props.slot).map((e) => ({
    id: e.id,
    order: e.order,
    ...(e.before !== undefined ? { before: e.before } : {}),
    ...(e.after !== undefined ? { after: e.after } : {}),
    component: markRaw(e.component as object),
  }))
}

reload()

const disposers: Array<{ dispose(): void }> = []
disposers.push(
  ctx.on('ctx:plugin-installed', reload),
  ctx.on('ctx:plugin-uninstalled', reload),
)
const slotRegistry = ctx.get<{ subscribe(cb: () => void): () => void }>('slots')
if (slotRegistry && typeof slotRegistry.subscribe === 'function') {
  disposers.push({ dispose: slotRegistry.subscribe(reload) })
}
onBeforeUnmount(() => {
  for (const d of disposers) d.dispose()
})

watch(() => props.slot, reload)
</script>

<template>
  <template v-for="oc in list" :key="oc.id">
    <component
      :is="oc.component"
      :class="itemClass"
      :data-slot-order="oc.order"
      :data-slot-id="oc.id"
      :data-slot="slot"
      :data-slot-before="oc.before ?? undefined"
      :data-slot-after="oc.after ?? undefined"
    />
  </template>
</template>
