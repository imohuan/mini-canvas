<script setup lang="ts">
/**
 * DemoSlotTab —— 自定义二级页签插槽测试组件（plugin-node-image 演示用）。
 *
 * 它被注册进 `settingsTab` 槽且 id = '图片/圆角'（命中 image 插件 config 的一个**二级**分组全名：
 * 一级「图片」下的一级是「圆角」），于是「图片」一级下的「圆角」这个二级页签的**默认观感被本组件顶替**。
 * 通过 props 收到对话框注入的能力（与 settingsNav occupant 完全对称）：
 *   group   — 本页签对应的完整分组 key（'图片/圆角'）
 *   active  — 当前是否激活（高亮态）
 *   onSelect(group) — 点它切换右侧到该完整分组的正文
 *
 * 只有"当前一级下二级分组多于一个"（即页签条显示时）settingsTab 插槽才会生效；
 * 若某一级只有孤零零一个二级分组，不会显示页签条，本插槽也不会有渲染机会。
 */
defineProps<{
  group?: string
  active?: boolean
  onSelect?: (group: string) => void
}>()
</script>

<template>
  <button type="button" class="dst" :class="{ on: active }" @click="onSelect?.(group ?? '')">
    {{ group?.split('/')[1] ?? group }}<span class="dst-tag">插槽</span>
  </button>
</template>

<style scoped>
.dst {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: #6b7280;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  transition: background 0.16s ease, color 0.16s ease;
}
.dst:hover {
  background: rgba(34, 197, 94, 0.14);
}
.dst.on {
  background: #16a34a;
  color: #fff;
}
.dst-tag {
  font-size: 10px;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.35);
}
</style>
