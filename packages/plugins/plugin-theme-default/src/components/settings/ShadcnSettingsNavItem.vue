<script setup lang="ts">
/**
 * ShadcnSettingsNavItem —— 设置左导航的一项（图标 + 名称）。
 *
 * 两套设置皮、所有插件共用这一个外观：文字左对齐、未选中的颜色统一、选中只加浅底。
 * 插件不再自绘导航项；它们只提供标题/分类/图标（见 navCategory.ts）。
 */
import { computed } from 'vue'
import type { Component } from 'vue'

const props = defineProps<{
  /** 图标组件（lucide-vue-next 或任意 Vue 组件） */
  icon?: unknown
  /** 显示名称 */
  label: string
  /** 是否为当前选中项 */
  active?: boolean
}>()

const emit = defineEmits<{
  (e: 'select'): void
}>()

/** 把 unknown 收窄成组件类型，模板里的 :is 才不会拿到脏值 */
const iconComponent = computed<Component | undefined>(() => {
  const value = props.icon
  if (typeof value === 'function' || (value && typeof value === 'object')) {
    return value as Component
  }
  return undefined
})
</script>

<template>
  <button
    type="button"
    class="shadcn-nav-item"
    :class="{ 'is-active': active }"
    :aria-current="active ? 'page' : undefined"
    @click="emit('select')"
  >
    <span class="shadcn-nav-item__icon" aria-hidden="true">
      <component :is="iconComponent" v-if="iconComponent" :size="15" :stroke-width="1.8" />
    </span>
    <span class="shadcn-nav-item__label">{{ label }}</span>
  </button>
</template>

<style scoped>
.shadcn-nav-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  /* 行级交互目标 ≥ 44px（docs/design/ui-style-guide.md §1 原则 4 / §5 第 4 条）。
     之前 34px 是按「紧凑列表」的直觉给的，但左侧导航是真正要点的一列行，
     按规范给到 44；行距仍靠 2px gap 保持紧凑感。 */
  min-height: 44px;
  box-sizing: border-box;
  padding: 0 10px;
  border: 0;
  /* 跟随全局圆角档位（--mct-radius），没选时用项目 8px。
     只写 --radius-control 会绕开主题设置，改圆角后左导航还是老样子。 */
  border-radius: var(--mct-radius, var(--radius-control, 8px));
  background: transparent;
  /* 未选中统一用弱化的文字色；不靠 opacity，避免和插件自带样式叠加后深浅不一 */
  color: var(--ui-ink-dim, #6b7280);
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
  text-align: left;
  cursor: pointer;
  transition: background var(--dur-hover, 0.18s) ease, color var(--dur-hover, 0.18s) ease;
}

.shadcn-nav-item:hover {
  background: var(--ui-hover, rgb(0 0 0 / 0.05));
  color: var(--ui-ink, #18202b);
}

/* 选中：中性浅底 + 正常文字色，不用强调色染整行 */
.shadcn-nav-item.is-active {
  background: var(--ui-panel-active, #e8eaf0);
  color: var(--ui-ink, #18202b);
  font-weight: 600;
}

.shadcn-nav-item:focus-visible {
  outline: 2px solid var(--ui-accent-ring, rgb(8 145 178 / 0.6));
  outline-offset: -1px;
}

.shadcn-nav-item__icon {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  /* 图标跟文字同色：整行只靠底色表达选中 */
  color: inherit;
}

.shadcn-nav-item.is-active .shadcn-nav-item__icon,
.shadcn-nav-item:hover .shadcn-nav-item__icon {
  color: inherit;
}

.shadcn-nav-item__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}
</style>
