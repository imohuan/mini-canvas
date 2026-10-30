import { readText, readNumber, readBool, type ComponentPlayground } from './types'

export const tooltipPlayground: ComponentPlayground = {
  id: 'tooltip',
  defaults: {
    content: '顶部提示',
    placement: 'top',
    delay: 180,
    maxWidth: '280px',
    buttonLabel: '悬停我',
    disabled: false,
    focusable: true,
  },
  fields: [
    { kind: 'text', key: 'content', label: '提示文字', placeholder: '例如：这个功能做什么' },
    { kind: 'text', key: 'buttonLabel', label: '触发器文字', placeholder: '例如：悬停我' },
    { kind: 'segment', key: 'placement', label: '出现方向', options: [
      { value: 'top', label: '上' },
      { value: 'right', label: '右' },
      { value: 'bottom', label: '下' },
      { value: 'left', label: '左' },
    ] },
    { kind: 'number', key: 'delay', label: '延迟出现', min: 0, max: 1000, step: 20, suffix: 'ms' },
    { kind: 'text', key: 'maxWidth', label: '最大宽度', placeholder: '例如：280px' },
    { kind: 'toggle', key: 'focusable', label: '可聚焦' },
    { kind: 'toggle', key: 'disabled', label: '禁用' },
  ],
  presets: [
    { id: 'top', name: '顶部提示', description: '最常见', patch: { content: '顶部提示', placement: 'top', delay: 180, maxWidth: '280px', buttonLabel: '悬停我', disabled: false, focusable: true } },
    { id: 'long', name: '长文字换行', description: '限制最大宽度', patch: { content: '右侧提示，比较长的时候会自动换行，不会撑破面板。', placement: 'right', delay: 120, maxWidth: '200px', buttonLabel: '悬停我', disabled: false, focusable: true } },
    { id: 'instant', name: '立即出现', description: '没有延迟', patch: { content: '立刻显示', placement: 'bottom', delay: 0, maxWidth: '280px', buttonLabel: '悬停我', disabled: false, focusable: true } },
  ],
  summary: (s) => {
    const placement = { top: '上', right: '右', bottom: '下', left: '左' }[readText(s, 'placement')] ?? '上'
    const flags = [placement, readNumber(s, 'delay', 180) + 'ms']
    if (!readBool(s, 'focusable')) flags.push('不可聚焦')
    if (readBool(s, 'disabled')) flags.push('禁用')
    return flags.join(' · ')
  },
}
