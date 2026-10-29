/**
 * Button 展示页的纯数据：初始值、预设和代码生成。
 *
 * 页面只负责布局与交互，这里单独放可测试的规则，避免“文案改了一处、示例代码没跟上”。
 * 库本身不依赖 lucide；只有在示例代码里展示“图标插槽”时才提到图标组件。
 */
import {
  BUTTON_SIZES,
  BUTTON_VARIANTS,
  type ButtonSize,
  type ButtonVariant,
} from '../components/buttonTypes'

export interface ButtonPlaygroundState {
  label: string
  variant: ButtonVariant
  size: ButtonSize
  block: boolean
  disabled: boolean
  loading: boolean
  showIcon: boolean
  iconOnly: boolean
}

export interface ButtonPreset {
  id: string
  name: string
  description: string
  patch: Partial<ButtonPlaygroundState>
}

export const DEFAULT_BUTTON_STATE: ButtonPlaygroundState = {
  label: '开始创作',
  variant: 'primary',
  size: 'md',
  block: false,
  disabled: false,
  loading: false,
  showIcon: true,
  iconOnly: false,
}

export const BUTTON_PRESETS: ButtonPreset[] = [
  {
    id: 'primary',
    name: '主要操作',
    description: '每个区域只放一个',
    patch: { label: '开始创作', variant: 'primary', size: 'md', showIcon: true, iconOnly: false, block: false, disabled: false, loading: false },
  },
  {
    id: 'quiet',
    name: '次要操作',
    description: '取消、了解详情',
    patch: { label: '了解详情', variant: 'ghost', size: 'md', showIcon: false, iconOnly: false, block: false, disabled: false, loading: false },
  },
  {
    id: 'danger',
    name: '危险操作',
    description: '删除前先确认',
    patch: { label: '删除画布', variant: 'danger', size: 'md', showIcon: true, iconOnly: false, block: false, disabled: false, loading: false },
  },
  {
    id: 'icon',
    name: '图标按钮',
    description: '必须带无障碍名称',
    patch: { label: '更多操作', variant: 'ghost', size: 'md', showIcon: true, iconOnly: true, block: false, disabled: false, loading: false },
  },
]

/** 右侧面板里可点的外观选项，中文名与库里的 variant 一一对应。 */
export const VARIANT_LABELS: Record<ButtonVariant, string> = {
  primary: '主要',
  secondary: '次要',
  ghost: '轻量',
  danger: '危险',
}

export const SIZE_LABELS: Record<ButtonSize, string> = {
  sm: '小',
  md: '中',
  lg: '大',
}

export { BUTTON_SIZES, BUTTON_VARIANTS }

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
}

/**
 * 按当前配置生成可复制的 SFC 片段。
 *
 * 这里把当前状态全写出来，方便用户照着改；纯图标时一定要带 aria-label，
 * 避免出现没有可读名称的图标按钮。
 */
export function buildButtonSnippet(state: ButtonPlaygroundState): string {
  const label = state.label.trim() || '按钮'
  // 纯图标按钮必须带一个真的图标；否则把「文字按钮」切成「图标按钮」后，
  // 复制出来会得到没有内容的方按钮。
  const needsIcon = state.showIcon || state.iconOnly
  const imports = ["import { Button } from '@mini-canvas/ui-kit'"]
  if (needsIcon) imports.push("import { Sparkles } from 'lucide-vue-next'")

  const lines = ['<template>', '  <Button', `    variant="${state.variant}"`, `    size="${state.size}"`]
  if (state.block) lines.push('    block')
  if (state.disabled) lines.push('    disabled')
  if (state.loading) lines.push('    loading')
  if (state.iconOnly) lines.push(`    aria-label="${escapeAttribute(label)}"`)
  lines.push('  >')
  if (needsIcon) {
    lines.push('    <template #icon>')
    lines.push('      <Sparkles :size="16" />')
    lines.push('    </template>')
  }
  if (!state.iconOnly) lines.push(`    ${label}`)
  lines.push('  </Button>', '</template>')

  return ['<script setup lang="ts">', ...imports, '</script>', '', ...lines].join('\n')
}

/** 展示页顶部的当前配置摘要，保持短句，不把参数堆成技术清单。 */
export function buildStateSummary(state: ButtonPlaygroundState): string {
  const flags = [VARIANT_LABELS[state.variant], SIZE_LABELS[state.size]]
  if (state.iconOnly) flags.push('纯图标')
  if (state.block) flags.push('整行')
  if (state.loading) flags.push('保存中')
  else if (state.disabled) flags.push('禁用')
  return flags.join(' · ')
}
