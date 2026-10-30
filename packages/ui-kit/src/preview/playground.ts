/**
 * 预览页的「试玩」状态：右侧配置面板改这里，中间预览立刻跟着变。
 *
 * 每个组件只声明自己的可调项；页面拿到 state 后再决定怎么渲染预览。
 * 加新组件时在同一份文件里补一条 item，页面侧的 switch 也补一支即可。
 */
import type { UiKitSize } from '../shared/types'

export type PlaygroundVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export interface PlaygroundState {
  label: string
  variant: PlaygroundVariant
  size: UiKitSize
  block: boolean
  disabled: boolean
  loading: boolean
  showIcon: boolean
  iconOnly: boolean
  round: boolean
}

export const DEFAULT_PLAYGROUND: PlaygroundState = {
  label: '开始创作',
  variant: 'primary',
  size: 'md',
  block: false,
  disabled: false,
  loading: false,
  showIcon: true,
  iconOnly: false,
  round: false,
}

export const VARIANT_LABELS: Record<PlaygroundVariant, string> = {
  primary: '主要',
  secondary: '次要',
  ghost: '轻量',
  danger: '危险',
}

export const VARIANT_ORDER: PlaygroundVariant[] = ['primary', 'secondary', 'ghost', 'danger']

export const SIZE_LABELS: Record<UiKitSize, string> = {
  sm: '小',
  md: '中',
  lg: '大',
}

export const SIZE_ORDER: UiKitSize[] = ['sm', 'md', 'lg']

export interface PlaygroundPreset {
  id: string
  name: string
  description: string
  patch: Partial<PlaygroundState>
}

export const PLAYGROUND_PRESETS: PlaygroundPreset[] = [
  {
    id: 'primary',
    name: '主要操作',
    description: '每个区域只放一个',
    patch: { label: '开始创作', variant: 'primary', size: 'md', showIcon: true, iconOnly: false, block: false, disabled: false, loading: false, round: false },
  },
  {
    id: 'quiet',
    name: '次要操作',
    description: '取消、了解详情',
    patch: { label: '了解详情', variant: 'ghost', size: 'md', showIcon: false, iconOnly: false, block: false, disabled: false, loading: false, round: false },
  },
  {
    id: 'danger',
    name: '危险操作',
    description: '删除前先确认',
    patch: { label: '删除画布', variant: 'danger', size: 'md', showIcon: true, iconOnly: false, block: false, disabled: false, loading: false, round: false },
  },
  {
    id: 'icon',
    name: '图标按钮',
    description: '必须带无障碍名称',
    patch: { label: '更多操作', variant: 'ghost', size: 'md', showIcon: true, iconOnly: true, block: false, disabled: false, loading: false, round: false },
  },
]

/** 预览区下面那行小字：把当前配置压成一句话。 */
export function summarize(state: PlaygroundState): string {
  const flags = [VARIANT_LABELS[state.variant], SIZE_LABELS[state.size]]
  if (state.iconOnly) flags.push('纯图标')
  else if (state.showIcon) flags.push('带图标')
  if (state.round) flags.push('圆角')
  if (state.block) flags.push('整行')
  if (state.loading) flags.push('保存中')
  else if (state.disabled) flags.push('禁用')
  return flags.join(' · ')
}
