# SplitPane 分割面板

@@VUE@@
<script setup lang="ts">
import { SplitPane } from '@mini-canvas/ui-kit'
</script>

<template>
  <div style="height: 220px; border: 1px solid var(--mck-line); border-radius: 12px; overflow: hidden">
    <SplitPane :initial="0.6" :min-left="120" :min-right="120">
      <template #left><div class="split-demo__pane">左</div></template>
      <template #right><div class="split-demo__pane">右</div></template>
    </SplitPane>
  </div>
</template>
<style scoped>
.split-demo__pane { display: grid; height: 100%; place-items: center; color: var(--mck-ink-muted); font-size: 12px; }
</style>
@@ENDVUE@@

拖动中间分隔线；越过最小尺寸会吸边收成一栏；双击恢复初始比例；键盘方向键微调。

| 属性 | 默认 | 说明 |
| --- | --- | --- |
| initial | 0.5 | 初始比例 |
| minLeft / minRight | 180 | 两栏最小尺寸 |
| snap | 56 | 吸边距离 |
| direction | horizontal | horizontal / vertical |

