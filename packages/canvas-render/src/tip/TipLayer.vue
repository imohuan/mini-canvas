<script setup lang="ts">
/**
 * TipLayer —— 全局鼠标跟随提示层（渲染层提供，全站唯一一个）。
 *
 * 消费方：canvas.notify(msg, { followPointer: true }) —— canvas 的通知队列是唯一事实源，
 * 本组件只按 followPointer 过滤渲染。
 * 位置：左上角对齐指针（右下角显示）、无间隔。
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { useCanvasContextOrRender } from '../contracts/canvasContext'
import type { NotifyItem } from '../canvas/notifyService'

// overlay 槽宿主会下发 class/data-slot-*；本组件根是 Teleport，继承不了，
// 显式关掉避免 Vue warn 刷屏（e2e 有控制台纯净断言）。
defineOptions({ inheritAttrs: false })

const pos = ref({ x: 0, y: 0 })

/**
 * 通知队列：CanvasContext 与 RenderContext 都能取到同一份 ctx。
 * computed 直接读 shallowReactive 队列，队列变化会自动重渲染。
 */
const ctx = useCanvasContextOrRender().ctx
const tips = computed<NotifyItem[]>(
  () => ctx.tryGet<{ notifications: { list(): NotifyItem[] } }>('canvas')?.notifications.list().filter((x) => x.followPointer) ?? [],
)
const message = computed(() => tips.value.map((x) => x.message).join(' · '))
function onMove(e: PointerEvent): void {
  pos.value = { x: e.clientX, y: e.clientY }
}

onMounted(() => {
  window.addEventListener("pointermove", onMove, { passive: true })
})
onBeforeUnmount(() => {
  window.removeEventListener("pointermove", onMove)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="message" class="ctip-layer" role="tooltip" :style="{ left: pos.x + 'px', top: pos.y + 'px' }">
      {{ message }}
    </div>
  </Teleport>
</template>

<style>
/* 非 scoped：Teleport 到 body。 */
.ctip-layer {
  position: fixed;
  z-index: 3200;
  padding: 5px 10px;
  border-radius: 8px;
  background: var(--ui-tip, rgb(0 0 0 / 0.9));
  color: var(--ui-tip-ink, #fff);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  pointer-events: none;
}
</style>

