# Switch 开关

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Switch } from '@mini-canvas/ui-kit'

const value = ref(true)
</script>

<template>
  <div class="switch-demo">
    <Switch v-model="value" label="自动保存" description="每 30 秒保存一次" />
    <Switch :model-value="false" label="加载中" loading />
    <Switch :model-value="true" label="禁用" disabled />
    <Switch v-model="value" />
  </div>
</template>
<style scoped>
.switch-demo { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; }
</style>
@@ENDVUE@@

- label / description 可选，只有开关时也要给 aria-label。
- loading 时不可改，视觉上有等待状态。

