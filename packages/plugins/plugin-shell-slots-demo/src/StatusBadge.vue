<script setup lang="ts">
// 状态条末尾演示徽章：读节点数（纯 ctx，不需要视口）。
import { computed, onBeforeUnmount, ref } from 'vue'
import { useCanvasContext } from '@mini-canvas/canvas-render'

// 外壳槽内拿 ctx：优先基础上下文（Provider provide）；插件是自包含 ESM 时，
// 插件包内的 canvas-render 与宿主是两份模块，inject 命中不了 —— 兜底读
// window.MiniCanvasUI.getContext()（宿主唯一 ctx，与 provide 的那份是同一个对象）。
function resolveCtx(): { get<T>(name: string): T; effect(fn: () => () => void): void } {
  try {
    return useCanvasContext().ctx as unknown as ReturnType<typeof resolveCtx>
  } catch {
    const w = window as unknown as { MiniCanvasUI?: { getContext(): { get<T>(name: string): T } } }
    const fallback = w.MiniCanvasUI?.getContext()
    if (!fallback) throw new Error('[ssd] 既无 Provider 上下文也无 window.MiniCanvasUI')
    return fallback as unknown as ReturnType<typeof resolveCtx>
  }
}
const ctx = resolveCtx()
const tick = ref(0)
const off = ctx.get<{ subscribe(cb: () => void): () => void }>('doc').subscribe(() => { tick.value += 1 })
onBeforeUnmount(() => off())
const count = computed(() => { void tick.value; return ctx.get<{ getNodes(): unknown[] }>('doc').getNodes().length })
</script>

<template>
  <span class="ss-demo-badge" data-testid="ssd-status" :title="'当前节点数：' + count">节点 {{ count }}</span>
</template>

<style scoped>
.ss-demo-badge {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 10px;
  margin: 0 4px;
  border-radius: 10px;
  background: var(--ui-accent-soft, rgba(8 145 178 / 0.12));
  color: var(--ui-accent, #0891b2);
  font: 700 12px system-ui, 'Microsoft YaHei', sans-serif;
}
</style>
