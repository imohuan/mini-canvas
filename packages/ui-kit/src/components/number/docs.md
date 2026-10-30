# NumberInput 数字输入

## 范围与步进

越界自动夹回；上下方向键和 +/- 按钮用同一个 step。

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { NumberInput } from '@mini-canvas/ui-kit'

const hours = ref(8)
</script>

<template>
  <div class="wall">
    <NumberInput v-model="hours" :min="0" :max="24" :step="2" suffix="小时" />
    <NumberInput v-model="hours" :min="0" :max="100" suffix="%" />
  </div>
</template>
<style scoped>
.wall { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
</style>
@@ENDVUE@@

## 小数精度

`precision` 决定显示和提交时保留几位，超出部分四舍五入。

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { NumberInput } from '@mini-canvas/ui-kit'

const rate = ref(1.5)
</script>

<template>
  <div class="wall">
    <NumberInput v-model="rate" :min="-5" :max="5" :step="0.1" :precision="1" />
    <NumberInput v-model="rate" :min="0" :max="1" :step="0.05" :precision="2" />
  </div>
</template>
<style scoped>
.wall { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
</style>
@@ENDVUE@@

## 空值与无按钮

传 `null` 表示还没填；`controls=false` 只留输入框，键盘照样能步进。

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { NumberInput } from '@mini-canvas/ui-kit'

const empty = ref<number | null>(null)
</script>

<template>
  <div class="wall">
    <NumberInput v-model="empty" placeholder="空值" controls />
    <NumberInput :model-value="6" :controls="false" aria-label="无按钮" />
  </div>
</template>
<style scoped>
.wall { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
</style>
@@ENDVUE@@

## 禁用

@@VUE@@
<script setup lang="ts">
import { NumberInput } from '@mini-canvas/ui-kit'
</script>

<template>
  <NumberInput :model-value="6" disabled />
</template>
@@ENDVUE@@

| 项目 | 说明 |
| --- | --- |
| min / max | 越界自动夹住 |
| step | 加减步长，上下方向键同值 |
| precision | 保留小数位 |
| controls | 显示 +/- 按钮 |
| 空值 | 传 null，清空后不参与计算 |

