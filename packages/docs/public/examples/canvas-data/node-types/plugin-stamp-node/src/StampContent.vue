<!-- 文件：packages/docs/public/examples/canvas-data/node-types/plugin-stamp-node/src/StampContent.vue -->
     格式：Vue 单文件组件（in 区域：卡片内部的内容）
     位置：插件包内部；由 ctx.nodes.register 的 in 字段挂进展示注册表 -->
<script setup lang="ts">
/** 内容组件拿到的是外壳透传的 props：节点 id 与它的 data */
const props = defineProps<{ id: string; data?: Record<string, unknown> }>()
</script>

<template>
  <div class="stamp-content">
    <div class="stamp-rank">{{ String(props.data?.rank ?? '—') }}</div>
    <div class="stamp-note">{{ String(props.data?.note ?? '（双击写点什么）') }}</div>
  </div>
</template>

<style scoped>
/* 颜色一律走主题 token（见「主题与配色」那一组），不写死数值 */
.stamp-content {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 100%;
  padding: 10px 12px;
  box-sizing: border-box;
  color: var(--ui-ink, #18202b);
  font-size: 13px;
}
.stamp-rank {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  background: var(--ui-accent-soft, rgb(8 145 178 / 0.12));
  color: var(--ui-accent-hover, #0e7490);
  font-weight: 700;
}
.stamp-note {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  line-height: 1.5;
  white-space: pre-wrap;
}
</style>

