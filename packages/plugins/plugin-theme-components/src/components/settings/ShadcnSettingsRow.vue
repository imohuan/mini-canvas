<script setup lang="ts">
/**
 * SettingsRow —— 设置页的一行：左边标题 + 说明，右边控件。
 *
 * 为什么住在主题插件（而不是组件库）：它**只在设置界面里出现**，属于应用层的排版决定，
 * 不是可复用的基础 UI。组件库只管按钮 / 输入 / 菜单这类到处都用得上的原子件。
 * 别处取件仍走 `useUiComponent('settingsRow')`，不直接 import 本文件。
 *
 * 相邻两行之间画一条分割线（卡片内不重复加边框）。控件宽度由调用方决定，
 * 这里只保证同一列对齐。
 */
defineProps<{
  /** 配置项标题 */
  label: string
  /** 一句说明（可选） */
  description?: string
  /** 控件独占一行（长文本、颜色、代码类字段用） */
  stacked?: boolean
}>()
</script>

<template>
  <div class="shadcn-settings-row" :class="{ 'is-stacked': stacked }">
    <div class="shadcn-settings-row__text">
      <span class="shadcn-settings-row__label">{{ label }}</span>
      <span v-if="description" class="shadcn-settings-row__desc">{{ description }}</span>
    </div>
    <div class="shadcn-settings-row__control">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.shadcn-settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  /* 行高跟主题尺寸档走（10px 上下 padding + 内容行高本身已达标）。 */
  min-height: calc(var(--plume-size-control-h, 2.25rem) - 4px);
  padding: 10px 0;
}

/* 卡片内分割线：最浅的一档柔线，避免每组行都像被粗框切开 */
.shadcn-settings-row + .shadcn-settings-row {
  border-top: 1px solid var(--ui-line-faint, var(--ui-line-soft, #eef0f4));
}

.shadcn-settings-row__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.shadcn-settings-row__label {
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
  color: var(--ui-ink, #18202b);
  text-align: left;
}

.shadcn-settings-row__desc {
  font-size: 12px;
  line-height: 1.5;
  color: var(--ui-ink-dim, #6b7280);
  text-align: left;
}

.shadcn-settings-row__control {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: flex-end;
}

/* 独占一行：文字在上、控件在下，颜色/路径这类宽控件不挤压布局 */
.shadcn-settings-row.is-stacked {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}

.shadcn-settings-row.is-stacked .shadcn-settings-row__control {
  justify-content: flex-start;
}
</style>
