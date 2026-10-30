import { readText, readBool, type ComponentPlayground } from './types'

export const confirmPlayground: ComponentPlayground = {
  id: 'confirm',
  defaults: {
    title: '删除画布？',
    description: '这个操作会立即生效，删除后无法恢复。',
    body: '画布里还有 3 个节点和 12 个资产。',
    confirmText: '删除',
    cancelText: '保留',
    danger: true,
    loading: false,
  },
  fields: [
    { kind: 'text', key: 'title', label: '标题', placeholder: '例如：删除画布？' },
    { kind: 'text', key: 'description', label: '说明', placeholder: '标题下面那行小字' },
    { kind: 'text', key: 'body', label: '正文', placeholder: '面板中间那段话' },
    { kind: 'text', key: 'confirmText', label: '确认按钮文字' },
    { kind: 'text', key: 'cancelText', label: '取消按钮文字' },
    { kind: 'toggle', key: 'danger', label: '危险色' },
    { kind: 'toggle', key: 'loading', label: '确认中（按钮转圈）' },
  ],
  presets: [
    { id: 'danger', name: '删除确认', description: '危险红色按钮', patch: { title: '删除画布？', description: '这个操作会立即生效，删除后无法恢复。', body: '画布里还有 3 个节点和 12 个资产。', confirmText: '删除', cancelText: '保留', danger: true, loading: false } },
    { id: 'normal', name: '普通确认', description: '主色按钮', patch: { title: '发布这个版本？', description: '发布后其他人就能看到。', body: '', confirmText: '发布', cancelText: '再想想', danger: false, loading: false } },
    { id: 'loading', name: '提交中', description: '防止重复点击', patch: { title: '保存修改？', description: '保存需要几秒钟。', body: '', confirmText: '保存', cancelText: '取消', danger: false, loading: true } },
  ],
  summary: (s) => {
    const flags = [readBool(s, 'danger') ? '危险色' : '主色']
    flags.push('确认：' + (readText(s, 'confirmText') || '确认'))
    if (readBool(s, 'loading')) flags.push('提交中')
    return flags.join(' · ')
  },
}
