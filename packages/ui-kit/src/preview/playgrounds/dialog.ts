import { readText, readBool, type ComponentPlayground } from './types'

export const dialogPlayground: ComponentPlayground = {
  id: 'dialog',
  defaults: {
    title: '编辑画布信息',
    description: '所有字段都会保存到云。',
    width: '480px',
    showClose: true,
    closeOnOverlay: true,
    closeOnEscape: true,
    lockScroll: true,
    longContent: false,
  },
  fields: [
    { kind: 'text', key: 'title', label: '标题', placeholder: '例如：编辑画布信息' },
    { kind: 'text', key: 'description', label: '说明', placeholder: '标题下面那行小字' },
    { kind: 'text', key: 'width', label: '面板宽度', placeholder: '例如：480px' },
    { kind: 'toggle', key: 'showClose', label: '显示关闭按钮' },
    { kind: 'toggle', key: 'closeOnOverlay', label: '点遮罩关闭' },
    { kind: 'toggle', key: 'closeOnEscape', label: 'Esc 关闭' },
    { kind: 'toggle', key: 'lockScroll', label: '锁定背景滚动' },
    { kind: 'toggle', key: 'longContent', label: '长内容（内部滚动）' },
  ],
  presets: [
    { id: 'form', name: '表单对话框', description: '两行输入 + 底部按钮', patch: { title: '编辑画布信息', description: '所有字段都会保存到云。', width: '480px', showClose: true, closeOnOverlay: true, closeOnEscape: true, lockScroll: true, longContent: false } },
    { id: 'long', name: '长内容', description: '面板内部滚动', patch: { title: '使用说明', description: '', width: '540px', showClose: true, closeOnOverlay: true, closeOnEscape: true, lockScroll: true, longContent: true } },
    { id: 'locked', name: '必须处理', description: '不能点遮罩关闭', patch: { title: '还有未保存的修改', description: '关闭前请先保存。', width: '400px', showClose: false, closeOnOverlay: false, closeOnEscape: false, lockScroll: true, longContent: false } },
  ],
  summary: (s) => {
    const flags = [readText(s, 'width') || '自适应宽']
    if (!readBool(s, 'closeOnOverlay')) flags.push('遮罩不可关')
    if (!readBool(s, 'closeOnEscape')) flags.push('Esc 不关')
    if (readBool(s, 'longContent')) flags.push('长内容')
    return flags.join(' · ')
  },
}
