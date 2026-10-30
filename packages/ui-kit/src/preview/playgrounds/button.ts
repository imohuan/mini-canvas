import { SIZE_OPTIONS, readSize, readText, readBool, type ComponentPlayground } from './types'

const VARIANTS = [
  { value: 'primary', label: '主要' },
  { value: 'secondary', label: '次要' },
  { value: 'ghost', label: '轻量' },
  { value: 'danger', label: '危险' },
]

export const buttonPlayground: ComponentPlayground = {
  id: 'button',
  defaults: {
    label: '开始创作',
    variant: 'primary',
    size: 'md',
    showIcon: true,
    iconOnly: false,
    block: false,
    round: false,
    disabled: false,
    loading: false,
  },
  fields: [
    { kind: 'text', key: 'label', label: '按钮文字', placeholder: '例如：保存草稿', maxlength: 24 },
    { kind: 'segment', key: 'variant', label: '外观', options: VARIANTS },
    { kind: 'segment', key: 'size', label: '尺寸', options: SIZE_OPTIONS },
    { kind: 'toggle', key: 'showIcon', label: '显示图标' },
    { kind: 'toggle', key: 'iconOnly', label: '只显示图标' },
    { kind: 'toggle', key: 'block', label: '占满宽度' },
    { kind: 'toggle', key: 'round', label: '圆角胶囊' },
    { kind: 'toggle', key: 'disabled', label: '禁用' },
    { kind: 'toggle', key: 'loading', label: '加载中' },
  ],
  presets: [
    { id: 'primary', name: '主要操作', description: '每个区域只放一个', patch: { label: '开始创作', variant: 'primary', size: 'md', showIcon: true, iconOnly: false, block: false, round: false, disabled: false, loading: false } },
    { id: 'quiet', name: '次要操作', description: '取消、了解详情', patch: { label: '了解详情', variant: 'ghost', size: 'md', showIcon: false, iconOnly: false, block: false, round: false, disabled: false, loading: false } },
    { id: 'danger', name: '危险操作', description: '删除前先确认', patch: { label: '删除画布', variant: 'danger', size: 'md', showIcon: true, iconOnly: false, block: false, round: false, disabled: false, loading: false } },
    { id: 'icon', name: '图标按钮', description: '必须带无障碍名称', patch: { label: '更多操作', variant: 'ghost', size: 'md', showIcon: true, iconOnly: true, block: false, round: false, disabled: false, loading: false } },
  ],
  summary: (s) => {
    const variant = { primary: '主要', secondary: '次要', ghost: '轻量', danger: '危险' }[readText(s, 'variant')] ?? '主要'
    const size = { sm: '小', md: '中', lg: '大' }[readSize(s)]
    const flags = [variant, size]
    if (readBool(s, 'iconOnly')) flags.push('纯图标')
    else if (readBool(s, 'showIcon')) flags.push('带图标')
    if (readBool(s, 'round')) flags.push('圆角')
    if (readBool(s, 'block')) flags.push('整行')
    if (readBool(s, 'loading')) flags.push('保存中')
    else if (readBool(s, 'disabled')) flags.push('禁用')
    return flags.join(' · ')
  },
}
