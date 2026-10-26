<script setup lang="ts">
/**
 * TipLayer —— **通用鼠标跟随提示层**（全站一个，注册在 overlay 槽，Teleport 到 body）。
 *
 * 用户口径（2026-10-26）：提示要像 hover 那样跟着鼠标走，并且任何地方都能主动调用
 * tipBus.showTip('...') / hideTip()。本组件只负责「画出来 + 跟随鼠标」。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { TIP_EVENT, hideTip, readTipFromGlobal } from './tipBus'

const OFFSET = { x: 14, y: 18 }

const message = ref(readTipFromGlobal())
const pos = ref({ x: 0, y: 0 })

function sync(): void {
  message.value = readTipFromGlobal()
}
function onMove(e: PointerEvent): void {
  pos.value = { x: e.clientX, y: e.clientY }
}
function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && message.value) hideTip()
}

onMounted(() => {
  window.addEventListener(TIP_EVENT, sync)
  window.addEventListener('pointermove', onMove, { passive: true })
  window.addEventListener('keydown', onKeyDown, true)
  sync()
})
onBeforeUnmount(() => {
  window.removeEventListener(TIP_EVENT, sync)
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('keydown', onKeyDown, true)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="message"
      class="tip-layer"
      role="tooltip"
      :style="{ left: pos.x + OFFSET.x + 'px', top: pos.y + OFFSET.y + 'px' }"
    >
      {{ message }}
    </div>
  </Teleport>
</template>

<style scoped>
.tip-layer {
  position: fixed;
  z-index: 3200;
  padding: 5px 10px;
  border-radius: 8px;
  background: var(--ui-tip);
  color: var(--ui-tip-ink);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  pointer-events: none;
  will-change: transform;
}
</style>
