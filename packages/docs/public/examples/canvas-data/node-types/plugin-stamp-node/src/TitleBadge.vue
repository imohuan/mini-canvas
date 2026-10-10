<!-- 文件：packages/docs/public/examples/canvas-data/node-types/plugin-stamp-node/src/TitleBadge.vue -->
     格式：Vue 单文件组件（通配角标）
     位置：插件包内部；由 ctx.nodes.attach('*', { region: 'title' }) 挂到**所有**节点类型上 -->
<template>
  <span class="title-badge">NEW</span>
</template>

<style scoped>
.title-badge {
  padding: 0 5px;
  border-radius: 6px;
  background: var(--ui-accent-soft, rgb(8 145 178 / 0.12));
  color: var(--ui-accent-hover, #0e7490);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
</style>

