import { readText, readNumber, readBool, type ComponentPlayground } from '../../preview/playground'

export const notifyPlayground: ComponentPlayground = {
  id: 'notify',
  defaults: {
    title: '已保存',
    description: '画布刚刚保存到云端。',
    tone: 'success',
    duration: 3600,
    withAction: false,
    actionLabel: '撤销',
    sticky: false,
  },
  fields: [
    { kind: 'text', key: 'title', label: '标题', placeholder: '例如：已保存' },
    { kind: 'text', key: 'description', label: '说明', placeholder: '标题下面那行小字' },
    { kind: 'segment', key: 'tone', label: '语气', options: [
      { value: 'success', label: '成功' },
      { value: 'primary', label: '进行中' },
      { value: 'warning', label: '警告' },
      { value: 'danger', label: '失败' },
      { value: 'info', label: '信息' },
    ] },
    { kind: 'number', key: 'duration', label: '停留时长（0 = 常驻）', min: 0, max: 10000, step: 200, suffix: 'ms' },
    { kind: 'toggle', key: 'withAction', label: '带操作按钮' },
    { kind: 'text', key: 'actionLabel', label: '操作按钮文字' },
    { kind: 'toggle', key: 'sticky', label: '常驻不自动关' },
  ],
  presets: [
    { id: 'saved', name: '保存成功', description: '3.6 秒后消失', patch: { title: '已保存', description: '画布刚刚保存到云端。', tone: 'success', duration: 3600, withAction: false, actionLabel: '撤销', sticky: false } },
    { id: 'retry', name: '同步失败', description: '常驻 + 重试按钮', patch: { title: '同步失败', description: '网络不稳定，稍后自动重试。', tone: 'danger', duration: 0, withAction: true, actionLabel: '立即重试', sticky: true } },
    { id: 'undo', name: '可撤销', description: '操作按钮 4 秒', patch: { title: '已删除节点', description: '', tone: 'info', duration: 4000, withAction: true, actionLabel: '撤销', sticky: false } },
  ],
  summary: (s) => {
    const tone = { success: '成功', primary: '进行中', warning: '警告', danger: '失败', info: '信息' }[readText(s, 'tone')] ?? '信息'
    const flags = [tone]
    flags.push(readBool(s, 'sticky') || readNumber(s, 'duration', 3600) === 0 ? '常驻' : readNumber(s, 'duration', 3600) + 'ms')
    if (readBool(s, 'withAction')) flags.push('带操作')
    return flags.join(' · ')
  },
}
