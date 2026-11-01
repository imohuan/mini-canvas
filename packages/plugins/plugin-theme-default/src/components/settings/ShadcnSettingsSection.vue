<script setup lang="ts">
/**
 * ShadcnSettingsSection —— 设置页里的一个小节（标题 + 说明 + 内容）。
 *
 * 只负责排版，不读配置。默认皮和成品皮共用这一份，两边的间距/字号才不会慢慢漂。
 */
defineProps<{
  /** 小节标题 */
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
  gap: 10px;
  padding: 18px 0;
  border-top: 1px solid var(--ui-line-soft, #eef0f4);
}

.shadcn-settings-section:first-child {
  padding-top: 4px;
  border-top: 0;
}

.shadcn-settings-section__head {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.shadcn-settings-section__title {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.35;
  color: var(--ui-ink, #18202b);
}

.shadcn-settings-section__desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.55;
  color: var(--ui-ink-dim, #6b7280);
}

.shadcn-settings-section__body {
  display: flex;
  flex-direction: column;
}
</style>
