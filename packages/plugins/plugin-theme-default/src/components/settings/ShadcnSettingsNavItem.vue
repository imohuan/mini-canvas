<script setup lang="ts">
/**
 * ShadcnSettingsNavItem —— 设置左导航的一项（图标 + 名称）。
 *
 * 图标从 settings/navIcon 场域取，调用方只传组件本身；这里不查注册表。
 * 用按钮而不是链接：点一下只切换右侧内容，不跳地址。
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
  min-height: 34px;
  box-sizing: border-box;
  padding: 0 10px;
  border: 0;
  border-radius: var(--radius-control, 8px);
  background: transparent;
  /* 未选中也要读得清：用常规文字色的一档灰，不用最淡的 muted */
  color: var(--ui-ink, #18202b);
  opacity: 0.72;
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
  opacity: 1;
}

/* 选中：中性浅底 + 正常文字色，不用强调色染整行 */
.shadcn-nav-item.is-active {
  background: var(--ui-panel-active, #e8eaf0);
  color: var(--ui-ink, #18202b);
  font-weight: 600;
  opacity: 1;
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
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
