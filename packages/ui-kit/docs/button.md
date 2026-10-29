# Button 按钮

按钮只做一件事：让用户点一下，触发一个明确动作。例如开始创作、保存草稿、删除画布。

## 什么时候用

- 页面上最重要的一步，用主要按钮。
- 取消、了解详情这类附带动作，用轻量按钮。
- 删除、清空这类不可恢复的动作，用危险按钮，并先确认。

一个区域里只放一个主要按钮。按钮文字写清楚动作，比如「保存草稿」比「确定」更容易懂。

## 直接试一个

下面的按钮和上面预览区共享同一份配置。改右边的文字、外观或尺寸，这里会一起变。

@@VUE@@
<script setup lang="ts">
import { Button } from '@mini-canvas/ui-kit'
import { Sparkles } from 'lucide-vue-next'
</script>

<template>
  <Button variant="secondary" size="md">
    <template #icon>
      <Sparkles :size="16" />
    </template>
    收藏这个画布
  </Button>
</template>
@@ENDVUE@@

## 带一个图标

图标用 `icon` 插槽，尺寸用 16px。纯图标按钮必须同时给 `aria-label`，否则读屏软件不知道它是做什么的。

@@VUE@@
<script setup lang="ts">
import { Button } from '@mini-canvas/ui-kit'
import { Trash2 } from 'lucide-vue-next'
</script>

<template>
  <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap">
    <Button variant="ghost">
      <template #icon><Trash2 :size="16" /></template>
      删除
    </Button>
    <Button variant="ghost" aria-label="更多操作">
      <template #icon><Trash2 :size="16" /></template>
    </Button>
  </div>
</template>
@@ENDVUE@@

## 使用说明

| 属性 | 可选值 | 说明 |
| --- | --- | --- |
| variant | primary / secondary / ghost / danger | 外观，决定这一下有多重要 |
| size | sm / md / lg | 高度分别是 28 / 32 / 40 像素 |
| block | 开关 | 占满父容器一整行 |
| loading | 开关 | 显示等待，并自动禁止重复点击 |
| disabled | 开关 | 暂时不能点 |

颜色、圆角和动效都从项目的主题变量来。换亮色或暗色主题时，按钮会自己跟上。
