<script setup lang="ts">
/**
 * DemoSlotNavItem —— 自定义导航插槽测试组件（plugin-node-image 演示用）。
 *
 * 它被注册进 `settingsNav` 插槽且 id = '边框'（命中 image 插件 config 的一个分组名），
 * 于是"边框"分组的**默认导航 tab 被本组件顶替**。它通过 props 收到对话框注入的能力：
 *   group   — 本项对应的分组 key（'边框'）
 *   active  — 当前是否激活（高亮态）
 *   onSelect(group) — 点它切换右侧到该分组内容（不给这个函数点了就没反应——这正是 slothost 注入的意义）
 *
 * 样式做成与默认 tab 观感接近的自定义导航项，肉眼可辨它来自插槽（带图标 + "插槽版"后缀）。
 */
defineProps<{
  group?: string
  active?: boolean
  onSelect?: (group: string) => void
}>()
</script>

<template>
  <!-- 整个导航项由插件自绘；点击委托给注入的 onSelect，实现"点它切右侧" -->
  <div class="dni" :class="{ on: active }" @click="onSelect?.(group ?? '')">
    <span class="dni-ico">◧</span>
    <span class="dni-txt">{{ group }}（插槽版）</span>
  </div>
</template>

<style scoped>
.dni {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  color: #374151;
  user-select: none;
}
.dni:hover {
  background: rgba(79, 124, 255, 0.12);
}
.dni.on {
  background: #22c55e;
  color: #fff;
}
.dni-ico {
  font-size: 13px;
}
.dni-txt {
  font-size: 12.5px;
}
</style>
