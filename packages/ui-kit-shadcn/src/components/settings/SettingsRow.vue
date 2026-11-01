<script setup lang="ts">
/**
 * SettingsRow —— 一行配置：左边标题 + 说明，右边控件。
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
  min-height: 42px;
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
