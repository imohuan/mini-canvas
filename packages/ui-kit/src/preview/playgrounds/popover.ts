import { readText, readBool, readNumber, type ComponentPlayground } from './types'

export const popoverPlayground: ComponentPlayground = {
  id: 'popover',
  defaults: {
    title: '重命名画布',
    description: '长内容会在卡片内滚动。',
    placement: 'bottom-start',
    offset: 8,
    width: '340px',
    closeOnOutside: true,
    closeOnEscape: true,
    disabled: false,
  },
  fields: [
    { kind: 'text', key: 'title', label: '标题', placeholder: '例如：重命名画布' },
    { kind: 'text', key: 'description', label: '说明', placeholder: '标题下面那行小字' },
    { kind: 'text', key: 'width', label: '面板宽度', placeholder: '例如：340px' },
    { kind: 'segment', key: 'placement', label: '弹出方向', options: [
      { value: 'bottom-start', label: '左下' },
      { value: 'bottom-end', label: '右下' },
      { value: 'top-start', label: '左上' },
      { value: 'right-start', label: '右侧' },
    ] },
    { kind: 'number', key: 'offset', label: '与触发器间距', min: 0, max: 40, suffix: 'px' },
    { kind: 'toggle', key: 'closeOnOutside', label: '点外部关闭' },
    { kind: 'toggle', key: 'closeOnEscape', label: 'Esc 关闭' },
    { kind: 'toggle', key: 'disabled', label: '禁用' },
  ],
  presets: [
    { id: 'rename', name: '重命名面板', description: '带输入框', patch: { title: '重命名画布', description: '长内容会在卡片内滚动。', placement: 'bottom-start', offset: 8, width: '340px', closeOnOutside: true, closeOnEscape: true, disabled: false } },
    { id: 'narrow', name: '窄面板', description: '只放一句话', patch: { title: '小提示', description: '', placement: 'bottom-end', offset: 8, width: '240px', closeOnOutside: true, closeOnEscape: true, disabled: false } },
  ],
  summary: (s) => {
    const placement = { 'bottom-start': '左下', 'bottom-end': '右下', 'top-start': '左上', 'right-start': '右侧' }[readText(s, 'placement')] ?? '左下'
    const flags = [placement, readText(s, 'width') || '自适应宽']
    if (!readBool(s, 'closeOnOutside')) flags.push('点外部不关')
    if (!readBool(s, 'closeOnEscape')) flags.push('Esc 不关')
    if (readBool(s, 'disabled')) flags.push('禁用')
    return flags.join(' · ')
  },
}
