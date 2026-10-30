# Switch 开关

## 带说明

`label` 是主标题，`description` 是下面那行小字；点整行都能切换。

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Switch } from '@mini-canvas/ui-kit'

const autoSave = ref(true)
</script>

<template>
  <Switch v-model="autoSave" label="自动保存" description="每 30 秒保存一次" />
</template>
@@ENDVUE@@

## 只有开关

不带文字时没有可见标签，必须补 `aria-label`。

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Switch } from '@mini-canvas/ui-kit'

const on = ref(false)
</script>

<template>
  <Switch v-model="on" aria-label="启用预览" />
</template>
@@ENDVUE@@

## 等待与禁用

`loading` 显示等待态且不能改；`disabled` 彻底不响应。

@@VUE@@
<script setup lang="ts">
import { Switch } from '@mini-canvas/ui-kit'
</script>

<template>
  <div class="col">
    <Switch :model-value="false" label="加载中" loading />
    <Switch :model-value="true" label="禁用" disabled />
  </div>
</template>
<style scoped>
.col { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; }
</style>
@@ENDVUE@@

## 三档尺寸

@@VUE@@
<script setup lang="ts">
import { Switch } from '@mini-canvas/ui-kit'
</script>

<template>
  <div class="col">
    <Switch :model-value="true" size="sm" label="小" />
    <Switch :model-value="true" size="md" label="中" />
    <Switch :model-value="true" size="lg" label="大" />
  </div>
</template>
<style scoped>
.col { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; }
</style>
@@ENDVUE@@

