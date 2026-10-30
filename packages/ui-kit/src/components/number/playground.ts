import { SIZE_OPTIONS, readSize, readNumber, readBool, type ComponentPlayground } from '../../preview/playground'

export const numberPlayground: ComponentPlayground = {
  id: 'number',
  defaults: {
    value: 6,
    min: 0,
    max: 24,
    step: 2,
    precision: 0,
    suffix: '小时',
    size: 'md',
    controls: true,
    disabled: false,
    readonly: false,
    invalid: false,
  },
  fields: [
    { kind: 'number', key: 'value', label: '当前值' },
    { kind: 'number', key: 'min', label: '最小值' },
    { kind: 'number', key: 'max', label: '最大值' },
    { kind: 'number', key: 'step', label: '步长' },
    { kind: 'number', key: 'precision', label: '小数位', min: 0, max: 4 },
    { kind: 'text', key: 'suffix', label: '单位', placeholder: '例如：小时' },
    { kind: 'segment', key: 'size', label: '尺寸', options: SIZE_OPTIONS },
    { kind: 'toggle', key: 'controls', label: '显示加减' },
    { kind: 'toggle', key: 'readonly', label: '只读' },
    { kind: 'toggle', key: 'disabled', label: '禁用' },
    { kind: 'toggle', key: 'invalid', label: '错误状态' },
  ],
  presets: [
    { id: 'hours', name: '小时数', description: '0-24，每次 2', patch: { value: 6, min: 0, max: 24, step: 2, precision: 0, suffix: '小时', size: 'md', controls: true, disabled: false, readonly: false, invalid: false } },
    { id: 'decimal', name: '小数', description: '一位小数，带加减', patch: { value: 1.5, min: -5, max: 5, step: 0.1, precision: 1, suffix: '', size: 'md', controls: true, disabled: false, readonly: false, invalid: false } },
    { id: 'plain', name: '纯输入', description: '不要加减按钮', patch: { value: 12, min: 0, max: 100, step: 1, precision: 0, suffix: 'px', size: 'md', controls: false, disabled: false, readonly: false, invalid: false } },
  ],
  summary: (s) => {
    const size = { sm: '小', md: '中', lg: '大' }[readSize(s)]
    const flags = [size, readNumber(s, 'min', 0) + '–' + readNumber(s, 'max', 100)]
    flags.push('步长 ' + readNumber(s, 'step', 1))
    if (!readBool(s, 'controls')) flags.push('无加减')
    if (readBool(s, 'readonly')) flags.push('只读')
    if (readBool(s, 'disabled')) flags.push('禁用')
    return flags.join(' · ')
  },
}
