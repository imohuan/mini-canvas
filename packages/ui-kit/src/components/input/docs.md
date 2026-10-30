# Input 输入框

## 基础与可清空

最常见的一档：有值时出现清空键，清完焦点自动回到输入框。

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Input } from '@mini-canvas/ui-kit'

const value = ref('示例文本')
</script>

<template>
  <div class="col">
    <Input v-model="value" placeholder="搜索画布、资产或节点" clearable aria-label="搜索" />
    <Input placeholder="没有清空键" aria-label="普通输入" />
  </div>
</template>
<style scoped>
.col { display: flex; flex-direction: column; gap: 10px; width: min(360px, 100%); }
</style>
@@ENDVUE@@

## 前后缀

`prefix` 放图标，`suffix` 放单位或计数；两个插槽都不占输入区。

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Input } from '@mini-canvas/ui-kit'
import { Search } from 'lucide-vue-next'

const value = ref('画布')
</script>

<template>
  <div class="col">
    <Input v-model="value" placeholder="搜索" aria-label="搜索">
      <template #prefix><Search :size="16" /></template>
    </Input>
    <Input v-model="value" :maxlength="12" aria-label="限长">
      <template #suffix>{{ value.length }}/12</template>
    </Input>
  </div>
</template>
<style scoped>
.col { display: flex; flex-direction: column; gap: 10px; width: min(360px, 100%); }
</style>
@@ENDVUE@@

## 错误与提示

`error` 优先于 `hint`，两者都会通过 aria-describedby 关联到输入框。

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Input } from '@mini-canvas/ui-kit'

const name = ref('')
</script>

<template>
  <div class="col">
    <Input v-model="name" placeholder="画布名称" :error="name ? '' : '名称不能为空'" aria-label="画布名称" />
    <Input type="password" placeholder="密码" hint="至少 8 位，包含字母和数字" aria-label="密码" />
  </div>
</template>
<style scoped>
.col { display: flex; flex-direction: column; gap: 10px; width: min(360px, 100%); }
</style>
@@ENDVUE@@

## 禁用与只读

`disabled` 完全不响应；`readonly` 能选中复制，但不能改。

@@VUE@@
<script setup lang="ts">
import { Input } from '@mini-canvas/ui-kit'
</script>

<template>
  <div class="col">
    <Input model-value="禁用状态" disabled aria-label="禁用" />
    <Input model-value="只读状态" readonly aria-label="只读" />
    <Input type="password" model-value="secret" aria-label="密码" />
  </div>
</template>
<style scoped>
.col { display: flex; flex-direction: column; gap: 10px; width: min(360px, 100%); }
</style>
@@ENDVUE@@

## 三档尺寸

@@VUE@@
<script setup lang="ts">
import { Input } from '@mini-canvas/ui-kit'
</script>

<template>
  <div class="col">
    <Input size="sm" placeholder="小" aria-label="小" />
    <Input size="md" placeholder="中" aria-label="中" />
    <Input size="lg" placeholder="大" aria-label="大" />
  </div>
</template>
<style scoped>
.col { display: flex; flex-direction: column; gap: 10px; width: min(360px, 100%); }
</style>
@@ENDVUE@@

| 项目 | 说明 |
| --- | --- |
| v-model | 字符串，输入时即时更新 |
| size | sm / md / lg，默认跟 Provider |
| type | text / password / email / search / url / tel |
| clearable | 出现清空按钮，点击后聚焦回输入框 |
| error / hint | 错误或辅助说明，带 aria-describedby |
| prefix / suffix 插槽 | 图标、单位、计数 |
| change | 失焦时派发；input 每次输入派发 |
| ariaLabel | 读屏名称；没有可见 label 时必填 |





