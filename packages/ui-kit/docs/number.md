# NumberInput 数字输入

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { NumberInput } from '@mini-canvas/ui-kit'

const value = ref(8)
</script>

<template>
  <div class="num-demo">
    <NumberInput v-model="value" :min="0" :max="24" :step="2" suffix="小时" />
    <NumberInput v-model="value" :min="-5" :max="5" :step="0.1" :precision="1" />
    <NumberInput :model-value="null" placeholder="空值" controls />
    <NumberInput :model-value="6" disabled />
  </div>
</template>
@@ENDVUE@@

| 项目 | 说明 |
| --- | --- |
| min / max | 越界自动夹住 |
| step | 加减步长，上下方向键同值 |
| precision | 保留小数位 |
| controls | 显示 +/- 按钮 |
| 空值 | 传 null，清空后不参与计算 |

