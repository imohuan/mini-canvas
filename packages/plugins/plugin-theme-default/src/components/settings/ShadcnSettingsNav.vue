<script setup lang="ts">
/**
 * ShadcnSettingsNav —— 设置左导航（第 0 级分类 + 一级图标菜单）。
 *
 * 两套设置皮都渲染这一份，所有插件也共用：插件只提交「分类 + 标题 + 图标」，
 * 外观（行高、对齐、选中底色、未选中颜色）全部收在这里，避免各画一套慢慢漂移。
 *
 * 分类顺序：内置「个人 / 集成 / 画布 / 开发」在前，插件新造的分类按出现顺序排后。
 */
import { computed } from 'vue'
import type { Component } from 'vue'
import ShadcnSettingsNavItem from './ShadcnSettingsNavItem.vue'
import { categoryRank, SETTINGS_CATEGORY_ORDER } from './navCategory'

export interface SettingsNavItemData {
  /** 一级菜单的稳定 key */
  key: string
  /** 显示名 */
  label: string
  /** 第 0 级分类 */
  category: string
  /** 图标组件 */
  icon?: unknown
  /** 插件自绘页（可选；有就渲染整页，没有就吃 settingsGroup 插槽） */
  page?: Component
}

const props = defineProps<{
  items: SettingsNavItemData[]
  active: string
}>()

const emit = defineEmits<{
  (e: 'select', key: string): void
}>()

interface NavGroup {
  category: string
  items: SettingsNavItemData[]
}

/** 按第 0 级分类分组；分类顺序固定，组内保持调用方给的顺序 */
const groups = computed<NavGroup[]>(() => {
  const map = new Map<string, SettingsNavItemData[]>()
  for (const item of props.items) {
    const list = map.get(item.category) ?? []
    list.push(item)
    map.set(item.category, list)
  }
  const extras: string[] = []
  for (const category of map.keys()) {
    if (!SETTINGS_CATEGORY_ORDER.includes(category) && !extras.includes(category)) extras.push(category)
  }
  return [...map.entries()]
    .map(([category, items]) => ({ category, items }))
    .sort((a, b) => categoryRank(a.category, extras) - categoryRank(b.category, extras))
})
</script>

<template>
  <aside class="ssn">
    <p v-if="!items.length" class="ssn-empty">暂无分组</p>
    <section v-for="group in groups" :key="group.category" class="ssn-group">
      <p class="ssn-caption">{{ group.category }}</p>
      <ShadcnSettingsNavItem
        v-for="item in group.items"
        :key="item.key"
        :icon="item.icon"
        :label="item.label"
        :active="active === item.key"
        @select="emit('select', item.key)"
      />
    </section>
  </aside>
</template>

<style scoped>
.ssn {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 2px;
  width: 192px;
  min-height: 0;
  /* 底部留白取 8px：内容多 12px 时正好不多出那 2px 的滚动条 */
  padding: 4px 10px 8px 2px;
  overflow-y: auto;
  border-right: 1px solid var(--ui-line-soft, #eef0f4);
}

.ssn-group {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.ssn-group + .ssn-group {
  margin-top: 12px;
}

.ssn-caption {
  margin: 2px 0 4px;
  padding: 0 10px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--ui-ink-mute, #8c95a3);
  text-align: left;
}

.ssn-empty {
  margin: 0;
  padding: 18px 10px;
  font-size: 12px;
  color: var(--ui-ink-mute, #8c95a3);
}

@media (max-width: 560px) {
  .ssn {
    width: 150px;
  }
}
</style>
