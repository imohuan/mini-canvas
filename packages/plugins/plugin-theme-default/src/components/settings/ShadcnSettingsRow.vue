<script setup lang="ts">
/**
 * ShadcnSettingsRow —— 一行配置：左边标题 + 说明，右边控件。
 *
 * 实际排版在 @mini-canvas/ui-kit-shadcn 的 SettingsRow（含卡片内分割线规则）；
 * 这里保留同名文件，兼容旧 import。新代码请直接 import SettingsRow。
 */
import { SettingsRow } from '@mini-canvas/ui-kit-shadcn'

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
  <SettingsRow :label="label" :description="description" :stacked="stacked">
    <slot />
  </SettingsRow>
</template>
