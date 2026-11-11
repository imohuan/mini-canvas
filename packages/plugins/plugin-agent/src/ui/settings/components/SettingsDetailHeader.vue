<script setup lang="ts">
/**
 * SettingsDetailHeader —— 设置里的「二级页」页头：返回 + 标题 + 一句说明。
 *
 * 用户口径（2026-11-11）：点编辑要像切换二级菜单，先把列表收起来，
 * 再显示这一页；返回按钮明确告诉用户怎么回去。
 */
import { ArrowLeft } from 'lucide-vue-next'
import { useUiComponent } from '@plume-canvas/canvas-render'

const Button = useUiComponent('Button')

defineProps<{
  backLabel: string
  title: string
  description?: string
}>()

defineEmits<{
  (e: 'back'): void
}>()
</script>

<template>
  <header class="sdh">
    <div class="sdh-top">
      <Button variant="ghost" size="xs" type="button" class="sdh-back" @click="$emit('back')">
        <ArrowLeft :size="14" aria-hidden="true" /> {{ backLabel }}
      </Button>
      <slot name="actions" />
    </div>
    <div class="sdh-text">
      <h3 class="sdh-title">{{ title }}</h3>
      <p v-if="description" class="sdh-desc">{{ description }}</p>
    </div>
  </header>
</template>

<style scoped>
/* sticky 只在**设置的滚动容器**里生效：长表单往下翻时标题和返回仍看得见。
   背景用面板底色，避免内容从下面透上来。 */
.sdh {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding-bottom: 8px;
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--ui-panel, #fff);
}
.sdh-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 24px; }
.sdh-back { margin-left: -8px; padding-inline: 8px; color: var(--ui-ink-dim, #6b7280); }
.sdh-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.sdh-title { margin: 0; font-size: 14px; font-weight: 700; line-height: 1.35; color: var(--ui-ink, #18202b); text-align: left; }
.sdh-desc { margin: 0; font-size: 11px; line-height: 1.55; color: var(--ui-ink-dim, #6b7280); text-align: left; }
</style>
