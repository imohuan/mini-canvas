# Tooltip 文字提示

## 四个方向

默认在上方；靠近视口边缘会自动翻转，不会跑出屏幕。

@@VUE@@
<script setup lang="ts">
import { Tooltip, Button } from '@mini-canvas/ui-kit'
</script>

<template>
  <div class="wall">
    <Tooltip content="上方提示" placement="top"><Button variant="secondary">上</Button></Tooltip>
    <Tooltip content="下方提示" placement="bottom"><Button variant="secondary">下</Button></Tooltip>
    <Tooltip content="左侧提示" placement="left"><Button variant="secondary">左</Button></Tooltip>
    <Tooltip content="右侧提示" placement="right"><Button variant="secondary">右</Button></Tooltip>
  </div>
</template>
<style scoped>
.wall { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
</style>
@@ENDVUE@@

## 长文本换行

`max-width` 限住宽度，长句自动换行，不会拉成一条细线。

@@VUE@@
<script setup lang="ts">
import { Tooltip, Button } from '@mini-canvas/ui-kit'
</script>

<template>
  <Tooltip content="这是一段比较长的提示文字，用来检查换行和最大宽度。超过 max-width 会自动折行，不会撑破面板。" :max-width="220">
    <Button variant="ghost">长提示</Button>
  </Tooltip>
</template>
@@ENDVUE@@

## 延迟与禁用

`delay=0` 立刻出现；`disabled` 只保留触发器本身。

@@VUE@@
<script setup lang="ts">
import { Tooltip, Button } from '@mini-canvas/ui-kit'
</script>

<template>
  <div class="wall">
    <Tooltip content="立刻出现" :delay="0"><Button variant="secondary">无延迟</Button></Tooltip>
    <Tooltip content="不会显示"><Button variant="ghost">禁用提示</Button></Tooltip>
  </div>
</template>
<style scoped>
.wall { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
</style>
@@ENDVUE@@

悬停或键盘聚焦都会出现；Esc 关闭。

