import { SIZE_OPTIONS, readSize, readText, readBool, type ComponentPlayground } from '../../preview/playground'

export const switchPlayground: ComponentPlayground = {
  id: 'switch',
  defaults: {
    value: true,
    label: '自动保存',
    description: '每 30 秒保存一次',
    size: 'md',
    disabled: false,
    loading: false,
  },
  fields: [
    { kind: 'text', key: 'label', label: '标题', placeholder: '例如：自动保存' },
    { kind: 'text', key: 'description', label: '说明', placeholder: '标题下面那行小字' },
    { kind: 'segment', key: 'size', label: '尺寸', options: SIZE_OPTIONS },
    { kind: 'toggle', key: 'value', label: '默认打开' },
    { kind: 'toggle', key: 'loading', label: '加载中' },
    { kind: 'toggle', key: 'disabled', label: '禁用' },
  ],
  presets: [
    { id: 'save', name: '自动保存', description: '带说明文字', patch: { value: true, label: '自动保存', description: '每 30 秒保存一次', size: 'md', disabled: false, loading: false } },
    { id: 'bare', name: '纯开关', description: '只有开关本身', patch: { value: false, label: '', description: '', size: 'md', disabled: false, loading: false } },
    { id: 'loading', name: '加载中', description: '切换还没完成', patch: { value: false, label: '同步中', description: '正在读取云端设置', size: 'md', disabled: false, loading: true } },
  ],
  summary: (s) => {
    const size = { sm: '小', md: '中', lg: '大' }[readSize(s)]
    const flags = [size, readBool(s, 'value') ? '开' : '关']
    if (!readText(s, 'label')) flags.push('无标签')
    if (readBool(s, 'loading')) flags.push('加载中')
    if (readBool(s, 'disabled')) flags.push('禁用')
    return flags.join(' · ')
  },
}
