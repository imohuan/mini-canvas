# SplitPane 分割面板

把一块区域分成两栏。中间的线可以拖动，拖到边上会自动收成一栏，双击分隔线恢复初始比例。

## 什么时候用

- 左边放列表，右边放内容。
- 上面放预览，下面放文档。
- 让用户自己决定两栏多大，而不是写死宽度。

## 左右分栏

标签里的内容没有限制。两个最小宽度保证文字始终可读。

@@VUE@@
<script setup lang="ts">
import { SplitPane } from '@mini-canvas/ui-kit'
</script>

<template>
  <div style="height: 140px; border: 1px solid var(--ui-line, #e2e5ea); border-radius: 10px; overflow: hidden">
    <SplitPane :initial="0.6" :min-left="80" :min-right="80">
      <template #left>
        <div style="display: grid; height: 100%; place-items: center; background: var(--ui-hover-soft, #f7f8fa); font-size: 12px">左边内容</div>
      </template>
      <template #right>
        <div style="display: grid; height: 100%; place-items: center; font-size: 12px">右边内容</div>
      </template>
    </SplitPane>
  </div>
</template>
@@ENDVUE@@

## 上下分栏

把 `direction` 改成 `vertical`，两个插槽就变成上、下。拖动与吸边规则一样。

@@VUE@@
<script setup lang="ts">
import { SplitPane } from '@mini-canvas/ui-kit'
</script>

<template>
  <div style="height: 160px; border: 1px solid var(--ui-line, #e2e5ea); border-radius: 10px; overflow: hidden">
    <SplitPane direction="vertical" :initial="0.4" :min-left="48" :min-right="48">
      <template #left>
        <div style="display: grid; height: 100%; place-items: center; background: var(--ui-hover-soft, #f7f8fa); font-size: 12px">上面</div>
      </template>
      <template #right>
        <div style="display: grid; height: 100%; place-items: center; font-size: 12px">下面</div>
      </template>
    </SplitPane>
  </div>
</template>
@@ENDVUE@@

## 使用说明

| 属性 | 默认值 | 说明 |
| --- | --- | --- |
| initial | 0.5 | 初始比例，左/上侧占多少 |
| minLeft | 180 | 左/上侧最小像素 |
| minRight | 180 | 右/下侧最小像素 |
| snap | 56 | 越过最小尺寸多少像素后收成一栏 |
| direction | horizontal | 改成 vertical 就是上下分栏 |

分隔线可以用鼠标拖，也可以聚焦后用方向键微调。双击或按 Home 回到初始比例。
