<script setup lang="ts">
/**
 * SettingsSection —— 设置页的二级小节（小标题 + 卡片）。
 *
 * 结构（用户口径 2026-11-02）：一级标题下面是一串二级小标题，每个标题下一张卡片，
 * 卡片里每行之间一条分割线。这里只负责「标题 + 卡片外壳」；行用 ShadcnSettingsRow。
 *
 * 为什么住在主题插件：它只服务设置界面，属于应用层布局，不是基础 UI。
 * 别处取件走 `useUiComponent('settingsSection')`，不直接 import 本文件。
 */
defineProps<{
  /** 二级小标题 */
  title: string
  /** 标题下的一句说明（可选） */
  description?: string
}>()
</script>

<template>
  <section class="shadcn-settings-section">
    <header class="shadcn-settings-section__head">
      <h3 class="shadcn-settings-section__title">{{ title }}</h3>
      <p v-if="description" class="shadcn-settings-section__desc">{{ description }}</p>
    </header>
    <div class="shadcn-settings-section__body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.shadcn-settings-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 0 20px;
}

.shadcn-settings-section__head {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.shadcn-settings-section__title {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.35;
  color: var(--ui-ink, #18202b);
  text-align: left;
}

.shadcn-settings-section__desc {
  margin: 0;
  font-size: 11px;
  line-height: 1.55;
  color: var(--ui-ink-dim, #6b7280);
  text-align: left;
}

/* 卡片：圆角由外层提供，这里只把行收进去、留出内边距 */
.shadcn-settings-section__body {
  display: flex;
  flex-direction: column;
  padding: 2px 16px;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: var(--radius-panel, 16px);
  background: var(--ui-panel, #fff);
  overflow: hidden;
}

/* 卡片里的行按卡片宽度收缩：给控件列留预算，长输入框才不会把行撑出卡片 */
.shadcn-settings-section__body > :deep(.shadcn-settings-row) {
  min-width: 0;
}

.shadcn-settings-section__body > :deep(.shadcn-settings-row__text) {
  flex: 1 1 auto;
}

.shadcn-settings-section__body > :deep(.shadcn-settings-row__control) {
  flex: 0 0 auto;
  max-width: 52%;
}

.shadcn-settings-section__body > :deep(.shadcn-settings-row.is-stacked .shadcn-settings-row__control) {
  max-width: 100%;
  width: 100%;
}
</style>
