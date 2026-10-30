import { readText, readBool, type ComponentPlayground } from '../../preview/playground'

export const contextMenuPlayground: ComponentPlayground = {
  id: 'context-menu',
  defaults: {
    hint: '在这块区域点右键',
    showIcons: true,
    showShortcut: true,
    showSubmenu: true,
    showDanger: true,
    showDisabled: true,
  },
  fields: [
    { kind: 'text', key: 'hint', label: '区域提示文字', placeholder: '例如：在这块区域点右键' },
    { kind: 'toggle', key: 'showIcons', label: '显示图标' },
    { kind: 'toggle', key: 'showShortcut', label: '显示快捷键' },
    { kind: 'toggle', key: 'showSubmenu', label: '包含子菜单' },
    { kind: 'toggle', key: 'showDanger', label: '包含危险项' },
    { kind: 'toggle', key: 'showDisabled', label: '包含禁用项' },
  ],
  presets: [
    { id: 'full', name: '完整菜单', description: '图标、快捷键、子菜单都有', patch: { hint: '在这块区域点右键', showIcons: true, showShortcut: true, showSubmenu: true, showDanger: true, showDisabled: true } },
    { id: 'plain', name: '纯文字', description: '只有标签', patch: { hint: '在这块区域点右键', showIcons: false, showShortcut: false, showSubmenu: false, showDanger: false, showDisabled: false } },
    { id: 'minimal', name: '最小菜单', description: '两项操作', patch: { hint: '点右键试试', showIcons: false, showShortcut: false, showSubmenu: false, showDanger: true, showDisabled: false } },
  ],
  summary: (s) => {
    const flags = []
    if (readBool(s, 'showIcons')) flags.push('图标')
    if (readBool(s, 'showShortcut')) flags.push('快捷键')
    if (readBool(s, 'showSubmenu')) flags.push('子菜单')
    if (readBool(s, 'showDanger')) flags.push('危险项')
    if (readBool(s, 'showDisabled')) flags.push('禁用项')
    return flags.length ? flags.join(' · ') : '纯文字菜单'
  },
}
