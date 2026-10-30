import { SIZE_OPTIONS, readSize, readNumber, readText, readBool, type ComponentPlayground } from './types'

export const sliderPlayground: ComponentPlayground = {
  id: 'slider',
  defaults: {
    value: 40,
    min: 0,
    max: 100,
    step: 1,
    size: 'md',
    showValue: true,
    suffix: '',
    disabled: false,
  },
  stretch: true,
  fields: [
    { kind: 'range', key: 'value', label: '当前值', min: 0, max: 100, step: 1 },
    { kind: 'number', key: 'min', label: '最小值' },
    { kind: 'number', key: 'max', label: '最大值' },
    { kind: 'number', key: 'step', label: '步长', min: 1 },
    { kind: 'text', key: 'suffix', label: '后缀', placeholder: '例如：%' },
    { kind: 'segment', key: 'size', label: '尺寸', options: SIZE_OPTIONS },
    { kind: 'toggle', key: 'showValue', label: '显示数值' },
    { kind: 'toggle', key: 'disabled', label: '禁用' },
  ],
  presets: [
    { id: 'percent', name: '百分比', description: '0-100', patch: { value: 40, min: 0, max: 100, step: 1, size: 'md', showValue: true, suffix: '%', disabled: false } },
    { id: 'opacity', name: '不透明度', description: '带小数', patch: { value: 0.65, min: 0, max: 1, step: 0.05, size: 'md', showValue: true, suffix: '', disabled: false } },
    { id: 'disabled', name: '禁用', description: '不可拖动', patch: { value: 40, min: 0, max: 100, step: 1, size: 'md', showValue: true, suffix: '', disabled: true } },
  ],
  summary: (s) => {
    const size = { sm: '小', md: '中', lg: '大' }[readSize(s)]
    const flags = [size, readNumber(s, 'min', 0) + '–' + readNumber(s, 'max', 100)]
    flags.push('步长 ' + readNumber(s, 'step', 1))
    if (!readBool(s, 'showValue')) flags.push('隐藏数值')
    if (readBool(s, 'disabled')) flags.push('禁用')
    return flags.join(' · ')
  },
}
