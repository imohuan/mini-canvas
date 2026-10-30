# Tabs 选项卡

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Tabs } from '@mini-canvas/ui-kit'

const tab = ref('preview')
</script>

<template>
  <div class="tabs-demo">
    <Tabs v-model="tab" block :items="[
      { value: 'preview', label: '预览' },
      { value: 'code', label: '代码', badge: 3 },
      { value: 'docs', label: '文档' },
      { value: 'settings', label: '设置', disabled: true },
    ]" />
  </div>
</template>
<style scoped>
.tabs-demo { display: flex; flex-direction: column; gap: 12px; width: min(460px, 100%); }
</style>
@@ENDVUE@@

- 左右方向键在可用项间循环；Home / End 跳到首尾。
- badge 显示数字或短文本。
- 超出宽度时整条横向滚动，不换行。

