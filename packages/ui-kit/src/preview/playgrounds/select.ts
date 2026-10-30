import { SIZE_OPTIONS, readSize, readText, readBool, type ComponentPlayground } from './types'

export const selectPlayground: ComponentPlayground = {
  id: 'select',
  defaults: {
    value: 'image',
    size: 'md',
    searchable: false,
    clearable: true,
    grouped: false,
    disabled: false,
    invalid: false,
    error: '',
  },
  stretch: true,
  fields: [
    { kind: 'segment', key: 'size', label: '尺寸', options: SIZE_OPTIONS },
    { kind: 'toggle', key: 'searchable', label: '可搜索' },
    { kind: 'toggle', key: 'clearable', label: '可清空' },
    { kind: 'toggle', key: 'grouped', label: '分组显示' },
    { kind: 'toggle', key: 'invalid', label: '错误状态' },
    { kind: 'text', key: 'error', label: '错误提示', placeholder: '显示在选择器下方' },
    { kind: 'toggle', key: 'disabled', label: '禁用' },
  ],
  presets: [
    { id: 'basic', name: '基础选择', description: '四项，可清空', patch: { value: 'image', size: 'md', searchable: false, clearable: true, grouped: false, disabled: false, invalid: false, error: '' } },
    { id: 'search', name: '可搜索', description: '选项多时更好用', patch: { value: 'image', size: 'md', searchable: true, clearable: true, grouped: true, disabled: false, invalid: false, error: '' } },
    { id: 'error', name: '错误态', description: '红框 + 文案', patch: { value: null, size: 'md', searchable: false, clearable: true, grouped: false, disabled: false, invalid: true, error: '请先选择类型' } },
  ],
  summary: (s) => {
    const size = { sm: '小', md: '中', lg: '大' }[readSize(s)]
    const flags = [size]
    if (readBool(s, 'searchable')) flags.push('可搜索')
    if (readBool(s, 'grouped')) flags.push('分组')
    if (readBool(s, 'clearable')) flags.push('可清空')
    if (readBool(s, 'invalid')) flags.push('错误态')
    if (readBool(s, 'disabled')) flags.push('禁用')
    return flags.join(' · ')
  },
}
