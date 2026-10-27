<script setup lang="ts">
// 状态条末尾演示徽章：读节点数（纯 ctx，不需要视口）。
import { computed, onBeforeUnmount, ref } from 'vue'
import { useCanvasContext } from '@mini-canvas/canvas-render'

// 外壳槽内用基础上下文（Provider 提供）。插件包内自带的 canvas-render 与宿主同 key
// （字符串 key），inject 能直接命中宿主 provide 的那一份。
const { ctx } = useCanvasContext()
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
