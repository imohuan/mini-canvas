<script setup lang="ts">
/**
 * CursorTooltip —— 跟随鼠标的暗色提示气泡（观感与 packages/ui 的 AxTooltip 一致：
 * rgba(0,0,0,.9) 底 / #fff 字 / 12px / 圆角 6px，无箭头）。
 *
 * 与 Tooltip.vue（锚定触发器）的差异：本件**跟随鼠标**（left/top = 指针位置），
 * 供「拖线非法提示 / 选择态提醒」这类没有固定触发器的场景用。
 *
 * 用法（配合全局 tip 服务）：ctx.get("tip").show("...") 显示 / .hide() 隐藏。
 */
import { onBeforeUnmount, onMounted, ref } from "vue"

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
  window.addEventListener("mini-canvas:tip", sync)
  window.addEventListener("pointermove", onMove, { passive: true })
  sync()
})
onBeforeUnmount(() => {
  window.removeEventListener("mini-canvas:tip", sync)
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
/* 非 scoped：Teleport 到 body。观感 = AxTooltip 同款暗色 token。 */
.mouse-tip {
  position: fixed;
  z-index: 100001;
  padding: 4px 8px;
  border-radius: 6px;
  background: rgb(0 0 0 / 0.9);
  color: #fff;
  box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
  font-size: 12px;
  line-height: 16px;
  white-space: nowrap;
  pointer-events: none;
}
</style>

