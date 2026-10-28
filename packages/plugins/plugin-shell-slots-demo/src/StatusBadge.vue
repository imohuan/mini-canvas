<script setup lang="ts">
/**
 * 状态条末尾徽章：节点数由组件自己从上下文订阅 doc 得到。
 */
import { onBeforeUnmount, shallowRef } from 'vue'
import { useCanvasContext } from '@mini-canvas/canvas-render'

const { ctx } = useCanvasContext()
const doc = ctx.tryGet<{ getNodes(): unknown[]; subscribe(fn: () => void): () => void }>('doc')
const count = shallowRef(doc ? doc.getNodes().length : 0)
const offDoc = doc?.subscribe(() => {
  count.value = doc.getNodes().length
})
onBeforeUnmount(() => offDoc?.())
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
