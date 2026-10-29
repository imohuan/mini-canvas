# Button 按钮

## 案例墙

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Button, ButtonGroup, Tooltip } from '@mini-canvas/ui-kit'
import { Plus, Trash2, RefreshCw, Sparkles } from 'lucide-vue-next'

const loading = ref(false)
async function demo(): Promise<void> {
  loading.value = true
  await new Promise((r) => setTimeout(r, 1200))
  loading.value = false
}
</script>

<template>
  <div class="btn-wall">
    <div class="btn-row">
      <Button variant="primary" size="sm">主要 · 小</Button>
      <Button variant="primary" size="md">主要 · 中</Button>
      <Button variant="primary" size="lg">主要 · 大</Button>
      <Button variant="primary" loading>保存中</Button>
      <Button variant="primary" disabled>禁用</Button>
    </div>
    <div class="btn-row">
      <Button variant="secondary">次要</Button>
      <Button variant="ghost">轻量</Button>
      <Button variant="danger">危险</Button>
      <Button block>占满一行</Button>
    </div>
    <div class="btn-row">
      <Tooltip content="正方形图标按钮：宽高一致"><Button icon-only aria-label="新增" title="新增"><template #icon><Plus :size="16" /></template></Button></Tooltip>
      <Tooltip content="带 loading 的图标按钮"><Button icon-only variant="danger" loading aria-label="删除"><template #icon><Trash2 :size="16" /></template></Button></Tooltip>
      <Tooltip content="圆角图标按钮"><Button icon-only round variant="primary" aria-label="刷新"><template #icon><RefreshCw :size="16" /></template></Button></Tooltip>
      <Button variant="ghost" loading aria-label="等待"><template #icon><Sparkles :size="16" /></template></Button>
    </div>
    <div class="btn-row">
      <ButtonGroup block aria-label="操作组">
        <Button variant="secondary">开始</Button>
        <Button variant="ghost">预览</Button>
        <Button variant="ghost">发布</Button>
      </ButtonGroup>
    </div>
    <div class="btn-row is-long">
      <Button>这是一段很长的按钮文字，用来检查文本溢出、换行和视觉重量在真实场景下是否稳定。</Button>
      <Button variant="ghost" size="sm">同一行按钮的小尺寸长文本测试</Button>
    </div>
  </div>
</template>
@@ENDVUE@@

图标按钮永远保持正方形：宽高都来自同一档尺寸变量，改 Provider 的 size 也不会变形。

## Props

| 属性 | 默认值 | 说明 |
| --- | --- | --- |
| variant | 'secondary' | primary / secondary / ghost / danger |
| size | Provider 的 size | sm / md / lg |
| block | false | 占满父容器宽度 |
| disabled | false | 真禁用，事件不派发 |
| loading | false | 自动禁用并显示等待 |
| iconOnly | 自动 | 只有图标插槽时自动正方形；可显式覆盖 |
| round | false | 全圆角胶囊 |
| ariaLabel | 无 | 图标按钮必填，也是复制示例时的无障碍名称 |
| title | 无 | 悬停提示 |
| type | 'button' | 避免表单误提交 |

## Events

- click：按钮真正可点时派发，loading / disabled 不触发。

## Slots

- default：文字内容。
- icon：图标；只有 icon 没有文字会自动变图标按钮。

## 压力测试

- 不同 size 的正方形图标按钮，宽高一致。
- 超长文字不会被截成空按钮，次要长文本也保持单行省略。
- loading 与 disabled 同时存在时只显示 loading。
- 与 Tooltip 嵌套时仍能聚焦、读屏可朗读 aria-label。

