import { SIZE_OPTIONS, readSize, readText, readBool, type ComponentPlayground } from '../../preview/playground'

export const inputPlayground: ComponentPlayground = {
  id: 'input',
  defaults: {
    value: '',
    placeholder: '搜索画布、资产或节点',
    size: 'md',
    type: 'text',
    clearable: true,
    disabled: false,
    readonly: false,
    invalid: false,
    error: '',
    hint: '',
  },
  stretch: true,
  fields: [
    { kind: 'text', key: 'placeholder', label: '占位文字', placeholder: '还没输入时显示的提示' },
    { kind: 'segment', key: 'size', label: '尺寸', options: SIZE_OPTIONS },
    { kind: 'segment', key: 'type', label: '类型', options: [
      { value: 'text', label: '文本' },
      { value: 'password', label: '密码' },
      { value: 'email', label: '邮箱' },
      { value: 'search', label: '搜索' },
    ] },
    { kind: 'toggle', key: 'clearable', label: '可清空' },
    { kind: 'toggle', key: 'readonly', label: '只读' },
    { kind: 'toggle', key: 'disabled', label: '禁用' },
    { kind: 'toggle', key: 'invalid', label: '错误状态' },
    { kind: 'text', key: 'error', label: '错误提示', placeholder: '显示在输入框下方' },
    { kind: 'text', key: 'hint', label: '辅助说明', placeholder: '一行浅色提示' },
  ],
  presets: [
    { id: 'search', name: '搜索框', description: '带清空按钮', patch: { placeholder: '搜索画布、资产或节点', size: 'md', type: 'search', clearable: true, disabled: false, readonly: false, invalid: false, error: '', hint: '' } },
    { id: 'password', name: '密码框', description: '输入不可见', patch: { placeholder: '请输入密码', size: 'md', type: 'password', clearable: false, disabled: false, readonly: false, invalid: false, error: '', hint: '至少 8 位字符' } },
    { id: 'error', name: '错误态', description: '红框 + 错误文案', patch: { placeholder: '邮箱地址', size: 'md', type: 'email', clearable: true, disabled: false, readonly: false, invalid: true, error: '邮箱格式不正确', hint: '' } },
  ],
  summary: (s) => {
    const size = { sm: '小', md: '中', lg: '大' }[readSize(s)]
    const type = { text: '文本', password: '密码', email: '邮箱', search: '搜索' }[readText(s, 'type')] ?? '文本'
    const flags = [size, type]
    if (readBool(s, 'clearable')) flags.push('可清空')
    if (readBool(s, 'invalid')) flags.push('错误态')
    if (readBool(s, 'readonly')) flags.push('只读')
    if (readBool(s, 'disabled')) flags.push('禁用')
    return flags.join(' · ')
  },
}
