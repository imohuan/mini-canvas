<script setup lang="ts">
/**
 * MouseTipLayer —— 全局鼠标跟随提示层（默认主题提供，全站唯一一个）。
 *
 * 用户口径：提示是基础设施（和节点同级），其它插件直接调 ctx.get("tip").show("...") 即可；
 * 位置统一在鼠标右下角、无间隔。
 */
import { onBeforeUnmount, onMounted, ref } from "vue"
import { TIP_EVENT } from "../../ui/tipService"

const message = ref("")
const pos = ref({ x: 0, y: 0 })

function read(): string {
  const s = (globalThis as { __miniCanvasTip?: { text: string; visible: boolean } }).__miniCanvasTip
  return s?.visible ? s.text : ""
}
function sync(): void {
  message.value = read()
}
function onMove(e: PointerEvent): void {
  pos.value = { x: e.clientX, y: e.clientY }
}

onMounted(() => {
  window.addEventListener(TIP_EVENT, sync)
  window.addEventListener("pointermove", onMove, { passive: true })
  sync()
})
onBeforeUnmount(() => {
  window.removeEventListener(TIP_EVENT, sync)
  window.removeEventListener("pointermove", onMove)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="message" class="mouse-tip" role="tooltip" :style="{ left: pos.x + 'px', top: pos.y + 'px' }">
      {{ message }}
    </div>
  </Teleport>
</template>

<style>
/* 非 scoped：Teleport 到 body（scoped 会命不中）。 */
.mouse-tip {
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

