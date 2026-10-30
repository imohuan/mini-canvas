# Input 输入框

## 完整案例

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Input } from '@mini-canvas/ui-kit'
import { Search } from 'lucide-vue-next'

const value = ref('示例文本')
</script>

<template>
  <div class="input-demo">
    <Input v-model="value" placeholder="搜索画布、资产或节点" clearable aria-label="搜索">
      <template #prefix><Search :size="16" /></template>
    </Input>
    <Input placeholder="禁用状态" disabled />
    <Input placeholder="只读状态" readonly />
    <Input v-model="value" placeholder="错误提示" :error="value ? '' : '不能为空'" aria-label="错误示例" />
    <Input type="password" placeholder="密码" hint="至少 8 位，包含字母和数字" aria-label="密码" />
    <Input v-model="value" :maxlength="12" aria-label="限长输入">
      <template #suffix>{{ value.length }}/12</template>
    </Input>
  </div>
</template>
<style scoped>
.input-demo { display: flex; flex-direction: column; gap: 10px; width: min(380px, 100%); }
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

## 压力

- 超长输入横向滚动，不撑破面板。
- error 与 hint 同时存在时优先 error。
- 键盘输入、鼠标清空、触屏光标都可用。

