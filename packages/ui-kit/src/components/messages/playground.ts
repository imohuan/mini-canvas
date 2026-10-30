import { readText, readNumber, type ComponentPlayground } from '../../preview/playground'

export const messagesPlayground: ComponentPlayground = {
  id: 'messages',
  defaults: {
    text: '已复制到剪贴板',
    tone: 'neutral',
    duration: 2400,
  },
  fields: [
    { kind: 'text', key: 'text', label: '提示文字', placeholder: '例如：已复制' },
    { kind: 'segment', key: 'tone', label: '语气', options: [
      { value: 'neutral', label: '普通' },
      { value: 'success', label: '成功' },
      { value: 'info', label: '信息' },
      { value: 'warning', label: '警告' },
      { value: 'danger', label: '失败' },
    ] },
    { kind: 'number', key: 'duration', label: '显示时长', min: 600, max: 8000, step: 200, suffix: 'ms' },
  ],
  presets: [
    { id: 'copy', name: '复制成功', description: '最常见', patch: { text: '已复制到剪贴板', tone: 'neutral', duration: 2400 } },
    { id: 'success', name: '保存成功', description: '绿色', patch: { text: '保存成功', tone: 'success', duration: 2400 } },
    { id: 'long', name: '长文本', description: '看换行表现', patch: { text: '内容包含较长的中文与 English mixed text，看看换行表现。', tone: 'info', duration: 3600 } },
  ],
  summary: (s) => {
    const tone = { neutral: '普通', success: '成功', info: '信息', warning: '警告', danger: '失败' }[readText(s, 'tone')] ?? '普通'
    return [tone, readNumber(s, 'duration', 2400) + 'ms'].join(' · ')
  },
}
