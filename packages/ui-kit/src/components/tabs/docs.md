# Tabs 选项卡

## 基础

`block` 让整条铺满，每项平分宽度。

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Tabs } from '@mini-canvas/ui-kit'

const tab = ref('preview')
</script>

<template>
  <Tabs v-model="tab" block :items="[
    { value: 'preview', label: '预览' },
    { value: 'code', label: '代码' },
    { value: 'docs', label: '文档' },
  ]" />
</template>
@@ENDVUE@@

## 徽标与禁用项

`badge` 接数字或短文本；禁用项会被方向键跳过。

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Tabs } from '@mini-canvas/ui-kit'

const tab = ref('code')
</script>

<template>
  <Tabs v-model="tab" :items="[
    { value: 'preview', label: '预览' },
    { value: 'code', label: '代码', badge: 3 },
    { value: 'docs', label: '文档' },
    { value: 'settings', label: '设置', disabled: true },
  ]" />
</template>
@@ENDVUE@@

## 三档尺寸

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Tabs } from '@mini-canvas/ui-kit'

const tab = ref('a')
</script>

<template>
  <div class="col">
    <Tabs v-model="tab" size="sm" :items="[{ value: 'a', label: '小' }, { value: 'b', label: '尺寸' }]" />
    <Tabs v-model="tab" size="md" :items="[{ value: 'a', label: '中' }, { value: 'b', label: '尺寸' }]" />
    <Tabs v-model="tab" size="lg" :items="[{ value: 'a', label: '大' }, { value: 'b', label: '尺寸' }]" />
  </div>
</template>
<style scoped>
.col { display: flex; flex-direction: column; gap: 12px; width: min(360px, 100%); }
</style>
@@ENDVUE@@

- 左右方向键在可用项间循环；Home / End 跳到首尾。
- 超出宽度时整条横向滚动，不换行。

