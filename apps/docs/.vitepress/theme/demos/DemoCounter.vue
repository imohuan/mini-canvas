<script setup lang="ts">
import { ref } from 'vue'

/** 文档站自带的示例组件：用来证明「MD 里能跑真实 Vue 组件」这条路是通的。 */
const n = ref(0)
</script>

<template>
  <div class="demo-counter">
    <p>这是一个真的 Vue 组件，不是截图。</p>
    <button @click="n++">点我：{{ n }}</button>
  </div>
</template>

<style scoped>
.demo-counter {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
}
.demo-counter button {
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  padding: 6px 12px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  cursor: pointer;
}
.demo-counter button:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}
</style>
