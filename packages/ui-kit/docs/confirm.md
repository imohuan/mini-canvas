# Confirm 确认框

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Confirm, Button } from '@mini-canvas/ui-kit'

const open = ref(false)
const loading = ref(false)
async function doConfirm(): Promise<void> {
  loading.value = true
  await new Promise((r) => setTimeout(r, 800))
  loading.value = false
}
</script>

<template>
  <div>
    <Button variant="danger" @click="open = true">删除画布</Button>
    <Confirm v-model="open" title="删除画布？" description="这个操作会立即生效，删除后无法恢复。" confirm-text="删除" cancel-text="保留" danger :loading="loading" @confirm="doConfirm">
      <p class="confirm-demo__text">画布里还有 3 个节点和 12 个资产。</p>
    </Confirm>
  </div>
</template>
<style scoped>
.confirm-demo__text { margin: 0; color: var(--mck-ink-muted); font-size: 12px; }
</style>
@@ENDVUE@@

- 基于 Dialog，继承焦点、ESC、遮罩行为。
- danger 模式确认键为红色。
- loading 时按钮都禁用，避免重复提交。

