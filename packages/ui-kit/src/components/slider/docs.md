# Slider 滑块

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Slider } from '@mini-canvas/ui-kit'

const value = ref(64)
</script>

<template>
  <div class="slider-demo">
    <Slider v-model="value" :min="0" :max="100" />
    <Slider :model-value="40" :min="20" :max="80" :step="4" disabled />
    <Slider :model-value="50" :min="0" :max="2" :step="0.1" :format="(v) => v.toFixed(1) + 'x'" />
  </div>
</template>
<style scoped>
.slider-demo { display: flex; flex-direction: column; gap: 14px; width: min(420px, 100%); }
</style>
@@ENDVUE@@

拖动、键盘（方向键 / PageUp / PageDown / Home / End）都可用；小数步进会自动取整到步长。

| 属性 | 说明 |
| --- | --- |
| step | 步长，>0 生效 |
| showValue | 显示右侧数值，可关 |
| format | 数值格式化函数 |
| ariaLabel | 读屏名称 |

