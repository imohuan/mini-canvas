<script setup lang="ts">
/**
 * ShadcnSettingsSection —— 设置页里的一个二级小节（小标题 + 卡片）。
 *
 * 右侧结构（用户口径 2026-11-01）：一级标题 → 二级小标题 + 卡片（内含分割线行）→ 下一个二级小标题。
 * 具体排版在 @mini-canvas/ui-kit-shadcn 的 SettingsSection：业务插件只依赖组件库，
 * 不把默认主题当组件库（仓库有依赖方向测试守着）。这里保留同名文件，兼容旧 import。
 */
import { SettingsSection } from '@mini-canvas/ui-kit-shadcn'

defineProps<{
  /** 二级小标题 */
  title: string
  /** 小标题下的一句说明（可选） */
  description?: string
}>()
</script>

<template>
  <SettingsSection :title="title" :description="description">
    <slot />
  </SettingsSection>
</template>
