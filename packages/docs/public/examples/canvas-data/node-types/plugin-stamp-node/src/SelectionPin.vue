<!-- 文件：packages/docs/public/examples/canvas-data/node-types/plugin-stamp-node/src/SelectionPin.vue -->
     格式：Vue 单文件组件（多选框上控制栏里的一项）
     位置：插件包内部；由 ctx.selectionRegion.attach({ region: 'out:top' }) 挂到多选框上 -->
<template>
  <button class="selection-pin" type="button">批量盖章</button>
</template>

<style scoped>
.selection-pin {
  height: 22px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ntb-text, #6b7280);
  font-size: 11px;
  cursor: pointer;
}
.selection-pin:hover { background: var(--ntb-fill-hover, rgb(0 0 0 / 0.06)); }
</style>

