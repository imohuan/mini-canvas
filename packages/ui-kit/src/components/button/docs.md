# Button 按钮

顶部预览调单个按钮的参数；下面把外观、尺寸、图标、组合和极限文本分开摆。

## 四种外观

`primary` 一个区域只放一个，用来指路；其余动作降到 `secondary`、`ghost`。破坏性操作才用 `danger`。

@@VUE@@
<script setup lang="ts">
import { Button } from '@mini-canvas/ui-kit'
</script>

<template>
  <div class="wall">
    <Button variant="primary">创建画布</Button>
    <Button variant="secondary">保存</Button>
    <Button variant="ghost">取消</Button>
    <Button variant="danger">删除</Button>
  </div>
</template>
<style scoped>
.wall { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
</style>
@@ENDVUE@@

## 三档尺寸

`sm` 放工具栏，`md` 是默认，`lg` 留给引导页；同一行混排时高度对齐，不会参差。

@@VUE@@
<script setup lang="ts">
import { Button } from '@mini-canvas/ui-kit'
</script>

<template>
  <div class="wall">
    <Button size="sm">小 · 28px</Button>
    <Button size="md">中 · 32px</Button>
    <Button size="lg">大 · 38px</Button>
  </div>
</template>
<style scoped>
.wall { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
</style>
@@ENDVUE@@

## 等待与禁用

`loading` 会自动禁用，点下去不会再派发 click；`disabled` 是真禁用，事件和 Tab 都不进来。

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Button } from '@mini-canvas/ui-kit'

const saving = ref(false)
async function save(): Promise<void> {
  saving.value = true
  await new Promise((r) => setTimeout(r, 1400))
  saving.value = false
}
</script>

<template>
  <div class="wall">
    <Button variant="primary" :loading="saving" @click="save">
      {{ saving ? '保存中' : '点我保存' }}
    </Button>
    <Button variant="primary" loading>固定加载态</Button>
    <Button disabled>禁用</Button>
  </div>
</template>
<style scoped>
.wall { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
</style>
@@ENDVUE@@

## 图标按钮

只有 `icon` 插槽时自动变正方形；`aria-label` 是必填，读屏和复制示例都靠它。

@@VUE@@
<script setup lang="ts">
import { Button, Tooltip } from '@mini-canvas/ui-kit'
import { Plus, RefreshCw, Trash2, Sparkles } from 'lucide-vue-next'
</script>

<template>
  <div class="wall">
    <Tooltip content="新增"><Button icon-only aria-label="新增"><template #icon><Plus :size="16" /></template></Button></Tooltip>
    <Tooltip content="刷新"><Button icon-only round variant="primary" aria-label="刷新"><template #icon><RefreshCw :size="16" /></template></Button></Tooltip>
    <Tooltip content="删除"><Button icon-only variant="danger" aria-label="删除"><template #icon><Trash2 :size="16" /></template></Button></Tooltip>
    <Tooltip content="暂无数据"><Button icon-only disabled aria-label="暂无数据"><template #icon><Sparkles :size="16" /></template></Button></Tooltip>
    <Button variant="ghost" aria-label="等待"><template #icon><Sparkles :size="16" /></template>生成</Button>
  </div>
</template>
<style scoped>
.wall { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
</style>
@@ENDVUE@@

## 占满一行

`block` 把按钮拉成父级宽度，适合表单底部和空状态的主行动。

@@VUE@@
<script setup lang="ts">
import { Button } from '@mini-canvas/ui-kit'
</script>

<template>
  <div class="col">
    <Button block variant="primary">开始创作</Button>
    <Button block>稍后再说</Button>
  </div>
</template>
<style scoped>
.col { display: flex; flex-direction: column; gap: 8px; width: min(320px, 100%); }
</style>
@@ENDVUE@@

## 长文本

按钮不会被撑成空壳：主按钮按内容换行，次要的长文本保持单行省略。

@@VUE@@
<script setup lang="ts">
import { Button } from '@mini-canvas/ui-kit'
</script>

<template>
  <div class="wall">
    <Button>这是一段很长的按钮文字，用来检查文本溢出、换行和视觉重量在真实场景下是否稳定。</Button>
    <Button variant="ghost" size="sm">同一行按钮的小尺寸长文本测试</Button>
  </div>
</template>
<style scoped>
.wall { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; width: 100%; }
</style>
@@ENDVUE@@

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

