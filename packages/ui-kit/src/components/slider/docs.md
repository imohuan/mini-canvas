# Slider 滑块

## 基础

拖动、点击轨道、键盘都改值；右侧默认显示当前值。

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Slider } from '@mini-canvas/ui-kit'

const volume = ref(64)
</script>

<template>
  <div class="col">
    <Slider v-model="volume" :min="0" :max="100" aria-label="音量" />
  </div>
</template>
<style scoped>
.col { display: flex; flex-direction: column; gap: 14px; width: min(400px, 100%); }
</style>
@@ENDVUE@@

## 小数步进与格式化

`format` 只改显示，不改真实值；小数步进会自动对齐到 step。

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Slider } from '@mini-canvas/ui-kit'

const scale = ref(1.5)
</script>

<template>
  <div class="col">
    <Slider v-model="scale" :min="0" :max="3" :step="0.1" :format="(v: number) => v.toFixed(1) + 'x'" aria-label="缩放" />
    <Slider v-model="scale" :min="0" :max="3" :step="0.1" :show-value="false" aria-label="不显示值" />
  </div>
</template>
<style scoped>
.col { display: flex; flex-direction: column; gap: 14px; width: min(400px, 100%); }
</style>
@@ENDVUE@@

## 三档尺寸与禁用

@@VUE@@
<script setup lang="ts">
import { Slider } from '@mini-canvas/ui-kit'
</script>

<template>
  <div class="col">
    <Slider :model-value="30" size="sm" aria-label="小" />
    <Slider :model-value="50" size="md" aria-label="中" />
    <Slider :model-value="70" size="lg" aria-label="大" />
    <Slider :model-value="40" :min="20" :max="80" :step="4" disabled aria-label="禁用" />
  </div>
</template>
<style scoped>
.col { display: flex; flex-direction: column; gap: 14px; width: min(400px, 100%); }
</style>
@@ENDVUE@@

| 属性 | 说明 |
| --- | --- |
| step | 步长，>0 生效 |
| showValue | 显示右侧数值，可关 |
| format | 数值格式化函数 |
| ariaLabel | 读屏名称 |

