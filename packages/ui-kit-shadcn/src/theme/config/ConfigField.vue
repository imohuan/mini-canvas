<script setup lang="ts">
/**
 * ConfigField —— 「组件配置」里一格字段的统一外壳。
 *
 * 只做三件事：标签、控件、可选说明。
 * 拆出来的目的：配置条改成 6 列后，每个字段都很窄，
 * 标题行高与控件尺寸必须一致，否则一行里会高矮不齐。
 */
import { Label } from '@/previewKit'

defineProps<{
  label: string
  /** 控件下方的小字说明（可选） */
  hint?: string
}>()
</script>

<template>
  <div class="grid min-w-0 gap-1.5">
    <Label class="truncate text-xs">{{ label }}</Label>
    <slot />
    <p v-if="hint" class="truncate text-[11px] leading-4 text-muted-foreground">{{ hint }}</p>
  </div>
</template>
