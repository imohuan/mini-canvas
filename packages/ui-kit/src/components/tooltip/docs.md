# Tooltip 文字提示

@@VUE@@
<script setup lang="ts">
import { Tooltip, Button } from '@mini-canvas/ui-kit'
</script>

<template>
  <div class="tip-demo">
    <Tooltip content="顶部提示" placement="top"><Button>上</Button></Tooltip>
    <Tooltip content="右侧提示，比较长的时候会自动换行，不会撑破面板。" placement="right"><Button>右</Button></Tooltip>
    <Tooltip content="禁用状态" disabled><Button disabled>禁用</Button></Tooltip>
  </div>
</template>
<style scoped>
.tip-demo { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
</style>
@@ENDVUE@@

悬停或键盘聚焦都会出现；Esc 关闭。

