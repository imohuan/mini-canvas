import { SIZE_OPTIONS, readSize, readBool, type ComponentPlayground } from '../../preview/playground'

export const tabsPlayground: ComponentPlayground = {
  id: 'tabs',
  defaults: {
    value: 'preview',
    size: 'md',
    block: true,
    showBadge: true,
    showDisabled: true,
  },
  stretch: true,
  fields: [
    { kind: 'segment', key: 'size', label: '尺寸', options: SIZE_OPTIONS },
    { kind: 'toggle', key: 'block', label: '占满整行' },
    { kind: 'toggle', key: 'showBadge', label: '显示徽标' },
    { kind: 'toggle', key: 'showDisabled', label: '包含禁用项' },
  ],
  presets: [
    { id: 'block', name: '整行选项卡', description: '四等分', patch: { value: 'preview', size: 'md', block: true, showBadge: true, showDisabled: true } },
    { id: 'compact', name: '紧凑', description: '按内容宽度', patch: { value: 'preview', size: 'sm', block: false, showBadge: false, showDisabled: false } },
  ],
  summary: (s) => {
    const size = { sm: '小', md: '中', lg: '大' }[readSize(s)]
    const flags = [size]
    flags.push(readBool(s, 'block') ? '整行' : '按内容')
    if (readBool(s, 'showBadge')) flags.push('带徽标')
    if (readBool(s, 'showDisabled')) flags.push('含禁用项')
    return flags.join(' · ')
  },
}
